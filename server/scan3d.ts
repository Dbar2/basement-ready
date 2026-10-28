// Client for the MapAnything 3D service (services/scan3d). Optional: without SCAN3D_URL the
// scan runs exactly as before. Locally it's the Mac runner; in production, Modal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Detection } from "./pipeline";

const URL_ = process.env.SCAN3D_URL;
const TOKEN = process.env.SCAN3D_TOKEN;
const MAX_FRAMES = Number(process.env.SCAN3D_MAX_FRAMES ?? 24);
// Send at most this many frames; the service keeps the sharpest in each slice.
const SEND_FRAMES = 120;

export const scan3dEnabled = Boolean(URL_ && TOKEN);

export type Scan3d = {
  scan: any; // scan.json, see services/scan3d/README.md
  ply: ArrayBuffer;
  depth: ArrayBuffer;
  sentFrames: number[]; // our frame index for each request position (scan.frames[i].sourceIndex → this)
};

export async function scan3dReady(timeoutMs = 3000) {
  if (!scan3dEnabled) return false;
  try {
    const res = await fetch(`${URL_}/health`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

// One room's frames, [from, to) in our frame numbers.
export async function runScan3d(work: string, range: { from: number; to: number }, known: { floorToJoistsM?: number }): Promise<Scan3d> {
  const step = Math.max(1, Math.ceil((range.to - range.from) / SEND_FRAMES));
  const sentFrames: number[] = [];
  const form = new FormData();
  for (let n = range.from; n < range.to; n += step) {
    const name = `${String(n).padStart(4, "0")}.jpg`;
    form.append("frames", new Blob([readFileSync(join(work, "frames", name))], { type: "image/jpeg" }), name);
    sentFrames.push(n);
  }
  form.append("options", JSON.stringify({ maxFrames: MAX_FRAMES, ...(known.floorToJoistsM ? { known } : {}) }));
  const res = await fetch(`${URL_}/scan`, {
    method: "POST",
    body: form,
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`scan3d ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const parts = await res.formData();
  const scan = JSON.parse(await (parts.get("scan") as File).text());
  return { scan, ply: await (parts.get("points") as File).arrayBuffer(), depth: await (parts.get("depth") as File).arrayBuffer(), sentFrames };
}

// ---- Lifting SAM boxes into the room (formula from services/scan3d/README.md) ----

function half(bits: number) {
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

export type Measurements = {
  ceilingHeightM: number | null;
  widthM: number | null;
  depthM: number | null;
  scaleSource: "model" | "user_measurement";
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
    scaleSource: s3.scan.scaleSource === "user_measurement" ? "user_measurement" : "model",
    confidence: scale.confidence ?? "low",
    expectedErrorPct: scale.expectedErrorPct ?? 20,
    pass: s3.scan.quality?.pass ?? null,
    trusted: s3.scan.quality?.pass?.flatFloor === true && s3.scan.quality?.pass?.ceilingLevelWithin5cm === true,
    warnings: s3.scan.quality?.warnings ?? [],
    clearances,
  };
}
