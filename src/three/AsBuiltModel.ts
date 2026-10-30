// The basement as built, drawn from the plan instead of the noisy scan: every wall a slab of its real
// thickness, each room's own floor and ceiling, door and window openings cut through, the stairs as a
// flight, beams, ducts and bulkheads as boxes at their heights, the furnace and water heater as simple
// volumes. It all stands on the plan's floor by construction.
//
// Pure (no three.js): the server sends these surfaces to be painted with the real video
// (services/scan3d/scan3d/texture.py) and the browser draws the same ones (src/three/AsBuilt.tsx),
// matched by id and key.
import { along, bounds, distToSegment, inPolygon, wallDir, wallLength, wallNormal, type Box } from "../../server/model/geometry";
import type { Design, Existing, Fixture, Opening, Pt, Room, Wall } from "../../server/model/types";

export type V3 = [number, number, number];

// A flat piece of the shell that gets a photo: a rectangle in the basement frame. `origin` is its (0, 0)
// corner, `u` runs along its width and `v` up its height (unit vectors), `n` = u × v faces the room.
// Texture coordinates are (s, t) in metres along u and v. Stairs unfold: `v` is the horizontal run
// towards the top, and t climbs riser, tread, riser, tread from the foot.
export type Surface = {
  id: string;
  kind: "wall" | "floor" | "ceiling" | "pane" | "stairs" | "side";
  origin: V3;
  u: V3;
  v: V3;
  n: V3;
  size: [number, number];
  outline?: Pt[]; // the part that's drawn, in (s, t); the whole rectangle when absent
  holes?: Pt[][]; // openings cut through, in (s, t)
  steps?: { count: number; rise: number; tread: number };
  roomId?: string;
  // Changes only when the surface needs painting again: openings moving don't change it.
  key: string;
};

// A plain box (or upright cylinder) in one colour: wall cores (their reveals, tops and outer faces),
// the design's new walls, fixtures, the stairwell. `cap`: its top in another colour.
export type Block = {
  kind: "core" | "new" | "fixture" | "stairs" | "well";
  id: string;
  center: V3;
  size: V3; // along its own x (turned by rotY about +Y), y, z
  rotY: number;
  colour: string;
  cap?: string;
  shape?: "box" | "cylinder";
  guess?: boolean; // placed where it probably is, not where the scan saw it
};

export type AsBuilt = { surfaces: Surface[]; blocks: Block[]; floorY: number; box: Box; ceilingM: number };

export const DOOR_H = 2.03;
const WINDOW_H = 0.45; // a basement hopper, when the scan didn't measure it
const WINDOW_TOP_GAP = 0.15; // basement windows sit just under the joists
const RISE = 0.19;
const WELL_M = 0.7; // how far the stairwell is drawn above the ceiling
const SIDE_PROBE = 0.12; // past the slab, to find the room on each side

export const COLOURS = {
  core: "#C9C7C0", // the wall's own edges: jambs, sills, its far side
  cap: "#3A433E", // walls cut at the top, like a section
  outside: "#9EA39D",
  newWall: "#F1EFE9", // the design's new walls, painted warm white
  beam: "#6E6A64",
  duct: "#B8BDC0",
  bulkhead: "#E6E4DE",
  post: "#55595C",
  furnace: "#D9D8D2",
  heater: "#E8E6E0",
  panel: "#BFC2C0",
  drain: "#3E4447",
  stairs: "#9B8B76",
  well: "#EDEBE4",
};

const r4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0; // + 0: no −0 in the keys
const v3 = (x: number, y: number, z: number): V3 => [r4(x), r4(y), r4(z)];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// FNV-1a over the rounded geometry: short, stable, the same in Node and the browser.
export function keyOf(parts: unknown): string {
  const s = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function surface(s: Omit<Surface, "key">): Surface {
  const mm = (p: number[]) => p.map((x) => Math.round(x * 1000));
  return { ...s, key: keyOf([s.kind, mm(s.origin), mm(s.u), mm(s.v), mm(s.size), s.outline?.map(mm) ?? null, s.steps ? mm([s.steps.count, s.steps.rise, s.steps.tread]) : null]) };
}

const ceilingOf = (existing: Existing, r: Room | undefined) => r?.ceilingM ?? existing.ceilingM ?? 2.4;

// The rooms a wall faces on its left (+1, along wallNormal) and right (−1) side.
function sideRooms(w: Pick<Wall, "a" | "b" | "thicknessM">, rooms: Room[]) {
  const L = wallLength(w);
  const n = wallNormal(w);
  const count = Math.max(2, Math.ceil(L / 0.5));
  const found = (sign: 1 | -1) => {
    const out = new Set<Room>();
    for (let i = 0; i < count; i++) {
      const p = along(w, (L * (i + 0.5)) / count);
      const d = sign * (w.thicknessM / 2 + SIDE_PROBE);
      const q: Pt = [p[0] + n[0] * d, p[1] + n[1] * d];
      for (const r of rooms) if (inPolygon(q, r.polygon)) out.add(r);
    }
    return [...out];
  };
  return { left: found(1), right: found(-1) };
}

// Where an opening sits up the wall: doors from the floor, windows just under the ceiling unless the
// tape gave their sill.
export function openingSpan(o: Pick<Opening, "kind" | "heightM" | "sillM">, faceH: number): [number, number] {
  if (o.kind === "door") return [0, Math.min(o.heightM ?? DOOR_H, faceH - 0.05)];
  const h = Math.min(o.heightM ?? WINDOW_H, faceH * 0.8);
  const sill = o.sillM ?? Math.max(0.3, faceH - WINDOW_TOP_GAP - h);
  return [sill, Math.min(sill + h, faceH - 0.02)];
}

type Cut = { a0: number; a1: number; y0: number; y1: number; o: Opening };

// One wall: its faces (painted), its core (plain: the jambs, sills, lintels and the top), and the
// window or door seen in an opening that leads outside the plan.
function buildWall(w: Wall, openings: Opening[], rooms: Room[], existing: Existing, floorY: number, out: AsBuilt, isNew: boolean) {
  const L = wallLength(w);
  if (L < 0.02) return;
  const d = wallDir(w);
  const n2 = wallNormal(w);
  const t = Math.max(0.05, w.thicknessM);
  const { left, right } = sideRooms(w, rooms);
  const heightOf = (rs: Room[]) => (rs.length ? Math.max(...rs.map((r) => ceilingOf(existing, r))) : null);
  const hL = heightOf(left), hR = heightOf(right);
  const top = Math.max(hL ?? 0, hR ?? 0) || (existing.ceilingM ?? 2.4);
  // A wall with a room on one side only stands outside its room: the plan's line is the face the
  // camera saw. Between two rooms it's centred.
  const shift = left.length && !right.length ? -t / 2 : right.length && !left.length ? t / 2 : 0;
  const inner = Math.min(hL ?? top, hR ?? top);
  const cuts: Cut[] = openings
    .filter((o) => o.wallId === w.id)
    .map((o) => {
      const [y0, y1] = openingSpan(o, inner);
      return { a0: Math.max(0, o.offsetM - o.widthM / 2), a1: Math.min(L, o.offsetM + o.widthM / 2), y0, y1, o };
    })
    .filter((c) => c.a1 - c.a0 > 0.05 && c.y1 - c.y0 > 0.05)
    .sort((x, y) => x.a0 - y.a0);

  // The core: full-height pieces between openings, a sill under each window, a lintel over each.
  const ang = Math.atan2(d[1], d[0]);
  const mid = (a: number): Pt => [w.a[0] + d[0] * a + n2[0] * shift, w.a[1] + d[1] * a + n2[1] * shift];
  // Outside walls run on past their ends by their thickness, so outside corners close.
  const outer = !left.length || !right.length;
  const ext = outer ? t : 0;
  const piece = (a0: number, a1: number, y0: number, y1: number, i: string) => {
    if (a1 - a0 < 0.005 || y1 - y0 < 0.005) return;
    const c = mid((a0 + a1) / 2);
    out.blocks.push({ kind: isNew ? "new" : "core", id: `${w.id}:${i}`, center: v3(c[0], floorY + (y0 + y1) / 2, c[1]), size: v3(a1 - a0, y1 - y0, t), rotY: r4(-ang), colour: isNew ? COLOURS.newWall : outer ? COLOURS.outside : COLOURS.core, cap: COLOURS.cap });
  };
  let at = -ext;
  cuts.forEach((c, i) => {
    piece(at, c.a0, 0, top, `p${i}`);
    piece(c.a0, c.a1, 0, c.y0, `s${i}`);
    piece(c.a0, c.a1, c.y1, top, `l${i}`);
    at = Math.max(at, c.a1);
  });
  piece(at, L + ext, 0, top, "end");
  if (isNew) return;

  // The painted faces: one per side that faces a room, at the slab's face, as high as that room.
  for (const [side, sign, h, rs] of [["L", 1, hL, left], ["R", -1, hR, right]] as const) {
    if (h == null) continue;
    const off = shift + sign * (t / 2);
    const n = v3(n2[0] * sign, 0, n2[1] * sign);
    const u = v3(n[2], 0, -n[0]);
    // u runs a→b on the left face and b→a on the right.
    const start = sign === 1 ? w.a : w.b;
    const origin = v3(start[0] + n2[0] * off, floorY, start[1] + n2[1] * off);
    const holes = cuts.map((c): Pt[] => {
      const [s0, s1] = sign === 1 ? [c.a0, c.a1] : [L - c.a1, L - c.a0];
      return [[s0, c.y0], [s1, c.y0], [s1, c.y1], [s0, c.y1]];
    });
    out.surfaces.push(surface({ id: `wall:${w.id}:${side}`, kind: "wall", origin, u, v: [0, 1, 0], n, size: [r4(L), r4(h)], holes, roomId: rs[0]?.id }));
  }

  // An opening onto somewhere the plan doesn't reach shows what the camera saw there: the window's
  // glass at the outside of the wall, or the door itself in the middle of it.
  if ((left.length > 0) === (right.length > 0)) return;
  const sign = left.length ? 1 : -1;
  for (const c of cuts) {
    const off = c.o.kind === "window" ? shift - sign * (t / 2 - 0.02) : shift;
    const n = v3(n2[0] * sign, 0, n2[1] * sign);
    const u = v3(n[2], 0, -n[0]);
    const s0 = sign === 1 ? c.a0 : c.a1;
    const p = along(w, s0);
    const origin = v3(p[0] + n2[0] * off, floorY + c.y0, p[1] + n2[1] * off);
    out.surfaces.push(surface({ id: `pane:${c.o.id}`, kind: "pane", origin, u, v: [0, 1, 0], n, size: [r4(c.a1 - c.a0), r4(c.y1 - c.y0)], roomId: (left[0] ?? right[0])?.id }));
  }
}

const near = (p: Pt, ws: Wall[], m: number) => ws.some((w) => distToSegment(p, w.a, w.b) < m + w.thicknessM / 2);

// The stairs: a flight from the floor to the ceiling over the fixture's footprint, along its long side.
// The top is the end nearer `topHint` (where they started filming, when that was on the stairs) or,
// without one, the end nearer the edge of the basement.
function buildStairs(f: Fixture, existing: Existing, walls: Wall[], floorY: number, out: AsBuilt, topHint?: Pt) {
  const [sx, sz] = f.sizeM ?? [0.9, 2.6];
  const alongX = sx >= sz;
  const runLen = alongX ? sx : sz, width = alongX ? sz : sx;
  if (runLen < 0.5 || width < 0.3) return;
  const room = existing.rooms.find((r) => inPolygon(f.at, r.polygon));
  const H = ceilingOf(existing, room);
  const ends: [Pt, Pt] = alongX ? [[f.at[0] - sx / 2, f.at[1]], [f.at[0] + sx / 2, f.at[1]]] : [[f.at[0], f.at[1] - sz / 2], [f.at[0], f.at[1] + sz / 2]];
  const dist2 = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let topEnd: 0 | 1;
  if (topHint && Math.min(dist2(ends[0], topHint), dist2(ends[1], topHint)) < 3) topEnd = dist2(ends[0], topHint) <= dist2(ends[1], topHint) ? 0 : 1;
  else {
    const b = out.box;
    const edge = (p: Pt) => (alongX ? Math.min(p[0] - b.minX, b.maxX - p[0]) : Math.min(p[1] - b.minZ, b.maxZ - p[1]));
    topEnd = edge(ends[0]) <= edge(ends[1]) ? 0 : 1;
  }
  const foot = ends[1 - topEnd], head = ends[topEnd];
  const run = v3((head[0] - foot[0]) / runLen, 0, (head[1] - foot[1]) / runLen);
  const u = v3(...cross3(run, [0, 1, 0]));
  const count = Math.max(4, Math.round(H / RISE));
  const rise = H / count, tread = runLen / count;
  // The foot's corner on the −u side.
  const o: Pt = [foot[0] - (u[0] * width) / 2, foot[1] - (u[2] * width) / 2];
  out.surfaces.push(surface({ id: `stairs:${f.id}`, kind: "stairs", origin: v3(o[0], floorY, o[1]), u: v3(...u), v: v3(...run), n: [0, 1, 0], size: [r4(width), r4(count * (rise + tread))], steps: { count, rise: r4(rise), tread: r4(tread) } }));
  // Its two sides, under the steps' sawtooth, unless a wall hides them.
  const profile: Pt[] = [[0, 0]];
  for (let i = 0; i < count; i++) profile.push([r4(i * tread), r4((i + 1) * rise)], [r4((i + 1) * tread), r4((i + 1) * rise)]);
  profile.push([r4(runLen), 0]);
  for (const [side, sign] of [["L", -1], ["R", 1]] as const) {
    const along0: Pt = [foot[0] + (u[0] * sign * width) / 2, foot[1] + (u[2] * sign * width) / 2];
    const mid: Pt = [along0[0] + (run[0] * runLen) / 2, along0[1] + (run[2] * runLen) / 2];
    if (near(mid, walls, 0.15)) continue;
    const n = v3(u[0] * sign, 0, u[2] * sign);
    // s runs along the run on the right side (n = u) and back from the head on the left.
    const su: V3 = cross3([0, 1, 0], n);
    const sStart = sign === 1 ? along0 : [along0[0] + run[0] * runLen, along0[1] + run[2] * runLen];
    const outline = sign === 1 ? profile : profile.map(([s, t]): Pt => [r4(runLen - s), t]);
    out.surfaces.push(surface({ id: `side:${f.id}:${side}`, kind: "side", origin: v3(sStart[0], floorY, sStart[1]), u: v3(...su), v: [0, 1, 0], n, size: [r4(runLen), r4(H)], outline }));
  }
  // The back of the flight, under its top step.
  const ang = Math.atan2(u[2], u[0]);
  out.blocks.push({ kind: "stairs", id: `${f.id}:back`, center: v3(head[0] - run[0] * 0.01, floorY + H / 2, head[1] - run[2] * 0.01), size: v3(width, H, 0.02), rotY: r4(-ang), colour: COLOURS.stairs });
  // The stairwell: the ceiling is open over the flight, walled up past it to the floor above.
  const c: Pt = [(foot[0] + head[0]) / 2, (foot[1] + head[1]) / 2];
  const wx = alongX ? runLen : width, wz = alongX ? width : runLen;
  const y = floorY + H + WELL_M / 2;
  const ring: [number, number, number, number][] = [
    [c[0], c[1] - wz / 2 - 0.05, wx + 0.2, 0.1],
    [c[0], c[1] + wz / 2 + 0.05, wx + 0.2, 0.1],
    [c[0] - wx / 2 - 0.05, c[1], 0.1, wz],
    [c[0] + wx / 2 + 0.05, c[1], 0.1, wz],
  ];
  ring.forEach(([x, z, a, b], i) => out.blocks.push({ kind: "well", id: `${f.id}:well${i}`, center: v3(x, y, z), size: v3(a, WELL_M, b), rotY: 0, colour: COLOURS.well }));
  out.blocks.push({ kind: "well", id: `${f.id}:lid`, center: v3(c[0], floorY + H + WELL_M + 0.02, c[1]), size: v3(wx + 0.2, 0.04, wz + 0.2), rotY: 0, colour: COLOURS.well });
}

// Overhead runs, posts and the mechanical: plain volumes at their heights.
function buildFixture(f: Fixture, existing: Existing, floorY: number, out: AsBuilt) {
  const room = existing.rooms.find((r) => inPolygon(f.at, r.polygon));
  const H = ceilingOf(existing, room);
  const [sx, sz] = f.sizeM ?? [0.5, 0.5];
  const box = (y0: number, y1: number, size: Pt, colour: string, shape: Block["shape"] = "box") => {
    if (y1 - y0 < 0.005) return;
    out.blocks.push({ kind: "fixture", id: f.id, center: v3(f.at[0], floorY + (y0 + y1) / 2, f.at[1]), size: v3(size[0], y1 - y0, size[1]), rotY: 0, colour, shape, ...(f.guess ? { guess: true } : {}) });
  };
  switch (f.kind) {
    case "beam":
    case "duct":
    case "bulkhead": {
      const under = Math.min(H - 0.02, f.heightM ?? H - 0.2);
      box(under, H, [sx, sz], f.kind === "beam" ? COLOURS.beam : f.kind === "duct" ? COLOURS.duct : COLOURS.bulkhead);
      return;
    }
    case "post":
      box(0, f.heightM ?? H, [Math.min(sx, 0.12), Math.min(sz, 0.12)], COLOURS.post);
      return;
    case "furnace":
      box(0, 1.5, [sx, sz], COLOURS.furnace);
      return;
    case "water_heater": {
      const d = Math.min(0.6, Math.max(0.4, Math.min(sx, sz)));
      box(0, 1.5, [d, d], COLOURS.heater, "cylinder");
      return;
    }
    case "panel":
      box(1.1, 1.9, [sx, sz], COLOURS.panel);
      return;
    case "plumbing":
      box(0, 0.012, [0.24, 0.24], COLOURS.drain, "cylinder");
      return;
  }
}

// `design`: draw it on top: walls it removes go, its new walls stand in a clean finish (unless
// `newWalls` is false: the caller draws them), its new openings are cut. `floorY`: the plan's floor
// height in the basement frame. `stairTop`: a point near the stairs' top (the first camera of the take).
export function buildAsBuilt(existing: Existing, opts: { design?: Design | null; newWalls?: boolean; floorY?: number; stairTop?: Pt | null } = {}): AsBuilt {
  const floorY = opts.floorY ?? 0;
  const design = opts.design ?? null;
  const rooms = existing.rooms.filter((r) => r.polygon.length >= 3);
  const all = rooms.flatMap((r) => r.polygon).concat(existing.walls.flatMap((w) => [w.a, w.b]));
  const box = all.length ? bounds(all) : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  const ceilingM = Math.max(existing.ceilingM ?? 0, ...rooms.map((r) => r.ceilingM ?? 0)) || 2.4;
  const out: AsBuilt = { surfaces: [], blocks: [], floorY, box, ceilingM };
  const kept = design ? existing.walls.filter((w) => design.proposed.walls.some((x) => x.id === w.id)) : existing.walls;
  const openings = design ? design.proposed.openings : existing.openings;
  for (const w of kept) buildWall(w, openings, rooms, existing, floorY, out, false);
  if (design && opts.newWalls !== false) for (const w of design.proposed.walls.filter((x) => x.kind === "new")) buildWall(w, openings, rooms, existing, floorY, out, true);

  const stairs = existing.fixtures.filter((f) => f.kind === "stairs");
  for (const f of stairs) buildStairs(f, existing, existing.walls, floorY, out, opts.stairTop ?? undefined);
  for (const f of existing.fixtures.filter((x) => x.kind !== "stairs")) buildFixture(f, existing, floorY, out);

  // Each room's floor and ceiling, open over the stairs.
  for (const r of rooms) {
    const b = bounds(r.polygon);
    const H = ceilingOf(existing, r);
    out.surfaces.push(surface({ id: `floor:${r.id}`, kind: "floor", origin: v3(b.minX, floorY, b.maxZ), u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0], size: [r4(b.maxX - b.minX), r4(b.maxZ - b.minZ)], outline: r.polygon.map(([x, z]): Pt => [r4(x - b.minX), r4(b.maxZ - z)]), roomId: r.id }));
    const wells = stairs
      .filter((f) => inPolygon(f.at, r.polygon) && f.sizeM)
      .map((f): Pt[] => {
        const [x0, x1, z0, z1] = [f.at[0] - f.sizeM![0] / 2 - b.minX, f.at[0] + f.sizeM![0] / 2 - b.minX, f.at[1] - f.sizeM![1] / 2 - b.minZ, f.at[1] + f.sizeM![1] / 2 - b.minZ];
        return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      });
    out.surfaces.push(surface({ id: `ceiling:${r.id}`, kind: "ceiling", origin: v3(b.minX, floorY + H, b.minZ), u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0], size: [r4(b.maxX - b.minX), r4(b.maxZ - b.minZ)], outline: r.polygon.map(([x, z]): Pt => [r4(x - b.minX), r4(z - b.minZ)]), holes: wells, roomId: r.id }));
  }
  return out;
}

// A point on a surface, from its texture coordinates (s, t) in metres.
export function pointAt(sf: Surface, s: number, t: number): V3 {
  if (sf.kind === "stairs" && sf.steps) {
    const { rise, tread } = sf.steps;
    const k = Math.min(sf.steps.count - 1, Math.floor(t / (rise + tread)));
    const r = t - k * (rise + tread);
    const run = r < rise ? k * tread : k * tread + (r - rise);
    const up = r < rise ? k * rise + r : (k + 1) * rise;
    return [sf.origin[0] + sf.u[0] * s + sf.v[0] * run, sf.origin[1] + up, sf.origin[2] + sf.u[2] * s + sf.v[2] * run];
  }
  return [0, 1, 2].map((i) => sf.origin[i] + sf.u[i] * s + sf.v[i] * t) as V3;
}

// What the painter needs: the surfaces, and the solid volumes that can hide them from a camera. A
// fixture placed by guess hides nothing: where it really is, the scan's depth says so.
export function paintJob(ab: AsBuilt) {
  return {
    surfaces: ab.surfaces,
    occluders: ab.blocks.filter((b) => (b.kind === "fixture" || b.kind === "stairs") && !b.guess).map((b) => ({ center: b.center, size: b.size, rotY: b.rotY })),
  };
}

// Every surface's key in one: the paint is stale when this changes.
export const asBuiltKey = (ab: AsBuilt) => keyOf(ab.surfaces.map((s) => s.key).sort());
