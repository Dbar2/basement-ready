// "What it could look like" as photos: up to four of the homeowner's own frames, finished by Muse
// Image, then checked by SAM 3.1 so a window or the stairs never move in the picture. Runs as its
// own job after the answer, so nobody waits for it. Every picture is labelled "virtually staged".
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { museEdit, samImage } from "./meta";
import type { Detection } from "./pipeline";
import { parseSam } from "./sam";
import { half } from "./scan3d";
import { keys, storage } from "./storage";

const run = promisify(execFile);
const FPS = 5;

export type Concept = { n: number; frame: number; title: string; kept: boolean; checked: string };

type Box = { x: number; y: number; w: number; h: number };
type FramePick = { frame: number; title: string; space: string };
// What the 3D says about a frame: how far it sees (median depth), how level the phone was (0 level,
// 1 straight up or down) and which area of the basement it's in.
export type FrameView = { depthM: number; tilt: number; area: number };

export const MAX_PHOTOS = 4;
const LEVEL = 0.35; // |forward.y| under this: a normal photo, not the ceiling or the floor

// Which frames to finish: where they said what they want, the room with the window as a bedroom, a wide
// view of the main living space, and another room or angle. With the 3D, each pick is the widest level
// frame near it (the one that sees farthest), so photos show the room, not a close-up.
export function pickFrames(
  detections: Pick<Detection, "kind" | "frame" | "framesSeen" | "box" | "track">[],
  vision: { rooms: { room: string; atSeconds: number | null }[] } | null | undefined,
  household: string,
  frameCount: number,
  mainRoom: { startS: number; endS: number } | null = null,
  views: Map<number, FrameView> | null = null,
  wideAt: number | null = null, // seconds: when they held still in a corner for a wide shot
): FramePick[] {
  const picks: FramePick[] = [];
  const far = (f: number) => picks.every((p) => Math.abs(p.frame - f) >= 25);
  const widest = (frames: number[]) =>
    frames.filter((f) => far(f) && (views?.get(f)?.tilt ?? 1) < LEVEL).sort((a, b) => views!.get(b)!.depthM - views!.get(a)!.depthM)[0];
  for (const w of vision?.rooms ?? []) {
    if (w.atSeconds == null || picks.length >= 2) continue;
    const said = Math.min(frameCount - 1, Math.round(w.atSeconds * FPS));
    const frame = (views && widest([...views.keys()].filter((f) => Math.abs(f - said) <= 12))) ?? said;
    if (far(frame)) picks.push({ frame, title: w.room.charAt(0).toUpperCase() + w.room.slice(1), space: w.room });
  }
  // A window in clear view: the room becomes the bedroom, which needs that window. Its photo is the
  // frame that shows the whole window from farthest back.
  const window = detections
    .filter((d) => d.kind === "window" && d.box.w > 0.06 && d.box.w < 0.6)
    .sort((a, b) => b.framesSeen - a.framesSeen)[0];
  if (window) {
    const whole = window.track.filter((t) => t[1] > 0.01 && t[2] > 0.01 && t[1] + t[3] < 0.99 && t[2] + t[4] < 0.99);
    const frame =
      (views && widest(whole.map((t) => t[0]).filter((f) => views.has(f)))) ??
      [...whole].sort((a, b) => a[3] * a[4] - b[3] * b[4]).find((t) => far(t[0]) && t[3] > 0.06)?.[0] ??
      window.frame;
    if (far(frame)) {
      const forParent = household === "relative";
      picks.push({ frame, title: forParent ? "A bedroom for your parent" : "The bedroom", space: forParent ? "calm bedroom for an older parent" : "bedroom" });
    }
  }
  const inMain = (f: number) => !mainRoom || (f / FPS >= mainRoom.startS && f / FPS < mainRoom.endS);
  // Frames with the furnace or panel in them stay a service room; frames with something filling the
  // picture are close-ups.
  const busy = new Set<number>();
  const kinds = new Map<number, Set<string>>();
  for (const d of detections) {
    for (const t of d.track) {
      if (d.kind === "mechanical" || t[3] * t[4] > 0.2) busy.add(t[0]);
      kinds.set(t[0], (kinds.get(t[0]) ?? new Set()).add(d.kind));
    }
  }
  if (views) {
    const open = [...views.keys()].filter((f) => !busy.has(f));
    // The still wide shot from a corner is made for this photo.
    const still = wideAt == null ? null : widest(open.filter((f) => Math.abs(f / FPS - wideAt) <= 1.5));
    const living = still ?? widest(open.filter(inMain)) ?? widest(open);
    if (living != null) picks.push({ frame: living, title: "Living and kitchen", space: "open living room with a small modern kitchen" });
    // Another area if there is one, else the main room from another side.
    const areas = new Set(picks.map((p) => views.get(p.frame)?.area));
    const other = widest(open.filter((f) => !areas.has(views.get(f)!.area))) ?? widest(open);
    if (other != null) {
      const elsewhere = !areas.has(views.get(other)!.area);
      picks.push(
        elsewhere
          ? { frame: other, title: "The other room", space: "cosy den with a small home office" }
          : { frame: other, title: "Another angle", space: "open living room with a small modern kitchen" },
      );
    }
  } else if (picks.length < MAX_PHOTOS) {
    // Without the 3D: several things in view, none of them filling the frame, in the main room first.
    const wide = [...kinds.entries()]
      .filter(([f]) => !busy.has(f) && far(f))
      .sort((a, b) => Number(inMain(b[0])) - Number(inMain(a[0])) || b[1].size - a[1].size)[0];
    if (wide) picks.push({ frame: wide[0], title: "Living and kitchen", space: "open living room with a small modern kitchen" });
  }
  return picks.slice(0, MAX_PHOTOS);
}

// How far each kept frame of the 3D sees and how level it is, from the stored scans.
export async function frameViews(scanId: string, rooms: { index: number; has3d: boolean }[]): Promise<Map<number, FrameView> | null> {
  const views = new Map<number, FrameView>();
  for (const room of rooms.filter((r) => r.has3d)) {
    const [json, depth] = await Promise.all([read(keys.scan3d(scanId, "scan.json", room.index)), read(keys.scan3d(scanId, "depth.bin", room.index))]);
    if (!json || !depth) continue;
    const scan = JSON.parse(json.toString("utf8"));
    const [, H, W] = scan.files.depth.shape as number[];
    for (const f of scan.frames as { sourceIndex: number; depthOffset: number; pose: number[][] }[]) {
      const ours = scan.sentFrames?.[f.sourceIndex];
      if (ours == null) continue;
      const z: number[] = [];
      for (let i = 0; i < H * W; i += 7) {
        const v = half(depth.readUInt16LE(f.depthOffset + i * 2));
        if (v > 0) z.push(v);
      }
      if (z.length < 50) continue;
      z.sort((a, b) => a - b);
      views.set(ours, { depthM: z[Math.floor(z.length / 2)], tilt: Math.abs(f.pose[1][2]), area: room.index });
    }
  }
  return views.size ? views : null;
}

export function conceptPrompt(space: string, style: string) {
  return [
    `Renovate this unfinished basement photo into a finished ${space}.`,
    "Keep the exact same camera angle, room shape and ceiling height.",
    "Keep every window, door and stair exactly where it is and the same size. Do not add, remove or move any window, door or stair.",
    "Finish with smooth drywall walls and ceiling in warm white, light oak vinyl plank floor, slim recessed lights, simple modern furniture.",
    style ? `Feel: ${style}.` : "Feel: bright, calm and uncluttered.",
    "Photorealistic interior photo.",
  ].join(" ");
}

const iou = (a: Box, b: Box) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

// Every window and stair SAM saw in the original is still there, about where it was.
export function keptInPlace(original: Box[], found: Box[], minIou = 0.2) {
  return original.every((o) => found.some((f) => iou(o, f) >= minIou));
}

async function boxesIn(jpeg: Buffer, concept: string): Promise<Box[]> {
  const raw = await samImage(concept, `data:image/jpeg;base64,${jpeg.toString("base64")}`).catch(() => "");
  return parseSam(raw)
    .map((t) => t.frames[0]?.box)
    .filter((b): b is NonNullable<typeof b> => Boolean(b) && (b.c ?? 1) >= 0.4)
    .map((b) => ({ x: b.x1 / b.w, y: b.y1 / b.h, w: (b.x2 - b.x1) / b.w, h: (b.y2 - b.y1) / b.h }));
}

async function read(key: string) {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

export async function renderConcepts(scanId: string, result: any): Promise<Concept[]> {
  const main = (result.rooms ?? []).find((r: { index: number }) => r.index === result.mainRoom) ?? null;
  const views = await frameViews(scanId, result.rooms ?? []).catch(() => null);
  const picks = pickFrames(result.detections ?? [], result.vision, result.household ?? "unsure", result.frameCount ?? 0, main, views, result.capture?.wideAt ?? null);
  const work = join(tmpdir(), "basement-ready", `concepts-${scanId}`);
  mkdirSync(work, { recursive: true });
  const out: Concept[] = [];
  try {
    for (const p of picks) {
      const frame = await read(keys.frame(scanId, p.frame));
      if (!frame) continue;
      writeFileSync(join(work, "in.jpg"), frame);
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(work, "in.jpg")]);
      const [w, h] = stdout.trim().split(",").map(Number);
      // What SAM saw in the original frame: these must survive the makeover.
      const anchors = (result.detections as Detection[])
        .filter((d) => d.kind === "window" || d.kind === "stairs")
        .flatMap((d) => d.track.filter((t) => t[0] === p.frame).map((t) => ({ kind: d.kind, box: { x: t[1], y: t[2], w: t[3], h: t[4] } })));
      let kept = false;
      let checked = "Room shape kept";
      for (let attempt = 0; attempt < 2 && !kept; attempt++) {
        const img = await museEdit(frame, "image/jpeg", conceptPrompt(p.space, result.vision?.style ?? ""), `${w}x${h}`);
        writeFileSync(join(work, "out.bin"), img);
        // Back to the frame's own size, as a JPEG, so boxes line up and the page loads fast.
        await run("ffmpeg", ["-y", "-loglevel", "error", "-i", join(work, "out.bin"), "-vf", `scale=${w}:${h}`, "-q:v", "3", join(work, "out.jpg")]);
        const jpeg = readFileSync(join(work, "out.jpg"));
        if (anchors.length === 0) {
          kept = true;
        } else {
          const kinds = [...new Set(anchors.map((a) => a.kind))];
          const found = await Promise.all(kinds.map(async (k) => ({ k, boxes: await boxesIn(jpeg, k === "window" ? "basement window" : "staircase") })));
          kept = kinds.every((k) => keptInPlace(anchors.filter((a) => a.kind === k).map((a) => a.box), found.find((f) => f.k === k)!.boxes));
          checked = kept
            ? `${kinds.map((k) => (k === "window" ? "Windows" : "Stairs")).join(" and ")} kept where they are · checked by SAM 3.1`
            : "A window or the stairs moved in this picture: treat it as a mood, not a plan";
        }
        if (kept || attempt === 1) {
          const n = out.length + 1;
          await storage.put(keys.concept(scanId, n), jpeg, "image/jpeg");
          out.push({ n, frame: p.frame, title: p.title, kept, checked });
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return out;
}
