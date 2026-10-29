// One connected basement from rooms measured one at a time (mirrors services/scan3d/scan3d/assemble.py).
// MapAnything measures a room well on its own but drifts over a whole walk. So one rough pass over the
// whole walk says where the camera went: the walk is cut where it moved on to a new area, each area is
// measured on its own, and frames close in time (the same camera in both runs) place each area in the
// whole-walk plan. Areas are squared to the basement's axes, pieces of one open room are merged, and
// neighbours are nudged to share a wall. All 2D on the floor plane (x, z), in metres.

export type V2 = [number, number];
export type Rect = { x0: number; z0: number; x1: number; z1: number };
export type Placement = { theta: number; scale: number; shift: V2; pairs: number };

const PAIR_FRAMES = 2; // frames this close in time (5 fps) count as the same camera
const SQUARE_DEG = 20; // a room turned within this of a right angle is squared to it
export const PARTITION_M = 0.12; // wall thickness between two rooms
const CLOSE_GAP_M = 0.9; // a gap between facing walls narrower than this closes to a partition
const MIN_SIDE_OVERLAP_M = 0.4; // ...when the rooms face each other along at least this much
const SAME_ROOM_SHARE = 0.5; // each box holds this share of the other's cameras: one open room

const yaw = (f: V2) => Math.atan2(f[1], f[0]);
export const turn = (p: V2, theta: number): V2 => [p[0] * Math.cos(theta) - p[1] * Math.sin(theta), p[0] * Math.sin(theta) + p[1] * Math.cos(theta)];

// Cut a camera path (in filming order) into stretches that each stay in one place: least spread within
// stretches plus a fixed cost per cut. Returns [start, end) index pairs.
// A tenth of the whole walk's spread per cut: rooms, not steps within a room, whatever the scale of the
// rough pass. Too many cuts is safe (pieces of one room merge later); too few isn't.
const CUT_SHARE = 0.1;
export function splitWalk(pos: V2[], minLen = 6, penalty?: number): [number, number][] {
  const n = pos.length;
  if (n < 2 * minLen) return [[0, n]];
  if (penalty === undefined) {
    const mx = pos.reduce((a, p) => a + p[0], 0) / n, mz = pos.reduce((a, p) => a + p[1], 0) / n;
    penalty = CUT_SHARE * pos.reduce((a, p) => a + (p[0] - mx) ** 2 + (p[1] - mz) ** 2, 0);
  }
  const cx = [0], cz = [0], c2 = [0];
  for (const [x, z] of pos) {
    cx.push(cx.at(-1)! + x);
    cz.push(cz.at(-1)! + z);
    c2.push(c2.at(-1)! + x * x + z * z);
  }
  const cost = (a: number, b: number) => {
    const m = b - a, sx = cx[b] - cx[a], sz = cz[b] - cz[a];
    return c2[b] - c2[a] - (sx * sx + sz * sz) / m;
  };
  const best = new Array(n + 1).fill(Infinity);
  const back = new Array(n + 1).fill(0);
  best[0] = 0;
  for (let b = minLen; b <= n; b++) {
    for (let a = 0; a <= b - minLen; a++) {
      if (a && a < minLen) continue;
      const v = best[a] + cost(a, b) + (a ? penalty : 0);
      if (v < best[b]) {
        best[b] = v;
        back[b] = a;
      }
    }
  }
  const cuts: [number, number][] = [];
  for (let b = n; b > 0; b = back[b]) cuts.push([back[b], b]);
  return cuts.reverse();
}

// Where a room sits in the whole-walk plan, from its cameras that the whole walk also has.
export function place(roomIdx: number[], roomPos: V2[], roomFwd: V2[], wholeIdx: number[], wholePos: V2[], wholeFwd: V2[]): Placement | null {
  const level: [number, number][] = [];
  roomIdx.forEach((f, i) => {
    let j = 0;
    for (let k = 1; k < wholeIdx.length; k++) if (Math.abs(wholeIdx[k] - f) < Math.abs(wholeIdx[j] - f)) j = k;
    // Looking at the ceiling or floor says little about the heading.
    if (Math.abs(wholeIdx[j] - f) <= PAIR_FRAMES && Math.hypot(...roomFwd[i]) > 0.5 && Math.hypot(...wholeFwd[j]) > 0.5) level.push([i, j]);
  });
  if (level.length < 3) return null;
  let s = 0, c = 0;
  for (const [i, j] of level) {
    const d = yaw(wholeFwd[j]) - yaw(roomFwd[i]);
    s += Math.sin(d);
    c += Math.cos(d);
  }
  const theta = Math.atan2(s, c);
  const pr = level.map(([i]) => turn(roomPos[i], theta));
  const pw = level.map(([, j]) => wholePos[j]);
  const mean = (ps: V2[]): V2 => [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
  const mr = mean(pr), mw = mean(pw);
  let num = 0, den = 0;
  pr.forEach((p, k) => {
    num += (pw[k][0] - mw[0]) * (p[0] - mr[0]) + (pw[k][1] - mw[1]) * (p[1] - mr[1]);
    den += (p[0] - mr[0]) ** 2 + (p[1] - mr[1]) ** 2;
  });
  const scale = den > 1e-6 ? num / den : 1;
  return { theta, scale, shift: [mw[0] - scale * mr[0], mw[1] - scale * mr[1]], pairs: level.length };
}

// Snap a turn to the nearest right angle when it's close: rooms in a house share axes.
export function square(theta: number, tolDeg = SQUARE_DEG) {
  const q = Math.round(theta / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(((theta - q) * 180) / Math.PI) <= tolDeg ? q : theta;
}

export const quarterTurns = (theta: number) => (((Math.round(theta / (Math.PI / 2)) % 4) + 4) % 4) as 0 | 1 | 2 | 3;

// A room's box (width along its x, depth along its z, centred on its origin), turned by quarter turns.
export function placedRect(width: number, depth: number, theta: number, centre: V2): Rect {
  const [w, d] = quarterTurns(theta) % 2 ? [depth, width] : [width, depth];
  return { x0: centre[0] - w / 2, z0: centre[1] - d / 2, x1: centre[0] + w / 2, z1: centre[1] + d / 2 };
}

const inside = (r: Rect, p: V2) => p[0] > r.x0 && p[0] < r.x1 && p[1] > r.z0 && p[1] < r.z1;
const share = (r: Rect, ps: V2[]) => (ps.length ? ps.filter((p) => inside(r, p)).length / ps.length : 0);

// Two stretches of the walk in one open room are one room: where each box holds most of the other's
// cameras, the later stretch joins the earlier one. Returns, for each input, the room it became.
export function sameRooms(rects: Rect[], cams: V2[][]): number[] {
  const owner = rects.map((_, k) => k);
  for (let k = 1; k < rects.length; k++) {
    for (let j = 0; j < k; j++) {
      if (owner[j] !== j) continue;
      if (share(rects[j], cams[k]) >= SAME_ROOM_SHARE && share(rects[k], cams[j]) >= SAME_ROOM_SHARE) {
        owner[k] = j;
        break;
      }
    }
  }
  return owner;
}

// Shifts that stop rooms overlapping and close slivers between facing walls: the first room stays,
// later rooms move, in filming order.
export function settle(rects: Rect[], passes = 3): V2[] {
  const out = rects.map((r) => ({ ...r }));
  const moves: V2[] = rects.map(() => [0, 0]);
  const centre = (r: Rect): V2 => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
  for (let p = 0; p < passes; p++) {
    for (let k = 1; k < out.length; k++) {
      for (let j = 0; j < k; j++) {
        const a = out[j], b = out[k];
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
        const right = centre(b)[0] > centre(a)[0], below = centre(b)[1] > centre(a)[1];
        let dx = 0, dz = 0;
        if (ox > 0 && oz > 0) {
          if (ox < oz) dx = (ox + PARTITION_M) * (right ? 1 : -1);
          else dz = (oz + PARTITION_M) * (below ? 1 : -1);
        } else if (oz >= MIN_SIDE_OVERLAP_M && ox > -CLOSE_GAP_M && ox <= 0) dx = (-ox - PARTITION_M) * (right ? -1 : 1);
        else if (ox >= MIN_SIDE_OVERLAP_M && oz > -CLOSE_GAP_M && oz <= 0) dz = (-oz - PARTITION_M) * (below ? -1 : 1);
        if (dx || dz) {
          out[k] = { x0: b.x0 + dx, z0: b.z0 + dz, x1: b.x1 + dx, z1: b.z1 + dz };
          moves[k] = [moves[k][0] + dx, moves[k][1] + dz];
        }
      }
    }
  }
  return moves;
}
