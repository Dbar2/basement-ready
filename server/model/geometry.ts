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
  const a = bounds(room.polygon);
  const inner = rooms
    .filter((r) => r !== room && (r.kind === "stairs" || r.kind === "mechanical"))
    .reduce((s, r) => {
      const b = bounds(r.polygon);
      const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), d = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      return s + (w > 0 && d > 0 ? w * d : 0);
    }, 0);
  return Math.max(0, own - inner);
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
