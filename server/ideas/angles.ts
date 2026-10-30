// Which frames make a good picture of a room, from its 3D, never at random: sharp, wide (it sees far),
// the camera level and at eye height, not facing a wall closer than 1.5 m, and spread around each room
// (different rooms first, then different directions in the same room). A simple stand-in for the deck
// until server/views/angles.ts (bestAngles) lands; the deck switches to that then.
//
// The 3D's frames are already the sharpest of their stretch (services/scan3d keeps one per slice), and
// each carries its sharpness and its camera: camera-to-room with OpenCV axes (z forward, y down), the
// floor at y = 0. How far a frame sees comes from its depth map once the room is saved; while the scan
// is still measuring, only the area's scan.json is stored, so it's the distance to the room box's wall
// straight ahead.
import { half } from "../scan3d";
import { keys, storage } from "../storage";

export type Shot = {
  frame: number; // our frame number
  room: number;
  x: number;
  z: number;
  yaw: number; // radians, the direction it looks on the floor
  tilt: number; // 0 level, 1 straight up or down
  heightM: number; // the camera above the floor
  sharp: number;
  seesM: number | null; // how far it sees: the far quarter of the depth
  aheadM: number | null; // the nearest thing straight ahead: a wall, if it's close
};

const LEVEL = 0.35; // |forward.y|: about 20° up or down
const LOOSE = 0.55; // when a room has nothing level (phones filmed looking down)
const EYE: [number, number] = [1.0, 2.0];
const WALL_M = 1.5;
const APART = (70 * Math.PI) / 180; // two pictures of one room look at least this far apart
const FAR_M = 7;

type ScanJson = {
  frames?: { sourceIndex?: number; name?: string; frame?: number; sharpness?: number; pose: number[][]; depthOffset?: number }[];
  sentFrames?: number[];
  room?: { floor?: { heightM?: number }; box?: { min: number[]; max: number[] } };
  files?: { depth?: { shape?: number[] } };
};

const quantile = (v: number[], q: number) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length * q)] : null);

// The distance on the floor from a camera to the box's wall straight ahead of it.
function toWall(box: NonNullable<ScanJson["room"]>["box"], x: number, z: number, dx: number, dz: number): number | null {
  if (!box) return null;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return 0; // looking at the floor or the ceiling
  const [ux, uz] = [dx / len, dz / len];
  const t = (p: number, u: number, lo: number, hi: number) => (u > 1e-6 ? (hi - p) / u : u < -1e-6 ? (lo - p) / u : Infinity);
  return Math.max(0, Math.min(t(x, ux, box.min[0], box.max[0]), t(z, uz, box.min[2], box.max[2])));
}

// Every frame of one room's (or area's) 3D as a shot.
export function shotsFrom(scan: ScanJson, depth: Buffer | null, room: number): Shot[] {
  const [, H, W] = scan.files?.depth?.shape ?? [];
  const floor = scan.room?.floor?.heightM ?? 0;
  const out: Shot[] = [];
  for (const f of scan.frames ?? []) {
    const frame = (f.sourceIndex != null ? scan.sentFrames?.[f.sourceIndex] : undefined) ?? (f.name ? Number.parseInt(f.name, 10) : f.frame);
    if (frame == null || !Number.isFinite(frame)) continue;
    const P = f.pose;
    const [fx, fy, fz] = [P[0][2], P[1][2], P[2][2]];
    const [x, y, z] = [P[0][3], P[1][3], P[2][3]];
    let seesM: number | null = null;
    let aheadM: number | null = null;
    if (depth && H && W && f.depthOffset != null && f.depthOffset + H * W * 2 <= depth.length) {
      const all: number[] = [];
      const mid: number[] = [];
      for (let v = 0; v < H; v += 6) {
        for (let u = 0; u < W; u += 6) {
          const d = half(depth.readUInt16LE(f.depthOffset + (v * W + u) * 2));
          if (!(d > 0)) continue;
          all.push(d);
          if (v > H * 0.35 && v < H * 0.65 && u > W * 0.35 && u < W * 0.65) mid.push(d);
        }
      }
      // How far it sees: the far part of the picture (the floor near the feet would drag a median down).
      seesM = quantile(all, 0.75);
      aheadM = quantile(mid, 0.5);
    } else {
      seesM = aheadM = toWall(scan.room?.box, x, z, fx, fz);
    }
    out.push({ frame, room, x, z, yaw: Math.atan2(fx, fz), tilt: Math.abs(fy), heightM: y - floor, sharp: f.sharpness ?? 0, seesM, aheadM });
  }
  return out;
}

const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// The best few, spread around: each room's best first, then another direction in the same rooms.
export function pickAngles(shots: Shot[], max = 5, perRoom = 2, gap = 10): Shot[] {
  const rooms = new Map<number, Shot[]>();
  for (const s of shots) rooms.set(s.room, [...(rooms.get(s.room) ?? []), s]);
  const ranked: { room: number; shots: (Shot & { score: number })[] }[] = [];
  for (const [room, list] of rooms) {
    const fits = (s: Shot, level: number) => s.tilt < level && s.heightM >= EYE[0] && s.heightM <= EYE[1] && (s.aheadM ?? Infinity) >= WALL_M;
    const ok = list.filter((s) => fits(s, LEVEL)).length ? list.filter((s) => fits(s, LEVEL)) : list.filter((s) => fits(s, LOOSE));
    if (!ok.length) continue;
    const bySharp = [...ok].sort((a, b) => a.sharp - b.sharp);
    const scored = ok
      .map((s) => ({ ...s, score: Math.min(s.seesM ?? 3, FAR_M) / FAR_M + (0.6 * bySharp.indexOf(s)) / Math.max(1, ok.length - 1) - s.tilt }))
      .sort((a, b) => b.score - a.score);
    ranked.push({ room, shots: scored });
  }
  ranked.sort((a, b) => b.shots[0].score - a.shots[0].score);
  const picks: Shot[] = [];
  for (let round = 0; round < perRoom && picks.length < max; round++) {
    for (const r of ranked) {
      if (picks.length >= max) break;
      const mine = picks.filter((p) => p.room === r.room);
      if (mine.length > round) continue;
      const next = r.shots.find((s) => picks.every((p) => Math.abs(p.frame - s.frame) >= gap) && mine.every((p) => turn(p.yaw, s.yaw) >= APART));
      if (next) picks.push(next);
    }
  }
  return picks;
}

async function read(key: string) {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

// Every shot the 3D has so far: each saved room with its depth, else each area measured during the scan.
export async function storedShots(scanId: string, rooms: number[], areas: number): Promise<Shot[]> {
  const fromRooms = await Promise.all(
    rooms.map(async (i) => {
      const json = await read(keys.scan3d(scanId, "scan.json", i));
      return json ? shotsFrom(JSON.parse(json.toString("utf8")), await read(keys.scan3d(scanId, "depth.bin", i)), i) : [];
    }),
  );
  if (fromRooms.some((s) => s.length)) return fromRooms.flat();
  const fromAreas = await Promise.all(
    Array.from({ length: areas }, async (_, i) => {
      const json = await read(keys.area3d(scanId, i, "scan.json"));
      return json ? shotsFrom(JSON.parse(json.toString("utf8")), null, i) : [];
    }),
  );
  return fromAreas.flat();
}
