// The as-built 3D: the basement drawn from its plan (src/three/AsBuiltModel.ts) and painted with the
// real video by the 3D service (services/scan3d/scan3d/texture.py). Painted after the scan, and again
// whenever "Is this your basement?" changes the plan; each painting is kept under its plan's key.
//   GET  /api/scans/:id/asbuilt               { status: "ready" | "painting" | "none", index?, base? }
//   GET  /api/scans/:id/asbuilt/:key/:file    the atlas index or one of its JPEGs
// Mounted from server/index.ts. The example's painting is in the repo (scripts/sample-asbuilt.ts).
import type { Hono } from "hono";
import { basementRooms } from "../src/components/basementPlan";
import type { RoomPlacement, RoomResult } from "../src/api";
import { asBuiltKey, buildAsBuilt, paintJob, type AsBuilt } from "../src/three/AsBuiltModel";
import { ModelSchema } from "./model/schema";
import { seedModel } from "./model/seed";
import type { Existing, Pt } from "./model/types";
import { serviceFetch } from "./replay";
import { keys, storage } from "./storage";
import { basementFor, loadWorkspace } from "./workspace";

const URL_ = process.env.SCAN3D_TEXTURE_URL ?? process.env.SCAN3D_URL;
const TOKEN = process.env.SCAN3D_TOKEN;
const UUID = /^[0-9a-f-]{36}$/;
const KEY = /^[0-9a-z]{1,14}$/;
const FILE = /^(index\.json|atlas-\d{3,4}\.jpg)$/;
// Depth only says what's in front of a surface: every other pixel is plenty, and a quarter the upload.
const DEPTH_STEP = 2;

const prefix = (scanId: string) => `scans/${scanId}/asbuilt`;
const fileKey = (scanId: string, key: string, file: string) => `${prefix(scanId)}/${key}/${file}`;

async function read(key: string): Promise<Buffer | null> {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

// The basement as they confirmed it, or as the scan first drew it.
export async function existingFor(scanId: string): Promise<{ existing: Existing; result: any } | null> {
  const a = await basementFor(scanId, { userId: null, claims: [] });
  if (!a.basement || !a.result) return null;
  const w = await loadWorkspace(a.basement.id);
  const saved = ModelSchema.safeParse((w.state as { model?: unknown }).model);
  if (saved.success) return { existing: saved.data.existing as Existing, result: a.result };
  const model = seedModel(a.result, { tape: w.state.tape, ideas: w.state.ideas });
  return model ? { existing: model.existing, result: a.result } : null;
}

export type Area = { room: RoomResult; placement: RoomPlacement; scan: any; depth: Buffer | null; areaScale: number };

// Every area measured in 3D, with where it sits in the basement. A scan that didn't put its areas
// together has one: its main room, where it stands.
export async function areasOf(scanId: string, result: any): Promise<Area[]> {
  const rooms: RoomResult[] = (result.rooms ?? []).filter((r: RoomResult) => r.has3d);
  const placed = basementRooms(rooms);
  const list = placed ? placed.map((p) => p.room) : rooms.filter((r) => r.index === (result.mainRoom ?? rooms[0]?.index));
  const out: Area[] = [];
  for (const room of list) {
    const [json, depth] = await Promise.all([read(keys.scan3d(scanId, "scan.json", room.index)), read(keys.scan3d(scanId, "depth.bin", room.index))]);
    if (!json) continue;
    const scan = JSON.parse(json.toString("utf8"));
    // Doors fine-tuned this area's plan (server/scan3d.ts doorScale) but not its 3D: its cameras move with the plan.
    const w = scan.room?.widthM;
    const s = room.plan?.scaleSource === "door" && w ? room.plan.widthM / w : 1;
    out.push({ room, placement: room.placement ?? { turn: 0, x: 0, z: 0 }, scan, depth, areaScale: s > 0.8 && s < 1.25 ? s : 1 });
  }
  return out;
}

// Room frame -> basement frame (server/basement.ts basementViewpoints: a quarter turn, a shift on the
// floor, and `y`, the lift that puts the area's floor at 0), then their tape's scale.
function placePose(P: number[][], p: RoomPlacement, areaScale: number, k: number): number[][] {
  const t = (p.turn * Math.PI) / 2;
  const c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
  const M = [
    [c, 0, -s],
    [0, 1, 0],
    [s, 0, c],
  ];
  const rows = [0, 1, 2].map((r) => [
    ...[0, 1, 2].map((col) => M[r][0] * P[0][col] + M[r][1] * P[1][col] + M[r][2] * P[2][col]),
    (M[r][0] * P[0][3] * areaScale + M[r][1] * P[1][3] * areaScale + M[r][2] * P[2][3] * areaScale + (r === 0 ? p.x : r === 2 ? p.z : (p.y ?? 0))) * k,
  ]);
  return [...rows, [0, 0, 0, 1]];
}

// One area's depth, every DEPTH_STEP-th pixel each way, still float16.
function thinDepth(buf: Buffer, [F, H, W]: number[]) {
  const h = Math.floor(H / DEPTH_STEP), w = Math.floor(W / DEPTH_STEP);
  const src = new Uint16Array(buf.buffer, buf.byteOffset, F * H * W);
  const out = new Uint16Array(F * h * w);
  for (let f = 0; f < F; f++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(f * h + y) * w + x] = src[(f * H + y * DEPTH_STEP) * W + x * DEPTH_STEP];
  return { data: Buffer.from(out.buffer), shape: [F, h, w] };
}

// Where filming started, in the basement frame: the stairs' top is the end nearer it.
export function firstCamera(areas: Area[], k: number): Pt | null {
  let best: { n: number; at: Pt } | null = null;
  for (const a of areas) {
    (a.scan.frames ?? []).forEach((f: any) => {
      const n = a.scan.sentFrames?.[f.sourceIndex] ?? Infinity;
      if (best && n >= best.n) return;
      const P = placePose(f.pose, a.placement, a.areaScale, k);
      best = { n, at: [P[0][3], P[2][3]] };
    });
  }
  return (best as { n: number; at: Pt } | null)?.at ?? null;
}

type Current = { model: AsBuilt; key: string; existing: Existing; areas: Area[]; stairTop: Pt | null };

// The model for the scan's current plan, and its key.
export async function currentModel(scanId: string): Promise<Current | null> {
  const found = await existingFor(scanId);
  if (!found) return null;
  const areas = await areasOf(scanId, found.result);
  const k = found.existing.scale.factor ?? 1;
  const stairTop = firstCamera(areas, k);
  const model = buildAsBuilt(found.existing, { stairTop });
  return { model, key: asBuiltKey(model), existing: found.existing, areas, stairTop };
}

const painting = new Map<string, { key: string; done: Promise<void> }>();
const recent = new Map<string, number[]>();
const PAINTS_PER_HOUR = 12;

export const asBuiltEnabled = () => Boolean(URL_ && TOKEN);

// Paint the scan's current plan, unless it's painted or being painted. Never throws.
export function paintAsBuiltLater(scanId: string) {
  if (!asBuiltEnabled()) return;
  paintAsBuilt(scanId).catch((err) => console.error(`[asbuilt] ${scanId}: ${err instanceof Error ? err.message : err}`));
}

export async function paintAsBuilt(scanId: string): Promise<string | null> {
  const cur = await currentModel(scanId);
  if (!cur || !cur.areas.length) return null;
  if (await read(fileKey(scanId, cur.key, "index.json"))) return cur.key;
  const busy = painting.get(scanId);
  if (busy?.key === cur.key) {
    await busy.done;
    return cur.key;
  }
  const now = Date.now();
  const times = (recent.get(scanId) ?? []).filter((t) => now - t < 3600_000);
  if (times.length >= PAINTS_PER_HOUR) return null;
  recent.set(scanId, [...times, now]);
  const done = paintNow(scanId, cur).finally(() => painting.get(scanId)?.done === done && painting.delete(scanId));
  painting.set(scanId, { key: cur.key, done });
  await done;
  return cur.key;
}

// What the painter needs for a plan (services/scan3d/scan3d/texture.py): the job, the frames its
// cameras point at, and each area's depth. `frame(n)` reads one of the take's frames.
export async function paintRequest(cur: Pick<Current, "model" | "existing" | "areas">, frame: (n: number) => Promise<Buffer | null>) {
  const k = cur.existing.scale.factor ?? 1;
  const cameras: unknown[] = [];
  const frames: { name: string; data: Buffer }[] = [];
  const depths: { data: Buffer; shape: number[] }[] = [];
  for (const a of cur.areas) {
    const shape: number[] | undefined = a.scan.files?.depth?.shape;
    const thin = a.depth && shape ? thinDepth(a.depth, shape) : null;
    if (thin) depths.push(thin);
    for (const [i, f] of (a.scan.frames ?? []).entries()) {
      const n = a.scan.sentFrames?.[f.sourceIndex];
      if (n == null) continue;
      const jpg = await frame(n);
      if (!jpg) continue;
      frames.push({ name: `${String(n).padStart(4, "0")}.jpg`, data: jpg });
      const [[fx, , cx], [, fy, cy]] = f.intrinsics;
      const m = f.model;
      // Model pixels -> the frame's own (services/scan3d/scan3d/frames.py resizes, then crops).
      const r = m.resizedWidth / f.width;
      const K = [[fx / r, 0, (cx + m.cropLeft + 0.5) / r - 0.5], [0, fy / r, (cy + m.cropTop + 0.5) / r - 0.5], [0, 0, 1]];
      const s = DEPTH_STEP;
      cameras.push({
        image: frames.length - 1,
        K,
        pose: placePose(f.pose, a.placement, a.areaScale, k),
        width: f.width,
        height: f.height,
        sharpness: f.sharpness ?? null,
        // Thinned depth pixel x is model pixel s·x.
        ...(thin ? { depth: { map: depths.length - 1, frame: i, K: [[fx / s, 0, cx / s], [0, fy / s, cy / s], [0, 0, 1]], scale: a.areaScale * k } } : {}),
      });
    }
  }
  const job = { ...paintJob(cur.model), cameras, depthShapes: depths.map((d) => d.shape), options: { ppm: 100, maxPage: 4096 } };
  return { job, frames, depths };
}

async function paintNow(scanId: string, cur: Current) {
  const t0 = Date.now();
  const { job, frames, depths } = await paintRequest(cur, (n) => read(keys.frame(scanId, n)));
  if (!job.cameras.length) throw new Error("no frames to paint from");
  const form = new FormData();
  form.append("job", JSON.stringify(job));
  for (const f of frames) form.append("frames", new Blob([new Uint8Array(f.data)], { type: "image/jpeg" }), f.name);
  depths.forEach((d, i) => form.append("depth", new Blob([new Uint8Array(d.data)], { type: "application/octet-stream" }), `area-${i}.bin`));
  // Through the record/replay layer (server/replay.ts), like the scan's other 3D calls.
  const res = await serviceFetch("scan3d", URL_ ?? "", "/texture", { method: "POST", body: form, signal: AbortSignal.timeout(10 * 60_000) }, () => ({ Authorization: `Bearer ${TOKEN}` }));
  if (!res.ok) throw new Error(`texture ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const parts = await res.formData();
  const index = JSON.parse(await (parts.get("index") as File).text());
  await Promise.all(
    Object.values(index.levels as Record<string, string>).map(async (name) => {
      const f = parts.get(name) as File | null;
      if (f) await storage.put(fileKey(scanId, cur.key, name), Buffer.from(await f.arrayBuffer()), "image/jpeg");
    }),
  );
  // The hints the surfaces were built with, so the browser builds the same ones.
  const stored = { ...index, key: cur.key, stairTop: cur.stairTop, floorY: 0 };
  await storage.put(fileKey(scanId, cur.key, "index.json"), Buffer.from(JSON.stringify(stored)), "application/json");
  await storage.put(`${prefix(scanId)}/latest.json`, Buffer.from(JSON.stringify({ key: cur.key })), "application/json");
  console.log(`[asbuilt] ${scanId}: ${job.cameras.length} frames, ${cur.model.surfaces.length} surfaces, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

export function mountAsBuilt(app: Hono) {
  app.get("/api/scans/:id/asbuilt", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
    const cur = await currentModel(id).catch(() => null);
    if (!cur) return c.json({ status: "none" });
    const base = (key: string) => `/api/scans/${id}/asbuilt/${key}/`;
    const ready = await read(fileKey(id, cur.key, "index.json"));
    if (ready) return c.json({ status: "ready", key: cur.key, index: JSON.parse(ready.toString("utf8")), base: base(cur.key) });
    // Not painted for this plan yet: start it, and show the last painting meanwhile (surfaces that
    // haven't moved keep their paint; the rest are plain until it's done).
    const can = asBuiltEnabled() && cur.areas.length > 0;
    if (can) paintAsBuiltLater(id);
    const latest = await read(`${prefix(id)}/latest.json`);
    const last = latest ? (JSON.parse(latest.toString("utf8")) as { key: string }).key : null;
    const old = last && KEY.test(last) ? await read(fileKey(id, last, "index.json")) : null;
    return c.json({ status: can ? "painting" : old ? "ready" : "none", key: cur.key, ...(old && last ? { index: JSON.parse(old.toString("utf8")), base: base(last) } : {}) });
  });

  app.get("/api/scans/:id/asbuilt/:key/:file", async (c) => {
    const { id, key, file } = c.req.param();
    if (!UUID.test(id) || !KEY.test(key) || !FILE.test(file)) return c.json({ error: "Not found" }, 404);
    const body = await read(fileKey(id, key, file));
    if (!body) return c.json({ error: "Not found" }, 404);
    // A painting never changes under its key.
    return new Response(new Uint8Array(body), { headers: { "Content-Type": file.endsWith(".json") ? "application/json" : "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
  });
}
