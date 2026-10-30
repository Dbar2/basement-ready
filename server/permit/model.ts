// The basement and the chosen design as the permit set draws them, from the one shared model
// (server/model/current.ts): the one they saved, else seeded from the scan; only a scan the model can't
// be seeded from is drawn from the rooms and layout seeded here. The owner's tape
// numbers then lock the sizes: the two main walls rescale the plan, and each window takes its taped
// width, height and sill. Every sheet reads this, so no size on the drawings is placed by hand.
import { openingsOn } from "../model/checks";
import { currentModel } from "../model/current";
import { chosenDesign } from "../model/legacy";
import type { Alarm, Design, Existing, Fixture, FixtureKind, Model, Opening, Pt, Room, RoomKind, Wall } from "../model/types";
import type { StoredState } from "../workspace";
import { basementGeometry, type Geometry } from "./plans";

// Walls and fixtures the camera never saw are a guess until the owner confirms the plan.
export type PWall = Wall & { guess?: boolean };
export type PFixture = Fixture & { guess?: boolean };

export type WindowChange = "keep" | "enlarge" | "new";
export type PermitWindow = {
  id: string;
  wallId: string;
  tag: string; // W1, W2…
  room: string;
  widthM: number; // as built: the taped size, or the proposed size when it's new or enlarged
  heightM: number | null;
  sillM: number | null;
  was: { widthM: number; heightM: number | null } | null; // an enlarged window's size today
  change: WindowChange;
  escape: boolean; // the bedroom's escape window
  taped: boolean;
};

export type PermitModel = {
  existing: Existing & { walls: PWall[]; fixtures: PFixture[] };
  design: Design & { proposed: Design["proposed"] & { walls: PWall[]; fixtures: PFixture[] } };
  from: "studio" | "scan";
  mainWalls: { id: string; label: string; scanM: number; tapedM: number | null }[];
  windows: PermitWindow[];
  ceilingM: number | null;
  beamM: number | null; // the lowest clearance under a beam, duct or bulkhead
  fuelBurning: boolean;
  estimated: boolean; // sizes still from the video
  geo: Geometry | null;
};

// The escape window we propose when the one there is too small, or there's none: a casement that
// opens fully, 610 x 760 mm clear (0.46 m²), sill at 900 mm.
export const PROPOSED_ESCAPE = { widthM: 0.61, heightM: 0.76, sillM: 0.9 };
export const escapeOk = (w: number | null, h: number | null) => (w == null || h == null ? null : w * h >= 0.35 && Math.min(w, h) >= 0.38);

// ---- Small geometry -----------------------------------------------------------------------------

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const wallLen = (w: Pick<Wall, "a" | "b">) => dist(w.a, w.b);
export const dir = (w: Pick<Wall, "a" | "b">): Pt => {
  const L = wallLen(w) || 1;
  return [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
};
export const at = (w: Pick<Wall, "a" | "b">, t: number): Pt => {
  const d = dir(w);
  return [w.a[0] + d[0] * t, w.a[1] + d[1] * t];
};
// Where p falls along the wall (t) and how far off its line (off).
export function project(w: Pick<Wall, "a" | "b">, p: Pt) {
  const d = dir(w);
  const v: Pt = [p[0] - w.a[0], p[1] - w.a[1]];
  return { t: v[0] * d[0] + v[1] * d[1], off: v[0] * -d[1] + v[1] * d[0] };
}
export function polygonArea(poly: Pt[]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    s += x0 * z1 - x1 * z0;
  }
  return Math.abs(s) / 2;
}
export function inPolygon(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
export function bounds(points: Pt[]): Box {
  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minZ: Math.min(...points.map((p) => p[1])),
    maxZ: Math.max(...points.map((p) => p[1])),
  };
}
export const rect = (x0: number, z0: number, x1: number, z1: number): Pt[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
export const centroid = (poly: Pt[]): Pt => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// A room's floor area, less any room drawn inside it (a stair or furnace room within the open area).
export function roomArea(room: Room, all: Room[]) {
  const b = bounds(room.polygon);
  const inner = all.filter((r) => r !== room && (r.kind === "stairs" || r.kind === "mechanical")).reduce((s, r) => s + overlap(b, bounds(r.polygon)), 0);
  return Math.max(0, polygonArea(room.polygon) - (room.kind === "stairs" || room.kind === "mechanical" ? 0 : inner));
}

// ---- Seeding from the scan and the layout -------------------------------------------------------

type Side = "minX" | "maxX" | "minZ" | "maxZ";
const SIDES: Side[] = ["minZ", "maxX", "maxZ", "minX"];
function sideWall(b: Box, side: Side): { a: Pt; b: Pt } {
  if (side === "minZ") return { a: [b.minX, b.minZ], b: [b.maxX, b.minZ] };
  if (side === "maxZ") return { a: [b.minX, b.maxZ], b: [b.maxX, b.maxZ] };
  if (side === "minX") return { a: [b.minX, b.minZ], b: [b.minX, b.maxZ] };
  return { a: [b.maxX, b.minZ], b: [b.maxX, b.maxZ] };
}

function kindOf(name: string): RoomKind {
  if (/furnace|mechanical|utility|boiler/i.test(name)) return "mechanical";
  if (/laundry/i.test(name)) return "laundry";
  if (/stair/i.test(name)) return "stairs";
  if (/storage|cold ?room|closet/i.test(name)) return "storage";
  if (/bath|washroom/i.test(name)) return "bathroom";
  return "other";
}

const ZONE: Record<string, RoomKind> = { bedroom: "bedroom", bathroom: "bathroom", kitchen: "kitchen", living: "living", stairs: "stairs", mechanical: "mechanical" };

function seed(g: Geometry, result: any): { existing: Existing & { walls: PWall[]; fixtures: PFixture[] }; design: PermitModel["design"]; mainId: string } {
  const areas = [...g.rooms].sort((a, b) => Number(b.plan === g.main?.plan) - Number(a.plan === g.main?.plan) || b.plan.areaM2 - a.plan.areaM2);
  const all = g.box;
  const walls: PWall[] = [];
  const openings: Opening[] = [];
  const rooms: Room[] = [];
  const fixtures: PFixture[] = [];
  let mainId = "";
  areas.forEach((area, i) => {
    const b = area.plan.box;
    const id = `area${i + 1}`;
    const isMain = area.plan === g.main?.plan;
    if (isMain) mainId = id;
    const kind = isMain ? "living" : kindOf(area.name);
    rooms.push({ id, polygon: rect(b.minX, b.minZ, b.maxX, b.maxZ), kind, name: area.name, unit: isMain ? 2 : kind === "mechanical" || kind === "laundry" || kind === "stairs" ? "shared" : 1, ceilingM: area.plan.ceilingHeightM });
    for (const side of SIDES) {
      const s = sideWall(b, side);
      const coord = side === "minX" ? b.minX : side === "maxX" ? b.maxX : side === "minZ" ? b.minZ : b.maxZ;
      const outer = Math.abs(coord - all[side]) < 0.3;
      // Two areas that share a wall: the one drawn first (the suite's) keeps it.
      const host = walls.find((w) => {
        const P = project(w, s.a), Q = project(w, s.b);
        return Math.abs(P.off) < 0.15 && Math.abs(Q.off) < 0.15 && Math.min(P.t, Q.t) > -0.15 && Math.max(P.t, Q.t) < wallLen(w) + 0.15;
      });
      const wall: PWall = host ?? { id: `${id}-${side}`, a: s.a, b: s.b, thicknessM: outer ? 0.2 : 0.12, kind: outer ? "foundation" : "existing", rating: null, guess: area.plan.sides[side] !== "wall" };
      if (!host) walls.push(wall);
      else if (area.plan.sides[side] === "wall") wall.guess = false;
      const shift = host ? project(host, s.a).t : 0;
      area.plan.openings
        .filter((o) => o.side === side)
        .forEach((o, k) => {
          const offsetM = r3(shift + o.atM);
          if (openings.some((x) => x.wallId === wall.id && x.kind === o.kind && Math.abs(x.offsetM - offsetM) < Math.max(x.widthM, o.widthM) * 0.75)) return;
          openings.push({ id: `${id}-${side}-${o.kind[0]}${k + 1}`, wallId: wall.id, kind: o.kind, offsetM, widthM: o.widthM, heightM: o.kind === "door" ? 2.03 : null, sillM: null, status: "existing", swing: o.kind === "door" ? "left" : null, detectionId: o.detectionId });
        });
    }
    area.plan.stairs.forEach((st, k) => fixtures.push({ id: `${id}-stairs${k + 1}`, kind: "stairs", at: [(st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2], sizeM: [st.x1 - st.x0, st.z1 - st.z0], detectionId: st.detectionId }));
    area.plan.fixtures.forEach((f, k) => fixtures.push({ id: `${id}-${f.kind}${k + 1}`, kind: f.kind as FixtureKind, at: [f.x, f.z], sizeM: f.kind === "furnace" ? [0.6, 0.7] : f.kind === "water_heater" ? [0.55, 0.55] : f.kind === "panel" ? [0.5, 0.15] : [0.3, 0.3], detectionId: f.detectionId }));
  });

  // Beams, ducts and bulkheads: the scan measured the clearance under each but not where it runs. A
  // main beam usually runs down the middle the long way, ducts beside it: placed there, to confirm.
  const main = g.main?.plan.box ?? all;
  const longX = main.maxX - main.minX >= main.maxZ - main.minZ;
  const clearances: { detectionId: string; label: string; clearanceM: number }[] = result?.measurements?.clearances ?? [];
  clearances
    .filter((c) => c.clearanceM >= 1.2)
    .forEach((c, i) => {
      const kind: FixtureKind = /bulkhead/i.test(c.label) ? "bulkhead" : /beam/i.test(c.label) ? "beam" : "duct";
      const off = kind === "beam" ? 0 : (i % 2 ? -1 : 1) * (0.5 + 0.4 * Math.floor(i / 2));
      const w = kind === "beam" ? 0.2 : kind === "duct" ? 0.35 : 0.45;
      const cx = (main.minX + main.maxX) / 2, cz = (main.minZ + main.maxZ) / 2;
      fixtures.push({
        id: `overhead${i + 1}`,
        kind,
        at: longX ? [cx, cz + off] : [cx + off, cz],
        sizeM: longX ? [main.maxX - main.minX, w] : [w, main.maxZ - main.minZ],
        heightM: c.clearanceM,
        detectionId: c.detectionId,
        guess: true,
      });
    });

  const existing = { walls, openings, rooms, fixtures, ceilingM: g.ceilingM, scale: { source: "model" as const }, confirmedAt: null };

  // ---- The design: the layout's rooms and walls, the stair and furnace room behind rated walls ----
  const dWalls: PWall[] = walls.map((w) => ({ ...w }));
  const dOpen: Opening[] = openings.map((o) => ({ ...o }));
  const dRooms: Room[] = rooms.filter((r) => r.id !== mainId).map((r) => ({ ...r }));
  const dFix: PFixture[] = fixtures.map((f) => ({ ...f }));
  const mb = g.main?.plan.box ?? all;
  let n = 0;
  const newWall = (a: Pt, b: Pt, rating: Wall["rating"] = null) => {
    const w: PWall = { id: `new${++n}`, a: [r3(a[0]), r3(a[1])], b: [r3(b[0]), r3(b[1])], thicknessM: 0.12, kind: "new", rating };
    dWalls.push(w);
    return w;
  };
  let d = 0;
  const door = (w: Wall, offsetM: number, widthM: number, rating: Opening["rating"] = null) => {
    const o: Opening = { id: `door${++d}`, wallId: w.id, kind: "door", offsetM: r3(offsetM), widthM: Math.min(widthM, wallLen(w) - 0.05), heightM: 2.03, status: "new", swing: "left", rating };
    dOpen.push(o);
    return o;
  };
  // A side that lies on the area's own outside wall needs no new wall.
  const onBoundary = (a: Pt, b: Pt) => {
    if (Math.abs(a[0] - b[0]) < 0.01) return Math.abs(a[0] - mb.minX) < 0.05 || Math.abs(a[0] - mb.maxX) < 0.05;
    if (Math.abs(a[1] - b[1]) < 0.01) return Math.abs(a[1] - mb.minZ) < 0.05 || Math.abs(a[1] - mb.maxZ) < 0.05;
    return false;
  };
  const centre: Pt = [(mb.minX + mb.maxX) / 2, (mb.minZ + mb.maxZ) / 2];
  // Walls of a room inside the area, on the sides not already a wall of the area, rated 30 minutes,
  // and a 20-minute door with a closer on the side facing the suite.
  const enclose = (z: { x0: number; z0: number; x1: number; z1: number }) => {
    const sides = SIDES.map((s) => sideWall({ minX: z.x0, maxX: z.x1, minZ: z.z0, maxZ: z.z1 }, s)).filter((s) => !onBoundary(s.a, s.b));
    const made = sides.map((s) => newWall(s.a, s.b, "30min"));
    const face = made.filter((w) => wallLen(w) >= 0.9).sort((a, b) => dist(at(a, wallLen(a) / 2), centre) - dist(at(b, wallLen(b) / 2), centre))[0];
    if (face) door(face, wallLen(face) / 2, 0.81, "20min");
  };
  const L = g.layout;
  if (L) {
    const layoutWalls = L.walls.map((w) => newWall([w.x0, w.z0], [w.x1, w.z1]));
    for (const dd of L.doors) {
      const w = layoutWalls.find((x) => {
        const p = project(x, [dd.x, dd.z]);
        return Math.abs(p.off) < 0.05 && p.t > 0 && p.t < wallLen(x);
      });
      if (w) door(w, project(w, [dd.x, dd.z]).t, Math.max(dd.widthM, 0.76));
    }
    L.zones.forEach((z, i) => {
      const kind = ZONE[z.kind] ?? "other";
      const polygon = rect(z.x0, z.z0, z.x1, z.z1);
      if (kind === "stairs" || kind === "mechanical") {
        dRooms.push({ id: `${kind}${i + 1}`, polygon, kind, name: kind === "stairs" ? "Stairs to unit 1" : "Furnace room", unit: "shared", ceilingM: g.ceilingM });
        enclose(z);
      } else dRooms.push({ id: `${kind}${i + 1}`, polygon, kind, name: z.name, unit: 2, ceilingM: g.ceilingM, ...({ ceilingRating: "15min" } as object) });
    });
  } else dRooms.push({ id: mainId, polygon: rect(mb.minX, mb.minZ, mb.maxX, mb.maxZ), kind: "living", name: "Unit 2", unit: 2, ceilingM: g.ceilingM, ...({ ceilingRating: "15min" } as object) });
  // The suite's own walls to the rest of the house are rated too, and so are their doors.
  for (const w of dWalls) {
    if (w.kind !== "existing" || !w.id.startsWith(`${mainId}-`)) continue;
    w.rating = "30min";
    for (const o of dOpen) if (o.wallId === w.id && o.kind === "door") o.rating = "20min";
  }
  // A side of the suite the camera never saw, inside the basement: closed with a new rated wall.
  for (const w of dWalls) if (w.guess && w.kind === "existing" && w.id.startsWith(`${mainId}-`)) Object.assign(w, { kind: "new", rating: "30min", guess: false });

  // The escape window: the bedroom's window the layout picked, or a new one in the outside wall
  // nearest the bedroom (never an inside wall).
  const bed = dRooms.find((r) => r.unit === 2 && r.kind === "bedroom");
  if (g.egress && g.main) {
    const sideId = `${mainId}-${g.egress.side}`;
    const mine = dOpen.filter((o) => o.wallId === sideId && o.kind === "window").sort((a, b) => Math.abs(a.offsetM - g.egress!.atM) - Math.abs(b.offsetM - g.egress!.atM))[0];
    if (g.egress.existing && mine) (mine as Opening & { escape?: boolean }).escape = true;
  }
  if (bed && !dOpen.some((o) => (o as { escape?: boolean }).escape)) {
    // Outside walls the bedroom itself runs along, and how much of each it has.
    const runs = dWalls
      .filter((w) => w.kind === "foundation")
      .map((w) => {
        const ps = bed.polygon.map((p) => project(w, p));
        const on = ps.filter((p) => Math.abs(p.off) < 0.25);
        if (on.length < 2) return null;
        const t0 = Math.max(0, Math.min(...on.map((p) => p.t))), t1 = Math.min(wallLen(w), Math.max(...on.map((p) => p.t)));
        return t1 - t0 >= PROPOSED_ESCAPE.widthM + 0.4 ? { w, t0, t1 } : null;
      })
      .filter((x): x is { w: PWall; t0: number; t1: number } => x !== null)
      .sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0));
    const host = runs[0];
    if (host) {
      const o: Opening & { escape?: boolean } = { id: "escape1", wallId: host.w.id, kind: "window", offsetM: r3((host.t0 + host.t1) / 2), widthM: PROPOSED_ESCAPE.widthM, heightM: PROPOSED_ESCAPE.heightM, sillM: PROPOSED_ESCAPE.sillM, status: "new", escape: true };
      dOpen.push(o);
    }
  }
  const alarms: Alarm[] = g.alarms.map((a, i) => ({ id: `alarm${i + 1}`, kind: a.kind, at: [a.x, a.z], why: a.why }));
  const stair = dRooms.find((r) => r.kind === "stairs");
  if (stair) alarms.push({ id: `alarm${alarms.length + 1}`, kind: "smoke", at: centroid(stair.polygon), why: "In the shared stair" });
  const design = {
    id: "permit",
    name: L?.kind === "studio" ? "Studio" : "One bedroom",
    layout: L?.kind ?? "custom",
    proposed: { walls: dWalls, openings: dOpen, rooms: dRooms, fixtures: dFix, alarms, furniture: [] },
    finishes: { style: "", floor: "", walls: "" },
    chosen: true,
    updatedAt: "",
  } as PermitModel["design"];
  return { existing, design, mainId };
}

// ---- Tape ---------------------------------------------------------------------------------------

// The two walls the owner tapes: the suite's longest wall each way.
function mainWallsOf(existing: Existing, design: Design): PWall[] {
  const unit = design.proposed.rooms.filter((r) => r.unit === 2);
  if (!unit.length) return [];
  const ub = bounds(unit.flatMap((r) => r.polygon));
  const near = (w: Wall) => [w.a, w.b].every((p) => p[0] > ub.minX - 0.3 && p[0] < ub.maxX + 0.3 && p[1] > ub.minZ - 0.3 && p[1] < ub.maxZ + 0.3);
  const cands = existing.walls.filter((w) => w.kind !== "new" && near(w));
  const along = (axis: 0 | 1) => cands.filter((w) => Math.abs(dir(w)[axis]) > 0.9).sort((a, b) => Number(Boolean((a as PWall).guess)) - Number(Boolean((b as PWall).guess)) || wallLen(b) - wallLen(a))[0];
  return [along(0), along(1)].filter(Boolean) as PWall[];
}

// Scale every point about `o` by kx along x and kz along z.
function rescale<T>(v: T, o: Pt, kx: number, kz: number): T {
  const P = (p: Pt): Pt => [r3(o[0] + (p[0] - o[0]) * kx), r3(o[1] + (p[1] - o[1]) * kz)];
  const walls = (ws: PWall[]) => ws.map((w) => ({ ...w, a: P(w.a), b: P(w.b) }));
  const scaleOffset = (ows: Opening[], ws: PWall[]) =>
    ows.map((op) => {
      const w = ws.find((x) => x.id === op.wallId);
      if (!w) return op;
      const d = dir(w);
      return { ...op, offsetM: r3(op.offsetM * Math.hypot(d[0] * kx, d[1] * kz)) };
    });
  const anyV = v as any;
  const layer = (l: any) => ({
    ...l,
    walls: walls(l.walls),
    openings: scaleOffset(l.openings, l.walls),
    rooms: l.rooms.map((r: Room) => ({ ...r, polygon: r.polygon.map(P) })),
    fixtures: l.fixtures.map((f: PFixture) => ({ ...f, at: P(f.at), sizeM: f.sizeM ? ([r3(f.sizeM[0] * kx), r3(f.sizeM[1] * kz)] as Pt) : f.sizeM })),
    ...(l.alarms ? { alarms: l.alarms.map((a: Alarm) => ({ ...a, at: P(a.at) })) } : {}),
    ...(l.furniture ? { furniture: l.furniture.map((f: any) => ({ ...f, at: P(f.at) })) } : {}),
  });
  if (anyV.proposed) return { ...anyV, proposed: layer(anyV.proposed) };
  return layer(anyV);
}

// ---- The model the sheets draw ------------------------------------------------------------------

// Each bedroom's escape window: the biggest window in its outside walls, marked for the sheets.
function markEscape(design: Design): Design {
  if (design.proposed.openings.some((o) => (o as { escape?: boolean }).escape)) return design;
  const escape = new Set(
    design.proposed.rooms
      .filter((r) => r.kind === "bedroom" && r.unit === 2)
      .flatMap((r) => openingsOn(r, design, "window").sort((a, b) => b.widthM * (b.heightM ?? 0.5) - a.widthM * (a.heightM ?? 0.5)).slice(0, 1))
      .map((o) => o.id),
  );
  return escape.size ? { ...design, proposed: { ...design.proposed, openings: design.proposed.openings.map((o) => (escape.has(o.id) ? { ...o, escape: true } : o)) } } : design;
}

export function permitModel(result: any, state: StoredState | null | undefined): PermitModel | null {
  const st = state ?? {};
  const geo = basementGeometry(result, st);
  // The model every page works from: the one they saved, else seeded from the scan (server/model/current.ts).
  const current = currentModel(result, st);
  let existing: PermitModel["existing"];
  let design: PermitModel["design"];
  let from: PermitModel["from"];
  if (current?.model.designs.length) {
    existing = current.model.existing as PermitModel["existing"];
    design = markEscape(chosenDesign(current.model)!) as PermitModel["design"];
    from = current.saved ? "studio" : "scan";
  } else {
    if (!geo) return null;
    ({ existing, design } = seed(geo, result));
    from = "scan";
  }

  // The main walls, and the tape that locks them.
  const tapes = new Map((st.permit?.walls ?? []).map((w) => [w.id, w.mm]));
  const studioTape = new Map((existing.scale.tapeM ?? []).map((t) => [t.wallId, t.lengthM]));
  const mains = mainWallsOf(existing, design);
  const mainWalls = mains.map((w) => {
    const taped = tapes.get(w.id);
    return { id: w.id, label: Math.abs(dir(w)[0]) > 0.9 ? "side-to-side wall" : "front-to-back wall", scanM: wallLen(w), tapedM: taped ? taped / 1000 : (studioTape.get(w.id) ?? null) };
  });
  if (from === "scan" && mains.length) {
    const kOf = (axis: 0 | 1) => {
      const m = mainWalls.find((x, i) => Math.abs(dir(mains[i])[axis]) > 0.9);
      return m?.tapedM && m.scanM > 0.5 ? m.tapedM / m.scanM : 1;
    };
    const kx = kOf(0), kz = kOf(1);
    if (kx !== 1 || kz !== 1) {
      const o: Pt = [Math.min(...mains.flatMap((w) => [w.a[0], w.b[0]])), Math.min(...mains.flatMap((w) => [w.a[1], w.b[1]]))];
      existing = rescale(existing, o, kx, kz);
      design = rescale(design, o, kx, kz);
    }
  }

  // Windows: taped sizes, and what happens to each.
  const taped = new Map((st.permit?.windows ?? []).map((w) => [w.id, w]));
  const t = st.tape ?? {};
  const roomOf = (wallId: string) => {
    const w = design.proposed.walls.find((x) => x.id === wallId);
    if (!w) return "";
    const mid = at(w, wallLen(w) / 2);
    const [nx, nz] = [-dir(w)[1], dir(w)[0]];
    const touches = (r: Room) => r.kind !== "stairs" && r.kind !== "mechanical" && (inPolygon([mid[0] + nx * 0.3, mid[1] + nz * 0.3], r.polygon) || inPolygon([mid[0] - nx * 0.3, mid[1] - nz * 0.3], r.polygon));
    const room = design.proposed.rooms.find((r) => r.unit === 2 && touches(r)) ?? design.proposed.rooms.find(touches);
    return room?.name ?? "";
  };
  const windows: PermitWindow[] = [];
  const winOpenings = design.proposed.openings.filter((o) => o.kind === "window").sort((a, b) => Number(Boolean((b as { escape?: boolean }).escape)) - Number(Boolean((a as { escape?: boolean }).escape)));
  winOpenings.forEach((o, i) => {
    const escape = Boolean((o as { escape?: boolean }).escape);
    const tw = taped.get(o.id);
    const wMm = tw?.widthMm ?? (escape ? t.egressWidthMm : null) ?? null;
    const hMm = tw?.heightMm ?? (escape ? t.egressHeightMm : null) ?? null;
    const sMm = tw?.sillMm ?? (escape ? t.egressSillMm : null) ?? null;
    const isTaped = o.status === "new" || (wMm != null && hMm != null && sMm != null);
    const nowW = wMm ? wMm / 1000 : o.widthM, nowH = hMm ? hMm / 1000 : o.heightM, nowS = sMm ? sMm / 1000 : (o.sillM ?? null);
    let change: WindowChange = o.status === "new" ? "new" : "keep";
    let widthM = nowW, heightM = nowH, sillM = nowS, was: PermitWindow["was"] = null;
    if (escape && change === "keep" && escapeOk(wMm ? nowW : null, hMm ? nowH : null) === false) {
      change = "enlarge";
      was = { widthM: nowW, heightM: nowH };
      widthM = Math.max(nowW, PROPOSED_ESCAPE.widthM);
      heightM = Math.max(nowH ?? 0, PROPOSED_ESCAPE.heightM);
      sillM = Math.min(nowS ?? PROPOSED_ESCAPE.sillM, PROPOSED_ESCAPE.sillM);
    }
    windows.push({ id: o.id, wallId: o.wallId, tag: `W${i + 1}`, room: roomOf(o.wallId), widthM, heightM, sillM, was, change, escape, taped: isTaped });
  });

  // Each window drawn at its size as built: taped, or proposed when it's new or enlarged.
  const sized = new Map(windows.map((w) => [w.id, w]));
  design = { ...design, proposed: { ...design.proposed, openings: design.proposed.openings.map((o) => (sized.has(o.id) ? { ...o, widthM: sized.get(o.id)!.widthM, heightM: sized.get(o.id)!.heightM, sillM: sized.get(o.id)!.sillM } : o)) } };

  const tapedAll = mainWalls.length > 0 && mainWalls.every((m) => m.tapedM != null);
  // The owner tapes the lowest beam or duct: none is lower than that, and the video's guesses that
  // were lower come up to it.
  if (t.beamMm) {
    const lowest = t.beamMm / 1000;
    const lift = (fs: PFixture[]) => fs.map((f) => ((f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead") && f.heightM != null ? { ...f, heightM: Math.max(f.heightM, lowest) } : f));
    design = { ...design, proposed: { ...design.proposed, fixtures: lift(design.proposed.fixtures) } };
  }
  const overhead = design.proposed.fixtures.filter((f) => (f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead") && f.heightM != null).map((f) => f.heightM as number);
  return {
    existing,
    design,
    from,
    mainWalls,
    windows,
    ceilingM: t.ceilingMm ? t.ceilingMm / 1000 : (existing.ceilingM ?? geo?.ceilingM ?? null),
    beamM: t.beamMm ? t.beamMm / 1000 : overhead.length ? Math.min(...overhead) : (geo?.beamM ?? null),
    fuelBurning: design.proposed.fixtures.some((f) => f.kind === "furnace" || f.kind === "water_heater") || Boolean(geo?.fuelBurning),
    estimated: !tapedAll,
    geo,
  };
}

// The suite's rooms, and the floor area of unit 2.
export const unitRooms = (m: PermitModel) => m.design.proposed.rooms.filter((r) => r.unit === 2);
// Everything that's unit 2's floor: its rooms, and the area of the basement it takes as a whole (the
// open floor between the rooms is the suite's too).
export const unitOutline = (m: PermitModel) => [...m.existing.rooms.filter((r) => r.unit === 2), ...unitRooms(m)].map((r) => r.polygon);
export function unitArea(m: PermitModel) {
  const polys = unitOutline(m);
  if (!polys.length) return 0;
  const out = m.design.proposed.rooms.filter((r) => r.kind === "stairs" || r.kind === "mechanical").map((r) => r.polygon);
  const b = bounds(polys.flat());
  const step = 0.05;
  let n = 0;
  for (let x = b.minX + step / 2; x < b.maxX; x += step)
    for (let z = b.minZ + step / 2; z < b.maxZ; z += step) if (polys.some((p) => inPolygon([x, z], p)) && !out.some((p) => inPolygon([x, z], p))) n++;
  return n * step * step;
}
