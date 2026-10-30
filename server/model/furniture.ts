// Furniture in the design itself, so every view agrees: the 3D, the plan and every picture of every
// angle show the bed in the same spot, and swapping the sofa for a desk changes all of them at once.
// The model decides where things go; renderers only draw what's here.
//
// Each room gets the pieces its kind needs, backed onto a wall where it can be, each one checked as
// it's placed: inside its room, clear of the others and of every door's swing, and leaving a path
// from every room to the way out. Pure and deterministic, so the browser and the server agree.
import type { Design, Edit, Furniture, FurnitureKind, Opening, Pt, Room, Wall } from "./types";

// What a piece looks like. Most are their kind; two small "other" pieces are told apart by their id.
export type Look = Exclude<FurnitureKind, "other"> | "coffee_table" | "nightstand" | "other";
export const lookOf = (f: Pick<Furniture, "kind" | "id">): Look =>
  f.kind !== "other" ? f.kind : /coffee-table/.test(f.id) ? "coffee_table" : /nightstand/.test(f.id) ? "nightstand" : "other";

// Footprints are [along the wall it backs onto, out from it], in metres, before rotation. `front` is the
// clear floor it needs in front (to sit, open, walk past); `heightM` decides whether it fits under a window.
type Spec = { label: string; sizes: Pt[]; front: number; heightM: number };
export const SPECS: Record<Look, Spec> = {
  bed: { label: "Bed", sizes: [[1.72, 2.17], [1.42, 2.02]], front: 0.5, heightM: 1.1 },
  sofa: { label: "Sofa", sizes: [[2.2, 0.95], [1.8, 0.9]], front: 0.42, heightM: 0.85 },
  armchair: { label: "Armchair", sizes: [[0.82, 0.99]], front: 0.3, heightM: 1.02 },
  desk: { label: "Desk", sizes: [[1.2, 0.6]], front: 0.75, heightM: 0.76 },
  dining: { label: "Dining table", sizes: [[1.4, 1.66], [0.8, 1.6]], front: 0.25, heightM: 0.9 },
  dresser: { label: "Dresser", sizes: [[1.2, 0.5]], front: 0.6, heightM: 0.82 },
  tv: { label: "TV and console", sizes: [[1.76, 0.4]], front: 0.3, heightM: 1.35 },
  rug: { label: "Rug", sizes: [[2.6, 1.8]], front: 0, heightM: 0.01 },
  shelf: { label: "Bookshelf", sizes: [[0.9, 0.35]], front: 0.4, heightM: 1.8 },
  kitchen: { label: "Kitchen", sizes: [[3.0, 0.62]], front: 1.0, heightM: 2.1 },
  fridge: { label: "Fridge", sizes: [[0.75, 0.68]], front: 0.9, heightM: 1.8 },
  vanity: { label: "Vanity", sizes: [[0.6, 0.46]], front: 0.6, heightM: 0.85 },
  toilet: { label: "Toilet", sizes: [[0.4, 0.66]], front: 0.6, heightM: 0.8 },
  shower: { label: "Tub and shower", sizes: [[1.5, 0.75]], front: 0.6, heightM: 0.6 },
  washer_dryer: { label: "Washer and dryer", sizes: [[0.7, 0.7]], front: 0.9, heightM: 1.0 },
  coffee_table: { label: "Coffee table", sizes: [[1.2, 0.6]], front: 0, heightM: 0.39 },
  nightstand: { label: "Nightstand", sizes: [[0.5, 0.42]], front: 0, heightM: 0.55 },
  other: { label: "Furniture", sizes: [[0.6, 0.6]], front: 0, heightM: 0.8 },
};

// What a tap on a piece can swap it for: the pieces that stand against a wall in a living space.
export const SWAPS: FurnitureKind[] = ["sofa", "desk", "bed", "armchair", "dining", "dresser", "shelf", "tv"];

// ---------- plane geometry ----------

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const addS = (a: Pt, d: Pt, k: number): Pt => [a[0] + d[0] * k, a[1] + d[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const unit = (a: Pt): Pt => {
  const l = Math.hypot(a[0], a[1]);
  return l > 1e-9 ? [a[0] / l, a[1] / l] : [1, 0];
};

// Facing direction on the floor for a rotation about +Y (0 faces +z).
export const facing = (rotDeg: number): Pt => [Math.sin((rotDeg * Math.PI) / 180), Math.cos((rotDeg * Math.PI) / 180)];
const rotFor = (dir: Pt) => {
  const d = Math.round((Math.atan2(dir[0], dir[1]) * 180) / Math.PI);
  return d === -180 ? 180 : d;
};

// The four corners of a footprint: `at` its centre, `size` [local x, local z], turned by rotDeg.
export function corners(f: Pick<Furniture, "at" | "rotDeg" | "sizeM">, grow = 0): Pt[] {
  const z = facing(f.rotDeg);
  const x: Pt = [z[1], -z[0]];
  const hx = f.sizeM[0] / 2 + grow, hz = f.sizeM[1] / 2 + grow;
  return [
    [f.at[0] - x[0] * hx - z[0] * hz, f.at[1] - x[1] * hx - z[1] * hz],
    [f.at[0] + x[0] * hx - z[0] * hz, f.at[1] + x[1] * hx - z[1] * hz],
    [f.at[0] + x[0] * hx + z[0] * hz, f.at[1] + x[1] * hx + z[1] * hz],
    [f.at[0] - x[0] * hx + z[0] * hz, f.at[1] - x[1] * hx + z[1] * hz],
  ];
}

// Two convex outlines overlap by more than `slack` metres (separating axis test).
export function overlaps(a: Pt[], b: Pt[], slack = 0.01) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const n = unit([-(poly[(i + 1) % poly.length][1] - poly[i][1]), poly[(i + 1) % poly.length][0] - poly[i][0]]);
      const pa = a.map((p) => dot(p, n)), pb = b.map((p) => dot(p, n));
      if (Math.max(...pa) - slack <= Math.min(...pb) || Math.max(...pb) - slack <= Math.min(...pa)) return false;
    }
  }
  return true;
}

export function inPolygon(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
}

const segmentsCross = (p: Pt, q: Pt, a: Pt, b: Pt) => {
  const d1 = cross(sub(q, p), sub(a, p)), d2 = cross(sub(q, p), sub(b, p));
  const d3 = cross(sub(b, a), sub(p, a)), d4 = cross(sub(b, a), sub(q, a));
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
};

// Every corner inside the room (a centimetre of slack) and no room edge cutting across it.
export function insideRoom(c: Pt[], poly: Pt[]) {
  const centre: Pt = [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length];
  const shrunk = c.map((p) => addS(p, unit(sub(centre, p)), 0.012));
  if (!shrunk.every((p) => inPolygon(p, poly))) return false;
  return !shrunk.some((p, i) => poly.some((a, k) => segmentsCross(p, shrunk[(i + 1) % shrunk.length], a, poly[(k + 1) % poly.length])));
}

// ---------- what a room offers: its edges, its doors ----------

type Span = [number, number];
type Edge = { a: Pt; dir: Pt; n: Pt; len: number; solid: boolean; doors: Span[]; windows: Span[]; sills: number[] };

const opening = (w: Wall, o: Opening): [Pt, Pt] => {
  const d = unit(sub(w.b, w.a));
  return [addS(w.a, d, o.offsetM - o.widthM / 2), addS(w.a, d, o.offsetM + o.widthM / 2)];
};

// A room's edges, each with an inward normal, whether a wall stands on it, and where its doors and
// windows are along it.
function edgesOf(room: Room, walls: Wall[], openings: Opening[]): Edge[] {
  const poly = room.polygon;
  let area = 0;
  for (let i = 0; i < poly.length; i++) area += cross(poly[i], poly[(i + 1) % poly.length]);
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dir = unit(sub(b, a));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n: Pt = area > 0 ? [-dir[1], dir[0]] : [dir[1], -dir[0]];
    // Walls on this edge's line: how much of the edge they cover.
    let covered = 0;
    const doors: Span[] = [], windows: Span[] = [], sills: number[] = [];
    for (const w of walls) {
      const off = Math.max(Math.abs(cross(dir, sub(w.a, a))), Math.abs(cross(dir, sub(w.b, a))));
      if (off > 0.08) continue;
      const t0 = dot(sub(w.a, a), dir), t1 = dot(sub(w.b, a), dir);
      covered += Math.max(0, Math.min(len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)));
      for (const o of openings.filter((x) => x.wallId === w.id)) {
        const [p, q] = opening(w, o).map((e) => dot(sub(e, a), dir));
        const s: Span = [Math.min(p, q), Math.max(p, q)];
        if (s[1] < 0 || s[0] > len) continue;
        if (o.kind === "door") doors.push(s);
        else {
          windows.push(s);
          sills.push(o.sillM ?? 1.3);
        }
      }
    }
    return { a, dir, n, len, solid: covered >= len * 0.5, doors, windows, sills };
  });
}

// The floor in front of each door, both sides, where nothing may stand: the door swings there.
export function doorZones(design: Pick<Design, "proposed">): Pt[][] {
  const { walls, openings } = design.proposed;
  return openings.flatMap((o) => {
    if (o.kind !== "door") return [];
    const w = walls.find((x) => x.id === o.wallId);
    if (!w) return [];
    const [p, q] = opening(w, o);
    const d = unit(sub(q, p));
    const n: Pt = [-d[1], d[0]];
    const reach = o.widthM; // the leaf's swing, a little less than the opening
    const a = addS(p, d, -0.05), b = addS(q, d, 0.05);
    return [[addS(a, n, -reach), addS(b, n, -reach), addS(b, n, reach), addS(a, n, reach)]];
  });
}

// ---------- the path out ----------

const CELL = 0.1;
const CLEAR_FURNITURE = 0.35; // a 0.7 m way past furniture
const CLEAR_WALL = 0.2; // through a 0.4 m gap or wider: any doorway

// Can you walk from the way out to every door, and into every room that has furniture? On a 10 cm
// grid over the design: walls (less their doorways) and furniture (less rugs) are in the way. The way
// out is the existing doors, or the stairs; with neither, any door.
export function pathOut(design: Pick<Design, "proposed">, furniture = design.proposed.furniture): { ok: boolean; why: string | null } {
  const { walls, openings, rooms, fixtures } = design.proposed;
  if (!rooms.length) return { ok: true, why: null };
  const pts = [...rooms.flatMap((r) => r.polygon), ...walls.flatMap((w) => [w.a, w.b])];
  const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  const z0 = Math.min(...pts.map((p) => p[1])), z1 = Math.max(...pts.map((p) => p[1]));
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
  const centre = (i: number, k: number): Pt => [x0 + (i + 0.5) * CELL, z0 + (k + 0.5) * CELL];
  // Solid wall pieces: each wall less its openings (windows block walking too, so only doors are cut).
  const solid: [Pt, Pt][] = walls.flatMap((w) => {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const d = unit(sub(w.b, w.a));
    const cuts = openings
      .filter((o) => o.wallId === w.id && o.kind === "door")
      .map((o): Span => [o.offsetM - o.widthM / 2, o.offsetM + o.widthM / 2])
      .sort((p, q) => p[0] - q[0]);
    const out: [Pt, Pt][] = [];
    let t = 0;
    for (const [c0, c1] of cuts) {
      if (c0 > t) out.push([addS(w.a, d, t), addS(w.a, d, c0)]);
      t = Math.max(t, c1);
    }
    if (t < len) out.push([addS(w.a, d, t), w.b]);
    return out;
  });
  const blockers = [
    ...furniture.filter((f) => lookOf(f) !== "rug").map((f) => corners(f)),
    ...fixtures.filter((f) => f.kind !== "stairs" && f.kind !== "beam" && f.kind !== "duct" && f.kind !== "bulkhead").map((f) => {
      const [sx, sz] = f.sizeM ?? [0.6, 0.6];
      return corners({ at: f.at, rotDeg: 0, sizeM: [sx, sz] });
    }),
  ];
  const free = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const p = centre(i, k);
      if (solid.some(([a, b]) => distToSegment(p, a, b) < CLEAR_WALL)) continue;
      if (blockers.some((c) => inPolygon(p, c) || c.some((q, j) => distToSegment(p, q, c[(j + 1) % 4]) < CLEAR_FURNITURE))) continue;
      free[k * nx + i] = 1;
    }
  }
  const cellOf = (p: Pt) => [Math.floor((p[0] - x0) / CELL), Math.floor((p[1] - z0) / CELL)] as const;
  // The free cells within reach of a point (a door's centre is inside the wall, so look around it).
  const near = (p: Pt, r = 0.35) => {
    const out: number[] = [];
    const [ci, ck] = cellOf(p);
    const m = Math.ceil(r / CELL);
    for (let k = ck - m; k <= ck + m; k++) for (let i = ci - m; i <= ci + m; i++) if (i >= 0 && k >= 0 && i < nx && k < nz && free[k * nx + i]) out.push(k * nx + i);
    return out;
  };
  const doorCentres = openings.flatMap((o) => {
    const w = walls.find((x) => x.id === o.wallId);
    if (!w || o.kind !== "door") return [];
    return [{ o, w, at: addS(w.a, unit(sub(w.b, w.a)), o.offsetM) }];
  });
  const exits = [
    ...doorCentres.filter((d) => d.w.kind !== "new").map((d) => d.at),
    ...rooms.filter((r) => r.kind === "stairs").map((r) => r.polygon.reduce<Pt>((s, p) => [s[0] + p[0] / r.polygon.length, s[1] + p[1] / r.polygon.length], [0, 0])),
    ...fixtures.filter((f) => f.kind === "stairs").map((f) => f.at),
  ];
  const starts = (exits.length ? exits : doorCentres.map((d) => d.at)).flatMap((p) => near(p));
  if (!starts.length && !exits.length && !doorCentres.length) return { ok: true, why: null };
  if (!starts.length) return { ok: false, why: "Nothing clear at the way out." };
  const seen = new Uint8Array(nx * nz);
  const queue = [...new Set(starts)];
  queue.forEach((c) => (seen[c] = 1));
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const i = c % nx, k = (c - i) / nx;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, kk = k + dk;
      if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
      const n = kk * nx + ii;
      if (free[n] && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  for (const d of doorCentres) if (!near(d.at).some((c) => seen[c])) return { ok: false, why: `The door on ${d.w.id} can't be reached.` };
  // And the front of every piece that's used from the front: the bed's side, the counter, the sofa.
  for (const f of furniture) {
    const spec = SPECS[lookOf(f)];
    const zone = spec.front > 0 ? frontZone(f, spec.front) : null;
    if (!zone) continue;
    const reach = 0.45;
    const zx = zone.map((p) => p[0]), zz = zone.map((p) => p[1]);
    let reached = false;
    for (let k = Math.max(0, Math.floor((Math.min(...zz) - reach - z0) / CELL)); k < Math.min(nz, Math.ceil((Math.max(...zz) + reach - z0) / CELL)) && !reached; k++) {
      for (let i = Math.max(0, Math.floor((Math.min(...zx) - reach - x0) / CELL)); i < Math.min(nx, Math.ceil((Math.max(...zx) + reach - x0) / CELL)) && !reached; i++) {
        if (!seen[k * nx + i]) continue;
        const p = centre(i, k);
        reached = inPolygon(p, zone) || zone.some((q, j) => distToSegment(p, q, zone[(j + 1) % 4]) <= reach);
      }
    }
    if (!reached) return { ok: false, why: `The ${spec.label.toLowerCase()} can't be reached.` };
  }
  return { ok: true, why: null };
}

// ---------- placing ----------

type Ctx = {
  design: Design;
  room: Room;
  edges: Edge[];
  placed: Furniture[]; // everything in the design so far, every room
  doors: Pt[][];
  fixtures: Pt[][];
  budget: { paths: number }; // way-out checks left (PATH_CHECKS)
};

// The floor a piece keeps clear in front of it.
function frontZone(f: Pick<Furniture, "at" | "rotDeg" | "sizeM">, front: number): Pt[] | null {
  if (front <= 0) return null;
  const z = facing(f.rotDeg);
  return corners({ at: addS(f.at, z, f.sizeM[1] / 2 + front / 2), rotDeg: f.rotDeg, sizeM: [f.sizeM[0], front] });
}

const PAIRS = new Set(["coffee_table|sofa", "armchair|coffee_table", "bed|nightstand"]);
const together = (a: Look, b: Look) => PAIRS.has([a, b].sort().join("|"));

// Does `f` fit: in its room, clear of every piece (and the floor each keeps clear), of door swings and
// of fixtures, and not in front of a window it's taller than the sill of? Rugs only need the room.
function fits(ctx: Ctx, f: Furniture, edge?: { e: Edge; t0: number; t1: number }) {
  const c = corners(f);
  if (!insideRoom(c, ctx.room.polygon)) return false;
  const look = lookOf(f);
  if (look === "rug") return true;
  const mine = frontZone(f, SPECS[look].front);
  for (const o of ctx.placed) {
    const ol = lookOf(o);
    if (ol === "rug") continue;
    const oc = corners(o);
    if (overlaps(c, oc)) return false;
    // A coffee table sits in the sofa's clear floor, chairs face it, nightstands stand by the bed.
    const pair = together(look, ol);
    const theirs = frontZone(o, SPECS[ol].front);
    if (theirs && !pair && overlaps(c, theirs)) return false;
    if (mine && !pair && overlaps(mine, oc)) return false;
  }
  if (ctx.doors.some((d) => overlaps(c, d))) return false;
  if (ctx.fixtures.some((x) => overlaps(c, x))) return false;
  if (edge) {
    const { e, t0, t1 } = edge;
    if (e.doors.some(([a, b]) => t1 > a - 0.05 && t0 < b + 0.05)) return false;
    if (e.windows.some(([a, b], i) => t1 > a && t0 < b && SPECS[look].heightM > e.sills[i] - 0.05)) return false;
  }
  return true;
}

// Places `f` if it fits and still leaves a way out; returns whether it did.
// The way-out check walks a 10 cm grid of the whole design, so it's the slow part of placing a piece.
// A design gets this many: plenty for any room that has a place for its furniture, and a room that has
// none (an odd candidate layout) gives up in a fraction of a second instead of searching every spot.
const PATH_CHECKS = 200;
export const pathChecks = { used: 0 };

function tryPlace(ctx: Ctx, f: Furniture, edge?: { e: Edge; t0: number; t1: number }) {
  if (!fits(ctx, f, edge)) return false;
  if (lookOf(f) !== "rug") {
    if (ctx.budget.paths <= 0) return false;
    ctx.budget.paths--;
    pathChecks.used++;
    if (!pathOut(ctx.design, [...ctx.placed, f]).ok) return false;
  }
  ctx.placed.push(f);
  return true;
}

type Spot = { f: Furniture; edge?: { e: Edge; t0: number; t1: number }; cost: number; turned?: boolean };

// Every spot along the room's edges where a piece of this size could back onto the edge, sliding in
// 10 cm steps; `side` turns it a quarter so its length runs along the edge (a bed in a narrow room).
function spotsOnEdges(ctx: Ctx, base: Omit<Furniture, "at" | "rotDeg">, opts: { soft?: boolean; side?: boolean } = {}): Spot[] {
  const out: Spot[] = [];
  ctx.edges.forEach((e, ei) => {
    if (!e.solid && !opts.soft) return;
    for (const turned of opts.side ? [false, true] : [false]) {
      const along = turned ? base.sizeM[1] : base.sizeM[0];
      const out_ = turned ? base.sizeM[0] : base.sizeM[1];
      if (along > e.len + 1e-6) continue;
      const steps = Math.max(0, Math.floor((e.len - along) / 0.1 + 1e-6));
      for (let s = 0; s <= steps; s++) {
        // Centred spots first, then outwards; the last step lands flush with the far end.
        const t0 = s === steps ? e.len - along : s * 0.1;
        const tc = t0 + along / 2;
        const at = addS(addS(e.a, e.dir, tc), e.n, out_ / 2 + 0.01);
        // Turned: the piece faces along the edge, towards the room's open end (the longer way).
        const rotDeg = turned ? rotFor(tc < e.len / 2 ? e.dir : [-e.dir[0], -e.dir[1]]) : rotFor(e.n);
        out.push({
          f: { ...base, at: [r3(at[0]), r3(at[1])], rotDeg },
          edge: { e, t0, t1: t0 + along },
          turned,
          cost: Math.abs(tc - e.len / 2) * 0.15 + (e.solid ? 0 : 1.5) + (turned ? 1.2 : 0) + ei * 1e-4 + s * 1e-6,
        });
      }
    }
  });
  return out;
}

const centroidOf = (poly: Pt[]): Pt => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];

function placeBest(ctx: Ctx, spots: Spot[]): Spot | null {
  for (const s of [...spots].sort((a, b) => a.cost - b.cost)) if (tryPlace(ctx, s.f, s.edge)) return s;
  return null;
}

// Free-standing spots on a 20 cm grid inside the room, for a dining table.
function spotsInside(ctx: Ctx, base: Omit<Furniture, "at" | "rotDeg">, cost: (p: Pt) => number): Spot[] {
  const xs = ctx.room.polygon.map((p) => p[0]), zs = ctx.room.polygon.map((p) => p[1]);
  const out: Spot[] = [];
  for (let x = Math.min(...xs) + 0.4; x <= Math.max(...xs) - 0.4; x += 0.2) {
    for (let z = Math.min(...zs) + 0.4; z <= Math.max(...zs) - 0.4; z += 0.2) {
      for (const rotDeg of [0, 90]) {
        const at: Pt = [r3(x), r3(z)];
        out.push({ f: { ...base, at, rotDeg }, cost: cost(at) + rotDeg * 1e-4 });
      }
    }
  }
  return out;
}

const piece = (ctx: Ctx, kind: FurnitureKind, n: number, sizeM: Pt, name: string = kind, colour?: string): Omit<Furniture, "at" | "rotDeg"> => ({
  id: `${ctx.room.id}-${name.replace(/_/g, "-")}-${n}`,
  kind,
  sizeM,
  roomId: ctx.room.id,
  ...(colour ? { colour } : {}),
});

// A piece placed relative to another: `along` across its width, `out` forward from its centre.
const beside = (f: Furniture, along: number, out: number): Pt => {
  const z = facing(f.rotDeg);
  const x: Pt = [z[1], -z[0]];
  return [r3(f.at[0] + x[0] * along + z[0] * out), r3(f.at[1] + x[1] * along + z[1] * out)];
};

function furnishBedroom(ctx: Ctx) {
  // The bed backs onto the window wall when it can (the original layout's choice), centred; a narrow
  // sleeping corner gets a smaller bed, or one turned with its side to the wall.
  let spot: Spot | null = null;
  for (const size of SPECS.bed.sizes) {
    const spots = spotsOnEdges(ctx, piece(ctx, "bed", 1, size), { side: true, soft: true }).map((s) => ({
      ...s,
      cost: s.cost - (s.edge?.e.windows.length ? 0.5 : 0),
    }));
    spot = placeBest(ctx, spots);
    if (spot) break;
  }
  if (!spot) return;
  const bed = spot.f;
  if (!spot.turned) {
    [-1, 1].forEach((side, i) => {
      const at = beside(bed, side * (bed.sizeM[0] / 2 + 0.33), -bed.sizeM[1] / 2 + 0.24);
      tryPlace(ctx, { ...piece(ctx, "other", i + 1, SPECS.nightstand.sizes[0], "nightstand"), at, rotDeg: bed.rotDeg });
    });
    const rug: Pt = [Math.min(2.3, bed.sizeM[0] + 0.6), 1.4];
    tryPlace(ctx, { ...piece(ctx, "rug", 1, rug), at: beside(bed, 0, bed.sizeM[1] / 2 - 0.25), rotDeg: bed.rotDeg });
  }
  // A dresser on another wall, in a room big enough to walk round it.
  const area = Math.abs(ctx.room.polygon.reduce((s, p, i) => s + cross(p, ctx.room.polygon[(i + 1) % ctx.room.polygon.length]), 0)) / 2;
  if (area >= 9) placeBest(ctx, spotsOnEdges(ctx, piece(ctx, "dresser", 1, SPECS.dresser.sizes[0])));
}

function furnishLiving(ctx: Ctx, withDining: boolean) {
  // The sofa backs onto the longest stretch of wall, facing the room; in an open plan, onto the edge
  // of the next space, like a divider.
  const c = centroidOf(ctx.room.polygon);
  let sofa: Furniture | null = null;
  let tvAt: Pt | null = null;
  for (const size of SPECS.sofa.sizes) {
    const spots = spotsOnEdges(ctx, piece(ctx, "sofa", 1, size), { soft: true }).map((s) => {
      // Room to sit and walk in front of it: the depth of the room facing out from this edge.
      const e = s.edge!.e;
      const depth = Math.max(...ctx.room.polygon.map((p) => dot(sub(p, e.a), e.n)));
      return { ...s, cost: s.cost - Math.min(depth, 4) * 0.4 - e.len * 0.05 };
    });
    sofa = placeBest(ctx, spots)?.f ?? null;
    if (sofa) break;
  }
  if (sofa) {
    const table: Furniture = { ...piece(ctx, "other", 1, SPECS.coffee_table.sizes[0], "coffee_table"), at: beside(sofa, 0, sofa.sizeM[1] / 2 + 0.42 + 0.3), rotDeg: sofa.rotDeg };
    if (tryPlace(ctx, table)) {
      tryPlace(ctx, { ...piece(ctx, "rug", 1, [2.6, 1.8]), at: beside(table, 0, -0.1), rotDeg: sofa.rotDeg });
      // Chairs either side of the table, turned to it.
      let n = 0;
      for (const side of [1, -1]) {
        const at = beside(table, side * 1.3, 0.25);
        const toTable = unit(sub(table.at, at));
        if (tryPlace(ctx, { ...piece(ctx, "armchair", ++n, SPECS.armchair.sizes[0]), at, rotDeg: rotFor(toTable) })) continue;
        n--;
      }
    } else {
      tryPlace(ctx, { ...piece(ctx, "rug", 1, [Math.min(2.4, sofa.sizeM[0] + 0.2), 1.4]), at: beside(sofa, 0, sofa.sizeM[1] / 2 + 0.4), rotDeg: sofa.rotDeg });
    }
    // The TV faces the sofa from across the room, on a wall 1.8 to 4.2 m away.
    const fz = facing(sofa.rotDeg);
    const tv = spotsOnEdges(ctx, piece(ctx, "tv", 1, SPECS.tv.sizes[0]))
      .filter((s) => {
        const d = dot(sub(s.f.at, sofa!.at), fz);
        return dot(s.edge!.e.n, fz) < -0.99 && d >= 1.8 && d <= 4.2;
      })
      .map((s) => ({ ...s, cost: Math.abs(dot(sub(s.f.at, sofa!.at), [fz[1], -fz[0]])) }));
    tvAt = placeBest(ctx, tv)?.f.at ?? null;
  }
  if (withDining) {
    // The table near the kitchen and away from the sofa, where it fits with its chairs.
    const kitchen = ctx.placed.find((f) => f.kind === "kitchen");
    for (const size of SPECS.dining.sizes) {
      const spots = spotsInside(ctx, piece(ctx, "dining", 1, size), (p) => {
        const k = kitchen ? Math.hypot(p[0] - kitchen.at[0], p[1] - kitchen.at[1]) : Math.hypot(p[0] - c[0], p[1] - c[1]);
        const s = sofa ? Math.hypot(p[0] - sofa.at[0], p[1] - sofa.at[1]) : 3;
        // Not between the sofa and the TV.
        const view = sofa && tvAt && distToSegment(p, sofa.at, tvAt) < 1.2 ? 3 : 0;
        return k * 0.3 - Math.min(s, 4) * 0.5 + view;
      });
      if (placeBest(ctx, spots)) break;
    }
  }
}

function furnishKitchen(ctx: Ctx) {
  // One run along the longest wall, fridge at its end, up to 3.6 m.
  const edges = [...ctx.edges].filter((e) => e.solid).sort((a, b) => b.len - a.len);
  for (const e of edges) {
    const len = Math.min(3.6, Math.floor(e.len * 10) / 10);
    if (len < 1.8) continue;
    const spot = spotsOnEdges({ ...ctx, edges: [e] }, piece(ctx, "kitchen", 1, [len, SPECS.kitchen.sizes[0][1]]));
    if (placeBest(ctx, spot)) return;
  }
}

function furnishBathroom(ctx: Ctx) {
  // The tub in a corner, the toilet away from it, the vanity between.
  const corner = (s: Spot) => (s.edge ? Math.min(s.edge.t0, s.edge.e.len - s.edge.t1) : 0);
  const tub = placeBest(ctx, spotsOnEdges(ctx, piece(ctx, "shower", 1, SPECS.shower.sizes[0])).map((s) => ({ ...s, cost: corner(s) + s.cost * 0.01 })))?.f;
  const far = (s: Spot) => (tub ? -Math.hypot(s.f.at[0] - tub.at[0], s.f.at[1] - tub.at[1]) : 0);
  placeBest(ctx, spotsOnEdges(ctx, piece(ctx, "toilet", 1, SPECS.toilet.sizes[0])).map((s) => ({ ...s, cost: far(s) + s.cost * 0.01 })));
  placeBest(ctx, spotsOnEdges(ctx, piece(ctx, "vanity", 1, SPECS.vanity.sizes[0])).map((s) => ({ ...s, cost: -far(s) * 0.2 + s.cost * 0.01 })));
}

// Furniture for every room of the design, in the basement frame. Kitchens go first (the dining table
// looks for them), then bathrooms, bedrooms and living spaces. Any furniture already there is replaced.
export function furnishDesign(design: Design): Design {
  const placed: Furniture[] = [];
  const base: Design = { ...design, proposed: { ...design.proposed, furniture: placed } };
  const doors = doorZones(base);
  const fixtures = design.proposed.fixtures
    .filter((f) => f.kind !== "beam" && f.kind !== "duct" && f.kind !== "bulkhead")
    .map((f) => corners({ at: f.at, rotDeg: 0, sizeM: f.sizeM ?? [0.6, 0.6] }));
  const order = ["kitchen", "bathroom", "laundry", "bedroom", "living", "other"] as const;
  const rooms = [...design.proposed.rooms].sort((a, b) => order.indexOf(a.kind as never) - order.indexOf(b.kind as never));
  const hasKitchen = rooms.some((r) => r.kind === "kitchen");
  const hasDining = rooms.some((r) => r.kind === "living" && /dining/i.test(r.name));
  const budget = { paths: PATH_CHECKS };
  for (const room of rooms) {
    const ctx: Ctx = { design: base, room, edges: edgesOf(room, design.proposed.walls, design.proposed.openings), placed, doors, fixtures, budget };
    if (room.kind === "kitchen") furnishKitchen(ctx);
    else if (room.kind === "bathroom") furnishBathroom(ctx);
    else if (room.kind === "laundry") placeBest(ctx, spotsOnEdges(ctx, piece(ctx, "washer_dryer", 1, SPECS.washer_dryer.sizes[0])));
    else if (room.kind === "bedroom") furnishBedroom(ctx);
    // A living space with a kitchen gets a dining table; so does one called "living and dining".
    else if (room.kind === "living") furnishLiving(ctx, hasKitchen || hasDining);
    else if (room.kind === "other" && /office|den|study/i.test(room.name)) placeBest(ctx, spotsOnEdges(ctx, piece(ctx, "desk", 1, SPECS.desk.sizes[0])));
  }
  return { ...design, proposed: { ...design.proposed, furniture: placed } };
}

// ---------- changing it ----------

// The furniture edits on a design (the studio's applyEdit hands these here).
export function editFurniture(design: Design, e: Edit): Design {
  const list = design.proposed.furniture;
  const set = (furniture: Furniture[]): Design => ({ ...design, proposed: { ...design.proposed, furniture } });
  if (e.op === "add_furniture") return set([...list.filter((f) => f.id !== e.furniture.id), e.furniture]);
  if (e.op === "remove_furniture") return set(list.filter((f) => f.id !== e.furnitureId));
  if (e.op === "set_furniture") {
    return set(
      list.map((f) =>
        f.id !== e.furnitureId
          ? f
          : {
              ...f,
              ...(e.kind ? { kind: e.kind } : {}),
              ...(e.at ? { at: e.at } : {}),
              ...(e.rotDeg != null ? { rotDeg: e.rotDeg } : {}),
              ...(e.sizeM ? { sizeM: e.sizeM } : {}),
              ...(e.colour != null ? { colour: e.colour } : {}),
            },
      ),
    );
  }
  return design;
}

function ctxFor(design: Design, roomId: string | undefined, except: string): Ctx | null {
  const room = design.proposed.rooms.find((r) => r.id === roomId) ?? null;
  if (!room) return null;
  return {
    design: { ...design, proposed: { ...design.proposed, furniture: design.proposed.furniture.filter((f) => f.id !== except) } },
    room,
    edges: edgesOf(room, design.proposed.walls, design.proposed.openings),
    placed: design.proposed.furniture.filter((f) => f.id !== except),
    doors: doorZones(design),
    fixtures: design.proposed.fixtures.filter((f) => f.kind !== "beam" && f.kind !== "duct" && f.kind !== "bulkhead").map((f) => corners({ at: f.at, rotDeg: 0, sizeM: f.sizeM ?? [0.6, 0.6] })),
    budget: { paths: PATH_CHECKS },
  };
}

// Swap a piece for another kind: same spot, back still on the same wall, sized for what it is now.
// If the new piece doesn't fit there it slides along its wall, then anywhere in the room; if it fits
// nowhere, the swap is refused (null) and the design stays as it was.
export function swapFurniture(design: Design, furnitureId: string, kind: FurnitureKind): Edit[] | null {
  const f = design.proposed.furniture.find((x) => x.id === furnitureId);
  if (!f) return null;
  const ctx = ctxFor(design, f.roomId, f.id);
  const look = lookOf({ kind, id: kind });
  for (const sizeM of SPECS[look].sizes) {
    const z = facing(f.rotDeg);
    const at: Pt = [r3(f.at[0] - (z[0] * (f.sizeM[1] - sizeM[1])) / 2), r3(f.at[1] - (z[1] * (f.sizeM[1] - sizeM[1])) / 2)];
    const next: Furniture = { ...f, kind, sizeM, at };
    if (!ctx || (fits(ctx, next) && pathOut(ctx.design, [...ctx.placed, next]).ok)) return [{ op: "set_furniture", furnitureId, kind, sizeM, at }];
  }
  if (!ctx) return null;
  for (const sizeM of SPECS[look].sizes) {
    const base = { ...f, kind, sizeM };
    const fz = facing(f.rotDeg);
    const spots = [
      ...spotsOnEdges(ctx, base, { soft: true }).map((s) => ({ ...s, cost: Math.hypot(s.f.at[0] - f.at[0], s.f.at[1] - f.at[1]) + (dot(facing(s.f.rotDeg), fz) > 0.99 ? 0 : 2) })),
    ];
    for (const s of spots.sort((a, b) => a.cost - b.cost)) {
      if (fits(ctx, s.f, s.edge) && pathOut(ctx.design, [...ctx.placed, s.f]).ok) return [{ op: "set_furniture", furnitureId, kind, sizeM, at: s.f.at, rotDeg: s.f.rotDeg }];
    }
  }
  return null;
}

// Slide a piece along its wall by `stepM` (negative: the other way), if it still fits there.
export function nudgeFurniture(design: Design, furnitureId: string, stepM: number): Edit[] | null {
  const f = design.proposed.furniture.find((x) => x.id === furnitureId);
  if (!f) return null;
  const ctx = ctxFor(design, f.roomId, f.id);
  const z = facing(f.rotDeg);
  const x: Pt = [z[1], -z[0]];
  for (const k of [1, 0.5]) {
    const at: Pt = [r3(f.at[0] + x[0] * stepM * k), r3(f.at[1] + x[1] * stepM * k)];
    const next = { ...f, at };
    if (!ctx || (fits(ctx, next) && pathOut(ctx.design, [...ctx.placed, next]).ok)) return [{ op: "set_furniture", furnitureId, at }];
  }
  return null;
}

// What every check on a design's furniture says, for tests and the studio's readiness list.
export function furnitureProblems(design: Design): string[] {
  const out: string[] = [];
  const list = design.proposed.furniture;
  const doors = doorZones(design);
  for (const f of list) {
    const room = design.proposed.rooms.find((r) => r.id === f.roomId);
    if (!room) out.push(`${f.id} isn't in a room`);
    else if (!insideRoom(corners(f), room.polygon)) out.push(`${f.id} sticks out of ${room.name}`);
    if (lookOf(f) === "rug") continue;
    if (doors.some((d) => overlaps(corners(f), d))) out.push(`${f.id} is in a door's swing`);
    for (const o of list) if (o.id < f.id && lookOf(o) !== "rug" && overlaps(corners(f), corners(o))) out.push(`${f.id} overlaps ${o.id}`);
  }
  const path = pathOut(design);
  if (!path.ok) out.push(path.why ?? "No way out");
  return out;
}

// A short, stable fingerprint of what a picture of the design depends on: walls, openings, rooms,
// furniture and finishes. Pictures are cached by it, so an unchanged design never pays twice.
export function designHash(design: Pick<Design, "proposed" | "finishes">): string {
  const { walls, openings, rooms, furniture } = design.proposed;
  // Only what a picture can show: where each wall stands, not whether the scan was sure of it or what
  // it's rated, so confirming the plan as it is keeps every picture made of it.
  const shown = walls.map((w) => [w.id, w.a, w.b, w.kind, w.thicknessM]);
  const text = JSON.stringify([shown, openings, rooms.map((r) => [r.id, r.kind, r.polygon]), furniture, design.finishes]);
  // cyrb53: 53 bits, the same in Node and the browser.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
