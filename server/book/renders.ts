// Pictures of the final design. The 3D studio renders the design from a spot the camera really
// stood, sends the canvas, and Muse Image turns that render into a photo of the finished suite. SAM
// 3.1 then looks for the windows, doors and stairs in both, and the photo is kept only when every
// one is still where the render had it (keptInPlace, server/concepts.ts). If Muse Image moves one
// twice, the plain render is kept instead, so the book never shows a window that isn't there.
import { keptInPlace } from "../concepts";
import { museEdit, samImage } from "../meta";
import type { Finishes } from "../model/types";
import { parseSam } from "../sam";
import { storage } from "../storage";

export const MAX_RENDERS = 6; // $0.01 an image and three SAM checks: about $0.05 a render at most
export type RenderEntry = { n: number; title: string; spot: number | null; designId: string | null; status: "pending" | "done" | "failed"; kept: boolean | null; checked: string; at: string };

export const renderKey = (scanId: string, n: number) => `scans/${scanId}/renders/${n}.jpg`;
const indexKey = (scanId: string) => `scans/${scanId}/renders/index.json`;

type Box = { x: number; y: number; w: number; h: number };

async function read(key: string) {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

export async function renderIndex(scanId: string): Promise<RenderEntry[]> {
  const raw = await read(indexKey(scanId));
  try {
    return raw ? (JSON.parse(raw.toString("utf8")) as RenderEntry[]) : [];
  } catch {
    return [];
  }
}

// One writer per scan at a time, so two renders landing together don't lose each other.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(scanId: string, f: () => Promise<T>): Promise<T> {
  const next = (queues.get(scanId) ?? Promise.resolve()).then(f, f);
  queues.set(scanId, next.catch(() => {}));
  return next;
}
const upsert = (scanId: string, e: RenderEntry) =>
  serial(scanId, async () => {
    const list = (await renderIndex(scanId)).filter((x) => x.n !== e.n);
    await storage.put(indexKey(scanId), Buffer.from(JSON.stringify([...list, e].sort((a, b) => a.n - b.n))), "application/json");
  });

// Width and height from a PNG or JPEG header.
export function imageSize(b: Buffer): [number, number] | null {
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  let o = 2;
  while (o + 9 < b.length && b[o] === 0xff) {
    const m = b[o + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(o + 7), b.readUInt16BE(o + 5)];
    o += 2 + b.readUInt16BE(o + 2);
  }
  return null;
}

export function renderPrompt(finishes: Finishes | null) {
  const f = finishes ? [finishes.style && `${finishes.style} style`, finishes.floor && `${finishes.floor} floor`, finishes.walls && `${finishes.walls} walls`, finishes.kitchen && `kitchen: ${finishes.kitchen}`, finishes.bath && `bathroom: ${finishes.bath}`].filter(Boolean).join(", ") : "";
  return [
    "Turn this 3D render of a finished basement suite into a real photograph of the same room.",
    "Keep the camera exactly where it is. Keep every wall, door, window, the stairs and the ceiling height exactly where they are and the same size; add no new openings.",
    f ? `Finishes: ${f}.` : "",
    "Natural daylight from the windows plus warm pot lights, tidy and lived-in, a few simple furnishings. No people, no text.",
  ]
    .filter(Boolean)
    .join(" ");
}

const ANCHORS: [string, string][] = [
  ["window", "basement window"],
  ["door", "door"],
  ["stairs", "staircase"],
];

export type RenderWork = {
  edit: (img: Buffer, mime: string, prompt: string, size: string) => Promise<Buffer>;
  boxes: (img: Buffer, mime: string, concept: string) => Promise<Box[]>;
  save: (key: string, img: Buffer) => Promise<void>;
};

const realWork: RenderWork = {
  edit: museEdit,
  boxes: async (img, mime, concept) =>
    parseSam(await samImage(concept, `data:${mime};base64,${img.toString("base64")}`).catch(() => ""))
      .map((t) => t.frames[0]?.box)
      .filter((b): b is NonNullable<typeof b> => Boolean(b) && (b.c ?? 1) >= 0.4)
      .map((b) => ({ x: b.x1 / b.w, y: b.y1 / b.h, w: (b.x2 - b.x1) / b.w, h: (b.y2 - b.y1) / b.h })),
  save: (key, img) => storage.put(key, img, img[0] === 0x89 ? "image/png" : "image/jpeg"),
};

// Takes the next number for a render, or null when the basement has all its pictures.
export const reserveRender = (scanId: string, e: Omit<RenderEntry, "n" | "status" | "kept" | "checked">) =>
  serial(scanId, async (): Promise<RenderEntry | null> => {
    const list = await renderIndex(scanId);
    if (list.length >= MAX_RENDERS) return null;
    const entry: RenderEntry = { ...e, n: Math.max(0, ...list.map((x) => x.n)) + 1, status: "pending", kept: null, checked: "" };
    await storage.put(indexKey(scanId), Buffer.from(JSON.stringify([...list, entry])), "application/json");
    return entry;
  });

// Restyle one render and record how it went. Never throws: a failure is written to the index.
export async function restyleRender(scanId: string, entry: RenderEntry, raw: Buffer, mime: string, finishes: Finishes | null, work: RenderWork = realWork): Promise<RenderEntry> {
  let done: RenderEntry;
  try {
    if (!process.env.MODEL_API_KEY && !process.env.RELAY_TOKEN && work === realWork) {
      await work.save(renderKey(scanId, entry.n), raw);
      done = { ...entry, status: "done", kept: true, checked: "The 3D render itself: restyling needs the Muse Image key" };
    } else {
      const [w, h] = imageSize(raw) ?? [1280, 720];
      const anchors = await Promise.all(ANCHORS.map(async ([kind, concept]) => ({ kind, concept, boxes: await work.boxes(raw, mime, concept) })));
      const present = anchors.filter((a) => a.boxes.length);
      let kept = false;
      let photo: Buffer | null = null;
      for (let attempt = 0; attempt < 2 && !kept; attempt++) {
        photo = await work.edit(raw, mime, renderPrompt(finishes), `${w}x${h}`);
        const pm = photo[0] === 0x89 ? "image/png" : "image/jpeg";
        const found = await Promise.all(present.map(async (a) => keptInPlace(a.boxes, await work.boxes(photo!, pm, a.concept))));
        kept = found.every(Boolean);
      }
      await work.save(renderKey(scanId, entry.n), kept && photo ? photo : raw);
      const names = present.map((a) => (a.kind === "window" ? "windows" : a.kind === "door" ? "doors" : "stairs"));
      done = {
        ...entry,
        status: "done",
        kept,
        checked: kept
          ? names.length
            ? `${names.join(", ")} kept where they are · checked by SAM 3.1 · virtually staged`
            : "Virtually staged from the 3D render"
          : "Muse Image moved a window, door or the stairs, so this is the plain 3D render",
      };
    }
  } catch (err) {
    console.error(`[renders] ${scanId} #${entry.n}: ${err instanceof Error ? err.message : err}`);
    done = { ...entry, status: "failed", kept: null, checked: "This picture didn't render; try again." };
  }
  await upsert(scanId, done);
  return done;
}
