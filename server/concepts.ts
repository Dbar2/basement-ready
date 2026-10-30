// "What it could look like" as photos: up to four of the homeowner's own frames, finished by Muse
// Image, then checked by SAM 3.1 so a window or the stairs never move in the picture. Every picture is
// labelled "virtually staged".
//
// All of them render at once, each is checked on its own, and each is announced the moment it lands.
// The job that starts them early, as soon as SAM's finds are in, is server/photos.ts.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { museEdit, samImage } from "./meta";
import type { Detection } from "./pipeline";
import { photoSpaces, type PhotoSpaces } from "./plans";
import type { Household } from "./rules";
import { parseSam } from "./sam";
import { half } from "./scan3d";
import { keys, storage } from "./storage";

const run = promisify(execFile);
const FPS = 5;

export type Concept = { n: number; frame: number; title: string; kept: boolean; checked: string };
export type Concepts = { status: "pending" | "done" | "failed"; items: Concept[] };

type Box = { x: number; y: number; w: number; h: number };
type FramePick = { frame: number; title: string; space: string };
// What the 3D says about a frame: how far it sees (median depth), how level the phone was (0 level,
// 1 straight up or down) and which area of the basement it's in.
export type FrameView = { depthM: number; tilt: number; area: number };

export const MAX_PHOTOS = 4;
const LEVEL = 0.35; // |forward.y| under this: a normal photo, not the ceiling or the floor
const WIDE_S = 1.5; // the still wide shot: frames this close to it

// Which frames to finish: where they said what they want, the room with the window as a bedroom, a wide
// view of the main living space, and another room or angle. With the 3D, each pick is the widest level
// frame near it (the one that sees farthest), so photos show the room, not a close-up. `spaces` says
// what each photo shows, from what they said they want it to be.
export function pickFrames(
  detections: Pick<Detection, "kind" | "frame" | "framesSeen" | "box" | "track">[],
  vision: { rooms: { room: string; atSeconds: number | null }[] } | null | undefined,
  household: string,
  frameCount: number,
  mainRoom: { startS: number; endS: number } | null = null,
  views: Map<number, FrameView> | null = null,
  wideAt: number | null = null, // seconds: when they held still in a corner for a wide shot
  spaces: PhotoSpaces = photoSpaces(null, household as Household),
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
    if (far(frame)) picks.push({ frame, ...spaces.bedroom });
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
    const still = wideAt == null ? null : widest(open.filter((f) => Math.abs(f / FPS - wideAt) <= WIDE_S));
    const living = still ?? widest(open.filter(inMain)) ?? widest(open);
    if (living != null) picks.push({ frame: living, ...spaces.living });
    // Another area if there is one, else the main room from another side.
    const areas = new Set(picks.map((p) => views.get(p.frame)?.area));
    const other = widest(open.filter((f) => !areas.has(views.get(f)!.area))) ?? widest(open);
    if (other != null) {
      const elsewhere = !areas.has(views.get(other)!.area);
      picks.push(elsewhere ? { frame: other, title: "The other room", space: "cosy den with a small home office" } : { frame: other, title: "Another angle", space: spaces.living.space });
    }
  } else if (picks.length < MAX_PHOTOS) {
    // Without the 3D: the still wide shot when there is one, the frame nearest the middle of the hold.
    const at = wideAt == null ? null : Math.round(wideAt * FPS);
    const still =
      at == null
        ? undefined
        : Array.from({ length: 2 * WIDE_S * FPS + 1 }, (_, i) => at + (i % 2 ? (i + 1) / 2 : -i / 2))
            .filter((f) => f >= 0 && f < frameCount)
            .find((f) => !busy.has(f) && far(f));
    // Else several things in view, none of them filling the frame, in the main room first.
    const wide = [...kinds.entries()]
      .filter(([f]) => !busy.has(f) && far(f) && (still == null || Math.abs(f - still) >= 25))
      .sort((a, b) => Number(inMain(b[0])) - Number(inMain(a[0])) || b[1].size - a[1].size)[0];
    if (still != null) picks.push({ frame: still, ...spaces.living });
    if (wide) picks.push(still != null ? { frame: wide[0], title: "Another angle", space: spaces.living.space } : { frame: wide[0], ...spaces.living });
  }
  return picks.slice(0, MAX_PHOTOS);
}

// How far each kept frame of the 3D sees and how level it is, from the stored scans. Areas whose 3D
// isn't saved yet are skipped, so this also works part-way through a scan.
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

export function conceptPrompt(space: string, style: string, wants = "") {
  return [
    `Renovate this unfinished basement photo into a finished ${space}.`,
    "Keep the exact same camera angle, room shape and ceiling height.",
    "Keep every window, door and stair exactly where it is and the same size. Do not add, remove or move any window, door or stair.",
    "Finish with smooth drywall walls and ceiling in warm white, light oak vinyl plank floor, slim recessed lights, simple modern furniture.",
    wants ? `The homeowner wants: "${wants.replace(/["\n]/g, " ")}".` : "",
    style ? `Feel: ${style}.` : "Feel: bright, calm and uncluttered.",
    "Photorealistic interior photo.",
  ]
    .filter(Boolean)
    .join(" ");
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

export async function boxesIn(jpeg: Buffer, concept: string): Promise<Box[]> {
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

// A JPEG's width and height, from its frame header.
export function jpegSize(jpeg: Buffer): [number, number] | null {
  let o = 2;
  while (o + 9 < jpeg.length && jpeg[o] === 0xff) {
    const marker = jpeg[o + 1];
    const len = jpeg.readUInt16BE(o + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [jpeg.readUInt16BE(o + 7), jpeg.readUInt16BE(o + 5)];
    o += 2 + len;
  }
  return null;
}

// Muse Image's picture back to the frame's own size, as a JPEG, so boxes line up and the page loads fast.
export async function toFrameJpeg(img: Buffer, w: number, h: number): Promise<Buffer> {
  const work = mkdtempSync(join(tmpdir(), "br-photo-"));
  try {
    writeFileSync(join(work, "in.bin"), img);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", join(work, "in.bin"), "-vf", `scale=${w}:${h}`, "-q:v", "3", join(work, "out.jpg")]);
    return readFileSync(join(work, "out.jpg"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export type PhotoWork = {
  frame: (n: number) => Promise<Buffer | null>;
  edit: (frame: Buffer, prompt: string, size: string) => Promise<Buffer>;
  resize: (img: Buffer, w: number, h: number) => Promise<Buffer>;
  boxes: (jpeg: Buffer, concept: string) => Promise<Box[]>;
  save: (n: number, jpeg: Buffer) => Promise<void>;
  landed: (c: Concept) => Promise<void>;
};

export const realWork = (scanId: string, landed: PhotoWork["landed"]): PhotoWork => ({
  frame: (n) => read(keys.frame(scanId, n)),
  edit: (frame, prompt, size) => museEdit(frame, "image/jpeg", prompt, size),
  resize: toFrameJpeg,
  boxes: boxesIn,
  save: (n, jpeg) => storage.put(keys.concept(scanId, n), jpeg, "image/jpeg"),
  landed,
});

type Anchor = { kind: string; box: Box };

// Every pick at once. Each tries Muse Image up to twice until SAM finds its windows and stairs where
// they were, and is saved and announced as soon as it's done, whatever the others are doing. One
// photo failing never costs the others; only when every one fails is it an error (and retried).
export async function renderPicks(picks: FramePick[], anchorsFor: (frame: number) => Anchor[], prompt: (space: string) => string, work: PhotoWork): Promise<Concept[]> {
  const errors: unknown[] = [];
  const done = await Promise.all(
    picks.map(async (p, i): Promise<Concept | null> => {
      try {
        return await renderPick(p, i + 1, anchorsFor(p.frame), prompt, work);
      } catch (err) {
        errors.push(err);
        console.error(`[concepts] photo ${i + 1}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }),
  );
  if (picks.length && errors.length === picks.length) throw errors[0];
  return done.filter((c): c is Concept => c !== null);
}

async function renderPick(p: FramePick, n: number, anchors: Anchor[], prompt: (space: string) => string, work: PhotoWork): Promise<Concept | null> {
  const frame = await work.frame(p.frame);
  if (!frame) return null;
  const [w, h] = jpegSize(frame) ?? [1280, 720];
  for (let attempt = 0; attempt < 2; attempt++) {
    const jpeg = await work.resize(await work.edit(frame, prompt(p.space), `${w}x${h}`), w, h);
    let kept = true;
    let checked = "Room shape kept";
    if (anchors.length) {
      const kinds = [...new Set(anchors.map((a) => a.kind))];
      const found = await Promise.all(kinds.map(async (k) => ({ k, boxes: await work.boxes(jpeg, k === "window" ? "basement window" : "staircase") })));
      kept = kinds.every((k) => keptInPlace(anchors.filter((a) => a.kind === k).map((a) => a.box), found.find((f) => f.k === k)!.boxes));
      checked = kept
        ? `${kinds.map((k) => (k === "window" ? "Windows" : "Stairs")).join(" and ")} kept where they are · checked by SAM 3.1`
        : "A window or the stairs moved in this picture: treat it as a mood, not a plan";
    }
    if (kept || attempt === 1) {
      await work.save(n, jpeg);
      const c = { n, frame: p.frame, title: p.title, kept, checked };
      await work.landed(c);
      return c;
    }
  }
  return null;
}

// What the photos are made from. With the answer out, its own reading; before that, the scan's finds
// as they were streamed, the still wide shot, who it's for and what they said they want.
export type PhotoInputs = {
  detections: Detection[];
  vision: { rooms: { room: string; atSeconds: number | null }[]; style?: string } | null;
  household: Household;
  frameCount: number;
  rooms: { index: number; has3d: boolean }[];
  mainRoom: { startS: number; endS: number } | null;
  wideAt: number | null;
  plans: string | null;
};

const anchorsIn = (detections: Detection[]) => (frame: number): Anchor[] =>
  detections
    .filter((d) => d.kind === "window" || d.kind === "stairs")
    .flatMap((d) => d.track.filter((t) => t[0] === frame).map((t) => ({ kind: d.kind, box: { x: t[1], y: t[2], w: t[3], h: t[4] } })));

export async function renderConcepts(scanId: string, result: any, landed: PhotoWork["landed"] = async () => {}): Promise<Concept[]> {
  const inputs: PhotoInputs = {
    detections: result.detections ?? [],
    vision: result.vision ?? null,
    household: result.household ?? "unsure",
    frameCount: result.frameCount ?? 0,
    rooms: result.rooms ?? [],
    mainRoom: (result.rooms ?? []).find((r: { index: number }) => r.index === result.mainRoom) ?? null,
    wideAt: result.capture?.wideAt ?? null,
    plans: result.plans ?? null,
  };
  return renderFrom(scanId, inputs, realWork(scanId, landed));
}

export async function renderFrom(scanId: string, f: PhotoInputs, work: PhotoWork) {
  const views = await frameViews(scanId, f.rooms).catch(() => null);
  const spaces = photoSpaces(f.plans, f.household);
  const picks = pickFrames(f.detections, f.vision, f.household, f.frameCount, f.mainRoom, views, f.wideAt, spaces);
  return renderPicks(picks, anchorsIn(f.detections), (space) => conceptPrompt(space, f.vision?.style ?? "", spaces.note), work);
}
