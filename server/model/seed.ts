// The model, first drawn from the scan: the basement as it is (every area's walls, its windows and
// doors, the stairs, furnace, water heater, panel, plumbing, and the beams, ducts and bulkheads with
// the headroom under them), then a few designs for the suite, each permit-ready from the start: the
// stair and furnace room behind 30-minute walls, a 20-minute door with a closer into the suite, a
// 15-minute ceiling, the bedroom on an escape window, 81 cm doors, alarms by the rules, a clear way out.
import type { Plan as ScanPlan, RoomResult } from "../../src/api";
import { basementRooms } from "../../src/components/basementPlan";
import { suggestLayout, type Layout, type LayoutOptions } from "../layout";
import type { Plan, Side } from "../plan";
import { burnsFuel, placeAlarms } from "./alarms";
import { checkDesign } from "./checks";
import { applyEdits, nextId } from "./edit";
import { add, along, bounds, clamp, dist, inPolygon, mul, polygonArea, project, r2, r3, rectPoly, wallLength, wallNormal, type Box } from "./geometry";
import type { Design, Edit, Existing, Finishes, Fixture, FixtureKind, Model, Opening, Pt, Room, RoomKind, Wall } from "./types";

// Anything overhead has its underside well above furniture; below this SAM outlined a shelf
// (server/scan3d.ts lowOverhead).
const MIN_OVERHEAD_M = 1.2;
const FIXTURE_SIZE: Partial<Record<FixtureKind, Pt>> = { furnace: [0.6, 0.7], water_heater: [0.55, 0.55], panel: [0.5, 0.15], plumbing: [0.3, 0.3] };
const NEW_WALL_M = 0.12; // 2x4 studs and drywall
const DOOR_M = 0.81; // the narrowest door the checks allow
const LANDING_M = 1.0; // at the foot of the stairs, to step off and open the door

type Tape = { egressWidthMm?: number | null; egressHeightMm?: number | null; egressSillMm?: number | null; ceilingMm?: number | null };

type ScanResultLike = {
  plan?: ScanPlan | null;
  rooms?: RoomResult[];
  mainRoom?: number | null;
  measurements?: { ceilingHeightM: number | null; clearances: { detectionId: string; label: string; clearanceM: number }[] } | null;
};

const SIDES: Side[] = ["minZ", "maxX", "maxZ", "minX"];
// A side of a box as a wall from `a` to `b`, so an opening's `atM` (from minX or minZ) is its offset.
function sideWall(b: Box, side: Side): { a: Pt; b: Pt } {
  if (side === "minZ") return { a: [b.minX, b.minZ], b: [b.maxX, b.minZ] };
  if (side === "maxZ") return { a: [b.minX, b.maxZ], b: [b.maxX, b.maxZ] };
  if (side === "minX") return { a: [b.minX, b.minZ], b: [b.minX, b.maxZ] };
  return { a: [b.maxX, b.minZ], b: [b.maxX, b.maxZ] };
}

// ---- The basement as it is ----

export function existingFromScan(result: ScanResultLike, tape: Tape = {}): Existing | null {
  const placed = basementRooms(result.rooms);
  const areas: { index: number; name: string; plan: ScanPlan; clearances: { detectionId: string; label: string; clearanceM: number }[] }[] = placed
    ? placed.map((p) => ({ index: p.room.index, name: p.room.name, plan: p.plan, clearances: p.room.measurements?.clearances ?? [] }))
    : result.plan
      ? [{ index: result.mainRoom ?? 0, name: result.rooms?.[0]?.name ?? "Your basement", plan: result.plan, clearances: result.measurements?.clearances ?? [] }]
      : [];
  if (!areas.length) return null;
  // The scan's main room first, then the biggest: its walls win where two areas share one.
  areas.sort((a, b) => Number(b.index === result.mainRoom) - Number(a.index === result.mainRoom) || b.plan.areaM2 - a.plan.areaM2);
  const all = bounds(areas.flatMap((a) => [[a.plan.box.minX, a.plan.box.minZ] as Pt, [a.plan.box.maxX, a.plan.box.maxZ] as Pt]));

  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const rooms: Room[] = [];
  const fixtures: Fixture[] = [];
  const box = (p: ScanPlan): Box => ({ minX: r3(p.box.minX), maxX: r3(p.box.maxX), minZ: r3(p.box.minZ), maxZ: r3(p.box.maxZ) });

  for (const area of areas) {
    const b = box(area.plan);
    const id = `room-${area.index}`;
    for (const side of SIDES) {
      const s = sideWall(b, side);
      const coord = side === "minX" ? b.minX : side === "maxX" ? b.maxX : side === "minZ" ? b.minZ : b.maxZ;
      const outer = Math.abs(coord - all[side]) < 0.3;
      // Two areas that share a wall: keep the one already drawn when it covers this one.
      const host = walls.find((w) => {
        const P = project(w, s.a), Q = project(w, s.b);
        return Math.abs(P.off) < 0.15 && Math.abs(Q.off) < 0.15 && Math.min(P.t, Q.t) > -0.15 && Math.max(P.t, Q.t) < wallLength(w) + 0.15;
      });
      const wall: Wall = host ?? { id: `${id}-${side}`, a: s.a, b: s.b, thicknessM: outer ? 0.2 : NEW_WALL_M, kind: outer ? "foundation" : "existing", rating: null, ...(area.plan.sides[side] !== "wall" ? { guess: true } : {}) };
      if (!host) walls.push(wall);
      else if (host.guess && area.plan.sides[side] === "wall") host.guess = false;
      const shift = host ? project(host, s.a).t : 0;
      for (const o of area.plan.openings.filter((x) => x.side === side)) {
        const offsetM = r3(shift + o.atM);
        if (openings.some((x) => x.wallId === wall.id && x.kind === o.kind && Math.abs(x.offsetM - offsetM) < Math.max(x.widthM, o.widthM) * 0.75)) continue;
        openings.push({ id: nextId(o.kind, openings), wallId: wall.id, kind: o.kind, offsetM, widthM: o.widthM, heightM: null, status: "existing", detectionId: o.detectionId });
      }
    }
    for (const st of area.plan.stairs) {
      if (fixtures.some((f) => f.kind === "stairs" && dist(f.at, [(st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2]) < 0.5)) continue;
      fixtures.push({ id: nextId("stairs", fixtures), kind: "stairs", at: [r3((st.x0 + st.x1) / 2), r3((st.z0 + st.z1) / 2)], sizeM: [r3(st.x1 - st.x0), r3(st.z1 - st.z0)], detectionId: st.detectionId });
    }
    for (const f of area.plan.fixtures) {
      if (fixtures.some((x) => x.kind === f.kind && dist(x.at, [f.x, f.z]) < 1)) continue;
      fixtures.push({ id: nextId(f.kind, fixtures), kind: f.kind, at: [r3(f.x), r3(f.z)], sizeM: FIXTURE_SIZE[f.kind], detectionId: f.detectionId });
    }
    // Beams, ducts and bulkheads: the scan measured the headroom under them but not where they run.
    // A main beam usually runs down the middle the long way, ducts beside it: placed there for them to drag.
    const long = b.maxX - b.minX >= b.maxZ - b.minZ;
    const over = area.clearances.filter((c) => c.clearanceM >= MIN_OVERHEAD_M && !fixtures.some((f) => f.detectionId === c.detectionId));
    over.forEach((c, i) => {
      const kind: FixtureKind = /bulkhead/i.test(c.label) ? "bulkhead" : /beam/i.test(c.label) ? "beam" : "duct";
      const off = kind === "beam" ? 0 : (i % 2 ? -1 : 1) * (0.5 + 0.4 * Math.floor(i / 2));
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const w = kind === "beam" ? 0.2 : kind === "duct" ? 0.35 : 0.45;
      fixtures.push({
        id: nextId(kind, fixtures),
        kind,
        at: long ? [r3(cx), r3(clamp(cz + off, b.minZ + 0.3, b.maxZ - 0.3))] : [r3(clamp(cx + off, b.minX + 0.3, b.maxX - 0.3)), r3(cz)],
        sizeM: long ? [r3(b.maxX - b.minX), w] : [w, r3(b.maxZ - b.minZ)],
        heightM: c.clearanceM,
        detectionId: c.detectionId,
        guess: true,
      });
    });
    const poly = rectPoly(b.minX, b.minZ, b.maxX, b.maxZ);
    const inside = (f: Fixture) => inPolygon(f.at, poly);
    const small = polygonArea(poly) < 10;
    const kind: RoomKind = small && fixtures.some((f) => inside(f) && (f.kind === "furnace" || f.kind === "water_heater")) ? "mechanical" : small && fixtures.some((f) => inside(f) && f.kind === "stairs") ? "stairs" : "other";
    rooms.push({ id, polygon: poly, kind, name: area.name, unit: 1, ceilingM: area.plan.ceilingHeightM });
  }

  // Their tape on the escape window goes on the biggest window: that's the one the bedroom gets.
  const big = openings.filter((o) => o.kind === "window").sort((a, b) => b.widthM - a.widthM)[0];
  if (big && (tape.egressWidthMm || tape.egressHeightMm)) {
    if (tape.egressWidthMm) big.widthM = tape.egressWidthMm / 1000;
    if (tape.egressHeightMm) big.heightM = tape.egressHeightMm / 1000;
    if (tape.egressSillMm) big.sillM = tape.egressSillMm / 1000;
  }
  const main = areas[0].plan;
  const source = main.scaleSource === "arkit" || main.scaleSource === "user_measurement" ? main.scaleSource : "model";
  return {
    walls,
    openings,
    rooms,
    fixtures,
    ceilingM: tape.ceilingMm ? tape.ceilingMm / 1000 : (main.ceilingHeightM ?? result.measurements?.ceilingHeightM ?? null),
    scale: { source, factor: 1 },
    confirmedAt: null,
  };
}

// ---- Designs ----

// The area the suite goes in: the biggest one that isn't the stair or a furnace room.
export function mainRoom(existing: Existing): Room | null {
  const usable = existing.rooms.filter((r) => r.kind !== "stairs" && r.kind !== "mechanical" && r.kind !== "closet");
  return [...(usable.length ? usable : existing.rooms)].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0] ?? null;
}

// The main area as the layout planner reads it (server/layout.ts), in the basement's own frame.
export function planOf(existing: Existing, room: Room): Plan {
  const b = bounds(room.polygon);
  const onSide = (side: Side) => {
    const s = sideWall(b, side);
    return existing.walls.filter((w) => {
      const P = project(s, w.a), Q = project(s, w.b);
      return Math.abs(P.off) < 0.1 && Math.abs(Q.off) < 0.1;
    });
  };
  const openings: Plan["openings"] = [];
  const sides = {} as Plan["sides"];
  for (const side of SIDES) {
    const s = sideWall(b, side);
    const ws = onSide(side);
    sides[side] = ws.some((w) => !w.guess) ? "wall" : "extent";
    for (const o of existing.openings.filter((x) => ws.some((w) => w.id === x.wallId))) {
      const w = ws.find((x) => x.id === o.wallId)!;
      const atM = project(s, along(w, o.offsetM)).t;
      if (atM < 0 || atM > wallLength(s)) continue;
      openings.push({ kind: o.kind, side, atM: r2(atM), widthM: o.widthM, detectionId: o.id });
    }
  }
  const within = (p: Pt) => p[0] >= b.minX - 0.05 && p[0] <= b.maxX + 0.05 && p[1] >= b.minZ - 0.05 && p[1] <= b.maxZ + 0.05;
  const widthM = r2(b.maxX - b.minX), depthM = r2(b.maxZ - b.minZ);
  return {
    version: 1,
    box: b,
    sides,
    widthM,
    depthM,
    areaM2: Math.round(widthM * depthM * 10) / 10,
    ceilingHeightM: room.ceilingM ?? existing.ceilingM,
    openings,
    stairs: existing.fixtures
      .filter((f) => f.kind === "stairs" && f.sizeM && within(f.at))
      .map((f) => ({ x0: f.at[0] - f.sizeM![0] / 2, z0: f.at[1] - f.sizeM![1] / 2, x1: f.at[0] + f.sizeM![0] / 2, z1: f.at[1] + f.sizeM![1] / 2, detectionId: f.id })),
    fixtures: existing.fixtures
      .filter((f): f is Fixture & { kind: "furnace" | "panel" | "water_heater" | "plumbing" } => ["furnace", "panel", "water_heater", "plumbing"].includes(f.kind) && within(f.at))
      .map((f) => ({ kind: f.kind, x: f.at[0], z: f.at[1], detectionId: f.id })),
    scaleSource: existing.scale.source === "tape" ? "user_measurement" : existing.scale.source,
    trusted: Boolean(existing.confirmedAt),
  };
}

const ZONE_KIND: Record<string, RoomKind> = { bedroom: "bedroom", bathroom: "bathroom", kitchen: "kitchen", living: "living", mechanical: "mechanical", stairs: "stairs" };

// A wall around one side of a rectangle that isn't already the area's own wall.
function freeSides(r: Box, main: Box) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.15;
  return SIDES.filter((s) => !(s === "minX" ? near(r.minX, main.minX) : s === "maxX" ? near(r.maxX, main.maxX) : s === "minZ" ? near(r.minZ, main.minZ) : near(r.maxZ, main.maxZ))).map((s) => ({ side: s, ...sideWall(r, s) }));
}

// The stair down from the main floor: its run, plus a landing at the foot to step off onto, walled in.
function stairRoom(st: Box, main: Box, taken: Box[]): Box {
  const snap = (v: number, edge: number) => (Math.abs(v - edge) < 0.15 ? edge : v);
  const s: Box = { minX: snap(st.minX, main.minX), maxX: snap(st.maxX, main.maxX), minZ: snap(st.minZ, main.minZ), maxZ: snap(st.maxZ, main.maxZ) };
  const alongX = s.maxX - s.minX >= s.maxZ - s.minZ;
  const clash = (b: Box) => taken.some((t) => b.minX < t.maxX - 0.05 && b.maxX > t.minX + 0.05 && b.minZ < t.maxZ - 0.05 && b.maxZ > t.minZ + 0.05);
  const ends: Box[] = alongX
    ? [
        { ...s, minX: s.maxX, maxX: Math.min(main.maxX, s.maxX + LANDING_M) },
        { ...s, maxX: s.minX, minX: Math.max(main.minX, s.minX - LANDING_M) },
      ]
    : [
        { ...s, minZ: s.maxZ, maxZ: Math.min(main.maxZ, s.maxZ + LANDING_M) },
        { ...s, maxZ: s.minZ, minZ: Math.max(main.minZ, s.minZ - LANDING_M) },
      ];
  // The foot is the end with room in front of it; a landing can't sit on the bedroom or kitchen.
  const fits = ends.filter((e) => (alongX ? e.maxX - e.minX : e.maxZ - e.minZ) > LANDING_M - 0.05 && !clash(e));
  const room = (e: Box) => (alongX ? Math.min(Math.abs(e.maxX - main.maxX), Math.abs(e.minX - main.minX)) : Math.min(Math.abs(e.maxZ - main.maxZ), Math.abs(e.minZ - main.minZ)));
  const foot = fits.sort((a, b) => room(b) - room(a))[0];
  return foot ? { minX: Math.min(s.minX, foot.minX), maxX: Math.max(s.maxX, foot.maxX), minZ: Math.min(s.minZ, foot.minZ), maxZ: Math.max(s.maxZ, foot.maxZ) } : s;
}

type Meta = { id: string; name: string; layout: Design["layout"] };

export function designFromLayout(existing: Existing, main: Room, layout: Layout, meta: Meta, finishes: Finishes, now: string): Design {
  const mb = bounds(main.polygon);
  const walls: Wall[] = existing.walls.map((w) => ({ ...w }));
  const openings: Opening[] = existing.openings.map((o) => ({ ...o }));
  const fixtures: Fixture[] = existing.fixtures.map((f) => ({ ...f }));
  const rooms: Room[] = existing.rooms.filter((r) => r.id !== main.id).map((r) => ({ ...r, unit: r.kind === "stairs" || r.kind === "mechanical" ? ("shared" as const) : (1 as const) }));
  const ceilingM = main.ceilingM ?? existing.ceilingM;
  const newWall = (a: Pt, b: Pt, rating: Wall["rating"] = null): Wall => {
    const w: Wall = { id: nextId("new", walls), a: [r3(a[0]), r3(a[1])], b: [r3(b[0]), r3(b[1])], thicknessM: NEW_WALL_M, kind: "new", rating };
    walls.push(w);
    return w;
  };
  const door = (w: Wall, offsetM: number, rating: Opening["rating"] = null) =>
    openings.push({ id: nextId("door", openings), wallId: w.id, kind: "door", offsetM: r3(offsetM), widthM: Math.min(DOOR_M, wallLength(w) - 0.05), heightM: 2.03, status: "new", swing: "left", rating });

  // The layout's own walls and doors.
  const layoutWalls = layout.walls.map((w) => newWall([w.x0, w.z0], [w.x1, w.z1]));
  for (const d of layout.doors) {
    const w = layoutWalls.find((x) => {
      const p = project(x, [d.x, d.z]);
      return Math.abs(p.off) < 0.05 && p.t > 0 && p.t < wallLength(x);
    });
    if (w) door(w, project(w, [d.x, d.z]).t);
  }
  const centre: Pt = [(mb.minX + mb.maxX) / 2, (mb.minZ + mb.maxZ) / 2];
  // Rooms a landing or a door can't open into.
  const closed: Box[] = layout.zones.filter((z) => z.kind !== "stairs" && z.kind !== "living").map((z) => ({ minX: z.x0, maxX: z.x1, minZ: z.z0, maxZ: z.z1 }));

  for (const z of layout.zones) {
    const kind = ZONE_KIND[z.kind] ?? "other";
    if (kind === "stairs") {
      // The stair stays the house's: walled in at 30 minutes, a 20-minute door at its foot into the suite.
      const run: Box = { minX: z.x0, maxX: z.x1, minZ: z.z0, maxZ: z.z1 };
      const r = stairRoom(run, mb, closed);
      rooms.push({ id: nextId("stairs", rooms), polygon: rectPoly(r.minX, r.minZ, r.maxX, r.maxZ), kind: "stairs", name: "Stairs to the main floor", unit: "shared", ceilingM });
      const sides = freeSides(r, mb).map((s) => newWall(s.a, s.b, "30min"));
      const rc: Pt = [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
      // The door: off the stair run, opening onto open floor of the suite, nearest the middle of it.
      const options = sides.flatMap((w) => {
        const L = wallLength(w);
        const n = wallNormal(w);
        const mid = along(w, L / 2);
        const out = mul(n, Math.sign(n[0] * (mid[0] - rc[0]) + n[1] * (mid[1] - rc[1]) || 1) * 0.4);
        const found: { w: Wall; t: number; score: number }[] = [];
        for (let t = DOOR_M / 2 + 0.03; t <= L - DOOR_M / 2 - 0.03 + 1e-9; t += 0.05) {
          const ends = [along(w, t - DOOR_M / 2), along(w, t), along(w, t + DOOR_M / 2)];
          if (ends.some((p) => inBox(p, run, 0.02))) continue;
          const o = add(along(w, t), out);
          if (!inBox(o, mb, -0.05) || closed.some((b) => inBox(o, b, 0))) continue;
          found.push({ w, t, score: dist(o, centre) });
        }
        return found;
      });
      const best = options.sort((a, b) => a.score - b.score)[0];
      if (best) door(best.w, best.t, "20min");
      continue;
    }
    if (kind === "mechanical") {
      // The furnace room: its own rated walls and a rated door, so a fire there stays there.
      const r: Box = { minX: z.x0, maxX: z.x1, minZ: z.z0, maxZ: z.z1 };
      rooms.push({ id: nextId("mechanical", rooms), polygon: rectPoly(r.minX, r.minZ, r.maxX, r.maxZ), kind: "mechanical", name: z.name, unit: "shared", ceilingM });
      const sides = freeSides(r, mb).map((s) => newWall(s.a, s.b, "30min"));
      const w = sides.filter((s) => wallLength(s) >= DOOR_M + 0.1).sort((a, b) => dist(along(a, wallLength(a) / 2), centre) - dist(along(b, wallLength(b) / 2), centre))[0];
      if (w) door(w, wallLength(w) / 2, "20min");
      continue;
    }
    rooms.push({ id: nextId(kind, rooms), polygon: rectPoly(z.x0, z.z0, z.x1, z.z1), kind, name: z.name, unit: 2, ceilingM, ceilingRating: "15min" });
  }
  // The leftover floor of the area is the suite's hall and open space; the rooms the scan saw elsewhere
  // stay the house's.
  const design: Design = {
    id: meta.id,
    name: meta.name,
    layout: meta.layout,
    // Furniture: server/model/furniture.ts furnishDesign(design) places it, once that lands.
    proposed: { walls, openings, rooms, fixtures, alarms: [], furniture: [] },
    finishes,
    chosen: false,
    updatedAt: now,
  };
  design.proposed.alarms = placeAlarms(design, burnsFuel(fixtures));
  return design;
}

const inBox = (p: Pt, b: Box, pad: number) => p[0] > b.minX - pad && p[0] < b.maxX + pad && p[1] > b.minZ - pad && p[1] < b.maxZ + pad;

// A designer's pass: apply every one-tap fix until nothing more can be fixed.
export function autofix(design: Design, existing: Existing, now: string): Design {
  let d = design;
  for (let round = 0; round < 5; round++) {
    const edits: Edit[] = checkDesign(d, existing).flatMap((c) => (c.ok === false && c.fix ? c.fix.edits : []));
    if (!edits.length) break;
    d = applyEdits(d, edits, now);
  }
  return d;
}

// A second bedroom beside the first, on the same wall, when there's room for one of 7 m² or more.
function twoBedroom(plan: Plan, one: Layout): Layout | null {
  const bed = one.zones.find((z) => z.kind === "bedroom");
  if (!bed) return null;
  const b = plan.box;
  const alongX = Math.abs(bed.z0 - b.minZ) < 0.05 || Math.abs(bed.z1 - b.maxZ) < 0.05;
  const depth = alongX ? bed.z1 - bed.z0 : bed.x1 - bed.x0;
  const lo = alongX ? b.minX : b.minZ, hi = alongX ? b.maxX : b.maxZ;
  const taken = one.zones.filter((z) => z.kind !== "living").map((z) => (alongX ? [z.x0, z.x1, z.z0, z.z1] : [z.z0, z.z1, z.x0, z.x1]));
  const across = alongX ? [bed.z0, bed.z1] : [bed.x0, bed.x1];
  const len = Math.max(2.9, (7.2 / depth));
  // Slide along the wall for a free span of `len`.
  for (let a0 = lo; a0 + len <= hi + 1e-6; a0 += 0.1) {
    const a1 = a0 + len;
    if (taken.some(([t0, t1, c0, c1]) => a0 < t1 - 0.05 && a1 > t0 + 0.05 && across[0] < c1 - 0.05 && across[1] > c0 + 0.05)) continue;
    const z = alongX ? { x0: r2(a0), x1: r2(a1), z0: bed.z0, z1: bed.z1 } : { x0: bed.x0, x1: bed.x1, z0: r2(a0), z1: r2(a1) };
    const inner = alongX ? (Math.abs(bed.z0 - b.minZ) < 0.05 ? bed.z1 : bed.z0) : Math.abs(bed.x0 - b.minX) < 0.05 ? bed.x1 : bed.x0;
    const walls = [...one.walls];
    walls.push(alongX ? { x0: z.x0, z0: inner, x1: z.x1, z1: inner } : { x0: inner, z0: z.z0, x1: inner, z1: z.z1 });
    for (const a of [a0, a1]) if (a - lo > 0.05 && hi - a > 0.05) walls.push(alongX ? { x0: r2(a), z0: z.z0, x1: r2(a), z1: z.z1 } : { x0: z.x0, z0: r2(a), x1: z.x1, z1: r2(a) });
    const doorAt = (a0 + a1) / 2;
    const doors = [...one.doors, alongX ? { x: r2(doorAt), z: inner, along: "x" as const, widthM: DOOR_M } : { x: inner, z: r2(doorAt), along: "z" as const, widthM: DOOR_M }];
    return { ...one, zones: [...one.zones.map((x) => (x === bed ? { ...x, name: "Bedroom 1" } : x)), { kind: "bedroom", name: "Bedroom 2", ...z, areaM2: r2((z.x1 - z.x0) * (z.z1 - z.z0)) }], walls, doors };
  }
  return null;
}

const DEFAULT_FINISHES: Finishes = { style: "light", floor: "Light oak laminate", walls: "Warm white" };

// Every design worth showing for this basement: one bedroom on the window, a studio, the bedroom on
// another wall, and two bedrooms where they fit. Each is checked and fixed before it's shown.
export function seedDesigns(existing: Existing, opts: { finishes?: Partial<Finishes>; pick?: LayoutOptions | null; now?: string } = {}): Design[] {
  const main = mainRoom(existing);
  if (!main) return [];
  const now = opts.now ?? new Date().toISOString();
  const plan = planOf(existing, main);
  const finishes = { ...DEFAULT_FINISHES, ...(opts.finishes ?? {}) };
  const one = suggestLayout(plan, { kind: "one_bedroom" });
  const build = (meta: Meta, layout: Layout) => autofix(designFromLayout(existing, main, layout, meta, finishes, now), existing, now);
  const passes = (d: Design, ids: string[]) => checkDesign(d, existing).every((c) => !ids.includes(c.id) || c.ok !== false);
  const kept: Design[] = [build({ id: "one_bedroom", name: "One bedroom", layout: "one_bedroom" }, one), build({ id: "studio", name: "Studio", layout: "studio" }, suggestLayout(plan, { kind: "studio" }))];
  // The bedroom on another wall: the next window first, then the longest walls. Only one that still
  // fits a bathroom, kitchen and enough living space is worth showing.
  const used = one.window?.side ?? null;
  const windowSides = plan.openings.filter((o) => o.kind === "window").sort((a, b) => b.widthM - a.widthM).map((o) => o.side);
  const lengthOf = (s: Side) => (s === "minZ" || s === "maxZ" ? plan.widthM : plan.depthM);
  const sides = [...new Set([...windowSides, ...(["minZ", "maxZ", "minX", "maxX"] as Side[]).sort((a, b) => lengthOf(b) - lengthOf(a))])].filter((s) => s !== used);
  for (const side of sides) {
    const d = build({ id: `bedroom_${side}`, name: "Bedroom on another wall", layout: "one_bedroom" }, suggestLayout(plan, { kind: "one_bedroom", side }));
    if (passes(d, ["rooms", "living-space", "bedroom-size", "way-out"].concat(d.proposed.rooms.filter((r) => r.kind === "bedroom").map((r) => `bedroom-size:${r.id}`)))) {
      kept.push(d);
      break;
    }
  }
  // Two bedrooms, where they fit with enough living space left.
  const two = twoBedroom(plan, one);
  if (two) {
    const d = build({ id: "two_bedroom", name: "Two bedrooms", layout: "two_bedroom" }, two);
    if (passes(d, ["rooms", "living-space", "way-out"])) kept.push(d);
  }
  const pick = opts.pick;
  const chosen = (pick?.kind === "studio" && kept.find((d) => d.id === "studio")) || (pick?.side && kept.find((d) => d.id === `bedroom_${pick.side}`)) || kept[0];
  return kept.map((d) => ({ ...d, chosen: d === chosen }));
}

export function emptyMood(): Model["mood"] {
  return { liked: [], disliked: [], style: null, finishes: {} };
}

// The whole model for a scan. `ideas`: what they picked on the old Ideas tab, so the same design is chosen.
export function seedModel(
  result: ScanResultLike,
  state: { tape?: Tape; ideas?: { kind?: "one_bedroom" | "studio" | null; side?: Side | null } } = {},
  now = new Date().toISOString(),
): Model | null {
  const existing = existingFromScan(result, state.tape ?? {});
  if (!existing) return null;
  return { version: 1, existing, designs: seedDesigns(existing, { pick: state.ideas ?? null, now }), mood: emptyMood() };
}
