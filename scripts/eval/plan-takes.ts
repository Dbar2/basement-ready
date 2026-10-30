// Caches what the floor plan is read from, so services/scan3d/plan_eval.py can score a change to the plan
// in seconds: each area's 3D (scan.json with its frames, points, depth), the camera's walk, and SAM's finds
// when the take has them. Written to tmp/eval/plan/<take>/.
//
//   tsx scripts/eval/plan-takes.ts --take b1,b2,b3          rendered basements, filmed with their true camera
//                                                           path (capture.json), areas cut from that path
//   tsx scripts/eval/plan-takes.ts --scan <id> [--name x]   a real take already scanned: its saved 3D files,
//                                                           placements and finds (no GPU work)
//
// --take needs the 3D service: SCAN3D_URL and SCAN3D_TOKEN (the Mac runner, or Modal for speed).
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { trackedWalk } from "../../server/basement";
import { cameraLookup } from "../../server/capture";
import { runScan3d } from "../../server/scan3d";

const run = promisify(execFile);
const MAIN = process.env.BR_MAIN ?? join(process.cwd(), "..", "..", "..");
const MEDIA = existsSync("media") ? "media" : join(MAIN, "media");
const OUT = "tmp/eval/plan";
const FPS = 5;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function frames(video: string, dir: string) {
  if (existsSync(join(dir, "0000.jpg"))) return readdirSync(dir).filter((f) => f.endsWith(".jpg")).length;
  mkdirSync(dir, { recursive: true });
  // The pipeline's frames: 5 a second, 1280 on the long side (server/pipeline.ts prepare).
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-t", "300", "-vf", `fps=${FPS},scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'`, "-q:v", "2", "-start_number", "0", join(dir, "%04d.jpg")]);
  return readdirSync(dir).filter((f) => f.endsWith(".jpg")).length;
}

async function rendered(id: string) {
  const src = readdirSync(join(MEDIA, "eval")).find((d) => d.startsWith(id));
  if (!src) throw new Error(`no rendered basement ${id} in ${MEDIA}/eval`);
  const out = join(OUT, src);
  const frameCount = await frames(join(MEDIA, "eval", src, "walkthrough.mp4"), join(out, "frames"));
  const capture = readFileSync(join(MEDIA, "eval", src, "capture.json"), "utf8");
  const cameraFor = await cameraLookup(async () => capture, FPS);
  if (!cameraFor) throw new Error("capture.json didn't read");
  const walk = trackedWalk(frameCount, cameraFor);
  if (!walk) throw new Error("too little of the walk was tracked");
  const cams: (number[] | null)[] = Array.from({ length: frameCount }, (_, n) => {
    const c = cameraFor(n);
    return c ? [c.pose[0][3], c.pose[1][3], c.pose[2][3]] : null;
  });
  const areas = [];
  for (const [i, span] of walk.spans.entries()) {
    const dir = join(out, `area-${i}`);
    if (!existsSync(join(dir, "depth.bin"))) {
      console.log(`[${src}] area ${i + 1} of ${walk.spans.length}: frames ${span.from}-${span.to}`);
      const s3 = await runScan3d(out, span, {}, { cameraFor, maxFaces: 100_000 });
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "scan.json"), JSON.stringify({ ...s3.scan, sentFrames: s3.sentFrames }));
      writeFileSync(join(dir, "points.ply"), Buffer.from(s3.ply));
      writeFileSync(join(dir, "depth.bin"), Buffer.from(s3.depth));
      if (s3.mesh) writeFileSync(join(dir, "mesh.bin"), Buffer.from(s3.mesh));
    }
    areas.push({ dir: `area-${i}`, span });
  }
  writeFileSync(join(out, "bundle.json"), JSON.stringify({ take: src, kind: "tracked", truth: src, frameCount, fps: FPS, areas, cams, detections: [] }));
  console.log(`[${src}] ${areas.length} areas cached in ${out}`);
}

async function scanned(id: string, name: string) {
  const res = await fetch(`http://localhost:${process.env.API_PORT ?? 8787}/api/scans/${id}`);
  if (!res.ok) throw new Error(`scan ${id}: ${res.status}`);
  const result = (await res.json()).result;
  const out = join(OUT, name);
  const base = join(MEDIA, "private", "scans", id);
  const areas = [];
  for (const r of result.rooms ?? []) {
    const from = join(base, "3d", r.index > 0 ? `room-${r.index}` : "");
    if (!existsSync(join(from, "depth.bin"))) continue;
    const dir = join(out, `area-${r.index}`);
    mkdirSync(dir, { recursive: true });
    for (const f of ["scan.json", "points.ply", "depth.bin", "mesh.bin"]) if (existsSync(join(from, f))) cpSync(join(from, f), join(dir, f));
    areas.push({ dir: `area-${r.index}`, span: { from: Math.round(r.startS * FPS), to: Math.round(r.endS * FPS) }, placement: r.placement ?? null, name: r.name });
  }
  if (!existsSync(join(out, "frames"))) cpSync(join(base, "frames"), join(out, "frames"), { recursive: true });
  const capture = existsSync(join(base, "capture.json")) ? readFileSync(join(base, "capture.json"), "utf8") : null;
  const cameraFor = capture ? await cameraLookup(async () => capture, FPS) : null;
  const cams = cameraFor ? Array.from({ length: result.frameCount }, (_, n) => {
    const c = cameraFor(n);
    return c ? [c.pose[0][3], c.pose[1][3], c.pose[2][3]] : null;
  }) : null;
  writeFileSync(join(out, "bundle.json"), JSON.stringify({ take: name, scanId: id, kind: cams ? "tracked" : "placed", truth: name, frameCount: result.frameCount, fps: FPS, areas, cams, detections: result.detections ?? [] }));
  console.log(`[${name}] ${areas.length} areas cached in ${out}`);
}

const takes = arg("take");
const scan = arg("scan");
if (takes) for (const t of takes.split(",")) await rendered(t);
else if (scan) await scanned(scan, arg("name") ?? scan.slice(0, 8));
else console.log("Usage: tsx scripts/eval/plan-takes.ts --take b1,b2,b3 | --scan <id> [--name david-05x]");
