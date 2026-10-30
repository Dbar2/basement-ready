// Where a walk through the basement starts: the spot where they filmed that looks furthest into the
// room, so it never opens facing a wall. Pure: the studio (src/studio/Studio3D.tsx) and the scan's
// walk-through (src/three/RealScan.tsx) both use it.
import { distToSegment, inPolygon } from "../../server/model/geometry";
import type { Pt } from "../../server/model/types";

// Where the camera stood and the way it looked, on the floor (plan metres; `dir` a unit vector).
export type Spot = { at: Pt; dir: Pt };

const FAR_M = 10; // a view this deep is as good as any
const CLEAR_M = 0.35; // never start pressed against a wall
// Turned this far off where they looked, a view counts for a little less; filmed facing a wall, it
// can turn right round into the room.
const TURNS: [number, number][] = [
  [0, 1],
  [Math.PI / 6, 0.92],
  [-Math.PI / 6, 0.92],
  [Math.PI / 3, 0.82],
  [-Math.PI / 3, 0.82],
  [Math.PI / 2, 0.7],
  [-Math.PI / 2, 0.7],
  [Math.PI, 0.6],
];

// How far from `p` along `d` before a wall.
export function freeAhead(p: Pt, d: Pt, walls: [Pt, Pt][], far = FAR_M) {
  let best = far;
  for (const [a, b] of walls) {
    const e: Pt = [b[0] - a[0], b[1] - a[1]];
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-9) continue;
    const w: Pt = [a[0] - p[0], a[1] - p[1]];
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const s = (w[0] * d[1] - w[1] * d[0]) / den;
    if (t > 0 && s >= 0 && s <= 1) best = Math.min(best, t);
  }
  return best;
}

// The best of the filmed spots inside the basement's rooms, turned a little where that sees further.
export function bestView(spots: Spot[], walls: [Pt, Pt][], rooms: Pt[][]): Spot | null {
  let best: { s: Spot; score: number } | null = null;
  for (const sp of spots) {
    if (rooms.length && !rooms.some((r) => inPolygon(sp.at, r))) continue;
    if (walls.some(([a, b]) => distToSegment(sp.at, a, b) < CLEAR_M)) continue;
    const base = Math.atan2(sp.dir[1], sp.dir[0]);
    for (const [turn, weight] of TURNS) {
      const dir: Pt = [Math.cos(base + turn), Math.sin(base + turn)];
      const score = freeAhead(sp.at, dir, walls) * weight;
      if (!best || score > best.score) best = { s: { at: sp.at, dir }, score };
    }
  }
  return best?.s ?? null;
}

// Filmed spots from a scan's scan.json (camera-to-basement poses, OpenCV axes: column 2 looks ahead),
// in plan metres (`k`: their tape's scale).
export function spotsOf(scan: { frames?: { pose: number[][] }[] } | null, k = 1): Spot[] {
  return (scan?.frames ?? []).flatMap((f) => {
    const P = f.pose;
    const dx = P[0][2], dz = P[2][2];
    const n = Math.hypot(dx, dz);
    return n > 0.2 ? [{ at: [P[0][3] * k, P[2][3] * k] as Pt, dir: [dx / n, dz / n] as Pt }] : [];
  });
}
