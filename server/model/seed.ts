// The model, first drawn from the scan: the basement as it is (every area's walls, its windows and
// doors, the stairs, furnace, water heater, panel, plumbing, and the beams, ducts and bulkheads with
// the headroom under them), then a few designs for the suite, each permit-ready from the start: the
// stair and furnace room behind 30-minute walls, a 20-minute door with a closer into the suite, a
// 15-minute ceiling, the bedroom on an escape window, 81 cm doors, alarms by the rules, a clear way out.
import type { BasementPlan, Plan as ScanPlan, RoomResult } from "../../src/api";
import { basementRooms } from "../../src/components/basementPlan";
import { overheadFinds } from "../clearance";
import { BATH_MIN_M2, GALLEY_MIN_M2, suggestLayout, WHY, type Layout, type LayoutOptions, type ZoneKind } from "../layout";
import type { Plan, Side } from "../plan";
import { colourFurniture } from "../ideas/deck";
import { burnsFuel, placeAlarms } from "./alarms";
import { checkDesign } from "./checks";
import { entranceOf, outsideDoors, saidOutside } from "./entrance";
import { applyEdits, nextId } from "./edit";
import { furnishDesign } from "./furniture";
import { add, along, bounds, centroid, clamp, dist, dot, edges as edgesOf, inPolygon, largestBox, minusBoxes, mul, overlapArea, polygonArea, project, r2, r3, rectPoly, sub, wallLength, wallNormal, type Box } from "./geometry";
import type { Check, Design, Edit, Existing, Finishes, Fixture, FixtureKind, Model, Mood, Opening, Pt, Room, RoomKind, Wall } from "./types";

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
  floorPlan?: BasementPlan | null;
  mainRoom?: number | null;
  measurements?: { ceilingHeightM: number | null; clearances: { detectionId: string; label: string; clearanceM: number }[]; doubtful?: { detectionId: string; label: string; clearanceM: number; why: string }[] } | null;
  detections?: { id: string; label?: string; framesSeen?: number }[];
  // What a model that watched the whole take saw (server/watch.ts): only each room's windows are read here.
  watch?: { rooms: { name: string; spokenName?: string | null; windows?: { atS: number | null; note: string }[] }[] } | null;
  // The answer's findings: what they told us about a door straight outside (server/model/entrance.ts).
  findings?: { ruleId?: string; status?: string }[];
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

const SAME_WALL_M = 0.35; // two areas' sides closer than this, along most of their length, are one wall

// One of each thing. Each area places what it saw itself, and on a video take the areas sit only roughly
// where they belong, so the stairs filmed going down and seen again later, or a water heater tracked twice,
// land as two. A basement has one staircase, one furnace, one water heater, one panel, one rough-in and
// one floor drain: keep the one SAM followed through the most frames. Beams, ducts and bulkheads only seen
// on video (not placed by the 3D) of one kind with the same headroom (within 3 cm) are one too, the lowest
// kept; ones the 3D placed are where they are.
export function oneOfEach(fixtures: Fixture[], detections: ScanResultLike["detections"] = []): Fixture[] {
  const det = (f: Fixture) => detections?.find((d) => d.id === f.detectionId);
  const seen = (f: Fixture) => det(f)?.framesSeen ?? 0;
  const keep: Fixture[] = [];
  for (const f of fixtures) {
    if (OVERHEAD.has(f.kind)) {
      const same = f.guess ? keep.find((k) => k.guess && k.kind === f.kind && k.heightM != null && f.heightM != null && Math.abs(k.heightM - f.heightM) <= 0.03) : undefined;
      if (!same) keep.push(f);
      else if ((f.heightM ?? Infinity) < (same.heightM ?? Infinity)) keep.splice(keep.indexOf(same), 1, f);
      continue;
    }
    // A rough-in and a floor drain are both plumbing: told apart by what SAM was asked for.
    const what = (x: Fixture) => `${x.kind}:${det(x)?.label ?? ""}`;
    const same = keep.find((k) => what(k) === what(f));
    if (!same) keep.push(f);
    else if (seen(f) > seen(same)) keep.splice(keep.indexOf(same), 1, f);
  }
  return keep;
}

const OVERHEAD = new Set<FixtureKind>(["beam", "duct", "bulkhead"]);

// Windows the whole-take watch saw in a room that SAM didn't find there: on that room's longest outside
// wall, the usual basement window's size, marked a guess for them to drag where it is.
export function watchedWindows(rooms: Room[], walls: Wall[], openings: Opening[], watch: ScanResultLike["watch"]): Opening[] {
  const out: Opening[] = [];
  for (const w of watch?.rooms ?? []) {
    const seen = w.windows?.length ?? 0;
    const room = rooms.find((r) => r.name === w.name || (w.spokenName && r.name === w.spokenName));
    if (!seen || !room) continue;
    const near = (x: Wall) => [x.a, x.b].every((p) => inPolygon(p, room.polygon) || room.polygon.some((q) => dist(p, q) < 0.4) || edgeDist(room.polygon, p) < 0.4);
    const mine = walls.filter(near);
    const have = openings.filter((o) => o.kind === "window" && mine.some((x) => x.id === o.wallId)).length + out.filter((o) => mine.some((x) => x.id === o.wallId)).length;
    const outside = mine.filter((x) => x.kind === "foundation").sort((a, b) => wallLength(b) - wallLength(a));
    for (let k = have; k < seen && outside.length; k++) {
      const host = outside[k % outside.length];
      const taken = [...openings, ...out].filter((o) => o.wallId === host.id);
      const L = wallLength(host);
      // Spread along the wall, clear of the doors and windows already on it.
      const spot = [0.5, 0.3, 0.7, 0.15, 0.85].map((f) => f * L).find((t) => taken.every((o) => Math.abs(o.offsetM - t) > (o.widthM + WINDOW_GUESS_M) / 2 + 0.1)) ?? L / 2;
      out.push({ id: nextId("window", [...openings, ...out]), wallId: host.id, kind: "window", offsetM: r3(spot), widthM: WINDOW_GUESS_M, heightM: null, sillM: null, status: "existing", guess: true });
    }
  }
  return out;
}

const WINDOW_GUESS_M = 0.8; // a basement window, before anyone measures it

function edgeDist(poly: Pt[], p: Pt) {
  let best = Infinity;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    best = Math.min(best, Math.abs(project({ a, b }, p).off) + Math.max(0, -project({ a, b }, p).t, project({ a, b }, p).t - dist(a, b)));
  });
  return best;
}

export function existingFromScan(result: ScanResultLike, tape: Tape = {}): Existing | null {
  if (result.floorPlan?.rooms.length) return existingFromPlan(result.floorPlan, result, tape);
  const placed = basementRooms(result.rooms);
  // Overhead finds with their headroom; one whose reading was set aside has none (server/clearance.ts).
  const areas: { index: number; name: string; plan: ScanPlan; clearances: ReturnType<typeof overheadFinds> }[] = placed
    ? placed.map((p) => ({ index: p.room.index, name: p.room.name, plan: p.plan, clearances: overheadFinds(p.room.measurements) }))
    : result.plan
      ? [{ index: result.mainRoom ?? 0, name: result.rooms?.[0]?.name ?? "Your basement", plan: result.plan, clearances: overheadFinds(result.measurements) }]
      : [];
  if (!areas.length) return null;
  // The scan's main room first, then the biggest: its walls win where two areas share one.
  areas.sort((a, b) => Number(b.index === result.mainRoom) - Number(a.index === result.mainRoom) || b.plan.areaM2 - a.plan.areaM2);
  const all = bounds(areas.flatMap((a) => [[a.plan.box.minX, a.plan.box.minZ] as Pt, [a.plan.box.maxX, a.plan.box.maxZ] as Pt]));

  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const rooms: Room[] = [];
  const fixtures: Fixture[] = [];
  const onEdge = new Set<Fixture>(); // placed on its area's edge: maybe clamped there from elsewhere
  const box = (p: ScanPlan): Box => ({ minX: r3(p.box.minX), maxX: r3(p.box.maxX), minZ: r3(p.box.minZ), maxZ: r3(p.box.maxZ) });

  for (const area of areas) {
    const b = box(area.plan);
    const id = `room-${area.index}`;
    for (const side of SIDES) {
      const s = sideWall(b, side);
      const coord = side === "minX" ? b.minX : side === "maxX" ? b.maxX : side === "minZ" ? b.minZ : b.maxZ;
      const outer = Math.abs(coord - all[side]) < 0.3;
      // Two areas that share a wall: one wall, where the area drawn first put it. Each area's own box
      // sits only roughly where it belongs on a video take, so a side running alongside an earlier wall,
      // close by and along most of either, is that wall; it grows to cover both.
      const host = walls.find((w) => {
        const P = project(w, s.a), Q = project(w, s.b);
        const lo = Math.max(0, Math.min(P.t, Q.t)), hi = Math.min(wallLength(w), Math.max(P.t, Q.t));
        return Math.abs(P.off) < SAME_WALL_M && Math.abs(Q.off) < SAME_WALL_M && hi - lo >= 0.6 * Math.min(wallLength(w), wallLength(s));
      });
      if (host) {
        const P = project(host, s.a).t, Q = project(host, s.b).t;
        const lo = Math.min(P, Q), hi = Math.max(P, Q);
        if (hi > wallLength(host)) host.b = along(host, hi).map(r3) as Pt;
        if (lo < 0) {
          host.a = along(host, lo).map(r3) as Pt;
          for (const o of openings) if (o.wallId === host.id) o.offsetM = r3(o.offsetM - lo);
        }
        if (outer && host.kind !== "foundation") Object.assign(host, { kind: "foundation", thicknessM: 0.2 });
      }
      const wall: Wall = host ?? { id: `${id}-${side}`, a: s.a, b: s.b, thicknessM: outer ? 0.2 : NEW_WALL_M, kind: outer ? "foundation" : "existing", rating: null, ...(area.plan.sides[side] !== "wall" ? { guess: true } : {}) };
      if (!host) walls.push(wall);
      else if (host.guess && area.plan.sides[side] === "wall") host.guess = false;
      const shift = host ? project(host, s.a).t : 0;
      for (const o of area.plan.openings.filter((x) => x.side === side)) {
        const offsetM = r3(shift + o.atM);
        // The same door seen from two areas lands on each one's wall: the first one placed stays.
        if (o.detectionId && openings.some((x) => x.detectionId === o.detectionId)) continue;
        if (openings.some((x) => x.wallId === wall.id && x.kind === o.kind && Math.abs(x.offsetM - offsetM) < Math.max(x.widthM, o.widthM) * 0.75)) continue;
        openings.push({ id: nextId(o.kind, openings), wallId: wall.id, kind: o.kind, offsetM, widthM: o.widthM, heightM: null, status: "existing", detectionId: o.detectionId, ...(o.guess ? { guess: true } : {}) });
      }
    }
    for (const st of area.plan.stairs) {
      if (fixtures.some((f) => f.kind === "stairs" && dist(f.at, [(st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2]) < 0.5)) continue;
      fixtures.push({ id: nextId("stairs", fixtures), kind: "stairs", at: [r3((st.x0 + st.x1) / 2), r3((st.z0 + st.z1) / 2)], sizeM: [r3(st.x1 - st.x0), r3(st.z1 - st.z0)], detectionId: st.detectionId, ...(st.bottom ? { bottom: [r3(st.bottom[0]), r3(st.bottom[1])] as Pt } : {}) });
    }
    for (const f of area.plan.fixtures) {
      // A thing seen from two areas is lifted in each one's 3D; where it isn't in the area, it lands
      // clamped to the area's edge. The copy inside its area wins (a furnace in the furnace room, not on
      // the rec room's far wall).
      const inset = Math.min(f.x - b.minX, b.maxX - f.x, f.z - b.minZ, b.maxZ - f.z);
      const twin = fixtures.find((x) => (f.detectionId && x.detectionId === f.detectionId) || (x.kind === f.kind && dist(x.at, [f.x, f.z]) < 1));
      if (twin && !(onEdge.has(twin) && inset > 0.05 && twin.detectionId === f.detectionId)) continue;
      const fx: Fixture = { id: twin?.id ?? nextId(f.kind, fixtures), kind: f.kind, at: [r3(f.x), r3(f.z)], sizeM: FIXTURE_SIZE[f.kind], detectionId: f.detectionId };
      if (twin) fixtures.splice(fixtures.indexOf(twin), 1, fx);
      else fixtures.push(fx);
      if (inset < 0.02) onEdge.add(fx);
    }
    // Beams, ducts and bulkheads: the scan measured the headroom under them but not where they run.
    // A main beam usually runs down the middle the long way, ducts beside it: placed there for them to drag.
    const long = b.maxX - b.minX >= b.maxZ - b.minZ;
    const over = area.clearances.filter((c) => (c.clearanceM == null || c.clearanceM >= MIN_OVERHEAD_M) && !fixtures.some((f) => f.detectionId === c.detectionId));
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

  fixtures.splice(0, fixtures.length, ...oneOfEach(fixtures, result.detections));
  // An area of its own that the furnace or water heater stands in, whatever its size, is the service room
  // the designs keep (the scan's furnace room): not the main area, and not a copy lying on its edge.
  // (A room named for what else it is, a laundry room, keeps that: its water heater gets walled off in it.)
  for (const r of rooms.slice(1))
    if (!/laundry|bath|kitchen|bed/i.test(r.name) && fixtures.some((f) => (f.kind === "furnace" || f.kind === "water_heater") && inPolygon(f.at, r.polygon) && edgeDist(r.polygon, f.at) > 0.05)) r.kind = "mechanical";
  rooms.push(...closets(rooms, walls, fixtures));
  openings.push(...watchedWindows(rooms, walls, openings, result.watch));

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

const PLAN_KINDS: RoomKind[] = ["bedroom", "bathroom", "kitchen", "living", "mechanical", "stairs", "closet", "storage", "laundry", "hall", "other"];

// A furnace or water heater found outside every room the scan drew stands in a closet its walls close in
// (a plan leaves a small furnace closet out): that closet is a room of its own, the service room the
// designs keep, from the nearest wall each way along the axes.
const CLOSET_M2 = 8;
function closets(rooms: Room[], walls: Wall[], fixtures: Fixture[]): Room[] {
  const out: Room[] = [];
  for (const f of fixtures.filter((x) => (x.kind === "furnace" || x.kind === "water_heater") && ![...rooms, ...out].some((r) => inPolygon(x.at, r.polygon)))) {
    const reach = (axis: 0 | 1, dir: 1 | -1) => {
      const o = 1 - axis;
      let best: number | null = null;
      for (const w of walls) {
        if ((w.a[o] - f.at[o]) * (w.b[o] - f.at[o]) > 0 || Math.abs(w.a[o] - w.b[o]) < 1e-6) continue;
        const hit = w.a[axis] + ((f.at[o] - w.a[o]) / (w.b[o] - w.a[o])) * (w.b[axis] - w.a[axis]);
        if ((hit - f.at[axis]) * dir > 0.05 && (best === null || Math.abs(hit - f.at[axis]) < Math.abs(best - f.at[axis]))) best = hit;
      }
      return best !== null && Math.abs(best - f.at[axis]) < 2.5 ? best : null;
    };
    const [x0, x1, z0, z1] = [reach(0, -1), reach(0, 1), reach(1, -1), reach(1, 1)];
    if (x0 === null || x1 === null || z0 === null || z1 === null) continue;
    const polygon = rectPoly(x0, z0, x1, z1);
    const area = polygonArea(polygon);
    // A closet, not a room the plan already has.
    if (area < 0.6 || area > CLOSET_M2 || rooms.some((r) => overlapArea(r.polygon, polygon) > area * 0.3)) continue;
    const inside = fixtures.filter((x) => (x.kind === "furnace" || x.kind === "water_heater") && inPolygon(x.at, polygon));
    out.push({ id: nextId("mechanical", [...rooms, ...out]), polygon, kind: "mechanical", name: inside.some((x) => x.kind === "furnace") ? "Furnace room" : "Water heater room", unit: 1, ceilingM: null });
  }
  return out;
}

// An app take's basement as its whole plan read it (server/floorplan.ts): rooms as polygons, walls with
// their own thickness (the camera never saw the ones marked guess, or saw through them), the doors and
// windows on them, and what stands in the rooms, all in the basement frame with the floor at 0.
export function existingFromPlan(plan: BasementPlan, result: ScanResultLike, tape: Tape = {}): Existing {
  const walls: Wall[] = plan.walls.map((w) => ({
    id: w.id,
    a: [r3(w.a[0]), r3(w.a[1])],
    b: [r3(w.b[0]), r3(w.b[1])],
    thicknessM: r3(w.thicknessM),
    kind: w.kind,
    rating: null,
    ...(w.guess ? { guess: true } : {}),
  }));
  const openings: Opening[] = plan.openings
    .filter((o) => walls.some((w) => w.id === o.wallId))
    .map((o) => ({
      id: o.id,
      wallId: o.wallId,
      kind: o.kind,
      offsetM: r3(o.offsetM),
      widthM: r3(o.widthM),
      heightM: o.heightM ?? null,
      ...(o.kind === "window" ? { sillM: o.sillM ?? null } : {}),
      status: "existing" as const,
      ...(o.detectionId ? { detectionId: o.detectionId } : {}),
      ...((o as { guess?: boolean }).guess ? { guess: true } : {}),
    }));
  const fixtures: Fixture[] = plan.fixtures.map((f) => ({
    id: f.id,
    kind: f.kind,
    at: [r3(f.at[0]), r3(f.at[1])],
    ...(f.sizeM ? { sizeM: [r3(f.sizeM[0]), r3(f.sizeM[1])] as Pt } : FIXTURE_SIZE[f.kind] ? { sizeM: FIXTURE_SIZE[f.kind] } : {}),
    ...(f.heightM != null ? { heightM: f.heightM } : {}),
    ...(f.detectionId ? { detectionId: f.detectionId } : {}),
    ...(f.kind === "stairs" && f.bottom ? { bottom: [r3(f.bottom[0]), r3(f.bottom[1])] as Pt } : {}),
  }));
  // Headroom SAM measured under something the plan didn't place: by the room's middle, for them to drag.
  const clear = (result.rooms ?? []).flatMap((r) => overheadFinds(r.measurements)).filter((c) => (c.clearanceM == null || c.clearanceM >= MIN_OVERHEAD_M) && !fixtures.some((f) => f.detectionId === c.detectionId));
  const biggest = [...plan.rooms].sort((a, b) => b.areaM2 - a.areaM2)[0];
  const names = new Set<string>();
  const rooms: Room[] = plan.rooms.map((r, i) => {
    const kind: RoomKind = PLAN_KINDS.includes(r.kind as RoomKind) ? (r.kind as RoomKind) : "other";
    let name = r.name ?? (r === biggest ? "Main room" : kind === "mechanical" ? "Furnace room" : kind === "closet" ? "Closet" : kind === "stairs" ? "Stairs" : r.low ? "Low room" : `Room ${i + 1}`);
    for (let n = 2; names.has(name); n++) name = `${name.replace(/ \d+$/, "")} ${n}`;
    names.add(name);
    return { id: r.id, polygon: r.polygon.map(([x, z]) => [r3(x), r3(z)] as Pt), kind, name, unit: 1, ceilingM: r.ceilingM };
  });
  for (const c of clear) {
    const kind: FixtureKind = /bulkhead/i.test(c.label) ? "bulkhead" : /beam/i.test(c.label) ? "beam" : "duct";
    const b = bounds(biggest.polygon);
    const long = b.maxX - b.minX >= b.maxZ - b.minZ;
    fixtures.push({
      id: nextId(kind, fixtures),
      kind,
      at: [r3((b.minX + b.maxX) / 2), r3((b.minZ + b.maxZ) / 2)],
      sizeM: long ? [r3(b.maxX - b.minX), 0.3] : [0.3, r3(b.maxZ - b.minZ)],
      heightM: c.clearanceM,
      detectionId: c.detectionId,
      guess: true,
    });
  }
  openings.push(...watchedWindows(rooms, walls, openings, result.watch));
  const big = openings.filter((o) => o.kind === "window").sort((a, b) => b.widthM - a.widthM)[0];
  if (big && (tape.egressWidthMm || tape.egressHeightMm)) {
    if (tape.egressWidthMm) big.widthM = tape.egressWidthMm / 1000;
    if (tape.egressHeightMm) big.heightM = tape.egressHeightMm / 1000;
    if (tape.egressSillMm) big.sillM = tape.egressSillMm / 1000;
  }
  const found = oneOfEach(fixtures, result.detections);
  rooms.push(...closets(rooms, walls, found));
  return {
    walls,
    openings,
    rooms,
    fixtures: found,
    ceilingM: tape.ceilingMm ? tape.ceilingMm / 1000 : (biggest.ceilingM ?? plan.ceilingM ?? result.measurements?.ceilingHeightM ?? null),
    scale: { source: "arkit", factor: 1 },
    confirmedAt: null,
  };
}

// ---- Designs ----

// The area the suite goes in: the biggest one that isn't the stair or a furnace room.
export function mainRoom(existing: Existing): Room | null {
  const usable = existing.rooms.filter((r) => r.kind !== "stairs" && r.kind !== "mechanical" && r.kind !== "closet");
  return [...(usable.length ? usable : existing.rooms)].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0] ?? null;
}

// The box a room is laid out in: its main part when it's L-shaped, so every room drawn in it stands
// against its real walls; grown over a thin strip (under a metre) that runs along most of a side, which is
// still that wall's floor (and its windows).
const THIN_M = 1.0;
export function planBox(poly: Pt[]): Box {
  const b = { ...largestBox(poly) };
  const all = bounds(poly);
  const inside = (pts: Pt[]) => pts.filter((p) => inPolygon(p, poly)).length / pts.length;
  const along = (n: number, at: (t: number) => Pt) => Array.from({ length: n }, (_, i) => at((i + 0.5) / n));
  if (b.minZ - all.minZ > 0.01 && b.minZ - all.minZ < THIN_M && inside(along(24, (t) => [b.minX + t * (b.maxX - b.minX), (b.minZ + all.minZ) / 2])) >= 0.7) b.minZ = all.minZ;
  if (all.maxZ - b.maxZ > 0.01 && all.maxZ - b.maxZ < THIN_M && inside(along(24, (t) => [b.minX + t * (b.maxX - b.minX), (b.maxZ + all.maxZ) / 2])) >= 0.7) b.maxZ = all.maxZ;
  if (b.minX - all.minX > 0.01 && b.minX - all.minX < THIN_M && inside(along(24, (t) => [(b.minX + all.minX) / 2, b.minZ + t * (b.maxZ - b.minZ)])) >= 0.7) b.minX = all.minX;
  if (all.maxX - b.maxX > 0.01 && all.maxX - b.maxX < THIN_M && inside(along(24, (t) => [(b.maxX + all.maxX) / 2, b.minZ + t * (b.maxZ - b.minZ)])) >= 0.7) b.maxX = all.maxX;
  return b;
}

// The main area as the layout planner reads it (server/layout.ts), in the basement's own frame.
export function planOf(existing: Existing, room: Room): Plan {
  const b = planBox(room.polygon);
  const onSide = (side: Side) => {
    const s = sideWall(b, side);
    return existing.walls.filter((w) => {
      const P = project(s, w.a), Q = project(s, w.b);
      // (A scan's walls stand on their centre lines, half a wall, about 10 cm, out from the room's face.)
      return Math.abs(P.off) < 0.15 && Math.abs(Q.off) < 0.15;
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
  // A door in the other arm of an L-shaped room: on the side of the box it's nearest, so the way to it
  // stays clear.
  for (const o of existing.openings.filter((x) => x.kind === "door" && !openings.some((y) => y.detectionId === x.id))) {
    const w = existing.walls.find((x) => x.id === o.wallId);
    const p = w ? along(w, o.offsetM) : null;
    if (!p || edgeDist(room.polygon, p) > 0.3) continue;
    const near = SIDES.map((side) => ({ side, ...project(sideWall(b, side), p) }))
      .filter((x) => x.t >= 0 && x.t <= wallLength(sideWall(b, x.side)))
      .sort((x, y) => Math.abs(x.off) - Math.abs(y.off))[0];
    if (near) openings.push({ kind: "door", side: near.side, atM: r2(near.t), widthM: o.widthM, detectionId: o.id, beyondM: r2(Math.abs(near.off)) });
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
      .map((f) => ({ x0: f.at[0] - f.sizeM![0] / 2, z0: f.at[1] - f.sizeM![1] / 2, x1: f.at[0] + f.sizeM![0] / 2, z1: f.at[1] + f.sizeM![1] / 2, detectionId: f.id, ...(f.bottom ? { bottom: f.bottom } : {}) })),
    fixtures: existing.fixtures
      .filter((f): f is Fixture & { kind: "furnace" | "panel" | "water_heater" | "plumbing" } => ["furnace", "panel", "water_heater", "plumbing"].includes(f.kind) && within(f.at))
      .map((f) => ({ kind: f.kind, x: f.at[0], z: f.at[1], detectionId: f.id })),
    scaleSource: existing.scale.source === "tape" ? "user_measurement" : existing.scale.source,
    trusted: Boolean(existing.confirmedAt),
  };
}

const ZONE_KIND: Record<string, RoomKind> = { bedroom: "bedroom", bathroom: "bathroom", kitchen: "kitchen", living: "living", mechanical: "mechanical", stairs: "stairs", laundry: "laundry" };

// A wall around one side of a rectangle that isn't already the area's own wall.
function freeSides(r: Box, main: Box) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.15;
  return SIDES.filter((s) => !(s === "minX" ? near(r.minX, main.minX) : s === "maxX" ? near(r.maxX, main.maxX) : s === "minZ" ? near(r.minZ, main.minZ) : near(r.maxZ, main.maxZ))).map((s) => ({ side: s, ...sideWall(r, s) }));
}

// The stair down from the main floor: its run, plus a landing at the foot to step off onto, walled in.
// `bottom`: the foot, when the scan could tell; then the landing goes there, and a strip too narrow to
// use beside the top of the flight goes in with the stairs.
const NARROW_M = 0.9;
function stairRoom(st: Box, main: Box, taken: Box[], bottom?: Pt): Box {
  const snap = (v: number, edge: number) => (Math.abs(v - edge) < 0.15 ? edge : v);
  let s: Box = { minX: snap(st.minX, main.minX), maxX: snap(st.maxX, main.maxX), minZ: snap(st.minZ, main.minZ), maxZ: snap(st.maxZ, main.maxZ) };
  const alongX = s.maxX - s.minX >= s.maxZ - s.minZ;
  if (bottom) {
    const footHi = alongX ? Math.abs(bottom[0] - s.maxX) <= Math.abs(bottom[0] - s.minX) : Math.abs(bottom[1] - s.maxZ) <= Math.abs(bottom[1] - s.minZ);
    const top = (k: "minX" | "maxX" | "minZ" | "maxZ") => (Math.abs(s[k] - main[k]) < NARROW_M ? main[k] : s[k]);
    s = alongX ? (footHi ? { ...s, minX: top("minX") } : { ...s, maxX: top("maxX") }) : footHi ? { ...s, minZ: top("minZ") } : { ...s, maxZ: top("maxZ") };
    const foot: Box = alongX
      ? footHi ? { ...s, minX: s.maxX, maxX: Math.min(main.maxX, s.maxX + LANDING_M) } : { ...s, maxX: s.minX, minX: Math.max(main.minX, s.minX - LANDING_M) }
      : footHi ? { ...s, minZ: s.maxZ, maxZ: Math.min(main.maxZ, s.maxZ + LANDING_M) } : { ...s, maxZ: s.minZ, minZ: Math.max(main.minZ, s.minZ - LANDING_M) };
    return { minX: Math.min(s.minX, foot.minX), maxX: Math.max(s.maxX, foot.maxX), minZ: Math.min(s.minZ, foot.minZ), maxZ: Math.max(s.maxZ, foot.maxZ) };
  }
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

// A room next to the main one, through a door, that the suite takes: a bathroom the scan already has, or
// one the suite needs when the main room can't hold a home on its own. Its own layout (a service room,
// the stairs if the plan drew them in it, the bathroom it takes), and what the rest of it becomes: the
// bedroom, the room it was (a laundry room stays one, now the suite's), or `kept`, finished as it is.
export type Extra = { room: Room; layout: Layout; rest: { kind: RoomKind; name: string; kept?: boolean } };

export function designFromLayout(existing: Existing, main: Room, layout: Layout, meta: Meta, finishes: Finishes, now: string, extras: Extra[] = []): Design {
  // The box the layout was drawn in (planOf): an L-shaped room's main part.
  const mb = planBox(main.polygon);
  const walls: Wall[] = existing.walls.map((w) => ({ ...w }));
  const openings: Opening[] = existing.openings.map((o) => ({ ...o }));
  const fixtures: Fixture[] = existing.fixtures.map((f) => ({ ...f }));
  const taken = new Set([main.id, ...extras.map((x) => x.room.id)]);
  const rooms: Room[] = existing.rooms.filter((r) => !taken.has(r.id)).map((r) => ({ ...r, unit: r.kind === "stairs" || r.kind === "mechanical" ? ("shared" as const) : (1 as const) }));
  const ceilingM = main.ceilingM ?? existing.ceilingM;
  const newWall = (a: Pt, b: Pt, rating: Wall["rating"] = null, why?: string): Wall => {
    const w: Wall = { id: nextId("new", walls), a: [r3(a[0]), r3(a[1])], b: [r3(b[0]), r3(b[1])], thicknessM: NEW_WALL_M, kind: "new", rating, ...(why ? { why } : {}) };
    walls.push(w);
    return w;
  };
  const door = (w: Wall, offsetM: number, rating: Opening["rating"] = null) =>
    openings.push({ id: nextId("door", openings), wallId: w.id, kind: "door", offsetM: r3(offsetM), widthM: Math.min(DOOR_M, wallLength(w) - 0.05), heightM: 2.03, status: "new", swing: "left", rating });

  // One room's layout: its walls and doors, then its rooms. `box`: the room's own, `ceiling` its height;
  // `closedToo`: more floor a stair door can't open onto (a kept bathroom's).
  const lay = (layout: Layout, box: Box, ceiling: number | null, closedToo: Box[] = []) => {
    const layoutWalls = layout.walls.map((w) => newWall([w.x0, w.z0], [w.x1, w.z1], null, w.why));
    for (const d of layout.doors) {
      const w = layoutWalls.find((x) => {
        const p = project(x, [d.x, d.z]);
        return Math.abs(p.off) < 0.05 && p.t > 0 && p.t < wallLength(x);
      });
      if (w) door(w, project(w, [d.x, d.z]).t);
    }
    const centre: Pt = [(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2];
    // Rooms a landing or a door can't open into.
    const closed: Box[] = [...layout.zones.filter((z) => z.kind !== "stairs" && z.kind !== "living").map((z) => ({ minX: z.x0, maxX: z.x1, minZ: z.z0, maxZ: z.z1 })), ...closedToo];

    for (const z of layout.zones) {
      const kind = ZONE_KIND[z.kind] ?? "other";
      if (kind === "stairs") {
        // The stair stays the house's: walled in at 30 minutes, a 20-minute door at its foot into the suite.
        const run: Box = { minX: z.x0, maxX: z.x1, minZ: z.z0, maxZ: z.z1 };
        const flight = fixtures.find((f) => f.kind === "stairs" && inBox(f.at, run, 0.05));
        const r = stairRoom(run, box, closed, flight?.bottom);
        rooms.push({ id: nextId("stairs", rooms), polygon: rectPoly(r.minX, r.minZ, r.maxX, r.maxZ), kind: "stairs", name: "Stairs to the main floor", unit: "shared", ceilingM: ceiling });
        const sides = freeSides(r, box).map((s) => newWall(s.a, s.b, "30min", WHY.stairs));
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
            // Onto this room's open floor, or the main room's (a stair the plan drew inside a side room).
            if (!(inBox(o, box, -0.05) || inBox(o, mb, -0.05)) || closed.some((b) => inBox(o, b, 0))) continue;
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
        rooms.push({ id: nextId("mechanical", rooms), polygon: rectPoly(r.minX, r.minZ, r.maxX, r.maxZ), kind: "mechanical", name: z.name, unit: "shared", ceilingM: ceiling });
        // Where it meets the stair room, the stair's wall is its wall too.
        const sides = freeSides(r, box).flatMap((s) => uncovered(s.a, s.b, walls).map(([a, b]) => newWall(a, b, "30min", WHY.service)));
        const w = sides.filter((s) => wallLength(s) >= DOOR_M + 0.1).sort((a, b) => dist(along(a, wallLength(a) / 2), centre) - dist(along(b, wallLength(b) / 2), centre))[0];
        if (w) door(w, wallLength(w) / 2, "20min");
        continue;
      }
      // A laundry room's own washer and dryer, where they were: kept, not built.
      rooms.push({ id: nextId(kind, rooms), polygon: rectPoly(z.x0, z.z0, z.x1, z.z1), kind, name: z.name, unit: 2, ceilingM: ceiling, ceilingRating: "15min", ...(kind === "laundry" ? { kept: true } : {}) });
    }
  };

  lay(layout, mb, ceilingM);
  const mainLiving = new Set(rooms.filter((r) => r.kind === "living").map((r) => r.id));
  for (const extra of extras) {
    // The room next door: its layout in its own box, and the rest of it what it becomes, all the suite's.
    const before = rooms.length;
    const box = planBox(extra.room.polygon);
    const own = extra.rest.kind === "bathroom" || extra.rest.kind === "bedroom" ? [box] : [];
    lay(extra.layout, box, extra.room.ceilingM ?? ceilingM, own);
    const cut = rooms.slice(before).map((r) => bounds(r.polygon));
    rooms.push({ id: extra.room.id, polygon: minusBoxes(extra.room.polygon, cut), kind: extra.rest.kind, name: extra.rest.name, unit: 2, ceilingM: extra.room.ceilingM ?? ceilingM, ceilingRating: "15min", ...(extra.rest.kept ? { kept: true } : {}) });
  }
  // A service room the scan found closed in (a furnace closet with no door seen) gets its 20-minute door,
  // into the living space where it can, as the other designs' service rooms have.
  for (const m of rooms.filter((r) => r.kind === "mechanical" && existing.rooms.some((x) => x.id === r.id))) {
    const sides = edgesOf(m.polygon).flatMap(([p, q]) =>
      walls.flatMap((w) => {
        const P = project(w, p), Q = project(w, q);
        if (Math.abs(P.off) > 0.12 || Math.abs(Q.off) > 0.12) return [];
        const t0 = clamp(Math.min(P.t, Q.t), 0, wallLength(w)), t1 = clamp(Math.max(P.t, Q.t), 0, wallLength(w));
        return t1 - t0 > DOOR_M + 0.1 ? [{ w, t0, t1 }] : [];
      }),
    );
    if (!sides.length || sides.some((x) => openings.some((o) => o.kind === "door" && o.wallId === x.w.id && o.offsetM > x.t0 && o.offsetM < x.t1))) continue;
    const mc = centroid(m.polygon);
    const beyond = (x: (typeof sides)[number]) => {
      const mid = along(x.w, (x.t0 + x.t1) / 2), n = wallNormal(x.w);
      const out = add(mid, mul(n, dot(sub(mid, mc), n) >= 0 ? 0.4 : -0.4));
      return [...rooms, main].find((r) => r !== m && inPolygon(out, r.polygon)) ?? null;
    };
    const score = (r: Room | null) => (!r ? 9 : r === main || r.kind === "living" ? 0 : r.unit === 2 ? 1 : 2);
    const best = [...sides].sort((a, b) => score(beyond(a)) - score(beyond(b)))[0];
    if (score(beyond(best)) < 9) door(best.w, (best.t0 + best.t1) / 2, "20min");
  }
  // The living space is the layout's band of the main room less what the other rooms drawn in it take (the
  // stair and furnace rooms, the kitchen, a bathroom on another wall), and the other arm of an L-shaped
  // room, so the way to a door there is the suite's floor.
  const band = layout.zones.find((z) => z.kind === "living");
  const inMain = rooms.filter((x) => x.kind !== "living" && !extras.some((e) => e.room.id === x.id) && (x.unit === 2 || x.unit === "shared")).map((x) => bounds(x.polygon));
  const offBand = band ? outside(mb, { minX: band.x0, maxX: band.x1, minZ: band.z0, maxZ: band.z1 }) : [];
  for (const r of rooms.filter((x) => x.kind === "living" && mainLiving.has(x.id))) r.polygon = minusBoxes(main.polygon, [...offBand, ...inMain.filter((b) => b.minX < mb.maxX + 0.01 && b.maxX > mb.minX - 0.01 && b.minZ < mb.maxZ + 0.01 && b.maxZ > mb.minZ - 0.01)]);
  // The leftover floor of the area is the suite's hall and open space; the rooms the scan saw elsewhere
  // stay the house's.
  const design: Design = {
    id: meta.id,
    name: meta.name,
    layout: meta.layout,
    // Furniture is placed once the design is final (seedDesigns: furnishDesign after autofix).
    proposed: { walls, openings, rooms, fixtures, alarms: [], furniture: [] },
    finishes,
    chosen: false,
    updatedAt: now,
  };
  design.proposed.alarms = placeAlarms(design, burnsFuel(fixtures));
  return design;
}

// A box less another inside it: the strips round it, up to four.
function outside(b: Box, keep: Box): Box[] {
  const k = { minX: Math.max(b.minX, keep.minX), maxX: Math.min(b.maxX, keep.maxX), minZ: Math.max(b.minZ, keep.minZ), maxZ: Math.min(b.maxZ, keep.maxZ) };
  return [
    { ...b, maxX: k.minX },
    { ...b, minX: k.maxX },
    { minX: k.minX, maxX: k.maxX, minZ: b.minZ, maxZ: k.minZ },
    { minX: k.minX, maxX: k.maxX, minZ: k.maxZ, maxZ: b.maxZ },
  ].filter((x) => x.maxX - x.minX > 0.02 && x.maxZ - x.minZ > 0.02);
}

// The parts of a straight wall from a to b that no wall already stands on.
function uncovered(a: Pt, b: Pt, walls: Wall[]): [Pt, Pt][] {
  const L = dist(a, b);
  if (L < 1e-6) return [];
  const on = walls.flatMap((w) => {
    const p = project({ a, b }, w.a), q = project({ a, b }, w.b);
    if (Math.abs(p.off) > 0.03 || Math.abs(q.off) > 0.03) return [];
    const lo = Math.max(0, Math.min(p.t, q.t)), hi = Math.min(L, Math.max(p.t, q.t));
    return hi - lo > 0.01 ? [[lo, hi] as const] : [];
  }).sort((x, y) => x[0] - y[0]);
  const out: [Pt, Pt][] = [];
  let t = 0;
  for (const [lo, hi] of on) {
    if (lo - t > 0.1) out.push([along({ a, b }, t), along({ a, b }, lo)]);
    t = Math.max(t, hi);
  }
  if (L - t > 0.1) out.push([along({ a, b }, t), b]);
  return out;
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
    walls.push(alongX ? { x0: z.x0, z0: inner, x1: z.x1, z1: inner, why: WHY.secondBedroom } : { x0: inner, z0: z.z0, x1: inner, z1: z.z1, why: WHY.secondBedroom });
    for (const a of [a0, a1]) if (a - lo > 0.05 && hi - a > 0.05) walls.push(alongX ? { x0: r2(a), z0: z.z0, x1: r2(a), z1: z.z1, why: WHY.secondBedroom } : { x0: z.x0, z0: r2(a), x1: z.x1, z1: r2(a), why: WHY.secondBedroom });
    const doorAt = (a0 + a1) / 2;
    const doors = [...one.doors, alongX ? { x: r2(doorAt), z: inner, along: "x" as const, widthM: DOOR_M } : { x: inner, z: r2(doorAt), along: "z" as const, widthM: DOOR_M }];
    return { ...one, zones: [...one.zones.map((x) => (x === bed ? { ...x, name: "Bedroom 1" } : x)), { kind: "bedroom", name: "Bedroom 2", ...z, areaM2: r2((z.x1 - z.x0) * (z.z1 - z.z0)) }], walls, doors };
  }
  return null;
}

const DEFAULT_FINISHES: Finishes = { style: "light", floor: "Light oak laminate", walls: "Warm white" };
// A room the scan named a bathroom, and the least a kept one can be (a three-piece is about 2.5 m² at its
// tightest; a new one is drawn 3.5 to 5).
const BATH_NAME = /\b(bath(room)?|washroom|powder room|toilet)\b/i;
const KEPT_BATH_M2 = 2.5;
const NO_ROOMS: ZoneKind[] = ["bedroom", "bathroom", "kitchen", "living"];

// The rooms through a door from the main one that a suite could take in: not the stairs, a furnace room or
// a closet.
function neighbours(existing: Existing, main: Room): Room[] {
  const doors = existing.openings.flatMap((o) => {
    const w = o.kind === "door" ? existing.walls.find((x) => x.id === o.wallId) : undefined;
    return w ? [along(w, o.offsetM)] : [];
  });
  return existing.rooms.filter(
    (r) => r.id !== main.id && !["stairs", "mechanical", "closet"].includes(r.kind) && polygonArea(r.polygon) >= 4 && doors.some((p) => edgeDist(main.polygon, p) < 0.4 && edgeDist(r.polygon, p) < 0.4),
  );
}

// The designs worth showing for this basement: two or three that are truly different, best first, each
// with a sentence on why. What's already there stays where it is and is the suite's: a bathroom, a
// kitchen, a laundry room (never a second bathroom, never moved). A bedroom gets a window that can be its
// escape window, away from the furnace and water heater and never against their room's walls when that
// can be helped; the living space is by the way in; the kitchen by the pipes. Every arrangement is built,
// checked and fixed, scored on those rules, and the best of each kind kept. Furnished after the fixes,
// so nothing stands where a fix moved a wall; each piece takes the colour their board gave it
// (server/ideas/deck.ts colourFurniture).
export function seedDesigns(existing: Existing, opts: { finishes?: Partial<Finishes>; colours?: Mood["colours"]; pick?: LayoutOptions | null; now?: string } = {}): Design[] {
  const now = opts.now ?? new Date().toISOString();
  const finishes = { ...DEFAULT_FINISHES, ...(opts.finishes ?? {}) };
  const isBath = (r: Room) => r.kind === "bathroom" || BATH_NAME.test(r.name);
  const isKitchen = (r: Room) => r.kind === "kitchen" || /\bkitchen(ette)?\b/i.test(r.name);
  const isLaundry = (r: Room) => r.kind === "laundry" || /\blaundry\b/i.test(r.name);
  const open = (r: Room) => !["stairs", "mechanical", "closet"].includes(r.kind) && !isBath(r) && !isKitchen(r);
  const fallback = mainRoom(existing);
  if (!fallback) return [];
  const mains = existing.rooms.filter(open).sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon)).slice(0, 3);
  if (!mains.length) mains.push(fallback);
  const xz = (p: Pt) => ({ x: p[0], z: p[1] });
  const mech = existing.fixtures.filter((f) => f.kind === "furnace" || f.kind === "water_heater");
  const avoid = [...mech.map((f) => xz(f.at)), ...existing.rooms.filter((r) => r.kind === "mechanical").map((r) => xz(centroid(r.polygon)))];
  const pipes = [...existing.fixtures.filter((f) => f.kind === "plumbing").map((f) => xz(f.at)), ...existing.rooms.filter((r) => isBath(r) || isLaundry(r) || isKitchen(r)).map((r) => xz(centroid(r.polygon)))];
  const hasBath = existing.rooms.some(isBath);
  const holdsMech = (r: Room) => mech.some((f) => inPolygon(f.at, r.polygon));
  const hasWindow = (r: Room) => existing.openings.some((o) => o.kind === "window" && edgeDist(r.polygon, along(existing.walls.find((w) => w.id === o.wallId)!, o.offsetM)) < 0.3);
  // A room kept as it is gets no new walls inside it, its stairs included (they're the suite's then, with a
  // rated door at the top: server/model/checks.ts "stairs-top"); only its furnace or water heater is walled off.
  const asIs = (r: Room, rest: Extra["rest"]): Extra => {
    const l = suggestLayout(planOf(existing, r), { kind: "one_bedroom", without: NO_ROOMS });
    return { room: r, layout: rest.kept ? { ...l, zones: l.zones.filter((z) => z.kind !== "stairs") } : l, rest };
  };
  const furnish = (d: Design) => {
    const f = furnishDesign(d);
    return opts.colours ? { ...f, proposed: { ...f.proposed, furniture: colourFurniture(f.proposed.furniture, opts.colours) } } : f;
  };
  const passes = (checks: Check[], ids: string[]) => checks.every((c) => !ids.includes(c.id) || c.ok !== false);
  // A home: a kitchen at least a galley, a three-piece bathroom (one already there can be smaller) and
  // somewhere to sleep, each big enough, and enough living space. A way out of every room, its alarms,
  // and an escape window where someone sleeps (one the fixes can add, at least).
  const home = (d: Design, checks: Check[]) => {
    const suite = d.proposed.rooms.filter((r) => r.unit === 2);
    const sized = (kind: string, least: number) => suite.some((r) => r.kind === kind && polygonArea(r.polygon) >= (r.kept ? KEPT_BATH_M2 : least) - 0.01);
    const beds = suite.filter((r) => r.kind === "bedroom");
    return sized("kitchen", GALLEY_MIN_M2) && sized("bathroom", BATH_MIN_M2) && passes(checks, ["rooms", "living-space", "way-out", "smoke-alarms", ...beds.map((r) => `bedroom-size:${r.id}`), ...beds.map((r) => `escape:${r.id}`)]);
  };
  // How near a room comes to the furnace and water heater (0 inside), and whether it shares a wall with
  // their room.
  const nearMech = (r: Room) => (avoid.length ? Math.min(...avoid.map((p) => (inPolygon([p.x, p.z], r.polygon) ? 0 : edgeDist(r.polygon, [p.x, p.z])))) : 9);
  const againstService = (d: Design, r: Room) => d.proposed.rooms.some((m) => m.kind === "mechanical" && overlapArea(grown(m.polygon, 0.25), r.polygon) > 0.05);
  // Where they come in: a door straight outside from the suite, else the stairs' door.
  const entry = (d: Design): Pt | null => {
    const out = outsideDoors(d.proposed.walls, d.proposed.openings).filter((o) => existing.entrance?.status !== "needed" || o.status === "new");
    const stairs = d.proposed.rooms.find((r) => r.kind === "stairs");
    const stairDoor = stairs ? d.proposed.openings.find((o) => o.kind === "door" && o.rating === "20min" && edgeDist(stairs.polygon, along(d.proposed.walls.find((w) => w.id === o.wallId)!, o.offsetM)) < 0.2) : undefined;
    const o = out[0] ?? stairDoor;
    return o ? along(d.proposed.walls.find((w) => w.id === o.wallId)!, o.offsetM) : null;
  };
  type Try = { d: Design; checks: Check[]; home: boolean; score: number; bedRoom: string | null; byEntry: boolean; byPipes: boolean };
  const tries: Try[] = [];
  const build = (main: Room, meta: Meta, layout: Layout | null, extras: Extra[]) => {
    if (!layout) return;
    const d = autofix(designFromLayout(existing, main, layout, meta, finishes, now, extras), existing, now);
    const checks = checkDesign(d, existing);
    const suite = d.proposed.rooms.filter((r) => r.unit === 2);
    const beds = suite.filter((r) => r.kind === "bedroom");
    const living = suite.filter((r) => r.kind === "living");
    const kitchen = suite.find((r) => r.kind === "kitchen");
    const e = entry(d);
    const byEntry = Boolean(e && living.some((r) => inPolygon(e, r.polygon) || edgeDist(r.polygon, e) < 1.0));
    const toPipes = kitchen && pipes.length ? Math.min(...pipes.map((p) => Math.hypot(p.x - centroid(kitchen.polygon)[0], p.z - centroid(kitchen.polygon)[1]))) : null;
    const newWalls = d.proposed.walls.filter((w) => w.kind === "new").reduce((t, w) => t + wallLength(w), 0);
    let score = (home(d, checks) ? 100 : 0) - checks.filter((c) => c.ok === false).length * 5;
    for (const b of beds) score -= Math.max(0, 1.5 - nearMech(b)) * 4 + (againstService(d, b) ? 5 : 0);
    // A room next door taken in for space (not kept for what it is) costs: the suite stays in as few rooms
    // as make it a home.
    const takenIn = extras.filter((x) => !x.rest.kept).length;
    score += (byEntry ? 3 : 0) - (toPipes === null ? 0 : Math.min(3, toPipes * 0.4)) - newWalls * 0.15 + suite.filter((r) => r.kept).length * 2 - takenIn * 8;
    const own = beds.find((b) => existing.rooms.some((x) => x.id === b.id));
    tries.push({ d, checks, home: home(d, checks), score, bedRoom: own?.id ?? (beds[0] ? "main" : null), byEntry, byPipes: toPipes !== null && toPipes < 3 });
  };
  const oneMeta: Meta = { id: "one_bedroom", name: "One bedroom", layout: "one_bedroom" };
  const studioMeta: Meta = { id: "studio", name: "Studio", layout: "studio" };
  const twoMeta: Meta = { id: "two_bedroom", name: "Two bedrooms", layout: "two_bedroom" };
  for (const main of mains) {
    const plan = planOf(existing, main);
    const near = neighbours(existing, main);
    const keptBath = near.find(isBath) ?? null, keptKitchen = near.find(isKitchen) ?? null, keptLaundry = isLaundry(main) ? null : (near.find(isLaundry) ?? null);
    // Never a second bathroom: a room that can't reach the one there doesn't hold the suite.
    if (hasBath && !keptBath) continue;
    const kept: Extra[] = [
      ...(keptBath ? [asIs(keptBath, { kind: "bathroom", name: keptBath.name, kept: true })] : []),
      ...(keptKitchen ? [asIs(keptKitchen, { kind: "kitchen", name: keptKitchen.name, kept: true })] : []),
      ...(keptLaundry ? [asIs(keptLaundry, { kind: "laundry", name: keptLaundry.name, kept: true })] : []),
    ];
    const without: ZoneKind[] = [...(keptBath ? (["bathroom"] as const) : []), ...(keptKitchen ? (["kitchen"] as const) : [])];
    // A laundry room holds no bedroom: its water heater and machines stay, and so does the noise.
    const lo: LayoutOptions = { avoid, plumbing: pipes, without: isLaundry(main) ? [...without, "bedroom"] : without, laundry: isLaundry(main) };
    const free = near.filter((r) => open(r) && !kept.some((k) => k.room.id === r.id));
    for (const kind of ["one_bedroom", "studio"] as const) {
      const meta = kind === "studio" ? studioMeta : oneMeta;
      build(main, meta, suggestLayout(plan, { kind, ...lo }), kept);
      // No bathroom anywhere yet: a room next door takes one (a laundry room keeps its washer and dryer,
      // and stays the laundry room).
      if (!hasBath)
        for (const r of [...free, ...(keptLaundry ? [keptLaundry] : [])]) {
          const theirs = suggestLayout(planOf(existing, r), { kind: "one_bedroom", without: ["bedroom", "kitchen", "living"], avoid, plumbing: pipes });
          const others = kept.filter((k) => k.room.id !== r.id);
          build(main, meta, suggestLayout(plan, { kind, ...lo, without: [...without, "bathroom"] }), [...others, { room: r, layout: theirs, rest: isLaundry(r) ? { kind: "laundry", name: r.name, kept: true } : { kind: "living", name: "Living" } }]);
        }
      // The laundry room next door as living space too, its washer and dryer kept where the pipes are.
      if (keptLaundry) {
        const living: Extra = { room: keptLaundry, layout: suggestLayout(planOf(existing, keptLaundry), { kind: "one_bedroom", without: NO_ROOMS, laundry: true, plumbing: pipes }), rest: { kind: "living", name: "Living" } };
        build(main, meta, suggestLayout(plan, { kind, ...lo }), [...kept.filter((k) => k.room.id !== keptLaundry.id), living]);
      }
      if (kind === "studio") continue;
      // The bedroom on another window.
      for (const side of isLaundry(main) ? [] : [...new Set(plan.openings.filter((o) => o.kind === "window").map((o) => o.side))]) build(main, { id: `bedroom_${side}`, name: "Bedroom on another wall", layout: "one_bedroom" }, suggestLayout(plan, { kind, side, ...lo }), kept);
      // The bedroom in a room next door with a window and nothing to keep away from in it: the whole room,
      // or its own corner with the rest living space (and its bathroom too, when there's none).
      for (const r of free.filter((x) => !isLaundry(x) && hasWindow(x) && !holdsMech(x))) {
        const named = r.kind === "bedroom" || /\bbed(room)?\b/i.test(r.name);
        const rMeta: Meta = { id: `bedroom_in_${r.id}`, name: named ? "Bedroom in its own room" : `Bedroom in the ${r.name.toLowerCase()}`, layout: "one_bedroom" };
        const here = suggestLayout(plan, { kind, ...lo, without: [...without, "bedroom"] });
        build(main, rMeta, here, [...kept, asIs(r, { kind: "bedroom", name: named ? r.name : "Bedroom" })]);
        const theirs = suggestLayout(planOf(existing, r), { kind: "one_bedroom", without: ["kitchen", "living", ...(hasBath ? (["bathroom"] as const) : [])], avoid, plumbing: pipes });
        build(main, rMeta, suggestLayout(plan, { kind, ...lo, without: [...without, "bedroom", ...(hasBath ? [] : (["bathroom"] as const))] }), [...kept, { room: r, layout: theirs, rest: { kind: "living", name: "Living" } }]);
      }
      // Two bedrooms, where they fit.
      const two = twoBedroom(plan, suggestLayout(plan, { kind: "one_bedroom", ...lo }));
      if (two) build(main, twoMeta, two, kept);
    }
  }
  // The best of each kind that's a home (else the best there is), then one more only if it's truly
  // different: its bedroom somewhere else.
  const ranked = [...tries].sort((a, b) => b.score - a.score);
  const homes = ranked.filter((t) => t.home);
  const pool = homes.length ? homes : ranked;
  const best = (f: (t: Try) => boolean) => pool.find(f) ?? null;
  // A one-bedroom leads when it's a home: it's what a second home usually wants.
  const picks = [best((t) => t.d.layout !== "studio"), best((t) => t.d.layout === "studio")].filter((t): t is Try => t !== null).sort((a, b) => Number(b.home) - Number(a.home) || Number(b.d.layout !== "studio") - Number(a.d.layout !== "studio") || b.score - a.score);
  const bedAt = (t: Try) => t.d.proposed.rooms.filter((r) => r.unit === 2 && r.kind === "bedroom").map((r) => centroid(r.polygon));
  const different = (t: Try) => picks.every((p) => p.d.layout !== t.d.layout || bedAt(p).every((a) => bedAt(t).every((b) => dist(a, b) > 1.5)));
  const third = pool.find((t) => !picks.includes(t) && t.home && different(t) && t.score >= (picks[0]?.score ?? 0) - 15);
  if (third) picks.push(third);
  // Each its own id, and a sentence on why.
  const ids = new Set<string>();
  const shown = picks.map((t) => {
    let id = t.d.id;
    for (let n = 2; ids.has(id); n++) id = `${t.d.id}_${n}`;
    ids.add(id);
    return { ...t.d, id, why: whyOf(t, existing, avoid.length > 0, mech) };
  });
  const pick = opts.pick;
  const chosen = (pick?.kind === "studio" && shown.find((d) => d.layout === "studio")) || (pick?.side && shown.find((d) => d.id === `bedroom_${pick.side}`)) || shown[0];
  return shown.map((d) => ({ ...furnish(d), chosen: d === chosen }));
}

// One plain sentence on why a design is the way it is: what it keeps, where they sleep, what's by the
// way in and the pipes.
function whyOf(t: { d: Design; byEntry: boolean; byPipes: boolean }, existing: Existing, anyMech: boolean, mech: Fixture[]): string {
  const suite = t.d.proposed.rooms.filter((r) => r.unit === 2);
  const parts: string[] = [];
  const kept = suite.filter((r) => r.kept && existing.rooms.some((x) => x.id === r.id));
  const keptLaundry = suite.some((r) => r.kept && r.kind === "laundry");
  const named = kept.map((r) => (r.kind === "laundry" ? "laundry room" : r.kind === "kitchen" ? "kitchen" : "bathroom"));
  const keeps = [...new Set([...named, ...(keptLaundry && !named.includes("laundry room") ? ["laundry"] : [])])];
  if (keeps.length) parts.push(`keeps your ${keeps.length > 1 ? `${keeps.slice(0, -1).join(", ")} and ${keeps.at(-1)}` : keeps[0]}`);
  const beds = suite.filter((r) => r.kind === "bedroom");
  const what = mech.some((f) => f.kind === "furnace") ? (mech.some((f) => f.kind === "water_heater") ? "the furnace and water heater" : "the furnace") : "the water heater";
  const clear = beds.length > 0 && anyMech && beds.every((b) => !t.d.proposed.rooms.some((m) => m.kind === "mechanical" && overlapArea(grown(m.polygon, 0.25), b.polygon) > 0.05) && mech.every((f) => !inPolygon(f.at, b.polygon) && edgeDist(b.polygon, f.at) >= 1.5));
  if (t.d.layout === "studio") parts.push(`one open room to live, sleep and cook in${clear ? `, the bed away from ${what}` : ""}`);
  else if (beds.length > 1) parts.push(`two bedrooms, each on a window${clear ? `, away from ${what}` : ""}`);
  else if (beds.length) {
    const own = existing.rooms.find((x) => x.id === beds[0].id);
    parts.push(`${own ? `the bedroom is the room you call ${own.name.toLowerCase().startsWith("bedroom") ? "the bedroom" : `the ${own.name.toLowerCase()}`}` : "the bedroom on the window wall"}${clear ? `, away from ${what}` : ""}`);
  }
  if (t.byEntry) parts.push("living space by the way in");
  else if (t.byPipes) parts.push("kitchen by the plumbing");
  const s = parts.slice(0, 3).join("; ");
  return s ? `${s[0].toUpperCase()}${s.slice(1)}.` : "";
}

// A polygon's box grown on every side.
const grown = (poly: Pt[], by: number): Pt[] => {
  const b = bounds(poly);
  return rectPoly(b.minX - by, b.minZ - by, b.maxX + by, b.maxZ + by);
};

// The design to recommend: the best of them, which the seed puts first, and its reason in one line (the
// first two parts of its sentence: "Keeps your bathroom; the bedroom on the window wall, away from the
// furnace."). A design saved before designs said why gets a plain one.
export function recommendedOf(designs: Design[]): { designId: string; reason: string } {
  const d = designs[0];
  const parts = (d.why ?? "").replace(/\.$/, "").split("; ").filter(Boolean);
  return { designId: d.id, reason: parts.length ? `${parts.slice(0, 2).join("; ")}.` : `${d.name}: the layout that fits your basement best.` };
}

export function emptyMood(): Model["mood"] {
  return { liked: [], disliked: [], style: null, finishes: {} };
}

// The whole model for a scan. `ideas`: what they picked on the old Ideas tab, so the same design is
// chosen. `mood`: what their board reads so far, which finishes and colours the designs.
export function seedModel(
  result: ScanResultLike,
  state: { tape?: Tape; ideas?: { kind?: "one_bedroom" | "studio" | null; side?: Side | null }; mood?: Mood | null } = {},
  now = new Date().toISOString(),
): Model | null {
  const found = existingFromScan(result, state.tape ?? {});
  if (!found) return null;
  // Its own way in, before any layout: the designs put a new entrance where it has none.
  const existing: Existing = { ...found, entrance: entranceOf(found, saidOutside(result.findings)) };
  const mood = state.mood ?? emptyMood();
  const designs = seedDesigns(existing, { pick: state.ideas ?? null, finishes: mood.finishes, colours: mood.colours, now });
  return { version: 1, existing, designs, mood, ...(designs.length ? { recommended: recommendedOf(designs) } : {}) };
}
