// "What it could look like" as photos: one or two of the homeowner's own frames, finished by Muse
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
import { keys, storage } from "./storage";

const run = promisify(execFile);
const FPS = 5;

export type Concept = { n: number; frame: number; title: string; kept: boolean; checked: string };

type Box = { x: number; y: number; w: number; h: number };
type FramePick = { frame: number; title: string; space: string };

// Which frames to finish: where they said what they want, else the room with the window, and a wide view.
export function pickFrames(
  detections: Pick<Detection, "kind" | "frame" | "framesSeen" | "box" | "track">[],
  vision: { rooms: { room: string; atSeconds: number | null }[] } | null | undefined,
  household: string,
  frameCount: number,
  mainRoom: { startS: number; endS: number } | null = null,
): FramePick[] {
  const picks: FramePick[] = [];
  const far = (f: number) => picks.every((p) => Math.abs(p.frame - f) >= 25);
  for (const w of vision?.rooms ?? []) {
    if (w.atSeconds == null || picks.length >= 2) continue;
    const frame = Math.min(frameCount - 1, Math.round(w.atSeconds * FPS));
    if (far(frame)) picks.push({ frame, title: w.room.charAt(0).toUpperCase() + w.room.slice(1), space: w.room });
  }
  // A window in clear view: the room becomes the bedroom, which needs that window.
  const window = detections
    .filter((d) => d.kind === "window" && d.box.w > 0.06 && d.box.w < 0.6)
    .sort((a, b) => b.framesSeen - a.framesSeen)[0];
  if (picks.length < 2 && window && far(window.frame)) {
    const forParent = household === "relative";
    picks.push({ frame: window.frame, title: forParent ? "A bedroom for your parent" : "The bedroom", space: forParent ? "calm bedroom for an older parent" : "bedroom" });
  }
  // A wide look at the main living space: several things in view, none of them filling the frame,
  // and not the furnace corner (that stays a service room).
  if (picks.length < 2) {
    const inView = new Map<number, { kinds: Set<string>; close: boolean; service: boolean }>();
    for (const d of detections) {
      for (const t of d.track) {
        const v = inView.get(t[0]) ?? { kinds: new Set<string>(), close: false, service: false };
        v.kinds.add(d.kind);
        if (t[3] * t[4] > 0.2) v.close = true;
        if (d.kind === "mechanical") v.service = true;
        inView.set(t[0], v);
      }
    }
    const inMain = (f: number) => !mainRoom || (f / FPS >= mainRoom.startS && f / FPS < mainRoom.endS);
    const wide = [...inView.entries()]
      .filter(([f, v]) => !v.close && !v.service && far(f))
      .sort((a, b) => Number(inMain(b[0])) - Number(inMain(a[0])) || b[1].kinds.size - a[1].kinds.size)[0];
    if (wide) picks.push({ frame: wide[0], title: "Living and kitchen", space: "open living room with a small modern kitchen" });
  }
  return picks.slice(0, 2);
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
  const picks = pickFrames(result.detections ?? [], result.vision, result.household ?? "unsure", result.frameCount ?? 0, main);
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
