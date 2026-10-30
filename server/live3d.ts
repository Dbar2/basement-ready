// The 3D scan assembling while you film. The live-finds frames are kept per recording, each with the
// compass heading the phone had; whenever a few new ones arrive, the 3D service rebuilds a small
// preview cloud from a spread of them, and the phone fetches the newest, with the map it draws:
// where the camera stood and looked, the room box and which of its sides were never filmed.
// Best-effort: without a 3D service, nothing here runs.
import { scan3dEnabled } from "./scan3d";

const URL_ = process.env.SCAN3D_URL;
const TOKEN = process.env.SCAN3D_TOKEN;
const PREVIEW_FRAMES = Number(process.env.LIVE3D_FRAMES ?? 12); // Mac: ~10–15 s per rebuild; on a GPU, raise it
const PREVIEW_POINTS = 30_000;
const NEW_FRAMES_TO_REBUILD = 4;
const KEEP_FRAMES = 260; // a 5-minute take, one frame every 1.2 s
const IDLE_MS = 10 * 60 * 1000;

// One spot on the camera's path, in the room frame (metres): where it stood, and which way it faced
// in degrees clockwise from -Z seen from above (the map's "up"). `heading` is the phone's compass then.
export type MapPoint = { x: number; z: number; yaw: number; heading: number | null; seq: number };
export type Side = "minX" | "maxX" | "minZ" | "maxZ";
export type LiveMap = {
  // "extent": no wall was ever seen on that side; the box just reaches as far as the points do.
  box: { min: [number, number, number]; max: [number, number, number]; sides: Record<Side, "wall" | "extent"> } | null;
  walls: [[number, number], [number, number]][];
  path: MapPoint[]; // in the order filmed
  newest: MapPoint | null; // the newest frame the service kept
  newestView: number | null; // its index in the cloud's per-point view numbers
  ceiling: boolean; // a ceiling plane was found
};

type Preview = {
  version: number;
  count: number;
  positions: Buffer; // float32 x,y,z
  colors: Buffer; // uint8 r,g,b
  views: Buffer; // uint8: which of the rebuild's views each point came from
  meta: { views: number; framesSeen: number; wallsSeen: number; ceilingHeightM: number | null; widthM: number | null; depthM: number | null; ms: number; map: LiveMap };
};

type Frame = { jpeg: Buffer; heading: number | null; seq: number };
type Session = { frames: Frame[]; seq: number; newSince: number; running: boolean; preview: Preview | null; touched: number };

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
  const views = Buffer.alloc(count);
  for (let i = 0; i < count; i++) {
    const o = i * 17;
    positions.writeFloatLE(view.getFloat32(o, true), i * 12);
    positions.writeFloatLE(view.getFloat32(o + 4, true), i * 12 + 4);
    positions.writeFloatLE(view.getFloat32(o + 8, true), i * 12 + 8);
    colors[i * 3] = view.getUint8(o + 12);
    colors[i * 3 + 1] = view.getUint8(o + 13);
    colors[i * 3 + 2] = view.getUint8(o + 14);
    views[i] = Math.min(255, view.getUint16(o + 15, true));
  }
  return { count, positions, colors, views };
}

type ScanFrame = { index: number; sourceIndex: number; pose: number[][] };
type ScanJson = {
  frames?: ScanFrame[];
  room?: { ceiling?: unknown; box?: { min: number[]; max: number[]; sides: Record<Side, string> }; walls?: { segment: number[][] }[] };
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

// Where a camera stood and which way its holder faced, from its camera-to-room pose (OpenCV axes:
// x right, y down, z forward). Pointed at the ceiling or floor, the top of the picture says which
// way they face: away from them looking down, toward them looking up.
export function placeOf(pose: number[][]): { x: number; z: number; yaw: number } {
  const f = [pose[0][2], pose[1][2], pose[2][2]];
  const up = [-pose[0][1], -pose[1][1], -pose[2][1]];
  const fx = f[0] - f[1] * up[0];
  const fz = f[2] - f[1] * up[2];
  const yaw = (Math.atan2(fx, -fz) * 180) / Math.PI;
  return { x: r3(pose[0][3]), z: r3(pose[2][3]), yaw: Math.round(((yaw % 360) + 360) % 360 * 10) / 10 };
}

// The map from one rebuild: each kept frame is looked up by its place in the request (the service
// keeps only the sharpest), so its compass heading and order come from the frames we sent.
export function mapOf(scan: ScanJson, sent: { heading: number | null; seq: number }[]): LiveMap {
  const kept = (scan.frames ?? []).filter((f) => Array.isArray(f.pose) && f.pose.length >= 3 && sent[f.sourceIndex]);
  const path = kept
    .map((f) => ({ view: f.index, point: { ...placeOf(f.pose), heading: sent[f.sourceIndex].heading, seq: sent[f.sourceIndex].seq } }))
    .sort((a, b) => a.point.seq - b.point.seq);
  const box = scan.room?.box;
  const side = (v: string | undefined) => (v === "wall" ? "wall" : "extent");
  return {
    box:
      box && box.min?.length === 3 && box.max?.length === 3
        ? {
            min: box.min.map(r3) as [number, number, number],
            max: box.max.map(r3) as [number, number, number],
            sides: { minX: side(box.sides?.minX), maxX: side(box.sides?.maxX), minZ: side(box.sides?.minZ), maxZ: side(box.sides?.maxZ) },
          }
        : null,
    walls: (scan.room?.walls ?? [])
      .filter((w) => w.segment?.length === 2)
      .map((w) => w.segment.map(([x, z]) => [r3(x), r3(z)]) as [[number, number], [number, number]]),
    path: path.map((p) => p.point),
    newest: path.at(-1)?.point ?? null,
    newestView: path.at(-1)?.view ?? null,
    ceiling: Boolean(scan.room?.ceiling),
  };
}

// A spread across everything filmed so far, always ending on the newest frame.
function pick(frames: Frame[], n: number) {
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
    chosen.forEach((f, i) => form.append("frames", new Blob([new Uint8Array(f.jpeg)], { type: "image/jpeg" }), `${String(i).padStart(4, "0")}.jpg`));
    form.append("options", JSON.stringify({ maxFrames: PREVIEW_FRAMES, maxPoints: PREVIEW_POINTS, skipDepth: true }));
    const res = await fetch(`${URL_}/scan`, { method: "POST", body: form, headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`scan3d ${res.status}`);
    const parts = await res.formData();
    const scan = JSON.parse(await (parts.get("scan") as File).text());
    const cloud = parsePly(await (parts.get("points") as File).arrayBuffer());
    const map = mapOf(scan, chosen);
    s.preview = {
      version: (s.preview?.version ?? 0) + 1,
      ...cloud,
      meta: {
        views: chosen.length,
        framesSeen: s.frames.length,
        wallsSeen: map.box ? Object.values(map.box.sides).filter((x) => x === "wall").length : 0,
        ceilingHeightM: scan.room?.ceilingHeightM ?? null,
        widthM: scan.room?.widthM ?? null,
        depthM: scan.room?.depthM ?? null,
        ms: Date.now() - started,
        map,
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

// `heading`: the phone's compass when it took the frame, if it has one, so the map can turn with it.
export function addLiveFrame(id: string, jpeg: Buffer, heading: number | null = null) {
  if (!scan3dEnabled) return;
  let s = sessions.get(id);
  if (!s) {
    s = { frames: [], seq: 0, newSince: 0, running: false, preview: null, touched: Date.now() };
    sessions.set(id, s);
  }
  s.touched = Date.now();
  s.frames.push({ jpeg, heading: heading != null && Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null, seq: s.seq++ });
  if (s.frames.length > KEEP_FRAMES) s.frames.splice(1, 1); // keep the first view; it anchors the room
  s.newSince++;
  if (!s.running && s.newSince >= NEW_FRAMES_TO_REBUILD && s.frames.length >= 4) void rebuild(id, s);
}

// The newest preview as one binary body: [4-byte JSON length][JSON][positions][colors][views].
export function livePreview(id: string, since: number): Buffer | null {
  const s = sessions.get(id);
  if (!s?.preview || s.preview.version <= since) return null;
  s.touched = Date.now();
  const p = s.preview;
  const json = Buffer.from(JSON.stringify({ version: p.version, count: p.count, ...p.meta, rebuilding: s.running }));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length, 0);
  return Buffer.concat([head, json, p.positions, p.colors, p.views]);
}

export const live3dEnabled = scan3dEnabled;
