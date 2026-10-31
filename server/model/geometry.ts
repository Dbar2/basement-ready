// Plane geometry for the model: points, walls, openings and room outlines, in metres on the floor.
// Pure, so the browser's plan and 3D use the same maths as the server's checks.
import type { Opening, Pt, Room, Wall } from "./types";

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const unit = (a: Pt): Pt => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l] : [1, 0];
};
export const roundPt = (p: Pt): Pt => [r3(p[0]), r3(p[1])];

export const wallLength = (w: Pick<Wall, "a" | "b">) => dist(w.a, w.b);
export const wallDir = (w: Pick<Wall, "a" | "b">) => unit(sub(w.b, w.a));
// The left-hand normal, looking from `a` to `b`.
export const wallNormal = (w: Pick<Wall, "a" | "b">): Pt => {
  const d = wallDir(w);
  return [-d[1], d[0]];
};
export const along = (w: Pick<Wall, "a" | "b">, t: number): Pt => add(w.a, mul(wallDir(w), t));
export const midpoint = (w: Pick<Wall, "a" | "b">): Pt => mul(add(w.a, w.b), 0.5);
export const isAxisAligned = (w: Pick<Wall, "a" | "b">) => Math.abs(w.a[0] - w.b[0]) < 1e-3 || Math.abs(w.a[1] - w.b[1]) < 1e-3;

// Where on the wall (metres from `a`) a point projects, and how far off the wall's line it is.
export function project(w: Pick<Wall, "a" | "b">, p: Pt) {
  const d = wallDir(w);
  const v = sub(p, w.a);
  return { t: dot(v, d), off: cross(d, v) };
}

export function distToSegment(p: Pt, a: Pt, b: Pt) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return dist(p, add(a, mul(ab, t)));
}

// The two ends of an opening in its wall.
export function openingEnds(w: Pick<Wall, "a" | "b">, o: Pick<Opening, "offsetM" | "widthM">): [Pt, Pt] {
  return [along(w, o.offsetM - o.widthM / 2), along(w, o.offsetM + o.widthM / 2)];
}

export function polygonArea(poly: Pt[]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return Math.abs(s) / 2;
}

export function centroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const c = cross(p, q);
    a += c;
    cx += (p[0] + q[0]) * c;
    cz += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) return mul(poly.reduce((s, p) => add(s, p), [0, 0] as Pt), 1 / Math.max(1, poly.length));
  return [cx / (3 * a), cz / (3 * a)];
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
export const rectPoly = (x0: number, z0: number, x1: number, z1: number): Pt[] => [
  [r3(Math.min(x0, x1)), r3(Math.min(z0, z1))],
  [r3(Math.max(x0, x1)), r3(Math.min(z0, z1))],
  [r3(Math.max(x0, x1)), r3(Math.max(z0, z1))],
  [r3(Math.min(x0, x1)), r3(Math.max(z0, z1))],
];

export const roomArea = (r: Pick<Room, "polygon">) => polygonArea(r.polygon);

// A room's own floor: its outline less what a stair or a furnace room drawn inside it takes (a design's
// living room is drawn around the stairs). Every page, sheet and sum of rooms reads this, so a room has
// one area everywhere.
export function floorArea(room: Pick<Room, "polygon" | "kind">, rooms: readonly Pick<Room, "polygon" | "kind">[]) {
  const own = polygonArea(room.polygon);
  if (room.kind === "stairs" || room.kind === "mechanical") return own;
  const inner = rooms.filter((r) => r !== room && (r.kind === "stairs" || r.kind === "mechanical")).reduce((s, r) => s + overlapArea(room.polygon, r.polygon), 0);
  return Math.max(0, own - inner);
}

// A box with its sides along the axes, as most rooms are.
const isBox = (poly: Pt[]) => poly.length === 4 && poly.every((p, i) => Math.abs(p[0] - poly[(i + 1) % 4][0]) < 1e-6 || Math.abs(p[1] - poly[(i + 1) % 4][1]) < 1e-6);

// How much floor two outlines share: exact for two boxes; otherwise counted in 10 cm cells of the box
// they share (an L-shaped furnace room's box can reach over a room it doesn't touch).
export function overlapArea(a: Pt[], b: Pt[]) {
  const A = bounds(a), B = bounds(b);
  const x0 = Math.max(A.minX, B.minX), x1 = Math.min(A.maxX, B.maxX), z0 = Math.max(A.minZ, B.minZ), z1 = Math.min(A.maxZ, B.maxZ);
  if (x1 <= x0 || z1 <= z0) return 0;
  if (isBox(a) && isBox(b)) return (x1 - x0) * (z1 - z0);
  const step = 0.1;
  let n = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) if (inPolygon([x, z], a) && inPolygon([x, z], b)) n++;
  return n * step * step;
}

// The edges of a polygon as (a, b) pairs.
export const edges = (poly: Pt[]): [Pt, Pt][] => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);

// Does the segment p→q cross the wall a→b (both proper crossings and touching)?
export function segmentsCross(p: Pt, q: Pt, a: Pt, b: Pt) {
  const d1 = cross(sub(q, p), sub(a, p)), d2 = cross(sub(q, p), sub(b, p));
  const d3 = cross(sub(b, a), sub(p, a)), d4 = cross(sub(b, a), sub(q, a));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// The wall's solid pieces: the wall with its door and window openings cut out (windows are solid
// to walk into; only doors let you through).
export function solidPieces(w: Wall, openings: Opening[], doorsOnly = true): [Pt, Pt][] {
  const L = wallLength(w);
  const cuts = openings
    .filter((o) => o.wallId === w.id && (!doorsOnly || o.kind === "door"))
    .map((o) => [clamp(o.offsetM - o.widthM / 2, 0, L), clamp(o.offsetM + o.widthM / 2, 0, L)] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const out: [Pt, Pt][] = [];
  let at = 0;
  for (const [s, e] of cuts) {
    if (s - at > 0.01) out.push([along(w, at), along(w, s)]);
    at = Math.max(at, e);
  }
  if (L - at > 0.01) out.push([along(w, at), along(w, L)]);
  return out;
}

// An outline with its sides along the axes, cut into the cells its own corners and the boxes' sides make:
// which cells are floor. Shared by largestBox and minusBoxes.
const SNAP_M = 0.02; // edges this close are one edge (a layout's centimetres against an outline's millimetres)
function cells(poly: Pt[], cutBoxes: Box[] = []) {
  const B = bounds(poly);
  // The outline's own coordinates, then each cut's, each kept only where it isn't one already there.
  const grid = (own: number[], theirs: number[], lo: number, hi: number) => {
    const out = [...new Set(own.map(r3))].sort((a, b) => a - b);
    for (const v of theirs.map(r3).sort((a, b) => a - b)) if (v > lo + SNAP_M && v < hi - SNAP_M && out.every((u) => Math.abs(u - v) > SNAP_M)) out.push(v);
    return out.sort((a, b) => a - b);
  };
  const xs = grid(poly.map((p) => p[0]), cutBoxes.flatMap((c) => [c.minX, c.maxX]), B.minX, B.maxX);
  const zs = grid(poly.map((p) => p[1]), cutBoxes.flatMap((c) => [c.minZ, c.maxZ]), B.minZ, B.maxZ);
  const snap = (v: number, at: number[]) => at.reduce((best, u) => (Math.abs(u - v) < Math.abs(best - v) ? u : best), v);
  const cuts = cutBoxes.map((c) => ({ minX: snap(c.minX, xs), maxX: snap(c.maxX, xs), minZ: snap(c.minZ, zs), maxZ: snap(c.maxZ, zs) }));
  const keep = xs.slice(1).map((x1, i) =>
    zs.slice(1).map((z1, j) => {
      const c: Pt = [(xs[i] + x1) / 2, (zs[j] + z1) / 2];
      return inPolygon(c, poly) && !cuts.some((k) => c[0] > k.minX && c[0] < k.maxX && c[1] > k.minZ && c[1] < k.maxZ);
    }),
  );
  return { xs, zs, keep };
}

// The biggest box inside an outline whose sides run along the axes: an L-shaped room's main part, where
// a layout can stand rooms against real walls. A box's own outline gives itself back.
export function largestBox(poly: Pt[]): Box {
  if (poly.length === 4) return bounds(poly);
  const { xs, zs, keep } = cells(poly);
  let best: Box = bounds(poly), most = -1;
  for (let i0 = 0; i0 < keep.length; i0++)
    for (let j0 = 0; j0 < (keep[0]?.length ?? 0); j0++)
      for (let i1 = i0; i1 < keep.length; i1++)
        for (let j1 = j0; j1 < keep[0].length; j1++) {
          let all = true;
          for (let i = i0; i <= i1 && all; i++) for (let j = j0; j <= j1 && all; j++) all = keep[i][j];
          if (!all) break;
          const a = (xs[i1 + 1] - xs[i0]) * (zs[j1 + 1] - zs[j0]);
          if (a > most) [most, best] = [a, { minX: xs[i0], maxX: xs[i1 + 1], minZ: zs[j0], maxZ: zs[j1 + 1] }];
        }
  return best;
}

// An outline less the boxes cut from it: what's left, traced round the same way as rectPoly. Where the
// cuts split it, the biggest piece; a box inside it that touches none of its sides leaves it as it was
// round the outside. Outlines with their sides along the axes only.
export function minusBoxes(poly: Pt[], cuts: Box[]): Pt[] {
  const { xs, zs, keep } = cells(poly, cuts);
  const nx = keep.length, nz = keep[0]?.length ?? 0;
  // The biggest piece of floor left, cell by cell.
  const piece = new Set<number>();
  let most = 0;
  const seen = new Set<number>();
  for (let s = 0; s < nx * nz; s++) {
    if (seen.has(s) || !keep[Math.floor(s / nz)][s % nz]) continue;
    const got: number[] = [];
    const todo = [s];
    seen.add(s);
    while (todo.length) {
      const c = todo.pop()!;
      got.push(c);
      const i = Math.floor(c / nz), j = c % nz;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj, n = a * nz + b;
        if (a >= 0 && a < nx && b >= 0 && b < nz && keep[a][b] && !seen.has(n)) (seen.add(n), todo.push(n));
      }
    }
    const area = got.reduce((t, c) => t + (xs[Math.floor(c / nz) + 1] - xs[Math.floor(c / nz)]) * (zs[(c % nz) + 1] - zs[c % nz]), 0);
    if (area > most) {
      most = area;
      piece.clear();
      for (const c of got) piece.add(c);
    }
  }
  if (!piece.size) return poly;
  const inPiece = (i: number, j: number) => i >= 0 && i < nx && j >= 0 && j < nz && piece.has(i * nz + j);
  // Its edges with floor on their left (the way rectPoly runs), joined end to end.
  const next = new Map<string, Pt>();
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  for (const c of piece) {
    const i = Math.floor(c / nz), j = c % nz;
    const [x0, x1, z0, z1] = [xs[i], xs[i + 1], zs[j], zs[j + 1]];
    if (!inPiece(i, j - 1)) next.set(key([x0, z0]), [x1, z0]);
    if (!inPiece(i + 1, j)) next.set(key([x1, z0]), [x1, z1]);
    if (!inPiece(i, j + 1)) next.set(key([x1, z1]), [x0, z1]);
    if (!inPiece(i - 1, j)) next.set(key([x0, z1]), [x0, z0]);
  }
  // The outside loop: from the lowest, leftmost corner.
  const start = [...next.keys()].map((k) => k.split(",").map(Number) as Pt).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  const loop: Pt[] = [start];
  for (let p = next.get(key(start)); p && key(p) !== key(start) && loop.length <= next.size; p = next.get(key(p))) loop.push(p);
  // Corners only: drop the points along a straight run.
  const out = loop.filter((p, i) => {
    const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
    return Math.abs(cross(sub(p, a), sub(b, p))) > 1e-9;
  });
  return out.map(roundPt);
}
