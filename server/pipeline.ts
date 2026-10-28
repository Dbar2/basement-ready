// One scan: phone video in, a verdict with proof out. Emits live events for the scan screen.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { assess } from "./assess";
import { samVideo, transcribe, uploadFile } from "./meta";
import type { Household } from "./rules";
import { bestFrame, parseSam } from "./sam";

const run = promisify(execFile);

export const MEDIA_ROOT = join(process.cwd(), "media", "private");
export const ANALYSIS_FPS = 5;

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

export type ScanEvent = { at: number; type: "log" | "find" | "stage" | "done" | "error"; text: string; data?: unknown };

export type Job = {
  id: string;
  dir: string;
  household: Household;
  address: string;
  status: "running" | "done" | "error";
  started: number;
  events: ScanEvent[];
  listeners: Set<(e: ScanEvent) => void>;
  result?: unknown;
};

export const jobs = new Map<string, Job>();

function emit(job: Job, type: ScanEvent["type"], text: string, data?: unknown) {
  const e: ScanEvent = { at: (Date.now() - job.started) / 1000, type, text, data };
  job.events.push(e);
  for (const l of job.listeners) l(e);
}

export function newJob(household: Household, address: string): Job {
  const id = randomUUID();
  const dir = join(MEDIA_ROOT, id);
  mkdirSync(join(dir, "frames"), { recursive: true });
  const job: Job = { id, dir, household, address, status: "running", started: Date.now(), events: [], listeners: new Set() };
  jobs.set(id, job);
  return job;
}

async function prepare(job: Job, inputPath: string) {
  const analysis = join(job.dir, "analysis.mp4");
  // 5 fps, long side 1280, max 2 minutes: keeps SAM billing to ~600 frames per concept.
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-i", inputPath, "-t", "120",
    "-vf", `fps=${ANALYSIS_FPS},scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'`,
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", analysis,
  ]);
  // Frames come from the analysis video itself, so frame N here is frame N in SAM's output.
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", analysis, "-vsync", "0", "-q:v", "3", "-start_number", "0", join(job.dir, "frames", "%04d.jpg")]);
  const wav = join(job.dir, "voice.wav");
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", inputPath, "-t", "120", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-map_metadata", "-1", wav]);
  } catch {
    // No audio track. The scan still works; we just don't hear what they want.
  }
  const frameCount = readdirSync(join(job.dir, "frames")).filter((f) => f.endsWith(".jpg")).length;
  return { analysis, wav: existsSync(wav) ? wav : null, frameCount };
}

const plural = (n: number, word: string) => `${n} ${word.toLowerCase()}${n === 1 ? "" : "s"}`;

export async function runScan(job: Job, inputPath: string) {
  try {
    emit(job, "stage", "prepare");
    const { analysis, wav, frameCount } = await prepare(job, inputPath);
    emit(job, "log", `Reading ${frameCount} frames from your video`, { frameCount });

    const transcriptP = wav
      ? transcribe(wav).then((t) => {
          if (t.transcript) emit(job, "log", `Heard: “${t.transcript.slice(0, 90)}${t.transcript.length > 90 ? "…" : ""}”`);
          return t;
        }).catch(() => ({ transcript: "", turns: [] }))
      : Promise.resolve({ transcript: "", turns: [] });

    emit(job, "stage", "find");
    const fileId = await uploadFile(analysis, "video/mp4", "basement.mp4");

    const detections: Detection[] = [];
    await Promise.all(
      CONCEPTS.map(async (c) => {
        const raw = await samVideo(c.concept, fileId).catch(() => "");
        // Ignore flickers: an object must hold for half a second to count.
        const tracks = parseSam(raw).filter((t) => t.frames.length >= Math.ceil(ANALYSIS_FPS / 2)).slice(0, 6);
        tracks.forEach((t, i) => {
          const b = bestFrame(t);
          detections.push({
            id: `${c.kind}-${c.label.toLowerCase().replace(/\s+/g, "-")}-${i + 1}`,
            kind: c.kind,
            label: c.label,
            concept: c.concept,
            frame: b.frame,
            seconds: b.frame / ANALYSIS_FPS,
            box: { x: b.box.x1 / b.box.w, y: b.box.y1 / b.box.h, w: (b.box.x2 - b.box.x1) / b.box.w, h: (b.box.y2 - b.box.y1) / b.box.h },
            framesSeen: t.frames.length,
            confidence: b.box.c ?? null,
            track: t.frames.map((f) => {
              const r = (n: number) => Math.round(n * 1000) / 1000;
              return [f.frame, r(f.box.x1 / f.box.w), r(f.box.y1 / f.box.h), r((f.box.x2 - f.box.x1) / f.box.w), r((f.box.y2 - f.box.y1) / f.box.h)];
            }),
          });
        });
        const found = tracks.length;
        emit(job, "find", found ? `Found ${plural(found, c.label)}` : `No ${c.label.toLowerCase()} seen`, {
          kind: c.kind,
          label: c.label,
          detections: detections.filter((d) => d.concept === c.concept),
        });
      }),
    );

    const transcript = await transcriptP;
    emit(job, "stage", "assess");
    emit(job, "log", "Checking Waterloo's second-unit rules");
    const result = await assess(job, detections, transcript.transcript);
    job.result = { id: job.id, household: job.household, address: job.address, frameCount, detections, transcript: transcript.transcript, ...result };
    job.status = "done";
    emit(job, "done", "Your answer is ready");
  } catch (err) {
    job.status = "error";
    emit(job, "error", err instanceof Error ? err.message : String(err));
  }
}
