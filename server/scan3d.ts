// Client for the MapAnything 3D service (services/scan3d). Optional: without SCAN3D_URL the
// scan runs exactly as before. Locally it's the Mac runner; in production, Modal.
import type { KnownCamera } from "./capture";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Detection } from "./pipeline";

const URL_ = process.env.SCAN3D_URL;
const TOKEN = process.env.SCAN3D_TOKEN;
// 48 frames per room measure rooms clearly better than 24 (docs/research/scan-eval.md).
const MAX_FRAMES = Number(process.env.SCAN3D_MAX_FRAMES ?? 48);
// Send at most this many frames; the service keeps the sharpest in each slice.
const SEND_FRAMES = 120;
// The whole basement's solid surface stays around 600k triangles, so a phone draws it smoothly.
const MESH_FACES = 600_000;
export const meshFaces = (areas: number) => Math.round(Math.min(300_000, Math.max(100_000, MESH_FACES / Math.max(1, areas))));

export const scan3dEnabled = Boolean(URL_ && TOKEN);

export type Scan3d = {
  scan: any; // scan.json, see services/scan3d/README.md
  ply: ArrayBuffer;
  depth: ArrayBuffer;
  surfels?: ArrayBuffer; // dense surface points for the photo-like view (services/scan3d export.py)
  mesh?: ArrayBuffer; // the solid surface, BRM1 (services/scan3d export.py mesh_bytes)
  sentFrames: number[]; // our frame index for each request position (scan.frames[i].sourceIndex → this)
};

// How long a scan waits for the 3D service to answer. Modal scales the GPU to zero after a minute idle
// (services/scan3d/app.py), and the next request waits while a container starts: 28 s and 105 s
// measured (Oct 30). The Mac runner is either up or it isn't.
export const readyWaitMs = (url = URL_) => (/modal\.run/.test(url ?? "") ? 3 * 60_000 : 3000);

// Whether the 3D service answers /health within `waitMs`. Asking also wakes Modal. A refused connection
// or a 5xx (a container still starting) is asked again; a 4xx (wrong token or address) won't get better.
export async function scan3dReady({ url = URL_, token = TOKEN, waitMs = readyWaitMs(url), retryMs = 2000, get = fetch } = {}) {
  if (!url || !token) return false;
  const until = Date.now() + waitMs;
  let why = "no answer";
  for (let left = waitMs; left > 0; left = until - Date.now()) {
    try {
      const res = await get(`${url}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(left) });
      if (res.ok) return true;
      why = `status ${res.status}`;
      if (res.status < 500) break;
    } catch (err) {
      why = err instanceof Error && err.name !== "TimeoutError" ? err.message : "no answer";
    }
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(retryMs, until - Date.now()))));
  }
  console.error(`[scan3d] not ready within ${Math.round(waitMs / 1000)} s: ${why}`);
  return false;
}

// One room's frames, [from, to) in our frame numbers.
// `cameraFor`: the phone's known camera for one of our frames (server/capture.ts), when the app filmed it.
// `maxFaces`: triangles in the solid surface; 0 for none.
export async function runScan3d(
  work: string,
  range: { from: number; to: number },
  known: { floorToJoistsM?: number },
  { maxFrames = MAX_FRAMES, cameraFor, maxFaces }: { maxFrames?: number; cameraFor?: (n: number) => KnownCamera | null; maxFaces?: number } = {},
): Promise<Scan3d> {
  const step = Math.max(1, Math.ceil((range.to - range.from) / SEND_FRAMES));
  const sentFrames: number[] = [];
  const form = new FormData();
  for (let n = range.from; n < range.to; n += step) {
    const name = `${String(n).padStart(4, "0")}.jpg`;
    form.append("frames", new Blob([readFileSync(join(work, "frames", name))], { type: "image/jpeg" }), name);
    sentFrames.push(n);
  }
  form.append("options", JSON.stringify({ maxFrames, ...(maxFaces != null ? { maxFaces } : {}), ...(known.floorToJoistsM ? { known } : {}) }));
  const cameras = cameraFor ? sentFrames.map(cameraFor) : [];
  if (cameras.some(Boolean)) form.append("cameras", JSON.stringify(cameras));
  const res = await fetch(`${URL_}/scan`, {
    method: "POST",
    body: form,
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`scan3d ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const parts = await res.formData();
  const scan = JSON.parse(await (parts.get("scan") as File).text());
  const surfels = parts.get("surfels") as File | null;
  const mesh = parts.get("mesh") as File | null;
  return {
    scan,
    ply: await (parts.get("points") as File).arrayBuffer(),
    depth: await (parts.get("depth") as File).arrayBuffer(),
    surfels: surfels ? await surfels.arrayBuffer() : undefined,
    mesh: mesh ? await mesh.arrayBuffer() : undefined,
    sentFrames,
  };
}

// ---- One floor plan for the whole basement (services/scan3d/scan3d/floorplan.py) ----

export type FloorPlanRoom = { box: [number, number, number, number]; outline: [number, number][]; areaM2: number; cameras: number; sides: Record<"minX" | "maxX" | "minZ" | "maxZ", "wall" | "extent"> };
// rotation: world (x, z) turned by -rotation is the plan frame.
export type FloorPlanResult = { rotation: number; floorY: number; ceilingY: number | null; footprintM2: number; rooms: FloorPlanRoom[] };

// The plan read from every area's points at once: only for areas in one tracked world (the app's).
export async function runFloorPlan(scans: Scan3d[], cameras: number[][]): Promise<FloorPlanResult> {
  const form = new FormData();
  form.append("areas", JSON.stringify(scans.map((s3) => ({ world: s3.scan.world, factor: s3.scan.scale?.factor ?? 1 }))));
  form.append("cameras", JSON.stringify(cameras));
  scans.forEach((s3, i) => form.append("points", new Blob([s3.ply], { type: "application/octet-stream" }), `area-${i}.ply`));
  const res = await fetch(`${URL_}/floorplan`, { method: "POST", body: form, headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`floorplan ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ---- Surface points for the photo-like view (services/scan3d/scan3d/export.py surfel_bytes) ----

// "BRS1", uint32 count, then positions int16 x3, colours uint8 x3, footprint uint8, frame uint16.
// The points are shuffled, so the first n are an even sample: a phone gets that many.
export const LITE_SURFELS = 400_000;
export function liteSurfels(buf: Buffer, n = LITE_SURFELS): Buffer {
  const count = buf.readUInt32LE(4);
  const m = Math.min(count, n);
  if (m === count) return buf;
  const at = (offset: number, width: number) => buf.subarray(8 + offset * count, 8 + offset * count + width * m);
  const head = Buffer.alloc(8);
  buf.copy(head, 0, 0, 4);
  head.writeUInt32LE(m, 4);
  return Buffer.concat([head, at(0, 6), at(6, 3), at(9, 1), at(10, 2)]);
}

// ---- Lifting SAM boxes into the room (formula from services/scan3d/README.md) ----

export function half(bits: number) {
  const e = (bits >> 10) & 0x1f;
  const m = bits & 0x3ff;
  const s = bits & 0x8000 ? -1 : 1;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

type Box = { x: number; y: number; w: number; h: number };

// Room-frame points (metres) under a box on one scan frame; percentiles per axis.
export function liftBox(scan: any, depth: ArrayBuffer, scanFrame: number, box: Box, erodePx = 2) {
  const f = scan.frames[scanFrame];
  const [, H, W] = scan.files.depth.shape;
  const m = f.model;
  const u0 = Math.max(0, Math.ceil(box.x * m.resizedWidth - m.cropLeft) + erodePx);
  const v0 = Math.max(0, Math.ceil(box.y * m.resizedHeight - m.cropTop) + erodePx);
  const u1 = Math.min(W - 1, Math.floor((box.x + box.w) * m.resizedWidth - m.cropLeft) - erodePx);
  const v1 = Math.min(H - 1, Math.floor((box.y + box.h) * m.resizedHeight - m.cropTop) - erodePx);
  const [[fx, , cx], [, fy, cy]] = f.intrinsics;
  const P = f.pose;
  const view = new DataView(depth, f.depthOffset, H * W * 2);
  const pts: number[][] = [];
  for (let v = v0; v <= v1; v++) {
    for (let u = u0; u <= u1; u++) {
      const z = half(view.getUint16((v * W + u) * 2, true));
      if (!(z > 0)) continue;
      const c = [((u - cx) * z) / fx, ((v - cy) * z) / fy, z];
      pts.push([0, 1, 2].map((r) => P[r][0] * c[0] + P[r][1] * c[1] + P[r][2] * c[2] + P[r][3]));
    }
  }
  if (pts.length < 20) return null;
  const pct = (q: number) =>
    [0, 1, 2].map((a) => {
      const s = pts.map((p) => p[a]).sort((x, y) => x - y);
      return s[Math.min(s.length - 1, Math.floor(q * s.length))];
    });
  return { count: pts.length, median: pct(0.5), p05: pct(0.05), p95: pct(0.95) };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Clear height under a duct or beam: the low edge of what SAM outlined, over every scan frame it shows up in.
export function clearanceUnder(s3: Scan3d, d: Detection): number | null {
  const byFrame = new Map(d.track.map((t) => [t[0], t]));
  const lows: number[] = [];
  s3.scan.frames.forEach((f: any, i: number) => {
    const ours = s3.sentFrames[f.sourceIndex];
    const t = byFrame.get(ours);
    if (!t) return;
    const lifted = liftBox(s3.scan, s3.depth, i, { x: t[1], y: t[2], w: t[3], h: t[4] });
    if (lifted) lows.push(lifted.p05[1]);
  });
  return lows.length ? Math.round(median(lows) * 100) / 100 : null;
}

// SAM's "beam" and "duct" also outline shelves and sofa backs. Anything overhead has its underside
// well above furniture, even with the 3D's scale 20% off; below this it isn't a beam or a duct.
const MIN_OVERHEAD_M = 1.2;
export function lowOverhead(scans3d: (Scan3d | null)[], detections: Detection[], measure = clearanceUnder): Detection[] {
  return detections.filter((d) => {
    if (d.kind !== "beam" && d.kind !== "duct") return false;
    const seen = scans3d.flatMap((s3) => (s3 ? [measure(s3, d)] : [])).filter((c): c is number => c !== null);
    return seen.length > 0 && Math.max(...seen) < MIN_OVERHEAD_M;
  });
}

// ---- Scale from doors: no tape needed ----

// A North American interior door slab is 80 in (2.03 m); with its frame, a door reads about 2.04 m.
export const DOOR_HEIGHT_M = 2.04;
const DOORS_AGREE = 0.04;

// Each door's height in scan units, from the frames where the whole door is in view.
export function doorHeights(s3: Scan3d, detections: Detection[]) {
  const heights: number[] = [];
  for (const d of detections.filter((x) => x.kind === "exit")) {
    const byFrame = new Map(d.track.map((t) => [t[0], t]));
    const seen: number[] = [];
    s3.scan.frames.forEach((f: any, i: number) => {
      const t = byFrame.get(s3.sentFrames[f.sourceIndex]);
      // A door cut off by the edge of the picture would read short.
      if (!t || t[2] < 0.02 || t[2] + t[4] > 0.98 || t[4] < 0.35) return;
      const lifted = liftBox(s3.scan, s3.depth, i, { x: t[1], y: t[2], w: t[3], h: t[4] });
      if (lifted) seen.push(lifted.p95[1] - lifted.p05[1]);
    });
    if (seen.length) heights.push(median(seen));
  }
  return heights;
}

// The factor that makes the doors 2.04 m tall, when two or more doors agree on it. In everyday
// footage doors are often open, cut off or behind clutter, so a big correction is distrusted:
// doors only fine-tune the 3D model's own scale.
const MAX_DOOR_CORRECTION = 0.15;
export function doorScale(heights: number[]): number | null {
  const ok = heights.filter((h) => h > 0.5 && h < 5);
  if (ok.length < 2) return null;
  const mid = median(ok);
  const agree = ok.filter((h) => Math.abs(h - mid) / mid <= DOORS_AGREE);
  if (agree.length < 2) return null;
  const s = DOOR_HEIGHT_M / median(agree);
  return Math.abs(s - 1) <= MAX_DOOR_CORRECTION ? s : null;
}

// Every length times s. Doors pin the scale to a few percent.
export function rescaleMeasurements(m: Measurements, s: number): Measurements {
  const r2 = (n: number | null) => (n == null ? null : Math.round(n * s * 100) / 100);
  return {
    ...m,
    ceilingHeightM: r2(m.ceilingHeightM),
    widthM: r2(m.widthM),
    depthM: r2(m.depthM),
    clearances: m.clearances.map((c) => ({ ...c, clearanceM: r2(c.clearanceM)! })),
    scaleSource: "door",
    confidence: "medium",
    expectedErrorPct: 6,
  };
}

export type Measurements = {
  ceilingHeightM: number | null;
  widthM: number | null;
  depthM: number | null;
  scaleSource: "model" | "user_measurement" | "door" | "arkit";
  confidence: "low" | "medium" | "high";
  expectedErrorPct: number;
  pass: Record<string, boolean | null> | null;
  // Only a scan with a flat floor and a level ceiling may decide rules; otherwise its sizes are rough.
  trusted: boolean;
  warnings: string[];
  clearances: { detectionId: string; label: string; clearanceM: number }[];
};

// The few numbers the rules use, plus how far to trust them.
export function summarize(s3: Scan3d, detections: Detection[]): Measurements {
  const room = s3.scan.room ?? {};
  const scale = s3.scan.scale ?? {};
  const clearances = detections
    .filter((d) => d.kind === "duct" || d.kind === "beam")
    .map((d) => ({ detectionId: d.id, label: d.label, clearanceM: clearanceUnder(s3, d) }))
    .filter((c): c is { detectionId: string; label: string; clearanceM: number } => c.clearanceM !== null && c.clearanceM > 0.5);
  return {
    ceilingHeightM: room.ceilingHeightM ?? null,
    widthM: room.widthM ?? null,
    depthM: room.depthM ?? null,
    scaleSource: s3.scan.scaleSource === "user_measurement" || s3.scan.scaleSource === "arkit" ? s3.scan.scaleSource : "model",
    confidence: scale.confidence ?? "low",
    expectedErrorPct: scale.expectedErrorPct ?? 20,
    pass: s3.scan.quality?.pass ?? null,
    trusted: s3.scan.quality?.pass?.flatFloor === true && s3.scan.quality?.pass?.ceilingLevelWithin5cm === true,
    warnings: s3.scan.quality?.warnings ?? [],
    clearances,
  };
}
