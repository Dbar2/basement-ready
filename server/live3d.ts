// The 3D scan assembling while you film. The live-finds frames are kept per recording; whenever a
// few new ones arrive, the 3D service rebuilds a small preview cloud from a spread of them, and the
// phone fetches the newest. Best-effort: without a 3D service, nothing here runs.
import { scan3dEnabled } from "./scan3d";

const URL_ = process.env.SCAN3D_URL;
const TOKEN = process.env.SCAN3D_TOKEN;
const PREVIEW_FRAMES = Number(process.env.LIVE3D_FRAMES ?? 12); // Mac: ~10–15 s per rebuild; on a GPU, raise it
const PREVIEW_POINTS = 30_000;
const NEW_FRAMES_TO_REBUILD = 4;
const KEEP_FRAMES = 160;
const IDLE_MS = 10 * 60 * 1000;

type Preview = {
  version: number;
  count: number;
  positions: Buffer; // float32 x,y,z
  colors: Buffer; // uint8 r,g,b
  meta: { views: number; framesSeen: number; wallsSeen: number; ceilingHeightM: number | null; widthM: number | null; depthM: number | null; ms: number };
};

type Session = { frames: Buffer[]; newSince: number; running: boolean; preview: Preview | null; touched: number };

const sessions = new Map<string, Session>();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.touched > IDLE_MS) sessions.delete(id);
}, 60_000).unref();

// Binary PLY from the 3D service: x y z float32, r g b uint8, frame uint16 (17 bytes a point).
function parsePly(ply: ArrayBuffer) {
  const bytes = new Uint8Array(ply);
  const headerEnd = Buffer.from(bytes).indexOf("end_header\n") + "end_header\n".length;
  const header = Buffer.from(bytes.subarray(0, headerEnd)).toString("latin1");
  const count = Number(header.match(/element vertex (\d+)/)?.[1] ?? 0);
  const view = new DataView(ply, headerEnd);
  const positions = Buffer.alloc(count * 12);
  const colors = Buffer.alloc(count * 3);
  for (let i = 0; i < count; i++) {
    const o = i * 17;
    positions.writeFloatLE(view.getFloat32(o, true), i * 12);
    positions.writeFloatLE(view.getFloat32(o + 4, true), i * 12 + 4);
    positions.writeFloatLE(view.getFloat32(o + 8, true), i * 12 + 8);
    colors[i * 3] = view.getUint8(o + 12);
    colors[i * 3 + 1] = view.getUint8(o + 13);
    colors[i * 3 + 2] = view.getUint8(o + 14);
  }
  return { count, positions, colors };
}

// A spread across everything filmed so far, always ending on the newest frame.
function pick(frames: Buffer[], n: number) {
  if (frames.length <= n) return frames;
  return Array.from({ length: n }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (n - 1))]);
}

async function rebuild(id: string, s: Session) {
  s.running = true;
  s.newSince = 0;
  const started = Date.now();
  try {
    const chosen = pick(s.frames, PREVIEW_FRAMES);
    const form = new FormData();
    chosen.forEach((jpeg, i) => form.append("frames", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), `${String(i).padStart(4, "0")}.jpg`));
    form.append("options", JSON.stringify({ maxFrames: PREVIEW_FRAMES, maxPoints: PREVIEW_POINTS, skipDepth: true }));
    const res = await fetch(`${URL_}/scan`, { method: "POST", body: form, headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`scan3d ${res.status}`);
    const parts = await res.formData();
    const scan = JSON.parse(await (parts.get("scan") as File).text());
    const cloud = parsePly(await (parts.get("points") as File).arrayBuffer());
    const sides = Object.values(scan.room?.box?.sides ?? {}) as string[];
    s.preview = {
      version: (s.preview?.version ?? 0) + 1,
      ...cloud,
      meta: {
        views: chosen.length,
        framesSeen: s.frames.length,
        wallsSeen: sides.filter((x) => x === "wall").length,
        ceilingHeightM: scan.room?.ceilingHeightM ?? null,
        widthM: scan.room?.widthM ?? null,
        depthM: scan.room?.depthM ?? null,
        ms: Date.now() - started,
      },
    };
  } catch (err) {
    console.error(`[live3d] ${id}: ${err instanceof Error ? err.message : err}`);
  } finally {
    s.running = false;
    // Frames that arrived during the rebuild start the next one straight away.
    if (sessions.get(id) === s && s.newSince >= NEW_FRAMES_TO_REBUILD) void rebuild(id, s);
  }
}

export function addLiveFrame(id: string, jpeg: Buffer) {
  if (!scan3dEnabled) return;
  let s = sessions.get(id);
  if (!s) {
    s = { frames: [], newSince: 0, running: false, preview: null, touched: Date.now() };
    sessions.set(id, s);
  }
  s.touched = Date.now();
  s.frames.push(jpeg);
  if (s.frames.length > KEEP_FRAMES) s.frames.splice(1, 1); // keep the first view; it anchors the room
  s.newSince++;
  if (!s.running && s.newSince >= NEW_FRAMES_TO_REBUILD && s.frames.length >= 4) void rebuild(id, s);
}

// The newest preview as one binary body: [4-byte JSON length][JSON][positions][colors].
export function livePreview(id: string, since: number): Buffer | null {
  const s = sessions.get(id);
  if (!s?.preview || s.preview.version <= since) return null;
  s.touched = Date.now();
  const p = s.preview;
  const json = Buffer.from(JSON.stringify({ version: p.version, count: p.count, ...p.meta, rebuilding: s.running }));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length, 0);
  return Buffer.concat([head, json, p.positions, p.colors]);
}

export const live3dEnabled = scan3dEnabled;
