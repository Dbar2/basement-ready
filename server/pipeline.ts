// One scan: phone video in, a verdict with proof out. Runs inside a worker job and writes
// every step to scan_events, so the scan screen (and a refresh) can follow along.
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { assess } from "./assess";
import { db, schema } from "./db";
import { samVideo, transcribe, uploadFile } from "./meta";
import type { Household } from "./rules";
import { bestFrame, parseSam } from "./sam";
import { runScan3d, scan3dReady, summarize, type Measurements, type Scan3d } from "./scan3d";
import { keys, storage } from "./storage";

const run = promisify(execFile);

export const ANALYSIS_FPS = 5;
const SAM_USD_PER_FRAME = 0.2 / 1000; // Meta pricing, 50-frame minimum per request

// What SAM looks for. One concept per request, per the SAM docs.
export const CONCEPTS: { concept: string; kind: string; label: string }[] = [
  { concept: "basement window", kind: "window", label: "Window" },
  { concept: "staircase", kind: "stairs", label: "Stairs" },
  { concept: "ceiling duct", kind: "duct", label: "Duct" },
  { concept: "support beam", kind: "beam", label: "Beam" },
  { concept: "furnace", kind: "mechanical", label: "Furnace" },
  { concept: "electrical panel", kind: "mechanical", label: "Electrical panel" },
  { concept: "door", kind: "exit", label: "Door" },
];

export type Detection = {
  id: string;
  kind: string;
  label: string;
  concept: string;
  frame: number; // index into the analysis video and the frames folder
  seconds: number;
  box: { x: number; y: number; w: number; h: number }; // 0..1 of the frame
  framesSeen: number;
  confidence: number | null;
  // Every frame SAM tracked it in: [frame, x, y, w, h], 0..1 of the frame. Drives the live overlay.
  track: [number, number, number, number, number][];
};

export type ScanEventType = "log" | "find" | "measure" | "stage" | "done" | "error";

function emitter(scanId: string, started: number) {
  return async (type: ScanEventType, text: string, data?: unknown) => {
    await db.insert(schema.scanEvents).values({ scanId, at: (Date.now() - started) / 1000, type, text, data: data ?? null });
  };
}

async function prepare(work: string, inputPath: string) {
  const analysis = join(work, "analysis.mp4");
  // 5 fps, long side 1280, max 2 minutes: keeps SAM to ~600 frames per concept.
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-i", inputPath, "-t", "120",
    "-vf", `fps=${ANALYSIS_FPS},scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'`,
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-movflags", "+faststart", analysis,
  ]);
  // Frames come from the analysis video itself, so frame N here is frame N in SAM's output.
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", analysis, "-vsync", "0", "-q:v", "3", "-start_number", "0", join(work, "frames", "%04d.jpg")]);
  const wav = join(work, "voice.wav");
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", inputPath, "-t", "120", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-map_metadata", "-1", wav]);
  } catch {
    // No audio track. The scan still works; we just don't hear what they want.
  }
  const frameCount = readdirSync(join(work, "frames")).filter((f) => f.endsWith(".jpg")).length;
  return { analysis, wav: existsSync(wav) ? wav : null, frameCount };
}

async function uploadFrames(scanId: string, work: string, frameCount: number) {
  const queue = Array.from({ length: frameCount }, (_, i) => i);
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
        await storage.putFile(keys.frame(scanId, n), join(work, "frames", `${String(n).padStart(4, "0")}.jpg`), "image/jpeg");
      }
    }),
  );
}

const plural = (n: number, word: string) => `${n} ${word.toLowerCase()}${n === 1 ? "" : "s"}`;

export async function runScan(scanId: string, opts: { lastAttempt: boolean }) {
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId));
  if (!scan?.videoKey) throw new Error(`Scan ${scanId} has no video`);
  const [basement] = await db.select().from(schema.basements).where(eq(schema.basements.id, scan.basementId));

  // A retried job starts clean.
  await db.delete(schema.scanEvents).where(eq(schema.scanEvents.scanId, scanId));
  await db.update(schema.scans).set({ status: "running", startedAt: new Date(), error: null }).where(eq(schema.scans.id, scanId));
  const emit = emitter(scanId, Date.now());
  const work = join(tmpdir(), "basement-ready", scanId);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "frames"), { recursive: true });

  try {
    await emit("stage", "prepare");
    const input = join(work, `input${extname(scan.videoKey) || ".mp4"}`);
    await storage.download(scan.videoKey, input);
    const { analysis, wav, frameCount } = await prepare(work, input);
    await emit("log", `Reading ${frameCount} frames from your video`, { frameCount });
    const uploads = Promise.all([storage.putFile(keys.analysis(scanId), analysis, "video/mp4"), uploadFrames(scanId, work, frameCount)]);

    const transcriptP = wav
      ? transcribe(wav)
          .then(async (t) => {
            if (t.transcript) await emit("log", `Heard: “${t.transcript.slice(0, 90)}${t.transcript.length > 90 ? "…" : ""}”`);
            return t;
          })
          .catch(() => ({ transcript: "", turns: [] }))
      : Promise.resolve({ transcript: "", turns: [] });

    // The 3D scan only needs the frames, so it runs alongside SAM.
    const known = (scan.inputs ?? {}) as { floorToJoistsM?: number };
    const scan3dP: Promise<Scan3d | null> = (await scan3dReady())
      ? (async () => {
          await emit("log", "Building your basement in 3D");
          try {
            return await runScan3d(work, frameCount, known);
          } catch (err) {
            console.error(`[scan3d] ${scanId}: ${err instanceof Error ? err.message : err}`);
            await emit("log", "3D scan unavailable this time; checking from the video instead");
            return null;
          }
        })()
      : Promise.resolve(null);

    await emit("stage", "find");
    const fileId = await uploadFile(analysis, "video/mp4", "basement.mp4");

    const detections: Detection[] = [];
    await Promise.all(
      CONCEPTS.map(async (c) => {
        const raw = await samVideo(c.concept, fileId).catch(() => "");
        // Ignore flickers: an object must hold for half a second to count.
        const tracks = parseSam(raw).filter((t) => t.frames.length >= Math.ceil(ANALYSIS_FPS / 2)).slice(0, 6);
        const found: Detection[] = tracks.map((t, i) => {
          const b = bestFrame(t);
          const r = (n: number) => Math.round(n * 1000) / 1000;
          return {
            id: `${c.kind}-${c.label.toLowerCase().replace(/\s+/g, "-")}-${i + 1}`,
            kind: c.kind,
            label: c.label,
            concept: c.concept,
            frame: b.frame,
            seconds: b.frame / ANALYSIS_FPS,
            box: { x: b.box.x1 / b.box.w, y: b.box.y1 / b.box.h, w: (b.box.x2 - b.box.x1) / b.box.w, h: (b.box.y2 - b.box.y1) / b.box.h },
            framesSeen: t.frames.length,
            confidence: b.box.c ?? null,
            track: t.frames.map((f) => [f.frame, r(f.box.x1 / f.box.w), r(f.box.y1 / f.box.h), r((f.box.x2 - f.box.x1) / f.box.w), r((f.box.y2 - f.box.y1) / f.box.h)]),
          };
        });
        detections.push(...found);
        await emit("find", found.length ? `Found ${plural(found.length, c.label)}` : `No ${c.label.toLowerCase()} seen`, {
          kind: c.kind,
          label: c.label,
          detections: found,
        });
      }),
    );

    const s3 = await scan3dP;
    let measurements: Measurements | null = null;
    if (s3) {
      measurements = summarize(s3, detections);
      await Promise.all([
        storage.put(keys.scan3d(scanId, "scan.json"), Buffer.from(JSON.stringify(s3.scan)), "application/json"),
        storage.put(keys.scan3d(scanId, "points.ply"), Buffer.from(s3.ply), "application/octet-stream"),
        storage.put(keys.scan3d(scanId, "depth.bin"), Buffer.from(s3.depth), "application/octet-stream"),
      ]);
      const room = [
        measurements.ceilingHeightM != null && `ceiling ${measurements.ceilingHeightM.toFixed(2)} m`,
        measurements.widthM != null && measurements.depthM != null && `room ${measurements.widthM.toFixed(1)} × ${measurements.depthM.toFixed(1)} m`,
      ].filter(Boolean);
      const caveat = !measurements.trusted ? " (rough: re-film slowly for exact sizes)" : measurements.scaleSource === "model" ? " (estimated)" : "";
      await emit("measure", `Measured ${room.join(" · ")}${caveat}`, measurements);
    }

    const transcript = await transcriptP;
    await emit("stage", "assess");
    await emit("log", "Checking your city's second-unit rules");
    const assessment = await assess(
      { dir: work, household: basement.household as Household, municipality: basement.municipality },
      detections,
      transcript.transcript,
      measurements,
    );
    await uploads;

    const samCost = CONCEPTS.length * Math.max(50, frameCount) * SAM_USD_PER_FRAME;
    const result = { id: scanId, household: basement.household, frameCount, detections, transcript: transcript.transcript, has3d: Boolean(s3), ...assessment.result };
    await db
      .update(schema.scans)
      .set({ status: "done", result, frameCount, transcript: transcript.transcript, costUsd: samCost + assessment.costUsd, finishedAt: new Date() })
      .where(eq(schema.scans.id, scanId));
    await emit("done", "Your answer is ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.lastAttempt) {
      await db.update(schema.scans).set({ status: "error", error: message, finishedAt: new Date() }).where(eq(schema.scans.id, scanId));
      await emit("error", "Something went wrong reading your video. Please try again, or try a shorter clip.");
    } else {
      await emit("log", "Hit a snag, trying again…");
    }
    throw err;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
