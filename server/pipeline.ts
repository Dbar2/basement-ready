// One scan: phone video in, a verdict with proof out. Runs inside a worker job and writes
// every step to scan_events, so the scan screen (and a refresh) can follow along.
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { finishAssessment, readWithSpark, type AssessContext, type SpeechTurn } from "./assess";
import { recheck, type AnswerValue } from "./recheck";
import { db, schema } from "./db";
import { enqueuePhotos, photosSoFar, settlePhotos } from "./photos";
import { findInPhotos, mergePhotoFinds } from "./photoFinds";
import { pointInPhoto, pointInVideo, withoutNamed } from "./pointFinds";
import { jpegSize } from "./concepts";
import { videoFinds } from "./videoFinds";
import { MIN_PHOTOS_3D, type PhotoTake } from "./photoInput";
import { cleanPlans, plansWords, PLANS_ID } from "./plans";
import { dataUrl, samImage, samVideo, transcribe, uploadFile } from "./meta";
import type { Property } from "./property";
import type { Household } from "./rules";
import { suggestLayout } from "./layout";
import { buildPlan, locate, rescalePlan, type Plan } from "./plan";
import { areaName, mainRoom, MAX_TAKE_S, MIN_ROOM_FRAMES, roomName, roomRanges, withIdeas, withoutGuide, type Idea, type Room, type RoomMark, type Span } from "./rooms";
import { basementViewpoints, mergeMesh, mergeSurfels, scanBasement, type BasementProgress, type BasementScan, type RoomPlacement } from "./basement";
import { measureBasementPlan, measuredPlan, reviewBasementPlan } from "./floorplan";
import type { BasementPlan } from "../src/api";
import { cameraLookup } from "./capture";
import { doorHeights, doorScale, lowOverhead, meshFaces, rescaleMeasurements, runScan3d, scan3dReady, summarize, type Measurements, type Scan3d } from "./scan3d";
import { keys, storage } from "./storage";
import { causeOf, FAILURE, stored } from "./failure";
import { charge, PRICES } from "./spend";
import { labelled } from "./demo";
import { roomNames } from "./watch";
import { sortClearances } from "./clearance";
import { checkPlanLater, startWatch, type Watching } from "./watchScan";

const run = promisify(execFile);

export const ANALYSIS_FPS = 5;
const SAM_USD_PER_FRAME = 0.2 / 1000; // Meta pricing, 50-frame minimum per request

// What SAM looks for. One concept per request, per the SAM docs. `video`: other words for a whole video,
// where they track better (scripts/practice: "metal duct" finds the round ducts and plenums that "ceiling
// duct" misses in a walk, but outlines flues and window wells in a single photo).
export const CONCEPTS: { concept: string; kind: string; label: string; video?: string }[] = [
  { concept: "basement window", kind: "window", label: "Window" },
  { concept: "staircase", kind: "stairs", label: "Stairs" },
  { concept: "ceiling duct", video: "metal duct", kind: "duct", label: "Duct" },
  { concept: "support beam", kind: "beam", label: "Beam" },
  { concept: "electrical panel", kind: "mechanical", label: "Electrical panel" },
  { concept: "water heater", kind: "mechanical", label: "Water heater" },
  { concept: "floor drain", kind: "mechanical", label: "Floor drain" },
  { concept: "door", kind: "exit", label: "Door" },
];
// SAM 3.1 never matches "furnace", "ceiling bulkhead" or "plumbing rough-in" by name (scripts/practice): a
// furnace, a bulkhead and pipes already in the floor (where a bathroom is cheapest, server/layout.ts) are
// found by pointing instead, with water heaters and panels the name missed (server/pointFinds.ts).

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

// `path` and `model` show the basement assembling on the wait screen (server/basement.ts BasementProgress).
export type ScanEventType = "log" | "find" | "measure" | "stage" | "done" | "error" | "path" | "model";

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
// A stored file's text, or null when it isn't there.
export async function storedText(key: string): Promise<string | null> {
  const body = await storage.get(key);
  if (!body) return null;
  const parts: Buffer[] = [];
  for await (const chunk of body) parts.push(chunk as Buffer);
  return Buffer.concat(parts).toString("utf8");
}

const cm = (points: [number, number][]) => points.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
const files3d = (scanId: string, query: string, mesh: boolean) => ({
  surfels: `/api/scans/${scanId}/3d/surfels.bin?${query}`,
  ...(mesh ? { mesh: `/api/scans/${scanId}/3d/mesh.bin?${query}` } : {}),
  scan: `/api/scans/${scanId}/3d/scan.json?${query}`,
});

// The walk, then each area saved and shown the moment it's measured, while the others still measure.
function progress3d(scanId: string, emit: (type: ScanEventType, text: string, data?: unknown) => Promise<void>): BasementProgress {
  return {
    path: (points) => emit("path", "", { points: cm(points) }),
    area: async (i, s3, place) => {
      await Promise.all([
        storage.put(keys.area3d(scanId, i, "scan.json"), Buffer.from(JSON.stringify(s3.scan)), "application/json"),
        ...(s3.surfels ? [storage.put(keys.area3d(scanId, i, "surfels.bin"), Buffer.from(s3.surfels), "application/octet-stream")] : []),
        ...(s3.mesh ? [storage.put(keys.area3d(scanId, i, "mesh.bin"), Buffer.from(s3.mesh), "application/octet-stream")] : []),
      ]);
      if (s3.surfels) await emit("model", "", { area: i, files: files3d(scanId, `area=${i}`, Boolean(s3.mesh)), place });
    },
  };
}

// The basement's own 3D files: every room's surface points and solid surface in one frame, and where
// the camera stood.
export async function saveBasement3d(scanId: string, b: BasementScan) {
  const rooms = b.scans.map((s3, i) => ({
    scan: s3.scan,
    surfels: s3.surfels,
    mesh: s3.mesh,
    rect: b.rects[i],
    placement: b.placements[i],
    frameNumbers: (s3.scan.frames ?? []).map((f: { sourceIndex: number }) => s3.sentFrames[f.sourceIndex]),
  }));
  const withPoints = rooms.filter((r): r is typeof r & { surfels: ArrayBuffer } => Boolean(r.surfels));
  const withMesh = rooms.filter((r): r is typeof r & { mesh: ArrayBuffer } => Boolean(r.mesh));
  await Promise.all([
    storage.put(keys.basement3d(scanId, "scan.json"), Buffer.from(JSON.stringify(basementViewpoints(rooms))), "application/json"),
    ...(withPoints.length ? [storage.put(keys.basement3d(scanId, "surfels.bin"), mergeSurfels(withPoints), "application/octet-stream")] : []),
    ...(withMesh.length ? [storage.put(keys.basement3d(scanId, "mesh.bin"), mergeMesh(withMesh, b.rects), "application/octet-stream")] : []),
  ]);
}

// How far to trust a size on the wait screen. Re-filming slowly helps a web take, whose 3D finds its own
// camera path; an app take's camera path is the phone's, and what's rough there is the depth itself
// (a floor 10 cm thick in the 3D), so a tape measurement is what fixes it, as for photos.
export function caveatFor(m: Measurements, photos = false) {
  if (!m.trusted) return photos || m.scaleSource === "arkit" ? " (rough: a tape measurement fixes it)" : " (rough: re-film slowly for exact sizes)";
  return m.scaleSource === "model" ? " (estimated)" : "";
}

// An app take's sizes on the wait screen: the whole plan's rooms, named as the watch named them. An area is
// a stretch of the walk (the stairs, half a room), so its own box isn't a room's size. Without a plan,
// each area's as before.
export function sizeLines(plan: BasementPlan | null | undefined, rooms: Room[]): { text: string; data: unknown }[] {
  const areas = rooms.filter((r) => r.measurements);
  if (!plan?.rooms.length) return areas.map((r) => ({ text: `${rooms.length > 1 ? `${r.name}: ` : "Measured "}${[r.measurements!.ceilingHeightM != null && `ceiling ${r.measurements!.ceilingHeightM.toFixed(2)} m`, r.measurements!.widthM != null && r.measurements!.depthM != null && `${r.measurements!.widthM.toFixed(1)} × ${r.measurements!.depthM.toFixed(1)} m`].filter(Boolean).join(" · ")}${caveatFor(r.measurements!)}`, data: r.measurements }));
  const caveat = areas.length && areas.every((r) => r.measurements!.trusted) ? "" : areas[0]?.measurements ? caveatFor({ ...areas[0].measurements, trusted: false }) : "";
  return plan.rooms.map((r, i) => {
    const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs);
    const ceiling = r.ceilingM ?? plan.ceilingM;
    const name = r.name || `Room ${i + 1}`;
    const sizes = [ceiling != null && `ceiling ${ceiling.toFixed(2)} m`, `${r.areaM2.toFixed(1)} m², ${w.toFixed(1)} × ${d.toFixed(1)} m`].filter(Boolean);
    return { text: `${plan.rooms.length > 1 ? `${name}: ` : "Measured "}${sizes.join(" · ")}${caveat}`, data: { room: r.id, areaM2: r.areaM2, widthM: w, depthM: d, ceilingHeightM: ceiling } };
  });
}

export async function finishRooms(
  scanId: string,
  ranges: { index: number; from: number; to: number }[],
  scans3d: (Scan3d | null)[],
  detections: Detection[],
  emit: (type: ScanEventType, text: string, data?: unknown) => Promise<void>,
  placements?: RoomPlacement[],
  // A photo take: its rooms' own names, where they typed one (the others are named here).
  photos?: { names: (string | null)[] },
  // What the watch pass saw and heard in each area ("Mom's room"), when nobody typed a name.
  watched: (string | null)[] = [],
  // An app take: the wait screen's sizes are the whole plan's rooms (sizeLines), not each area's.
  quiet = false,
): Promise<Room[]> {
  const furnaceFrames = detections.filter((d) => d.label === "Furnace").map((d) => d.frame);
  const named = new Set<string>();
  const rooms: Room[] = [];
  for (const r of ranges) {
    const s3 = scans3d[r.index];
    const typed = photos?.names[r.index] ?? watched[r.index] ?? null;
    let name = typed ?? (ranges.length === 1 ? "Your basement" : roomName(r.index, r.from, r.to, furnaceFrames, named));
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
      if (ranges.length > 1 && !typed) {
        named.delete(name);
        name = areaName(plan, rooms.filter((x) => !/^(Hall|Stairs)$/.test(x.name)).length + 1, r.from, r.to, furnaceFrames, named);
      }
      await Promise.all([
        // sentFrames maps the scan's frames back to ours, so the plan can be rebuilt later.
        storage.put(keys.scan3d(scanId, "scan.json", r.index), Buffer.from(JSON.stringify({ ...s3.scan, sentFrames: s3.sentFrames })), "application/json"),
        storage.put(keys.scan3d(scanId, "points.ply", r.index), Buffer.from(s3.ply), "application/octet-stream"),
        storage.put(keys.scan3d(scanId, "depth.bin", r.index), Buffer.from(s3.depth), "application/octet-stream"),
        ...(s3.surfels ? [storage.put(keys.scan3d(scanId, "surfels.bin", r.index), Buffer.from(s3.surfels), "application/octet-stream")] : []),
        ...(s3.mesh ? [storage.put(keys.scan3d(scanId, "mesh.bin", r.index), Buffer.from(s3.mesh), "application/octet-stream")] : []),
      ]);
      const sizes = [
        measurements.ceilingHeightM != null && `ceiling ${measurements.ceilingHeightM.toFixed(2)} m`,
        measurements.widthM != null && measurements.depthM != null && `${measurements.widthM.toFixed(1)} × ${measurements.depthM.toFixed(1)} m`,
      ].filter(Boolean);
      if (!quiet) await emit("measure", `${ranges.length > 1 ? `${name}: ` : "Measured "}${sizes.join(" · ")}${caveatFor(measurements, Boolean(photos))}`, measurements);
    }
    rooms.push({ index: r.index, name, startS: r.from / ANALYSIS_FPS, endS: r.to / ANALYSIS_FPS, has3d: Boolean(s3), plan, measurements, placement: placements?.[r.index] ?? null });
  }
  // Headroom that can't be headroom is set aside across the whole basement (server/clearance.ts).
  return sortClearances(rooms);
}

type Emit = (type: ScanEventType, text: string, data?: unknown) => Promise<void>;
type ScanInputs = {
  floorToJoistsM?: number;
  rooms?: RoomMark[];
  ideas?: Idea[];
  spoken?: Span[];
  lens?: "ultrawide" | "wide";
  wideAt?: number;
  demo?: boolean;
  photos?: PhotoTake; // a photo take (server/photoInput.ts) instead of a video
};
type StageInput = { scanId: string; videoKey: string; inputs: ScanInputs; work: string; ctx: AssessContext; emit: Emit; inflight: Promise<unknown>[] };
// What the input stage hands on: the finds, the measured rooms, and Spark's reading under way.
type Stage = {
  frameCount: number;
  detections: Detection[];
  transcript: { transcript: string; turns: SpeechTurn[] };
  rooms: Room[];
  sparkP: ReturnType<typeof readWithSpark>;
  uploads: Promise<unknown>;
  samCost: number;
  floorPlan?: BasementPlan | null; // app takes: the whole basement's plan (server/floorplan.ts), as measured
  // Spark's review of that plan, run once the answer is out (reviewPlanLater): null when there's no plan.
  reviewPlan?: (() => Promise<BasementPlan | null>) | null;
  watching: Watching;
};

// A video: frames and sound out of it, SAM following each thing through it, and the basement's 3D
// from the camera's walk.
async function videoStage({ scanId, videoKey, inputs, work, ctx, emit, inflight }: StageInput): Promise<Stage> {
  // Asked first, while the video downloads and ffmpeg reads it: a cold Modal takes up to two minutes.
  const readyP = scan3dReady();
  const input = join(work, `input${extname(videoKey) || ".mp4"}`);
  await storage.download(videoKey, input);
  const { analysis, wav, frameCount } = await prepare(work, input);
  if (!frameCount) throw new Error("ffmpeg: no frames in the video");
  await emit("log", `Reading ${frameCount} frames from your video`, { frameCount });
  const uploads = Promise.all([storage.putFile(keys.analysis(scanId), analysis, "video/mp4"), uploadFrames(scanId, work, frameCount)]);
  inflight.push(uploads.catch(() => {}));
  // Muse Wonder watches the whole take with its sound while SAM and the 3D work (server/watch.ts).
  const watching = startWatch(scanId, emit, { work, analysis, wav, frameCount, fps: ANALYSIS_FPS });
  inflight.push(watching.watch);

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
  inflight.push(transcriptP);

  // The 3D scan only needs the frames, so it runs alongside SAM: one room at a time, in filming order.
  const known = inputs.floorToJoistsM ? { floorToJoistsM: inputs.floorToJoistsM } : {};
  // One connected basement: a rough whole-walk pass places the areas, each measured on its own.
  // It starts once the service answers, without holding up SAM; a skipped 3D always says so.
  const no3d = "3D scan unavailable this time; checking from the video instead";
  const basementP: Promise<BasementScan | null> = readyP.then(async (ready) => {
    if (!ready) {
      await emit("log", no3d);
      return null;
    }
    return scanBasement(work, frameCount, known, (text) => emit("log", text), await cameraLookup(() => storedText(keys.capture(scanId)), ANALYSIS_FPS), progress3d(scanId, emit), watching.watch).catch(async (err) => {
      console.error(`[scan3d] ${scanId}: ${err instanceof Error ? err.message : err}`);
      await emit("log", no3d);
      return null;
    });
  });
  inflight.push(basementP);

  await emit("stage", "find");
  const fileId = await uploadFile(analysis, "video/mp4", "basement.mp4");

  const detections: Detection[] = [];
  await Promise.all(
    CONCEPTS.map(async (c) => {
      const raw = await samVideo(c.video ?? c.concept, fileId, frameCount).catch(() => "");
      // What holds for half a second, and one long, level beam at a time (server/videoFinds.ts).
      const found = videoFinds(c, raw, ANALYSIS_FPS);
      detections.push(...found);
      await emit("find", found.length ? `Found ${plural(found.length, c.label)}` : `No ${c.label.toLowerCase()} seen`, {
        kind: c.kind,
        label: c.label,
        detections: found,
      });
    }),
  );
  // Concept order, not the order SAM answered in: the same video always asks Spark the same thing.
  detections.sort((a, b) => CONCEPTS.findIndex((c) => c.concept === a.concept) - CONCEPTS.findIndex((c) => c.concept === b.concept));
  // What SAM can't find by name: once the watch says when each was filmed, Spark marks it on a frame there
  // and SAM tracks it through the video (server/pointFinds.ts), while the 3D measures.
  const framePath = (n: number) => join(work, "frames", `${String(n).padStart(4, "0")}.jpg`);
  const [frameW, frameH] = jpegSize(readFileSync(framePath(0))) ?? [720, 1280];
  const pointedP = watching.watch
    .then((w) => pointInVideo(w, { frameUrl: (n) => dataUrl(framePath(n), "image/jpeg"), fileId, frameCount, fps: ANALYSIS_FPS, w: frameW, h: frameH }))
    .catch((err) => {
      console.error(`[points] ${scanId}: ${err instanceof Error ? err.message : err}`);
      return { finds: [], costUsd: 0 };
    });
  inflight.push(pointedP);
  // The photos start now, from the finds and the wide shot, and land while the 3D measures.
  void uploads.then(() => enqueuePhotos(scanId)).catch((err) => console.error(`[photos] ${scanId}: ${err instanceof Error ? err.message : err}`));

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
  // A copy: the finds the 3D rules out below are taken from `detections` while Spark is still drawing its
  // proof frames, and Spark should read every find whether the 3D is fast or slow.
  const sparkP = readWithSpark(ctx, [...detections], transcript.transcript, transcript.turns);
  // Awaited after the 3D; a Spark failure meanwhile is still this scan's error, never an unhandled one.
  inflight.push(sparkP.catch(() => {}));

  const basement3d = await basementP;
  // The 3D service bills by the GPU second: an estimate per area, plus the rough pass over the walk.
  if (basement3d) charge("scan3d", (basement3d.scans.length + 1) * PRICES.scan3dArea());
  // Without the 3D, the phone's room marks still name the areas.
  const ranges = basement3d ? basement3d.spans.map((span, index) => ({ index, ...span })) : roomRanges(inputs.rooms ?? null, frameCount, ANALYSIS_FPS);
  const scans3d: (Scan3d | null)[] = basement3d ? basement3d.scans : ranges.map(() => null);
  const pointed = await pointedP;
  const extra = withoutNamed(pointed.finds, detections);
  for (const [label, finds] of Map.groupBy(extra, (d) => d.label)) {
    await emit("find", `Found ${plural(finds.length, label)}`, { kind: finds[0].kind, label, detections: finds });
  }
  detections.push(...extra);
  const low = lowOverhead(scans3d, detections);
  if (low.length) {
    for (const d of low) detections.splice(detections.indexOf(d), 1);
    await emit("log", `Left out ${plural(low.length, "find")} too low to be a beam or duct`);
  }
  const rooms = await finishRooms(scanId, ranges, scans3d, detections, emit, basement3d?.placements, undefined, roomNames(ranges, await watching.watch, ANALYSIS_FPS), Boolean(basement3d?.tracked));
  if (basement3d) {
    await saveBasement3d(scanId, basement3d);
    await emit("model", "", { area: "all", files: files3d(scanId, "room=all", basement3d.scans.some((s3) => s3.mesh)), path: cm(basement3d.path) });
  }
  // An app take's areas share the phone's world: one plan of the whole basement, with SAM's finds in it,
  // checked against the depth. It goes out with the answer as measured; Spark's look at it takes a minute
  // or more, so it runs after the answer (reviewPlanLater). Without it the plan is drawn from each area's
  // box, as before.
  const savePlan = (png: Buffer) => storage.put(keys.basement3d(scanId, "plan.png"), png, "image/png");
  const read = basement3d?.tracked
    ? await measureBasementPlan(work, basement3d, detections, { save: savePlan }).catch((err) => {
        console.error(`[plan] ${scanId}: ${err instanceof Error ? err.message : err}`);
        return null;
      })
    : null;
  const floorPlan = read && basement3d ? measuredPlan(read, basement3d) : null;
  if (basement3d?.tracked) for (const line of sizeLines(floorPlan, rooms)) await emit("measure", line.text, line.data);
  const reviewPlan = read && basement3d ? () => reviewBasementPlan(read, basement3d, { said: transcript.transcript, log: async (t) => console.log(`[plan] ${scanId}: ${t}`), save: savePlan }) : null;
  const samCost = CONCEPTS.length * Math.max(50, frameCount) * SAM_USD_PER_FRAME + pointed.costUsd;
  return { frameCount, detections, transcript, rooms, sparkP, uploads, samCost, floorPlan, reviewPlan, watching };
}

// "Found 2 windows, a door and the stairs"
export function findWords(found: Pick<Detection, "label">[]) {
  const counts = new Map<string, number>();
  for (const d of found) counts.set(d.label, (counts.get(d.label) ?? 0) + 1);
  const one = (label: string) => (/s$/i.test(label) ? `the ${label.toLowerCase()}` : `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label.toLowerCase()}`);
  const parts = [...counts].map(([label, n]) => (n === 1 ? one(label) : plural(n, label)));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}

// Each room of a photo take measured in 3D on its own, one at a time in room order, from its own run
// of photos. A room with fewer than MIN_PHOTOS_3D photos isn't measured, and one that fails is left
// out: either way its finds still count. Without `measure` (no 3D service) nothing is. scans[i] is room i's.
export async function measurePhotoRooms(
  take: PhotoTake,
  measure: ((range: { from: number; to: number }, areas: number) => Promise<Scan3d>) | null,
  log: (text: string) => Promise<void>,
  measured: (room: number, s3: Scan3d) => Promise<void> = async () => {},
): Promise<(Scan3d | null)[]> {
  const scans: (Scan3d | null)[] = take.rooms.map(() => null);
  const enough = take.rooms.flatMap((r, i) => (r.to - r.from >= MIN_PHOTOS_3D ? [i] : []));
  for (const [i, r] of take.rooms.entries()) {
    if (!enough.includes(i)) await log(`${r.name}: ${plural(r.to - r.from, "photo")} is too few to measure, so only its finds count`);
  }
  if (!measure) return scans;
  for (const [k, i] of enough.entries()) {
    const r = take.rooms[i];
    await log(enough.length > 1 ? `Measuring area ${k + 1} of ${enough.length}: ${r.name}` : "Measuring your basement");
    scans[i] = await measure({ from: r.from, to: r.to }, enough.length).catch(async (err) => {
      console.error(`[scan3d] ${r.name}: ${err instanceof Error ? err.message : err}`);
      await log(`${r.name} couldn't be measured this time; its finds still count`);
      return null;
    });
    if (scans[i]) await measured(i, scans[i]!);
  }
  return scans;
}

// A photo take: its photos are already the frames, upright and in room order (server/photoInput.ts).
// SAM reads each photo while each room with enough photos is measured in 3D on its own; then the same
// thing seen in two photos of a room becomes one find, and Spark reads the finds. There's no sound to
// hear. Rooms aren't placed in one plan (a photo has no walk to place it by): each is shown on its own.
async function photoStage({ scanId, inputs, work, ctx, emit, inflight }: StageInput, take: PhotoTake): Promise<Stage> {
  const frameCount = take.count;
  const ranges = take.rooms.map((r, index) => ({ index, from: r.from, to: r.to }));
  const roomOf = (frame: number) => ranges.find((r) => frame >= r.from && frame < r.to)?.index ?? 0;
  const measurable = ranges.some((r) => r.to - r.from >= MIN_PHOTOS_3D);
  // Asked first, while the photos download: a cold Modal takes up to two minutes.
  const readyP = measurable ? scan3dReady() : Promise.resolve(false);

  const framePath = (n: number) => join(work, "frames", `${String(n).padStart(4, "0")}.jpg`);
  await Promise.all(Array.from({ length: frameCount }, (_, n) => storage.download(keys.frame(scanId, n), framePath(n))));
  await emit("log", `Reading ${frameCount} photos of ${take.rooms.length === 1 ? "one room" : `${take.rooms.length} rooms`}`, { frameCount, photos: take.rooms });
  // Muse Wonder looks at every photo together while SAM and the 3D work (server/watch.ts).
  const watching = startWatch(scanId, emit, { work, framePath, photos: take });
  inflight.push(watching.watch);

  // Each room's 3D alongside SAM, once the service answers. The wait screen shows each room as it's measured.
  const known = inputs.floorToJoistsM ? { floorToJoistsM: inputs.floorToJoistsM } : {};
  const progress = progress3d(scanId, emit);
  const scans3dP = readyP
    .then(async (ready) => {
      if (!ready) await emit("log", measurable ? "3D scan unavailable this time; checking from the photos instead" : "3D scan unavailable: a room needs 3 or more photos to measure");
      return measurePhotoRooms(
        take,
        ready ? (r, areas) => runScan3d(work, r, known, { maxFaces: meshFaces(areas) }) : null,
        (text) => emit("log", text),
        (i, s3) => progress.area(i, s3, null),
      );
    })
    .catch(() => ranges.map(() => null));
  inflight.push(scans3dP);

  await emit("stage", "find");
  const images = new Map<number, string>();
  const image = (n: number) => images.get(n) ?? images.set(n, dataUrl(framePath(n), "image/jpeg")).get(n)!;
  let pointCost = 0;
  const found = await findInPhotos(
    frameCount,
    CONCEPTS,
    (concept, n) => samImage(concept, image(n)),
    (n, finds) => emit("find", finds.length ? `Found ${findWords(finds)} in photo ${n + 1}` : `Nothing found in photo ${n + 1}`, { photo: n, room: take.rooms[roomOf(n)].name, detections: finds }),
    8,
    async (n) => {
      const [w, h] = jpegSize(readFileSync(framePath(n))) ?? [1280, 960];
      const p = await pointInPhoto(n, image(n), w, h);
      pointCost += p.costUsd;
      return p.finds;
    },
  );
  images.clear();
  // The photos of what it could look like start now, from the finds.
  void enqueuePhotos(scanId).catch((err) => console.error(`[photos] ${scanId}: ${err instanceof Error ? err.message : err}`));

  const scans3d = await scans3dP;
  charge("scan3d", scans3d.filter(Boolean).length * PRICES.scan3dArea());
  const { finds: detections, matched } = mergePhotoFinds(found, roomOf, (d) => {
    const s3 = scans3d[roomOf(d.frame)];
    const at = s3 ? locate(s3, d) : null;
    return at ? [at.center[0], at.center[2]] : null;
  });
  if (matched) await emit("log", `Matched ${plural(matched, "find")} seen in more than one photo`);
  const low = lowOverhead(scans3d, detections);
  if (low.length) {
    for (const d of low) detections.splice(detections.indexOf(d), 1);
    await emit("log", `Left out ${plural(low.length, "find")} too low to be a beam or duct`);
  }

  await emit("stage", "assess");
  await emit("log", "Checking your city's second-unit rules");
  const sparkP = readWithSpark({ ...ctx, photos: take.count }, [...detections], "", []);
  inflight.push(sparkP.catch(() => {}));
  // A room they named keeps its name; "Room 2" may still turn out to be the furnace room.
  const names = take.rooms.map((r) => (/^room \d+$/i.test(r.name) ? null : r.name));
  const rooms = await finishRooms(scanId, ranges, scans3d, detections, emit, undefined, { names }, roomNames(ranges, await watching.watch, 1));
  // The 3D's own sense of size, with no walk or tape to check it against.
  if (rooms.some((r) => r.has3d)) await emit("log", "Sizes from photos are a close guess, within about 20%. One tape measurement on the next step makes them true to size.");
  return { frameCount, detections, transcript: { transcript: "", turns: [] }, rooms, sparkP, uploads: Promise.resolve(), samCost: frameCount * CONCEPTS.length * PRICES.samImage + pointCost, watching };
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
  // Work still reading the folder when something fails: the folder goes only once it's settled, and a
  // failure in it never goes unhandled (that would take the whole server down).
  const inflight: Promise<unknown>[] = [];

  try {
    await emit("stage", "prepare");
    const inputs = (scan.inputs ?? {}) as ScanInputs;
    const ctx: AssessContext = { dir: work, household: basement.household as Household, municipality: basement.municipality, property: basement.property as Property | null };
    const stageInput = { scanId, videoKey: scan.videoKey, inputs, work, ctx, emit, inflight };
    const { frameCount, detections, transcript, rooms, sparkP, uploads, samCost, floorPlan, reviewPlan, watching } = inputs.photos ? await photoStage(stageInput, inputs.photos) : await videoStage(stageInput);

    // The rules check one room's numbers: the best-scanned one.
    const main = mainRoom(rooms);
    const measurements = main?.measurements ?? null;
    const plan = main?.plan ?? null;

    // They may have answered "who's it for" while this ran.
    const [latest] = await db.select().from(schema.basements).where(eq(schema.basements.id, basement.id));
    const household = (latest?.household ?? basement.household) as Household;
    const assessment = finishAssessment({ ...ctx, household, watch: await watching.watch, rooms }, await sparkP, detections, measurements);
    await uploads;

    const assessed = {
      id: scanId,
      household,
      frameCount,
      detections,
      transcript: transcript.transcript,
      has3d: rooms.some((r) => r.has3d),
      plan,
      rooms,
      floorPlan: floorPlan ?? null,
      mainRoom: main?.index ?? null,
      ...assessment.result,
    };
    // Questions answered while it ran are applied now; recheck also redoes the plan with the room's size.
    const answered = await db.select().from(schema.answers).where(eq(schema.answers.basementId, basement.id));
    const rechecked = recheck(assessed, Object.fromEntries(answered.map((a) => [a.ruleId, a.value as AnswerValue])));
    const plans = cleanPlans(answered.find((a) => a.ruleId === PLANS_ID)?.value);
    // Ideas they tapped while filming count as much as what they said.
    // A starting layout inside the main room, for the 3D staging, the plan drawing and the brief.
    // The demo house: Waterloo's rules for a house that isn't real, labelled wherever it shows.
    const result = labelled({
      ...rechecked,
      vision: withIdeas(rechecked.vision, inputs.ideas, rooms),
      // How it was filmed: the lens, and the still wide shot the staged photos start from. A photo take
      // says how many photos: its sizes are the 3D's own guess, so the plan asks for a tape measurement.
      capture: { lens: inputs.lens ?? null, wideAt: inputs.wideAt ?? null, ...(inputs.photos ? { photos: inputs.photos.count } : {}) },
      // What Muse Wonder watched and heard: the rooms in order, how they join, what was said (server/watch.ts).
      watch: await watching.watch,
      layout: plan ? suggestLayout(plan) : null,
      // What they'd like it to be, from the wait screen: their wish when the video didn't say one.
      plans,
      wants: rechecked.wants || plansWords(plans),
      // The photos started with the finds; whatever has landed so far comes with the answer.
      concepts: await photosSoFar(scanId),
    }, Boolean(inputs.demo));
    await db
      .update(schema.scans)
      .set({ status: "done", result, frameCount, transcript: transcript.transcript, costUsd: samCost + assessment.costUsd + ((await watching.watch)?.costUsd ?? 0), finishedAt: new Date() })
      .where(eq(schema.scans.id, scanId));
    await emit("done", "Your answer is ready");
    // The as-built 3D: the plan painted with the video (server/asBuilt.ts), in the background.
    void import("./asBuilt").then((m) => m.paintAsBuiltLater(scanId));
    // Photos that finished while this was written go in now; photos that never started, start.
    await settlePhotos(scanId);
    await enqueuePhotos(scanId);
    // Spark's look at the plan, then Muse Wonder's check of it against the take for "Is this your basement?"
    // (server/planCheck.ts), on the plan as it then stands.
    inflight.push(reviewPlanLater(scanId, reviewPlan ?? null).then((reviewed) => checkPlanLater(scanId, reviewed ? { ...result, floorPlan: reviewed } : result, watching)));
  } catch (err) {
    // The real cause, in plain words; a missing key or an unreadable file won't fix itself on a retry.
    const cause = causeOf(err);
    if (opts.lastAttempt || !FAILURE[cause].retry) {
      await db.update(schema.scans).set({ status: "error", error: stored(cause, err), finishedAt: new Date() }).where(eq(schema.scans.id, scanId));
      await emit("error", FAILURE[cause].text, { cause, retry: FAILURE[cause].retry });
      if (!FAILURE[cause].retry) {
        console.error(`[scan] ${scanId}: ${stored(cause, err)}`);
        return;
      }
    } else {
      await emit("log", "Hit a snag, trying again…");
    }
    throw err;
  } finally {
    await Promise.allSettled(inflight);
    rmSync(work, { recursive: true, force: true });
  }
}

// After the answer: Spark's review of an app take's plan (server/floorplan.ts). When it changes the plan,
// the answer's plan becomes the reviewed one; pages that read the plan pick it up from there (a design
// they've already saved keeps the plan it was drawn on). Never throws.
export async function reviewPlanLater(scanId: string, review: (() => Promise<BasementPlan | null>) | null): Promise<BasementPlan | null> {
  if (!review) return null;
  try {
    const reviewed = await review();
    if (!reviewed) return null;
    await db
      .update(schema.scans)
      .set({ result: sql`jsonb_set(${schema.scans.result}, '{floorPlan}', ${JSON.stringify(reviewed)}::jsonb)` })
      .where(and(eq(schema.scans.id, scanId), isNotNull(schema.scans.result)));
    return reviewed;
  } catch (err) {
    console.error(`[plan review] ${scanId}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
