// What each candidate frame looks like (server/views/stable.ts Look): every frame read once, shrunk to
// a small grey copy by ffmpeg (one run for a few hundred), and measured. A scan's looks are kept in its
// storage (views/looks.json), so they're worked out once.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { keys, storage } from "../storage";
import { lookOf, type Look } from "./stable";

const run = promisify(execFile);
const LONG = 256; // the grey copy's long side, in pixels
const BATCH = 300;

// The grey copy's size for a frame of this size.
export const greySize = (w: number, h: number): [number, number] => {
  const k = LONG / Math.max(w, h);
  const even = (x: number) => Math.max(2, 2 * Math.round((x * k) / 2));
  return [even(w), even(h)];
};

// The looks of `frames` (by number, each with its picture's size), read by `read`. Frames that can't be
// read are left out.
export async function measureLooks(frames: { n: number; size: [number, number] }[], read: (n: number) => Promise<Buffer | null>): Promise<Map<number, Look>> {
  const out = new Map<number, Look>();
  const bySize = new Map<string, number[]>();
  for (const f of frames) bySize.set(f.size.join("x"), [...(bySize.get(f.size.join("x")) ?? []), f.n]);
  for (const [key, all] of bySize) {
    const [w, h] = greySize(...(key.split("x").map(Number) as [number, number]));
    for (let i = 0; i < all.length; i += BATCH) {
      const work = mkdtempSync(join(tmpdir(), "br-looks-"));
      try {
        const kept: number[] = [];
        for (const n of all.slice(i, i + BATCH)) {
          const jpeg = await read(n);
          if (!jpeg) continue;
          writeFileSync(join(work, `${String(kept.length).padStart(6, "0")}.jpg`), jpeg);
          kept.push(n);
        }
        if (!kept.length) continue;
        const { stdout } = await run("ffmpeg", ["-loglevel", "error", "-start_number", "0", "-i", join(work, "%06d.jpg"), "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], {
          encoding: "buffer",
          maxBuffer: kept.length * w * h + 1024 * 1024,
        });
        const px = w * h;
        kept.forEach((n, k) => {
          if ((k + 1) * px <= stdout.length) out.set(n, lookOf(stdout.subarray(k * px, (k + 1) * px), w, h));
        });
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
  }
  return out;
}

// Kept looks as JSON: { version, looks: { frame: [mean, dark, bright, lap] } }, rounded.
export const VERSION = 1;
export function looksToJson(looks: Map<number, Look>) {
  const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  return JSON.stringify({ version: VERSION, looks: Object.fromEntries([...looks].map(([n, l]) => [n, [r(l.mean, 1), r(l.dark, 4), r(l.bright, 4), r(l.lap, 1)]])) });
}
export function looksFromJson(raw: string | null): Map<number, Look> {
  const out = new Map<number, Look>();
  if (!raw) return out;
  try {
    const j = JSON.parse(raw);
    if (j?.version !== VERSION) return out;
    for (const [n, v] of Object.entries(j.looks ?? {})) {
      const [mean, dark, bright, lap] = v as number[];
      out.set(Number(n), { mean, dark, bright, lap });
    }
  } catch {
    // A broken file is measured again.
  }
  return out;
}

async function stored(key: string): Promise<Buffer | null> {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

// A scan's frames' looks, kept in its storage: the ones not measured yet are measured and added.
export async function keptLooks(scanId: string, frames: { n: number; size: [number, number] }[]): Promise<Map<number, Look>> {
  const key = `scans/${scanId}/views/looks.json`;
  const looks = looksFromJson((await stored(key))?.toString("utf8") ?? null);
  const missing = frames.filter((f) => !looks.has(f.n));
  if (missing.length) {
    for (const [n, l] of await measureLooks(missing, (n) => stored(keys.frame(scanId, n)))) looks.set(n, l);
    await storage.put(key, Buffer.from(looksToJson(looks)), "application/json");
  }
  return looks;
}
