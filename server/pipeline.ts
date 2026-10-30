// One scan: phone video in, a verdict with proof out. Runs inside a worker job and writes
// every step to scan_events, so the scan screen (and a refresh) can follow along.
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { finishAssessment, readWithSpark } from "./assess";
import { enqueue } from "./jobs";
import { recheck, type AnswerValue } from "./recheck";
import { db, schema } from "./db";
import { samVideo, transcribe, uploadFile } from "./meta";
import type { Property } from "./property";
import type { Household } from "./rules";
import { bestFrame, parseSam } from "./sam";
import { suggestLayout } from "./layout";
import { buildPlan, rescalePlan, type Plan } from "./plan";
import { areaName, mainRoom, MAX_TAKE_S, MIN_ROOM_FRAMES, roomName, roomRanges, withIdeas, withoutGuide, type Idea, type Room, type RoomMark, type Span } from "./rooms";
import { basementViewpoints, mergeSurfels, scanBasement, type BasementScan, type RoomPlacement } from "./basement";
import { doorHeights, doorScale, lowOverhead, rescaleMeasurements, runScan3d, scan3dReady, summarize, type Measurements, type Scan3d } from "./scan3d";
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
    "-y", "-loglevel", "error", "-i", inputPath, "-t", String(MAX_TAKE_S),
    "-vf", `fps=${ANALYSIS_FPS},scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'`,
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-movflags", "+faststart", analysis,
  ]);
  // Frames come from the analysis video itself, so frame N here is frame N in SAM's output.
  // Best JPEG quality: these frames feed the 3D scan and the proof pictures.
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", analysis, "-vsync", "0", "-q:v", "2", "-start_number", "0", join(work, "frames", "%04d.jpg")]);
  const wav = join(work, "voice.wav");
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", inputPath, "-t", String(MAX_TAKE_S), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-map_metadata", "-1", wav]);
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

const plural = (n: number, word: string) => `${n} ${word.toLowerCase()}${n === 1 || /s$/i.test(word) ? "" : "s"}`;

// Each room's 3D files saved, its measurements and plan worked out from the SAM finds.
// The basement's own 3D files: every room's surface points in one frame, and where the camera stood.
export async function saveBasement3d(scanId: string, b: BasementScan) {
  const rooms = b.scans.map((s3, i) => ({
    scan: s3.scan,
    surfels: s3.surfels,
    placement: b.placements[i],
    frameNumbers: (s3.scan.frames ?? []).map((f: { sourceIndex: number }) => s3.sentFrames[f.sourceIndex]),
  }));
  const withPoints = rooms.filter((r): r is typeof r & { surfels: ArrayBuffer } => Boolean(r.surfels));
  await Promise.all([
    storage.put(keys.basement3d(scanId, "scan.json"), Buffer.from(JSON.stringify(basementViewpoints(rooms))), "application/json"),
    ...(withPoints.length ? [storage.put(keys.basement3d(scanId, "surfels.bin"), mergeSurfels(withPoints), "application/octet-stream")] : []),
  ]);
}

export async function finishRooms(
  scanId: string,
  ranges: { index: number; from: number; to: number }[],
  scans3d: (Scan3d | null)[],
  detections: Detection[],
  emit: (type: ScanEventType, text: string, data?: unknown) => Promise<void>,
  placements?: RoomPlacement[],
): Promise<Room[]> {
  const furnaceFrames = detections.filter((d) => d.label === "Furnace").map((d) => d.frame);
  const named = new Set<string>();
  const rooms: Room[] = [];
  for (const r of ranges) {
    const s3 = scans3d[r.index];
    let name = ranges.length === 1 ? "Your basement" : roomName(r.index, r.from, r.to, furnaceFrames, named);
    let measurements: Measurements | null = null;
    let plan: Plan | null = null;
    if (s3) {
      // Objects seen in other rooms don't land on this room's frames, so they drop out here.
      measurements = summarize(s3, detections);
      plan = buildPlan(s3, detections, measurements.trusted);
      // No tape: let the doors fine-tune the model's scale when they agree.
      const s = measurements.scaleSource === "model" ? doorScale(doorHeights(s3, detections)) : null;
      if (s) {
        measurements = rescaleMeasurements(measurements, s);
        plan = plan && rescalePlan(plan, s);
      }
      // Halls and stairs get their own names; rooms are numbered without them.
      if (ranges.length > 1) {
        named.delete(name);
        name = areaName(plan, rooms.filter((x) => !/^(Hall|Stairs)$/.test(x.name)).length + 1, r.from, r.to, furnaceFrames, named);
      }
      await Promise.all([
        // sentFrames maps the scan's frames back to ours, so the plan can be rebuilt later.
        storage.put(keys.scan3d(scanId, "scan.json", r.index), Buffer.from(JSON.stringify({ ...s3.scan, sentFrames: s3.sentFrames })), "application/json"),
        storage.put(keys.scan3d(scanId, "points.ply", r.index), Buffer.from(s3.ply), "application/octet-stream"),
        storage.put(keys.scan3d(scanId, "depth.bin", r.index), Buffer.from(s3.depth), "application/octet-stream"),
        ...(s3.surfels ? [storage.put(keys.scan3d(scanId, "surfels.bin", r.index), Buffer.from(s3.surfels), "application/octet-stream")] : []),
      ]);
      const sizes = [
        measurements.ceilingHeightM != null && `ceiling ${measurements.ceilingHeightM.toFixed(2)} m`,
        measurements.widthM != null && measurements.depthM != null && `${measurements.widthM.toFixed(1)} × ${measurements.depthM.toFixed(1)} m`,
      ].filter(Boolean);
      const caveat = !measurements.trusted ? " (rough: re-film slowly for exact sizes)" : measurements.scaleSource === "model" ? " (estimated)" : "";
      await emit("measure", `${ranges.length > 1 ? `${name}: ` : "Measured "}${sizes.join(" · ")}${caveat}`, measurements);
    }
    rooms.push({ index: r.index, name, startS: r.from / ANALYSIS_FPS, endS: r.to / ANALYSIS_FPS, has3d: Boolean(s3), plan, measurements, placement: placements?.[r.index] ?? null });
  }
  return rooms;
}

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

    // One retry, and a failure is logged rather than passed off as "you didn't talk".
    const transcriptP = wav
      ? transcribe(wav)
          .catch(async (err) => {
            console.error(`[voice] ${scanId}: ${err instanceof Error ? err.message : err}; retrying`);
            return transcribe(wav);
          })
          .then(async (t) => {
            await emit("log", t.transcript ? `Heard: “${t.transcript.slice(0, 90)}${t.transcript.length > 90 ? "…" : ""}”` : "No talking heard in the video");
            return t;
          })
          .catch((err) => {
            console.error(`[voice] ${scanId}: ${err instanceof Error ? err.message : err}`);
            return { transcript: "", turns: [] };
          })
      : Promise.resolve({ transcript: "", turns: [] });

    // The 3D scan only needs the frames, so it runs alongside SAM: one room at a time, in filming order.
    const inputs = (scan.inputs ?? {}) as { floorToJoistsM?: number; rooms?: RoomMark[]; ideas?: Idea[]; spoken?: Span[]; lens?: "ultrawide" | "wide"; wideAt?: number };
    const known = inputs.floorToJoistsM ? { floorToJoistsM: inputs.floorToJoistsM } : {};
    // One connected basement: a rough whole-walk pass places the areas, each measured on its own.
    const basementP: Promise<BasementScan | null> = (await scan3dReady())
      ? scanBasement(work, frameCount, known, (text) => emit("log", text)).catch(async (err) => {
          console.error(`[scan3d] ${scanId}: ${err instanceof Error ? err.message : err}`);
          await emit("log", "3D scan unavailable this time; checking from the video instead");
          return null;
        })
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

    // Spark reads the finds and what they said while the 3D is still measuring.
    const heard = await transcriptP;
    // Drop the guide's own voice, and add what they tapped when asked what a room should be.
    const turns = withoutGuide(heard.turns, inputs.spoken);
    const tapped = (inputs.ideas ?? []).map((i) => `[Tapped at ${i.sec.toFixed(0)} s, room ${i.room + 1}: "${i.idea}"]`);
    const transcript = {
      transcript: [inputs.spoken?.length ? turns.map((t) => t.transcript).join(" ") : heard.transcript, ...tapped].filter(Boolean).join("\n"),
      turns,
    };
    await emit("stage", "assess");
    await emit("log", "Checking your city's second-unit rules");
    const ctx = { dir: work, household: basement.household as Household, municipality: basement.municipality, property: basement.property as Property | null };
    const sparkP = readWithSpark(ctx, detections, transcript.transcript, transcript.turns);

    const basement3d = await basementP;
    // Without the 3D, the phone's room marks still name the areas.
    const ranges = basement3d ? basement3d.spans.map((span, index) => ({ index, ...span })) : roomRanges(inputs.rooms ?? null, frameCount, ANALYSIS_FPS);
    const scans3d: (Scan3d | null)[] = basement3d ? basement3d.scans : ranges.map(() => null);
    const low = lowOverhead(scans3d, detections);
    if (low.length) {
      for (const d of low) detections.splice(detections.indexOf(d), 1);
      await emit("log", `Left out ${plural(low.length, "find")} too low to be a beam or duct`);
    }
    const rooms = await finishRooms(scanId, ranges, scans3d, detections, emit, basement3d?.placements);
    if (basement3d) await saveBasement3d(scanId, basement3d);
    // The rules check one room's numbers: the best-scanned one.
    const main = mainRoom(rooms);
    const measurements = main?.measurements ?? null;
    const plan = main?.plan ?? null;

    // They may have answered "who's it for" while this ran.
    const [latest] = await db.select().from(schema.basements).where(eq(schema.basements.id, basement.id));
    const household = (latest?.household ?? basement.household) as Household;
    const assessment = finishAssessment({ ...ctx, household }, await sparkP, detections, measurements);
    await uploads;

    const samCost = CONCEPTS.length * Math.max(50, frameCount) * SAM_USD_PER_FRAME;
    const assessed = {
      id: scanId,
      household,
      frameCount,
      detections,
      transcript: transcript.transcript,
      has3d: rooms.some((r) => r.has3d),
      plan,
      rooms,
      mainRoom: main?.index ?? null,
      ...assessment.result,
    };
    // Questions answered while it ran are applied now; recheck also redoes the plan with the room's size.
    const answered = await db.select().from(schema.answers).where(eq(schema.answers.basementId, basement.id));
    const rechecked = recheck(assessed, Object.fromEntries(answered.map((a) => [a.ruleId, a.value as AnswerValue])));
    // Ideas they tapped while filming count as much as what they said.
    // A starting layout inside the main room, for the 3D staging, the plan drawing and the brief.
    const result = {
      ...rechecked,
      vision: withIdeas(rechecked.vision, inputs.ideas, rooms),
      // How it was filmed: the lens, and the still wide shot the staged photos start from.
      capture: { lens: inputs.lens ?? null, wideAt: inputs.wideAt ?? null },
      layout: plan ? suggestLayout(plan) : null,
      // The photos come from their own job, right after this answer.
      concepts: { status: "pending" as const, items: [] },
    };
    await db
      .update(schema.scans)
      .set({ status: "done", result, frameCount, transcript: transcript.transcript, costUsd: samCost + assessment.costUsd, finishedAt: new Date() })
      .where(eq(schema.scans.id, scanId));
    await emit("done", "Your answer is ready");
    await enqueue("concepts", { scanId });
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
