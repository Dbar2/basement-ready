// One connected basement in 3D. A rough pass over the whole walk shows where the camera went; the walk
// is cut where it moved on to a new area, each area is measured on its own (sharper and truer to size),
// and the whole-walk pass places the areas in one plan (server/assemble.ts). Pieces of one open room
// merge; neighbours settle against each other to share a wall.
import { place, placedRect, quarterTurns, sameRooms, settle, splitWalk, square, turn, type Rect, type V2 } from "./assemble";
import { MIN_ROOM_FRAMES } from "./rooms";
import type { KnownCamera } from "./capture";
import { runFloorPlan, runScan3d, type FloorPlanResult, type FloorPlanRoom, type Scan3d } from "./scan3d";

// The rough pass only has to say where things are: fewer frames, faster.
const WHOLE_FRAMES = Number(process.env.SCAN3D_WHOLE_FRAMES ?? 40);

// Room frame -> basement frame: turn by quarter turns about the vertical, then shift on the floor.
export type RoomPlacement = { turn: 0 | 1 | 2 | 3; x: number; z: number };

export type BasementScan = {
  spans: { from: number; to: number }[]; // the areas kept, in our frame numbers, filming order
  scans: Scan3d[];
  placements: RoomPlacement[];
  rects: Rect[]; // each area's box in the basement frame
};

// Camera position, forward direction and our frame number for every frame a scan kept, on its floor plane.
function cameras(s3: Scan3d) {
  const frames: { pose: number[][]; sourceIndex: number }[] = s3.scan.frames ?? [];
  return {
    idx: frames.map((f) => s3.sentFrames[f.sourceIndex]),
    pos: frames.map((f): V2 => [f.pose[0][3], f.pose[2][3]]),
    fwd: frames.map((f): V2 => [f.pose[0][2], f.pose[2][2]]),
  };
}

// `cameraFor`: the phone's tracked camera for each of our frames, when the iPhone app filmed the take.
// Then the walk is cut from the phone's own (metric) path and every area comes back in the phone's one
// world, so areas are placed exactly instead of estimated from a rough pass.
export async function scanBasement(
  work: string,
  frameCount: number,
  known: { floorToJoistsM?: number },
  log: (text: string) => Promise<void>,
  cameraFor?: (n: number) => KnownCamera | null,
): Promise<BasementScan | null> {
  if (cameraFor) {
    const tracked = await scanTracked(work, frameCount, known, log, cameraFor);
    if (tracked) return tracked;
  }
  await log("Mapping your whole basement");
  const whole = await runScan3d(work, { from: 0, to: frameCount }, known, WHOLE_FRAMES);
  const w = cameras(whole);

  // Areas from where the camera went; a stretch too short to measure joins the one before it.
  const edges = [0];
  for (const [a] of splitWalk(w.pos).slice(1)) if (w.idx[a] - edges.at(-1)! >= MIN_ROOM_FRAMES) edges.push(w.idx[a]);
  if (frameCount - edges.at(-1)! < MIN_ROOM_FRAMES && edges.length > 1) edges.pop();
  const spans = edges.map((from, i) => ({ from, to: edges[i + 1] ?? frameCount }));

  const scans: Scan3d[] = [];
  for (const [i, span] of spans.entries()) {
    await log(spans.length > 1 ? `Measuring area ${i + 1} of ${spans.length}` : "Measuring your basement");
    scans.push(await runScan3d(work, span, known));
  }

  const placed = scans.map((s3) => {
    const c = cameras(s3);
    return { c, p: place(c.idx, c.pos, c.fwd, w.idx, w.pos, w.fwd) };
  });
  const scales = placed.flatMap(({ p }) => (p && p.scale > 0 ? [p.scale] : [])).sort((a, b) => a - b);
  const S = scales.length ? scales[Math.floor(scales.length / 2)] : 1;
  const theta = placed.map(({ p }) => (p ? square(p.theta) : 0));
  const centre = placed.map(({ p }): V2 => (p ? [p.shift[0] / S, p.shift[1] / S] : [0, 0]));
  const rects = scans.map((s3, k) => placedRect(s3.scan.room?.widthM ?? 0, s3.scan.room?.depthM ?? 0, theta[k], centre[k]));
  const cams = placed.map(({ c }, k) => c.pos.map((p): V2 => {
    const q = turn(p, theta[k]);
    return [q[0] + centre[k][0], q[1] + centre[k][1]];
  }));

  // Two stretches of one open room: keep the first.
  const owner = sameRooms(rects, cams);
  const kept = owner.flatMap((o, k) => (o === k ? [k] : []));
  const moves = settle(kept.map((k) => rects[k]));
  return {
    spans: kept.map((k) => spans[k]),
    scans: kept.map((k) => scans[k]),
    placements: kept.map((k, i) => ({ turn: quarterTurns(theta[k]), x: centre[k][0] + moves[i][0], z: centre[k][1] + moves[i][1] })),
    rects: kept.map((k, i) => ({ x0: rects[k].x0 + moves[i][0], z0: rects[k].z0 + moves[i][1], x1: rects[k].x1 + moves[i][0], z1: rects[k].z1 + moves[i][1] })),
  };
}

// Areas from the phone's own path, each measured with its known cameras and placed by the world the
// phone tracked. Null when too little of the take was tracked to rely on.
async function scanTracked(
  work: string,
  frameCount: number,
  known: { floorToJoistsM?: number },
  log: (text: string) => Promise<void>,
  cameraFor: (n: number) => KnownCamera | null,
): Promise<BasementScan | null> {
  const idx: number[] = [], pos: V2[] = [];
  for (let n = 0; n < frameCount; n += 3) {
    const c = cameraFor(n);
    if (!c) continue;
    idx.push(n);
    pos.push([c.pose[0][3], c.pose[2][3]]);
  }
  if (idx.length < Math.max(12, (frameCount / 3) * 0.5)) return null;

  const edges = [0];
  for (const [a] of splitWalk(pos).slice(1)) if (idx[a] - edges.at(-1)! >= MIN_ROOM_FRAMES) edges.push(idx[a]);
  if (frameCount - edges.at(-1)! < MIN_ROOM_FRAMES && edges.length > 1) edges.pop();
  const spans = edges.map((from, i) => ({ from, to: edges[i + 1] ?? frameCount }));

  const scans: Scan3d[] = [];
  for (const [i, span] of spans.entries()) {
    await log(spans.length > 1 ? `Measuring area ${i + 1} of ${spans.length}` : "Measuring your basement");
    scans.push(await runScan3d(work, span, known, undefined, cameraFor));
  }
  if (scans.some((s3) => s3.scan.world?.frame !== "arkit")) return null;

  // One floor plan from all of it: rooms from walls and doorways, not a box per stretch of video.
  const centres = idx.map((n) => {
    const c = cameraFor(n)!;
    return [c.pose[0][3], c.pose[1][3], c.pose[2][3]];
  });
  const plan = await runFloorPlan(scans, centres).catch(() => null);
  if (plan?.rooms.length) {
    const placed = fromFloorPlan(plan, scans, spans, idx, pos);
    if (placed) return placed;
  }

  // Each area's room frame in the phone's world: its x axis is the first row of the rotation.
  const theta = scans.map((s3) => Math.atan2(s3.scan.world.rotation[0][2], s3.scan.world.rotation[0][0]));
  const origin = scans.map((s3): V2 => [s3.scan.world.origin[0], s3.scan.world.origin[2]]);
  // The basement's axes follow the biggest area; the others square to it.
  const big = scans.reduce((b, s3, k) => ((s3.scan.room?.widthM ?? 0) * (s3.scan.room?.depthM ?? 0) > (scans[b].scan.room?.widthM ?? 0) * (scans[b].scan.room?.depthM ?? 0) ? k : b), 0);
  const turned = theta.map((t) => square(t - theta[big]));
  const centre = origin.map((o) => turn(o, -theta[big]));
  const rects = scans.map((s3, k) => placedRect(s3.scan.room?.widthM ?? 0, s3.scan.room?.depthM ?? 0, turned[k], centre[k]));
  const cams = spans.map((span) => {
    const out: V2[] = [];
    idx.forEach((n, i) => n >= span.from && n < span.to && out.push(turn(pos[i], -theta[big])));
    return out;
  });
  const owner = sameRooms(rects, cams);
  const kept = owner.flatMap((o, k) => (o === k ? [k] : []));
  const moves = settle(kept.map((k) => rects[k]));
  return {
    spans: kept.map((k) => spans[k]),
    scans: kept.map((k) => scans[k]),
    placements: kept.map((k, i) => ({ turn: quarterTurns(turned[k]), x: centre[k][0] + moves[i][0], z: centre[k][1] + moves[i][1] })),
    rects: kept.map((k, i) => ({ x0: rects[k].x0 + moves[i][0], z0: rects[k].z0 + moves[i][1], x1: rects[k].x1 + moves[i][0], z1: rects[k].z1 + moves[i][1] })),
  };
}

const SIDES = ["minX", "maxX", "minZ", "maxZ"] as const;
const NORMAL: Record<(typeof SIDES)[number], V2> = { minX: [-1, 0], maxX: [1, 0], minZ: [0, -1], maxZ: [0, 1] };
const sideOf = ([x, z]: V2): (typeof SIDES)[number] => (Math.abs(x) > Math.abs(z) ? (x < 0 ? "minX" : "maxX") : z < 0 ? "minZ" : "maxZ");

// Each floor-plan room keeps the area that filmed most of it; that area's box becomes the room's box (in
// the area's own frame, so its finds and depth still line up), and it's placed by the tracked world.
function fromFloorPlan(plan: FloorPlanResult, scans: Scan3d[], spans: { from: number; to: number }[], idx: number[], pos: V2[]): BasementScan | null {
  const phi = plan.rotation;
  const inBox = (b: FloorPlanRoom["box"], [x, z]: V2) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
  // Which room each area stood in most.
  const owner = spans.map((span) => {
    const counts = plan.rooms.map(() => 0);
    idx.forEach((n, i) => {
      if (n < span.from || n >= span.to) return;
      const p = turn(pos[i], -phi);
      plan.rooms.forEach((r, k) => inBox(r.box, p) && counts[k]++);
    });
    const best = counts.indexOf(Math.max(...counts));
    return counts[best] > 0 ? { room: best, count: counts[best] } : null;
  });
  const kept: number[] = [];
  plan.rooms.forEach((_, r) => {
    const areas = owner.flatMap((o, k) => (o?.room === r ? [k] : []));
    if (areas.length) kept.push(areas.reduce((a, b) => (owner[b]!.count > owner[a]!.count ? b : a)));
  });
  if (!kept.length) return null;
  kept.sort((a, b) => a - b);
  const placements: RoomPlacement[] = [];
  const rects: Rect[] = [];
  for (const k of kept) {
    const s3 = scans[k];
    const room = plan.rooms[owner[k]!.room];
    const theta = Math.atan2(s3.scan.world.rotation[0][2], s3.scan.world.rotation[0][0]);
    const o: V2 = [s3.scan.world.origin[0], s3.scan.world.origin[2]];
    const f = s3.scan.scale?.factor ?? 1;
    // The room's box: plan frame -> world -> this area's room frame.
    const [x0, z0, x1, z1] = room.box;
    const corners = ([[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as V2[]).map((c) => {
      const w = turn(c, phi);
      return turn([w[0] - o[0], w[1] - o[1]], -theta).map((v) => v * f) as V2;
    });
    const xs = corners.map((c) => c[0]), zs = corners.map((c) => c[1]);
    const box = s3.scan.room.box;
    box.min = [Math.min(...xs), 0, Math.min(...zs)];
    box.max = [Math.max(...xs), box.max?.[1] ?? 0, Math.max(...zs)];
    // Each side of this area's box faces the plan-frame side its outward normal turns into.
    box.sides = Object.fromEntries(SIDES.map((side) => [side, room.sides[sideOf(turn(NORMAL[side], theta - phi))]]));
    s3.scan.room.widthM = Math.round((box.max[0] - box.min[0]) * 100) / 100;
    s3.scan.room.depthM = Math.round((box.max[2] - box.min[2]) * 100) / 100;
    const c = turn(o, -phi);
    placements.push({ turn: quarterTurns(theta - phi), x: c[0], z: c[1] });
    rects.push({ x0, z0, x1, z1 });
  }
  return { spans: kept.map((k) => spans[k]), scans: kept.map((k) => scans[k]), placements, rects };
}

// The 3D matrix of a placement: x' = c x - s z, z' = s x + c z, y unchanged.
function basis(p: RoomPlacement) {
  const t = (p.turn * Math.PI) / 2;
  return { c: Math.round(Math.cos(t)), s: Math.round(Math.sin(t)) };
}

// Every room's surface points in the basement frame, in one file, shuffled together so any prefix is an
// even sample of the whole basement (the phone version is a prefix). Frame numbers become our video frame
// numbers, so the points still assemble in filming order.
export function mergeSurfels(rooms: { surfels: ArrayBuffer; placement: RoomPlacement; frameNumbers: number[] }[]): Buffer {
  const total = rooms.reduce((n, r) => n + new DataView(r.surfels).getUint32(4, true), 0);
  const pos = new Int16Array(total * 3), col = new Uint8Array(total * 3), size = new Uint8Array(total), frame = new Uint16Array(total);
  let o = 0;
  for (const r of rooms) {
    const n = new DataView(r.surfels).getUint32(4, true);
    const P = new Int16Array(r.surfels, 8, n * 3), C = new Uint8Array(r.surfels, 8 + n * 6, n * 3);
    const Z = new Uint8Array(r.surfels, 8 + n * 9, n), F = new Uint16Array(r.surfels.slice(8 + n * 10, 8 + n * 12));
    const { c, s } = basis(r.placement);
    const dx = r.placement.x * 1000, dz = r.placement.z * 1000;
    for (let i = 0; i < n; i++, o++) {
      const x = P[i * 3], z = P[i * 3 + 2];
      pos[o * 3] = Math.max(-32767, Math.min(32767, Math.round(c * x - s * z + dx)));
      pos[o * 3 + 1] = P[i * 3 + 1];
      pos[o * 3 + 2] = Math.max(-32767, Math.min(32767, Math.round(s * x + c * z + dz)));
      col.set(C.subarray(i * 3, i * 3 + 3), o * 3);
      size[o] = Z[i];
      frame[o] = r.frameNumbers[F[i]] ?? 0;
    }
  }
  // Shuffle (seeded, so a rebuild gives the same file).
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    for (let k = 0; k < 3; k++) [pos[i * 3 + k], pos[j * 3 + k]] = [pos[j * 3 + k], pos[i * 3 + k]];
    for (let k = 0; k < 3; k++) [col[i * 3 + k], col[j * 3 + k]] = [col[j * 3 + k], col[i * 3 + k]];
    [size[i], size[j]] = [size[j], size[i]];
    [frame[i], frame[j]] = [frame[j], frame[i]];
  }
  const head = Buffer.alloc(8);
  head.write("BRS1", 0, "ascii");
  head.writeUInt32LE(total, 4);
  return Buffer.concat([head, Buffer.from(pos.buffer), Buffer.from(col), Buffer.from(size), Buffer.from(frame.buffer)]);
}

// Where the camera stood for every kept frame, in the basement frame, for "jump to where you filmed".
export function basementViewpoints(rooms: { scan: any; placement: RoomPlacement; frameNumbers: number[] }[]) {
  const frames: { frame: number; room: number; pose: number[][] }[] = [];
  rooms.forEach((r, room) => {
    const { c, s } = basis(r.placement);
    const M = [
      [c, 0, -s],
      [0, 1, 0],
      [s, 0, c],
    ];
    (r.scan.frames ?? []).forEach((f: { pose: number[][] }, i: number) => {
      const P = f.pose;
      const pose = [0, 1, 2].map((row) => [
        ...[0, 1, 2].map((col) => M[row][0] * P[0][col] + M[row][1] * P[1][col] + M[row][2] * P[2][col]),
        M[row][0] * P[0][3] + M[row][1] * P[1][3] + M[row][2] * P[2][3] + (row === 0 ? r.placement.x : row === 2 ? r.placement.z : 0),
      ]);
      frames.push({ frame: r.frameNumbers[i] ?? 0, room, pose: [...pose, [0, 0, 0, 1]] });
    });
  });
  return { frames: frames.sort((a, b) => a.frame - b.frame) };
}
