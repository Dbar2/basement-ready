// "Try this look": the finished-basement photos made again in a chosen style with Muse Image, all at
// once, each checked by SAM 3.1 so the windows and stairs stay where they are. Stored per style, so
// trying a look twice doesn't pay twice. Labelled virtually staged wherever they're shown.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { conceptPrompt, keptInPlace } from "../concepts";
import { museEdit, samImage } from "../meta";
import type { Detection } from "../pipeline";
import { parseSam } from "../sam";
import { storage } from "../storage";
import type { Look } from "../workspace";
import { STYLES as ALL } from "./styles";

// The styles on offer, shared with the swipe deck (server/ideas/styles.ts), looked up by name.
export const STYLES: Record<string, (typeof ALL)[keyof typeof ALL]> = ALL;

const run = promisify(execFile);

export type Box = { x: number; y: number; w: number; h: number };

// Muse Image answers in its own format and size (WebP, up to 1600 px): back to a JPEG at the
// frame's own size, as server/concepts.ts does, so boxes line up and PDFs can embed it.
export async function toJpeg(img: Buffer, w: number, h: number) {
  const dir = mkdtempSync(join(tmpdir(), "look-"));
  try {
    writeFileSync(join(dir, "in.bin"), img);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", join(dir, "in.bin"), "-vf", `scale=${w}:${h}`, "-q:v", "3", join(dir, "out.jpg")]);
    return readFileSync(join(dir, "out.jpg"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
type Source = { n: number; frame: number; title: string; space: string; jpeg: Buffer; anchors: { kind: string; box: Box }[] };

export const lookKey = (scanId: string, style: string, n: number) => `looks/${scanId}/${style}/${n}.jpg`;

export async function boxes(jpeg: Buffer, concept: string): Promise<Box[]> {
  const raw = await samImage(concept, `data:image/jpeg;base64,${jpeg.toString("base64")}`).catch(() => "");
  return parseSam(raw)
    .map((t) => t.frames[0]?.box)
    .filter((b): b is NonNullable<typeof b> => Boolean(b) && (b.c ?? 1) >= 0.4)
    .map((b) => ({ x: b.x1 / b.w, y: b.y1 / b.h, w: (b.x2 - b.x1) / b.w, h: (b.y2 - b.y1) / b.h }));
}

// The frames to restyle: the ones the original photos were made from, with what SAM saw in them.
export function sourcesFrom(result: any, frames: Map<number, Buffer>): Source[] {
  const items: { n: number; frame: number; title: string }[] = result?.concepts?.items ?? [];
  return items
    .filter((c) => frames.has(c.frame))
    .map((c) => ({
      n: c.n,
      frame: c.frame,
      title: c.title,
      space: /bed/i.test(c.title) ? "bedroom" : /den|office|other/i.test(c.title) ? "cosy den with a small home office" : "open living room with a small modern kitchen",
      jpeg: frames.get(c.frame)!,
      anchors: ((result?.detections ?? []) as Detection[])
        .filter((d) => d.kind === "window" || d.kind === "stairs")
        .flatMap((d) => d.track.filter((t) => t[0] === c.frame).map((t) => ({ kind: d.kind, box: { x: t[1], y: t[2], w: t[3], h: t[4] } }))),
    }));
}

// A JPEG's pixel size, from its start-of-frame marker.
export function jpegSize(b: Buffer): { w: number; h: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// Every photo at once. The size string only sets the aspect ratio (server/meta.ts).
export async function renderLook(scanId: string, style: string, sources: Source[]): Promise<Look> {
  const feel = STYLES[style]?.feel ?? style;
  const items = await Promise.all(
    sources.map(async (src) => {
      try {
        const px = jpegSize(src.jpeg) ?? { w: 1280, h: 720 };
        const img = await toJpeg(await museEdit(src.jpeg, "image/jpeg", conceptPrompt(src.space, feel), `${px.w}x${px.h}`), px.w, px.h);
        let kept = true;
        let checked = "Room shape kept";
        if (src.anchors.length) {
          const kinds = [...new Set(src.anchors.map((x) => x.kind))];
          const found = await Promise.all(kinds.map(async (k) => ({ k, b: await boxes(img, k === "window" ? "basement window" : "staircase") })));
          kept = kinds.every((k) => keptInPlace(src.anchors.filter((x) => x.kind === k).map((x) => x.box), found.find((f) => f.k === k)!.b));
          checked = kept ? "Windows and stairs kept where they are · checked by SAM 3.1" : "A window or the stairs moved: treat it as a mood, not a plan";
        }
        await storage.put(lookKey(scanId, style, src.n), img, "image/jpeg");
        return { n: src.n, frame: src.frame, title: src.title, kept, checked };
      } catch {
        return null;
      }
    }),
  );
  const done = items.filter((x): x is NonNullable<typeof x> => x !== null);
  return { style, status: done.length ? "done" : "failed", items: done, at: new Date().toISOString() };
}
