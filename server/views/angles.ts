// The best real camera angles to picture a design from: picked from the frames the 3D kept, never at
// random. A good angle is steady and sharp, level, well exposed and at eye height (server/views/stable.ts:
// a frame that isn't is never pictured), sees a lot of the room's floor and walls, and has nothing right
// in front of the lens. Then the set is spread out around each room: different spots and directions,
// not neighbours in time.
//
// Pure: the views come from each area's scan.json and depth.bin (viewsFromArea), or, for a scan that
// only kept camera spots (the example), from the solid surface (viewsFromMesh). bestAngles in
// server/views/load.ts reads them from storage.
import type { RoomPlacement } from "../basement";
import { corners, lookOf } from "../model/furniture";
import type { Furniture } from "../model/types";
import { half } from "../scan3d";
import { frameQuality, heightsAlong, levelOf, motionOf, pathUp, roomDetail, type Look, type Motion } from "./stable";

export type Intrinsics = { fx: number; fy: number; cx: number; cy: number; width: number; height: number; source: "scan" | "assumed" };

// One frame as a candidate angle. Poses are camera-to-basement, OpenCV camera axes (x right, y down,
// z forward), the same frame as the merged 3D files and the model.
export type View = {
  room: number;
  frame: number; // our frame number: /api/scans/:id/frames/:frame
  pose: number[][];
  intrinsics: Intrinsics;
  heightM: number;
  pitchDeg: number; // up is positive
  rollDeg: number;
  sharpness: number | null; // variance of the Laplacian, from the 3D service
  seen: { floor: number; wall: number; near: number }; // shares of the room's floor and walls in view, and of the view taken up by something closer than 1.5 m
  depth?: DepthGrid; // what the camera sees, coarsely: for telling whether a piece of the design is hidden
  motion?: Motion | null; // how fast the camera turned there, and how sharp it is against the frames around it
  look?: Look | null; // its light and detail (server/views/looks.ts)
};

// How far the camera sees in each cell of a coarse grid over the picture (0..1 of its width and
// height), in metres along the lens; 99 where nothing was measured.
export type DepthGrid = { w: number; h: number; z: number[] };

export type Angle = Omit<View, "depth"> & { id: string; score: number; why: string; shows: string[] };

type Box = { minX: number; maxX: number; minZ: number; maxZ: number; ceilingM: number };

const FLOOR_CELL = 0.25;
const WALL_CELL = 0.3;
const NEAR_M = 1.5;
const NEAR_MAX = 0.4; // more of the picture than this closer than NEAR_M: a picture of what's in the way
const MIN_GAP_FRAMES = 10; // 2 s of video at 5 fps

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const deg = (r: number) => (r * 180) / Math.PI;
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// A placement as a 4×4 (room frame -> basement frame), as in server/basement.ts basementViewpoints.
export function placePose(P: number[][], p: RoomPlacement | null): number[][] {
  if (!p) return P.map((r) => [...r]);
  const t = (p.turn * Math.PI) / 2;
  const c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
  const M = [
    [c, 0, -s],
    [0, 1, 0],
    [s, 0, c],
  ];
  const out = [0, 1, 2].map((row) => [
    ...[0, 1, 2].map((col) => M[row][0] * P[0][col] + M[row][1] * P[1][col] + M[row][2] * P[2][col]),
    M[row][0] * P[0][3] + M[row][1] * P[1][3] + M[row][2] * P[2][3] + (row === 0 ? p.x : row === 2 ? p.z : 0),
  ]);
  return [...out, [0, 0, 0, 1]];
}

// Height above the floor, and pitch and roll against `up` (the camera path's own, server/views/stable.ts
// pathUp, where it can tell; else the 3D's +y).
const attitude = (P: number[][], up: [number, number, number] | null = null, height = (Q: number[][]) => Q[1][3]) => ({ heightM: height(P), ...levelOf(P, up) });

// Something in the way: a surface close to the lens that isn't the floor under your feet or the ceiling.
const isNear = (y: number, box: Box) => y >= 0.12 && y <= box.ceilingM - 0.1;

// What a set of seen points covers of a room box: distinct 25 cm floor cells and 30 cm wall cells.
export function coverage(points: ArrayLike<number>, box: Box) {
  const floor = new Set<number>(), wall = new Set<number>();
  const w = box.maxX - box.minX, d = box.maxZ - box.minZ;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    if (x < box.minX - 0.35 || x > box.maxX + 0.35 || z < box.minZ - 0.35 || z > box.maxZ + 0.35) continue;
    if (y < 0.12) {
      if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) floor.add(Math.floor((x - box.minX) / FLOOR_CELL) * 4096 + Math.floor((z - box.minZ) / FLOOR_CELL));
      continue;
    }
    if (y < 0.15 || y > box.ceilingM - 0.15) continue;
    const sides = [x - box.minX, box.maxX - x, z - box.minZ, box.maxZ - z].map(Math.abs);
    const side = sides.indexOf(Math.min(...sides));
    if (sides[side] > 0.35) continue;
    const along = side < 2 ? z - box.minZ : x - box.minX;
    wall.add(side * 1e6 + Math.floor(along / WALL_CELL) * 1000 + Math.floor(y / WALL_CELL));
  }
  const floorCells = Math.max(1, Math.ceil(w / FLOOR_CELL) * Math.ceil(d / FLOOR_CELL));
  const wallCells = Math.max(1, Math.ceil((2 * (w + d)) / WALL_CELL) * Math.ceil(Math.max(0.3, box.ceilingM - 0.3) / WALL_CELL));
  return { floor: Math.min(1, floor.size / floorCells), wall: Math.min(1, wall.size / wallCells) };
}

const GRID_W = 24;
const newGrid = (w: number, h: number): DepthGrid => ({ w, h, z: new Array(w * h).fill(99) });
function toGrid(g: DepthGrid, x: number, y: number, z: number) {
  const i = Math.floor(x * g.w), k = Math.floor(y * g.h);
  if (i < 0 || k < 0 || i >= g.w || k >= g.h) return;
  if (z < g.z[k * g.w + i]) g.z[k * g.w + i] = z;
}

// ---------- views from an area's own 3D (scan.json + depth.bin) ----------

export type AreaInput = {
  room: number;
  scan: any; // scan.json as stored by server/pipeline.ts finishRooms, with sentFrames
  depth: Uint8Array | null;
  placement: RoomPlacement | null;
  hasFrame?: (n: number) => boolean;
  step?: number; // depth pixels sampled every `step` in each direction
};

// The model-pixel intrinsics as the saved frame's pixels: u = x·resizedWidth − cropLeft (README).
export function frameIntrinsics(f: any): Intrinsics {
  const [[fx, , cx], [, fy, cy]] = f.intrinsics as number[][];
  const m = f.model;
  const sx = f.width / m.resizedWidth, sy = f.height / m.resizedHeight;
  return { fx: fx * sx, fy: fy * sy, cx: (cx + m.cropLeft) * sx, cy: (cy + m.cropTop) * sy, width: f.width, height: f.height, source: "scan" };
}

function seenFromBox(box: Box, P: number[][]): View["seen"] {
  const [x, z, dx, dz] = [P[0][3], P[2][3], P[0][2], P[2][2]];
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return { floor: 0, wall: 0, near: 1 }; // looking at the floor or the ceiling
  const t = (p: number, u: number, lo: number, hi: number) => (u > 1e-6 ? (hi - p) / u : u < -1e-6 ? (lo - p) / u : Infinity);
  const ahead = Math.max(0, Math.min(t(x, dx / len, box.minX, box.maxX), t(z, dz / len, box.minZ, box.maxZ)));
  const share = clamp(ahead / Math.max(1, Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ)), 0, 1);
  return { floor: share, wall: share, near: ahead < NEAR_M ? 1 : 0 };
}

export function viewsFromArea(a: AreaInput): View[] {
  const scan = a.scan;
  const room = scan.room ?? {};
  if (!room.box || !scan.frames?.length) return [];
  // How the camera moved through the area, in filming order.
  const numberOf = (f: any) => scan.sentFrames?.[f.sourceIndex] ?? Number.parseInt(String(f.name), 10);
  const motion = motionOf((scan.frames as any[]).filter((f) => f.pose && Number.isFinite(numberOf(f))).map((f) => ({ frame: numberOf(f), pose: f.pose, sharpness: typeof f.sharpness === "number" ? f.sharpness : null })));
  const poses = (scan.frames as any[]).filter((f) => f.pose).map((f) => f.pose as number[][]);
  const up = pathUp(poses);
  const height = heightsAlong(poses, up);
  const box: Box = { minX: room.box.min[0], maxX: room.box.max[0], minZ: room.box.min[2], maxZ: room.box.max[2], ceilingM: room.ceilingHeightM ?? room.box.max[1] ?? 2.3 };
  const [, H, W] = (scan.files?.depth?.shape ?? [0, 0, 0]) as number[];
  const step = a.step ?? 3;
  const out: View[] = [];
  for (const f of scan.frames as any[]) {
    const frame = numberOf(f);
    if (!Number.isFinite(frame) || (a.hasFrame && !a.hasFrame(frame))) continue;
    if (!f.intrinsics || !f.model || !f.pose) continue;
    const P = f.pose as number[][];
    let seen = { floor: 0, wall: 0, near: 1 };
    let depth: DepthGrid | undefined;
    if (a.depth && H && W && (f.validFraction ?? 1) >= 0.25) {
      const [[fx, , cx], [, fy, cy]] = f.intrinsics as number[][];
      const view = new DataView(a.depth.buffer, a.depth.byteOffset + f.depthOffset, H * W * 2);
      const pts: number[] = [];
      let valid = 0, near = 0;
      const m = f.model;
      const grid = newGrid(GRID_W, Math.round((GRID_W * f.height) / f.width));
      for (let v = 1; v < H; v += step) {
        for (let u = 1; u < W; u += step) {
          const z = half(view.getUint16((v * W + u) * 2, true));
          if (!(z > 0)) continue;
          valid++;
          toGrid(grid, (u + m.cropLeft) / m.resizedWidth, (v + m.cropTop) / m.resizedHeight, z);
          const c0 = ((u - cx) * z) / fx, c1 = ((v - cy) * z) / fy;
          const y = P[1][0] * c0 + P[1][1] * c1 + P[1][2] * z + P[1][3];
          if (z < NEAR_M && isNear(y, box)) near++;
          pts.push(P[0][0] * c0 + P[0][1] * c1 + P[0][2] * z + P[0][3], y, P[2][0] * c0 + P[2][1] * c1 + P[2][2] * z + P[2][3]);
        }
      }
      if (valid > 50) {
        seen = { ...coverage(pts, box), near: near / valid };
        depth = grid;
      }
    }
    // No depth yet (an area measured mid-scan): how much it sees, judged from the area's box, by how
    // far it is to the box's wall straight ahead.
    if (!a.depth) seen = seenFromBox(box, P);
    out.push({
      room: a.room,
      frame,
      pose: placePose(P, a.placement),
      intrinsics: frameIntrinsics(f),
      ...attitude(P, up, height),
      sharpness: typeof f.sharpness === "number" ? f.sharpness : null,
      seen,
      ...(depth ? { depth } : {}),
      motion: motion.get(frame) ?? null,
    });
  }
  return out;
}

// ---------- views from camera spots and the solid surface (the example) ----------

export type Spot = { frame: number; room: number; pose: number[][] }; // basement-frame pose, as basementViewpoints saves it

// A typical phone camera: about 68° across the long side of the picture.
export function assumedIntrinsics(width: number, height: number, longFovDeg = 68): Intrinsics {
  const f = Math.max(width, height) / 2 / Math.tan((longFovDeg * Math.PI) / 360);
  return { fx: f, fy: f, cx: width / 2, cy: height / 2, width, height, source: "assumed" };
}

// The pose at a frame that wasn't kept, from its two nearest kept neighbours (positions averaged,
// rotation averaged and squared up again). A frame further than `maxGap` from any kept one is null.
export function poseAt(spots: Spot[], frame: number, maxGap = 3): Spot | null {
  const exact = spots.find((s) => s.frame === frame);
  if (exact) return exact;
  const before = [...spots].filter((s) => s.frame < frame).sort((a, b) => b.frame - a.frame)[0];
  const after = [...spots].filter((s) => s.frame > frame).sort((a, b) => a.frame - b.frame)[0];
  const near = [before, after].filter((s): s is Spot => Boolean(s) && Math.abs(s.frame - frame) <= maxGap);
  if (!near.length) return null;
  if (near.length === 1) return { ...near[0], frame };
  const [a, b] = near;
  const k = (frame - a.frame) / (b.frame - a.frame);
  const M = a.pose.map((r, i) => r.map((v, j) => v * (1 - k) + b.pose[i][j] * k));
  // Gram–Schmidt on the rotation's columns.
  const col = (j: number) => [M[0][j], M[1][j], M[2][j]];
  const norm = (v: number[]) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const x = norm(col(0));
  const zr = col(2);
  const dz = zr[0] * x[0] + zr[1] * x[1] + zr[2] * x[2];
  const z = norm(zr.map((v, i) => v - dz * x[i]));
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const pose = [0, 1, 2].map((i) => [x[i], y[i], z[i], M[i][3]]);
  return { frame, room: a.room, pose: [...pose, [0, 0, 0, 1]] };
}

// What each camera sees of the solid surface: its vertices splatted into a coarse depth buffer from
// that camera, the nearest one per cell kept. `boxes` are the rooms' boxes in the basement frame.
// `motion`: how the camera moved, from the whole camera path (server/views/stable.ts motionOf).
// `path`: the whole camera path's poses, which say which way is up (server/views/stable.ts pathUp).
export function viewsFromMesh(spots: Spot[], meshPos: Int16Array, boxes: Map<number, Box>, intrinsics: Intrinsics, sharpness?: Map<number, number>, motion?: Map<number, Motion>, path: number[][][] = []): View[] {
  const up = pathUp(path);
  const height = heightsAlong(path, up);
  const GW = 64, GH = Math.max(1, Math.round((GW * intrinsics.height) / intrinsics.width));
  const sx = GW / intrinsics.width, sy = GH / intrinsics.height;
  const out: View[] = [];
  for (const s of spots) {
    const P = s.pose;
    const box = boxes.get(s.room) ?? boxes.values().next().value;
    if (!box) continue;
    // Room-to-camera: Rᵀ(p − t).
    const t = [P[0][3], P[1][3], P[2][3]];
    const zbuf = new Float32Array(GW * GH).fill(Infinity);
    const hit = new Int32Array(GW * GH).fill(-1);
    for (let v = 0; v < meshPos.length / 3; v += 2) {
      const d = [meshPos[v * 3] / 1000 - t[0], meshPos[v * 3 + 1] / 1000 - t[1], meshPos[v * 3 + 2] / 1000 - t[2]];
      const cz = P[0][2] * d[0] + P[1][2] * d[1] + P[2][2] * d[2];
      if (cz < 0.1) continue;
      const cx = P[0][0] * d[0] + P[1][0] * d[1] + P[2][0] * d[2];
      const cy = P[0][1] * d[0] + P[1][1] * d[1] + P[2][1] * d[2];
      const u = Math.floor(((intrinsics.fx * cx) / cz + intrinsics.cx) * sx), w = Math.floor(((intrinsics.fy * cy) / cz + intrinsics.cy) * sy);
      if (u < 0 || w < 0 || u >= GW || w >= GH) continue;
      const k = w * GW + u;
      if (cz < zbuf[k]) {
        zbuf[k] = cz;
        hit[k] = v;
      }
    }
    const pts: number[] = [];
    let valid = 0, near = 0;
    const depth: DepthGrid = { w: GW, h: GH, z: Array.from(zbuf, (z) => (Number.isFinite(z) ? z : 99)) };
    for (let k = 0; k < hit.length; k++) {
      if (hit[k] < 0) continue;
      valid++;
      if (zbuf[k] < NEAR_M && isNear(meshPos[hit[k] * 3 + 1] / 1000, box)) near++;
      pts.push(meshPos[hit[k] * 3] / 1000, meshPos[hit[k] * 3 + 1] / 1000, meshPos[hit[k] * 3 + 2] / 1000);
    }
    out.push({
      room: s.room,
      frame: s.frame,
      pose: P.map((r) => [...r]),
      intrinsics,
      ...attitude(P, up, height),
      sharpness: sharpness?.get(s.frame) ?? null,
      seen: valid > 20 ? { ...coverage(pts, box), near: near / valid } : { floor: 0, wall: 0, near: 1 },
      depth,
      motion: motion?.get(s.frame) ?? null,
    });
  }
  return out;
}

// ---------- the design in each view ----------

// A straight wall of the design on the plan (x, z).
export type Seg = [[number, number], [number, number]];
const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
// The sight line p to q passes through the wall.
const through = (p: number[], q: number[], [a, b]: Seg) => cross(p, q, a) * cross(p, q, b) < 0 && cross(a, b, p) * cross(a, b, q) < 0;

// What a view makes of the design: the pieces it shows (in the picture, in front of the lens and not
// behind a real wall or one of the design's new walls), and whether the camera stands where the design
// puts furniture (a person filmed from there; the picture would be taken from inside the sofa) or right
// up against a piece.
export function designInView(v: View, furniture: Pick<Furniture, "id" | "kind" | "at" | "rotDeg" | "sizeM">[], walls: Seg[] = []) {
  const P = v.pose, K = v.intrinsics;
  const eye: [number, number] = [P[0][3], P[2][3]];
  const fwd = [P[0][2], P[2][2]];
  const shows: string[] = [];
  let blocked = false, close = false, share = 0;
  for (const f of furniture) {
    if (lookOf(f) === "rug") continue;
    const c = corners(f, 0.3);
    if (inside(eye, c)) blocked = true;
    // Points on the piece, half a metre up: its centre and its corners pulled in a little.
    const pts = [f.at, ...corners(f, -0.15)].map((p) => [p[0], 0.45, p[1]]);
    let seen = 0;
    for (const p of pts) {
      const d = [p[0] - P[0][3], p[1] - P[1][3], p[2] - P[2][3]];
      const cz = P[0][2] * d[0] + P[1][2] * d[1] + P[2][2] * d[2];
      if (cz < 0.3 || cz > 8) continue;
      const u = (K.fx * (P[0][0] * d[0] + P[1][0] * d[1] + P[2][0] * d[2])) / cz + K.cx;
      const w = (K.fy * (P[0][1] * d[0] + P[1][1] * d[1] + P[2][1] * d[2])) / cz + K.cy;
      if (u < 0 || w < 0 || u >= K.width || w >= K.height) continue;
      if (v.depth) {
        const g = v.depth;
        const z = g.z[Math.min(g.h - 1, Math.floor((w / K.height) * g.h)) * g.w + Math.min(g.w - 1, Math.floor((u / K.width) * g.w))];
        if (z < cz - 0.5 || z >= 99) continue; // a real wall in front of it, or nothing measured there to say
      }
      if (walls.some((s) => through(eye, [p[0], p[2]], s))) continue; // a new wall in front of it
      seen++;
    }
    if (seen >= 2) {
      shows.push(f.id);
      // How much of the picture it fills: the box round its projected footprint, floor to 0.9 m up.
      const proj = corners(f).flatMap((q) => [0, 0.9].map((y) => {
        const d = [q[0] - P[0][3], y - P[1][3], q[1] - P[2][3]];
        const cz = Math.max(0.3, P[0][2] * d[0] + P[1][2] * d[1] + P[2][2] * d[2]);
        return [(K.fx * (P[0][0] * d[0] + P[1][0] * d[1] + P[2][0] * d[2])) / cz + K.cx, (K.fy * (P[0][1] * d[0] + P[1][1] * d[1] + P[2][1] * d[2])) / cz + K.cy];
      }));
      const us = proj.map((q) => clamp(q[0], 0, K.width)), ws = proj.map((q) => clamp(q[1], 0, K.height));
      share += ((Math.max(...us) - Math.min(...us)) * (Math.max(...ws) - Math.min(...ws))) / (K.width * K.height);
    }
    // Right in front of the lens: under a metre ahead, within the picture's width.
    const near = c.some((q) => {
      const d = [q[0] - eye[0], q[1] - eye[1]];
      const ahead = d[0] * fwd[0] + d[1] * fwd[1];
      return ahead > 0 && ahead < 0.9 && Math.abs(d[0] * fwd[1] - d[1] * fwd[0]) < ahead * (K.width / (2 * K.fx)) + 0.2;
    });
    if (near) close = true;
  }
  // How much of the picture's width a new wall fills from close by: a picture of a wall.
  let walled = 0;
  if (walls.length) {
    const half = Math.atan(K.width / (2 * K.fx)), yaw = Math.atan2(fwd[0], fwd[1]);
    for (let i = 0; i < 16; i++) {
      const a = yaw + half * ((2 * (i + 0.5)) / 16 - 1);
      const far: [number, number] = [eye[0] + Math.sin(a) * WALL_NEAR_M, eye[1] + Math.cos(a) * WALL_NEAR_M];
      if (walls.some((s) => through(eye, far, s))) walled++;
    }
  }
  return { shows, blocked, close, share: Math.min(1, share), walled: walled / 16 };
}
const WALL_NEAR_M = 2.0; // nearer than this, a wall fills its column of the picture

function inside(p: [number, number], poly: [number, number][]) {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inn = !inn;
  }
  return inn;
}

// ---------- choosing ----------

const yawOf = (P: number[][]) => Math.atan2(P[0][2], P[2][2]);

// How good each view is on its own, 0..1, and why: how fit the frame is to picture (server/views/stable.ts:
// 0 for one that's blurred, crooked, badly lit or swinging round), how much of the room it sees (against
// the best view of the same room) and whether something stands right in front of the lens.
function scoreViews(views: View[]) {
  const best = new Map<number, { floor: number; wall: number; sharp: number[]; looks: (Look | null | undefined)[] }>();
  for (const v of views) {
    const b = best.get(v.room) ?? { floor: 1e-6, wall: 1e-6, sharp: [], looks: [] };
    b.floor = Math.max(b.floor, v.seen.floor);
    b.wall = Math.max(b.wall, v.seen.wall);
    if (v.sharpness != null) b.sharp.push(v.sharpness);
    b.looks.push(v.look);
    best.set(v.room, b);
  }
  const detail = new Map([...best].map(([room, b]) => [room, roomDetail(b.looks)]));
  return views.map((v) => {
    const b = best.get(v.room)!;
    // Its sharpness against the room's middling frame counts a little too.
    const sorted = [...b.sharp].sort((x, y) => x - y);
    const sharpRoom = v.sharpness != null && sorted.length ? v.sharpness / sorted[Math.floor(sorted.length / 2)] : null;
    const q = frameQuality({ ...v, sharpRoom }, detail.get(v.room) ?? null);
    const wide = 0.5 * (v.seen.floor / b.floor) + 0.5 * (v.seen.wall / b.wall);
    const clear = 1 - smooth(0.12, 0.45, v.seen.near);
    const blocked = v.seen.near > NEAR_MAX;
    const score = blocked ? 0 : wide * clear * q.score;
    const why = [`sees ${Math.round(v.seen.floor * 100)}% of the floor and ${Math.round(v.seen.wall * 100)}% of the walls`, `${Math.round(v.seen.near * 100)}% within 1.5 m`, q.why, blocked && q.ok ? "not pictured: something right in front" : null].filter(Boolean).join(" · ");
    return { v, score, why };
  });
}

type Scored = { v: View; score: number; why: string; shows: string[]; share: number; walled?: number };

// Greedy, spread-out picking from a pool: each next pick is scored down by how close it stands to, and
// how nearly it looks the same way as, the picks so far (frames under 2 s from a pick are out), and up
// by `gain` (what it adds that the picks so far don't have). Only frames scoring at least `keep` of the
// best are picked at all: no making up the numbers with weaker ones.
function spreadPick(pool: Scored[], n: number, gain: (c: Scored, picked: Scored[]) => number = () => 1, keep = 0.5): Scored[] {
  const sorted = [...pool].filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.v.room - b.v.room || a.v.frame - b.v.frame);
  if (!sorted.length) return [];
  const top = sorted[0].score;
  const picked: Scored[] = [];
  while (picked.length < n) {
    let best: Scored | null = null, bestValue = 0;
    for (const c of sorted) {
      if (picked.includes(c) || c.score < top * keep) continue;
      let spread = 1;
      for (const p of picked) {
        if (p.v.room === c.v.room && Math.abs(c.v.frame - p.v.frame) < MIN_GAP_FRAMES) {
          spread = 0;
          break;
        }
        const dPos = Math.hypot(c.v.pose[0][3] - p.v.pose[0][3], c.v.pose[2][3] - p.v.pose[2][3]);
        let dYaw = Math.abs(yawOf(c.v.pose) - yawOf(p.v.pose));
        if (dYaw > Math.PI) dYaw = 2 * Math.PI - dYaw;
        spread = Math.min(spread, 1 - Math.exp(-((dPos / 1.2) ** 2) - (deg(dYaw) / 45) ** 2));
      }
      const value = c.score * spread * gain(c, picked);
      if (value > bestValue + 1e-12) {
        best = c;
        bestValue = value;
      }
    }
    if (!best || bestValue < top * 0.05) break;
    picked.push(best);
  }
  return picked;
}

const asAngle = (p: Scored): Angle => {
  const { depth: _, ...v } = p.v;
  return { ...v, id: `${p.v.room}-${String(p.v.frame).padStart(4, "0")}`, score: Math.round(p.score * 1000) / 1000, why: p.why, shows: p.shows };
};

function withDesign(views: View[], furniture: Pick<Furniture, "id" | "kind" | "at" | "rotDeg" | "sizeM">[], walls: Seg[] = []): Scored[] {
  // With a design: never from inside a piece, less from right up against one, more for each piece shown.
  return scoreViews(views).map((s) => {
    if (!furniture.length) return { ...s, shows: [] as string[], share: 0, walled: 0 };
    const d = designInView(s.v, furniture, walls);
    const k = d.blocked ? 0 : (d.close ? 0.5 : 1) * Math.min(2, 1 + 0.25 * d.shows.length) * (1 - d.walled);
    return { ...s, score: s.score * k, shows: d.shows, share: d.share, walled: d.walled, why: `${s.why} · shows ${d.shows.length} piece${d.shows.length === 1 ? "" : "s"}${d.close ? ", one right in front" : ""}` };
  });
}

// The design's own pictures: from any room's frames, the `n` best that show it, spread out, each new
// pick worth more for every piece it shows that fewer than two picks show yet. So the bed turns up in
// several pictures, from different sides, wherever the video allows.
export function pickDesignAngles(views: View[], n: number, furniture: Pick<Furniture, "id" | "kind" | "at" | "rotDeg" | "sizeM">[], walls: Seg[] = []): Angle[] {
  if (!furniture.length) return [];
  // The design has to be more than a speck: a tenth of the picture or more, the more the better; and
  // not half hidden by a new wall close in front of the lens.
  const pool = withDesign(views, furniture, walls).filter((s) => s.shows.length > 0 && s.share >= 0.1 && (s.walled ?? 0) < 0.5);
  const picks = spreadPick(pool, clamp(Math.round(n), 1, 8), (c, picked) => {
    const count = (id: string) => picked.filter((p) => p.shows.includes(id)).length;
    return Math.sqrt(Math.min(1, c.share * 2)) * (1 + c.shows.reduce((g, id) => g + (count(id) < 2 ? 0.6 : 0.05), 0));
  }, 0.35);
  return picks.map(asAngle);
}

// The best `perRoom` angles of each room, spread out: each next pick is scored down by how close it
// stands to, and how nearly it looks the same way as, the ones already picked; frames under 2 s from
// a pick are out, and so are frames well below the room's best. A room with no frame fit to picture
// gets none. Rooms keep their order; within a room, the best first. Deterministic.
export function pickAngles(views: View[], perRoom = 5, furniture: Pick<Furniture, "id" | "kind" | "at" | "rotDeg" | "sizeM">[] = [], walls: Seg[] = []): Angle[] {
  const n = clamp(Math.round(perRoom), 1, 8);
  const scored = withDesign(views, furniture, walls);
  const rooms = [...new Set(views.map((v) => v.room))].sort((a, b) => a - b);
  return rooms.flatMap((room) => spreadPick(scored.filter((s) => s.v.room === room), n).map(asAngle));
}
