// Things SAM 3.1 can't find by name (a furnace, a bulkhead, a plumbing rough-in) and finds only now and
// then (a water heater, an electrical panel): Muse Spark points at each one it sees, and SAM outlines it
// from that point (a point prompt, dev.meta.ai/docs/sam/segmenting). In a photo Spark looks at the photo.
// In a video the watch pass (server/watch.ts) says when each was filmed, Spark points on a frame there, and
// SAM tracks it through the whole video from that point, all of them in one request. An outline over most
// of the picture, or an unsure one, is dropped rather than shown. Checked with scripts/practice.
import { readReply, responses, samImage, samVideo, tokenCost } from "./meta";
import type { Detection } from "./pipeline";
import { bestFrame, parseSam, type SamBox, type SamTrack } from "./sam";
import { PRICES } from "./spend";
import type { Watch } from "./watch";

export const POINT_MODEL = "muse-spark-1.3";

export const POINTED = [
  { key: "furnace", concept: "furnace", kind: "mechanical", label: "Furnace", say: "a furnace: the metal cabinet that heats the house, with ducts or white plastic pipes on top" },
  { key: "water_heater", concept: "water heater", kind: "mechanical", label: "Water heater", say: "a water heater: a tall round tank" },
  { key: "electrical_panel", concept: "electrical panel", kind: "mechanical", label: "Electrical panel", say: "an electrical panel: the breaker box on a wall" },
  { key: "plumbing_rough_in", concept: "plumbing rough-in", kind: "mechanical", label: "Plumbing rough-in", say: "a plumbing rough-in: short capped drain pipes coming straight up out of the concrete floor for a future bathroom, not a bucket, a paint can, a drum or a post" },
  { key: "bulkhead", concept: "ceiling bulkhead", kind: "duct", label: "Bulkhead", say: "a bulkhead: a boxed-in drywall soffit along the ceiling, lower than the rest of it, not a bare metal duct, a beam or a joist" },
] as const;
export type PointKey = (typeof POINTED)[number]["key"];
const BY_KEY = Object.fromEntries(POINTED.map((p) => [p.key, p])) as Record<PointKey, (typeof POINTED)[number]>;

// SAM also finds these by name (server/pipeline.ts CONCEPTS): a pointed one counts only where the name found
// nothing on it.
const BY_NAME_TOO = new Set(["Water heater", "Electrical panel"]);
// An outline this unsure, or over this much of the picture, is the wrong thing or the whole room.
export const MIN_C = 0.35;
export const MAX_AREA = 0.6;

// Where Spark puts it, 0..1 of the picture: the box around it, and its middle. SAM is given the box: from
// a single point it outlines whatever that pixel belongs to, which can be a sticker on a furnace, and on
// practice photos boxes found more with fewer false finds.
export type Point = { key: PointKey; x: number; y: number; box?: [number, number, number, number] };
export type Found = { finds: Detection[]; costUsd: number };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const keyOf = (v: unknown): PointKey | null => (typeof v === "string" && v in BY_KEY ? (v as PointKey) : null);

function json(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON in the reply");
  return JSON.parse(text.slice(start, end + 1));
}

// ---- Photos ----------------------------------------------------------------------------------------

export const photoQuestion = () => `This is a photo of a basement. Give a box around each of these you can see in it:
${POINTED.map((p) => `- "${p.key}": ${p.say}`).join("\n")}
The box is just big enough to hold the whole thing. Leave out anything you can't see clearly; never guess.
Reply with JSON only: {"found":[{"kind":"furnace","x1":0-1000,"y1":0-1000,"x2":0-1000,"y2":0-1000}]} where x1, y1 is the box's top left and x2, y2 its bottom right, across and down the photo, times 1000. {"found":[]} when there is none.`;

const in1000 = (...v: (number | null)[]) => v.every((n) => n != null && n >= 0 && n <= 1000);

// A box (x1..y2) or a point (x, y), 0..1000; a box's middle is its point.
export function readMark(f: any): Omit<Point, "key"> | null {
  const [x1, y1, x2, y2] = [num(f?.x1), num(f?.y1), num(f?.x2), num(f?.y2)];
  if (in1000(x1, y1, x2, y2) && x2! > x1! && y2! > y1!) {
    const box: [number, number, number, number] = [x1! / 1000, y1! / 1000, x2! / 1000, y2! / 1000];
    return { x: Math.round((box[0] + box[2]) * 500) / 1000, y: Math.round((box[1] + box[3]) * 500) / 1000, box };
  }
  const [x, y] = [num(f?.x), num(f?.y)];
  return in1000(x, y) ? { x: x! / 1000, y: y! / 1000 } : null;
}

export function readPoints(text: string): Point[] {
  const found = json(text)?.found;
  if (!Array.isArray(found)) throw new Error("No found list");
  return found.flatMap((f: any) => {
    const key = keyOf(f?.kind);
    const m = readMark(f);
    return key && m ? [{ key, ...m }] : [];
  });
}

type Ask = (body: unknown) => Promise<any>;

// Spark's marks on one photo. A reply it can't read counts as none.
export async function pointsIn(imageUrl: string, ask: Ask = responses): Promise<{ points: Point[]; costUsd: number }> {
  const r = await ask({ model: POINT_MODEL, input: [{ role: "user", content: [{ type: "input_text", text: photoQuestion() }, { type: "input_image", image_url: imageUrl }] }] });
  const costUsd = tokenCost(POINT_MODEL, r?.usage)?.usd ?? 0;
  try {
    return { points: readReply(r, readPoints), costUsd };
  } catch {
    return { points: [], costUsd };
  }
}

// SAM's prompt text: one object per mark (a box, else a point), numbered from 1, grouped by frame in order.
export function pointPrompt(points: { frame: number; x: number; y: number; box?: [number, number, number, number] }[], w: number, h: number): string {
  const byFrame = new Map<number, string[]>();
  const px = (v: number, size: number) => Math.round(Math.min(size - 1, Math.max(0, v * size)));
  points.forEach((p, i) => {
    const token = p.box
      ? `${i + 1}<|box;x1=${px(p.box[0], w)};y1=${px(p.box[1], h)};x2=${px(p.box[2], w)};y2=${px(p.box[3], h)};w=${w};h=${h}|>`
      : `${i + 1}<|point;x=${px(p.x, w)};y=${px(p.y, h)};w=${w};h=${h}|>`;
    byFrame.set(p.frame, [...(byFrame.get(p.frame) ?? []), token]);
  });
  return [...byFrame.entries()].sort((a, b) => a[0] - b[0]).map(([f, tokens]) => `<${f}f>${tokens.join("")}`).join("");
}

const fair = (b: SamBox) => (b.c ?? 1) >= MIN_C && ((b.x2 - b.x1) * (b.y2 - b.y1)) / (b.w * b.h) <= MAX_AREA;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const slug = (label: string) => label.toLowerCase().replace(/\s+/g, "-");

// Spark marks, SAM outlines: one photo's pointed finds, in the shape of its other finds.
export async function pointInPhoto(frame: number, imageUrl: string, w: number, h: number, ask: Ask = responses, sam = samImage): Promise<Found> {
  const { points, costUsd } = await pointsIn(imageUrl, ask);
  // One request a mark: two marks in one photo share out the pixels between them (a furnace's went to the
  // water heater beside it), and a photo seldom has more than two.
  const boxes = await Promise.all(
    points.map(async (p) => parseSam(await sam(pointPrompt([{ frame: 0, ...p }], w, h), imageUrl).catch(() => "")).find((t) => t.id === 1)?.frames[0]?.box),
  );
  const counts = new Map<string, number>();
  const finds = points.flatMap((p, i): Detection[] => {
    const b = boxes[i];
    if (!b || !fair(b)) return [];
    const c = BY_KEY[p.key];
    const k = (counts.get(c.label) ?? 0) + 1;
    counts.set(c.label, k);
    const box = { x: r3(b.x1 / b.w), y: r3(b.y1 / b.h), w: r3((b.x2 - b.x1) / b.w), h: r3((b.y2 - b.y1) / b.h) };
    return [{ id: `${c.kind}-${slug(c.label)}-p${frame}-pt${k}`, kind: c.kind, label: c.label, concept: c.concept, frame, seconds: frame / 5, box, framesSeen: 1, confidence: b.c ?? null, track: [[frame, box.x, box.y, box.w, box.h]] }];
  });
  return { finds, costUsd: costUsd + points.length * PRICES.samImage };
}

const overlap = (a: number[], b: number[]) => {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return (x * y) / (a[2] * a[3] + b[2] * b[3] - x * y || 1);
};

// A pointed water heater or panel that SAM already found by name, on any frame they share, is that find;
// a pointed "bulkhead" on a duct SAM found is the bare duct.
export function withoutNamed(pointed: Detection[], named: Detection[]): Detection[] {
  const same = (p: Detection, label: string) =>
    named.some((n) => n.label === label && n.track.some((t) => p.track.some((u) => u[0] === t[0] && overlap(u.slice(1), t.slice(1)) >= 0.3)));
  return pointed.filter((p) => !(BY_NAME_TOO.has(p.label) && same(p, p.label)) && !(p.label === "Bulkhead" && same(p, "Duct")));
}

// ---- Video -----------------------------------------------------------------------------------------

export type Wanted = { key: PointKey; atS: number; note: string };

// What the watch saw that only pointing finds, with when it was filmed.
export function wantedFrom(watch: Pick<Watch, "rooms"> | null | undefined): Wanted[] {
  const out: Wanted[] = [];
  for (const r of watch?.rooms ?? []) {
    for (const f of r.fixtures) {
      const key = keyOf(f.kind);
      if (key && f.atS != null) out.push({ key, atS: f.atS, note: f.note });
    }
    for (const l of r.low) if (l.kind === "bulkhead" && l.atS != null) out.push({ key: "bulkhead", atS: l.atS, note: l.note });
  }
  return out;
}

export const frameQuestion = (w: Wanted, seconds: number[]) => `These are ${seconds.length} frames from a phone video of a basement, at ${seconds.map((s) => `${s.toFixed(1)} s`).join(", ")}. Around ${w.atS.toFixed(1)} s it shows ${BY_KEY[w.key].say}${w.note ? ` (${w.note})` : ""}.
Pick the frame where it shows best and give a box around it there, just big enough to hold the whole thing. If none of the frames shows it, say so; never guess.
Reply with JSON only: {"found":true,"frame":0-${seconds.length - 1},"x1":0-1000,"y1":0-1000,"x2":0-1000,"y2":0-1000} where frame counts from 0, x1, y1 is the box's top left and x2, y2 its bottom right, across and down the frame, times 1000, or {"found":false}.`;

export function readFramePoint(text: string, frames: number): ({ frame: number } & Omit<Point, "key">) | null {
  const a = json(text);
  if (a?.found !== true) return null;
  const f = num(a.frame);
  const m = readMark(a);
  return f != null && Number.isInteger(f) && f >= 0 && f < frames && m ? { frame: f, ...m } : null;
}

// Three frames around when it was filmed, half a second apart, inside the video.
export function framesNear(atS: number, fps: number, frameCount: number): number[] {
  const at = Math.round(atS * fps);
  return [...new Set([at - Math.round(fps / 2), at, at + Math.round(fps / 2)].map((n) => Math.min(frameCount - 1, Math.max(0, n))))];
}

export type VideoLook = { frameUrl: (n: number) => string; fileId: string; frameCount: number; fps: number; w: number; h: number };

// Spark marks a frame for each thing the watch saw; SAM tracks them all through the video in one request.
export async function pointInVideo(watch: Pick<Watch, "rooms"> | null | undefined, v: VideoLook, ask: Ask = responses, sam = samVideo): Promise<Found> {
  const wanted = wantedFrom(watch);
  let costUsd = 0;
  const prompts = (
    await Promise.all(
      wanted.map(async (w) => {
        const frames = framesNear(w.atS, v.fps, v.frameCount);
        const r = await ask({
          model: POINT_MODEL,
          input: [{ role: "user", content: [{ type: "input_text", text: frameQuestion(w, frames.map((n) => n / v.fps)) }, ...frames.map((n) => ({ type: "input_image", image_url: v.frameUrl(n) }))] }],
        }).catch(() => null);
        costUsd += tokenCost(POINT_MODEL, r?.usage)?.usd ?? 0;
        let p: ReturnType<typeof readFramePoint> = null;
        try {
          p = r ? readReply(r, (t) => readFramePoint(t, frames.length)) : null;
        } catch {
          p = null;
        }
        return p ? { key: w.key, ...p, frame: frames[p.frame] } : null;
      }),
    )
  ).filter((p): p is NonNullable<typeof p> => p !== null);
  if (!prompts.length) return { finds: [], costUsd };
  // At most 16 objects a request (the SAM docs).
  const asked = prompts.slice(0, 16);
  const raw = await sam(pointPrompt(asked, v.w, v.h), v.fileId, v.frameCount).catch(() => "");
  return { finds: pointedTracks(raw, asked, v.fps), costUsd: costUsd + Math.max(PRICES.samVideoMinFrames, v.frameCount) * PRICES.samVideoFrame };
}

// SAM's tracks back to what was pointed at: object i + 1 is prompt i. A track that doesn't hold for half
// a second, or whose clearest outline is unsure or the whole frame, is dropped; the same thing pointed at
// twice (the watch saw it on two visits) is kept once, its longer track.
export function pointedTracks(raw: string, asked: { key: PointKey }[], fps: number): Detection[] {
  const tracks = new Map(parseSam(raw).map((t) => [t.id, t]));
  const kept: { key: PointKey; t: SamTrack }[] = [];
  asked.forEach((p, i) => {
    const all = tracks.get(i + 1);
    // Frame by frame: filmed up close, a furnace fills the picture on some frames and not on others. It
    // counts when it holds for half a second at a fair size, and it's shown on one of those frames.
    const t = all && { ...all, frames: all.frames.filter((f) => fair(f.box)) };
    if (!t || t.frames.length < Math.ceil(fps / 2)) return;
    const same = kept.find((k) => k.key === p.key && k.t.frames.some((f) => t.frames.some((g) => g.frame === f.frame && overlap(box(f.box), box(g.box)) >= 0.5)));
    if (!same) kept.push({ key: p.key, t });
    else if (t.frames.length > same.t.frames.length) same.t = t;
  });
  const counts = new Map<string, number>();
  return kept.map(({ key, t }): Detection => {
    const c = BY_KEY[key];
    const k = (counts.get(c.label) ?? 0) + 1;
    counts.set(c.label, k);
    const b = bestFrame(t);
    return {
      id: `${c.kind}-${slug(c.label)}-pt${k}`,
      kind: c.kind,
      label: c.label,
      concept: c.concept,
      frame: b.frame,
      seconds: b.frame / fps,
      box: { x: b.box.x1 / b.box.w, y: b.box.y1 / b.box.h, w: (b.box.x2 - b.box.x1) / b.box.w, h: (b.box.y2 - b.box.y1) / b.box.h },
      framesSeen: t.frames.length,
      confidence: b.box.c ?? null,
      track: t.frames.map((f) => [f.frame, r3(f.box.x1 / f.box.w), r3(f.box.y1 / f.box.h), r3((f.box.x2 - f.box.x1) / f.box.w), r3((f.box.y2 - f.box.y1) / f.box.h)]),
    };
  });
}

const box = (b: SamBox) => [b.x1 / b.w, b.y1 / b.h, (b.x2 - b.x1) / b.w, (b.y2 - b.y1) / b.h];
