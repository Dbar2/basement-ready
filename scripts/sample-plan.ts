// Gives the frozen sample its 3D: the same whole-basement scan new scans get (server/basement.ts), so
// "See an example" shows the plan, the layout, the photo-like walk-through and the staging.
// Runs the local 3D service on the sample video's frames, builds each area's plan from the sample's SAM
// finds, writes rooms, plan, layout and measurements into public/samples/sample/result.json, and the 3D
// files into public/samples/sample/3d/ (the solid mesh.bin, surfels.bin and a phone-sized surfels-lite.bin
// for viewers without the mesh, scan.json).
// Usage: SCAN3D_URL=http://127.0.0.1:8790 SCAN3D_TOKEN=dev tsx scripts/sample-plan.ts
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { basementViewpoints, mergeMesh, mergeSurfels, scanBasement } from "../server/basement";
import { suggestLayout } from "../server/layout";
import { buildPlan } from "../server/plan";
import { mainRoom, type Room } from "../server/rooms";
import { liteSurfels, summarize } from "../server/scan3d";

const run = promisify(execFile);
const SAMPLE = "public/samples/sample";
const RESULT = `${SAMPLE}/result.json`;
const work = "media/private/scans/sample-plan";

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "frames"), { recursive: true });
// The same frames the pipeline makes: 5 a second, 1280 on the long side.
await run("ffmpeg", [
  "-y", "-loglevel", "error", "-i", "public/samples/sample-basement.mp4",
  "-vf", "fps=5,scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'",
  "-q:v", "2", "-start_number", "0", join(work, "frames", "%04d.jpg"),
]);
const frameCount = readdirSync(join(work, "frames")).length;

const result = JSON.parse(readFileSync(RESULT, "utf8"));
const b = await scanBasement(work, frameCount, {}, async (t) => console.log(t));
if (!b) throw new Error("No 3D from the local service");
const rooms: Room[] = b.scans.map((s3, index) => {
  const measurements = summarize(s3, result.detections);
  const plan = buildPlan(s3, result.detections, measurements.trusted);
  const span = b.spans[index];
  return { index, name: b.scans.length === 1 ? "Your basement" : `Room ${index + 1}`, startS: span.from / 5, endS: span.to / 5, has3d: true, plan, measurements, placement: b.placements[index] };
});
const main = mainRoom(rooms);
if (!main?.plan) throw new Error("No room box from the 3D scan");
const layout = suggestLayout(main.plan);
for (const r of rooms) console.log(`${r.name}: ${r.plan?.widthM} × ${r.plan?.depthM} m, ${r.plan?.areaM2} m², trusted ${r.plan?.trusted}, placed ${JSON.stringify(r.placement)}`);
console.log(layout.zones.map((z) => `${z.name} ${z.areaM2} m²`).join(" · "));

const files = b.scans.map((s3, i) => ({
  scan: s3.scan,
  surfels: s3.surfels!,
  placement: b.placements[i],
  frameNumbers: (s3.scan.frames ?? []).map((f: { sourceIndex: number }) => s3.sentFrames[f.sourceIndex]),
}));
const surfels = mergeSurfels(files);
mkdirSync(`${SAMPLE}/3d`, { recursive: true });
// The example lives in the repo: 800k points is plenty on a desktop; phones get the lite file.
writeFileSync(`${SAMPLE}/3d/surfels.bin`, liteSurfels(surfels, 800_000));
writeFileSync(`${SAMPLE}/3d/surfels-lite.bin`, liteSurfels(surfels));
writeFileSync(`${SAMPLE}/3d/scan.json`, JSON.stringify(basementViewpoints(files)));
console.log(`3D: ${surfels.readUInt32LE(4)} points, ${(surfels.length / 1e6).toFixed(1)} MB`);
const mesh = mergeMesh(b.scans.flatMap((s3, i) => (s3.mesh ? [{ mesh: s3.mesh, placement: b.placements[i], rect: b.rects[i] }] : [])), b.rects);
writeFileSync(`${SAMPLE}/3d/mesh.bin`, mesh);
console.log(`Solid: ${mesh.readUInt32LE(8)} triangles, ${(mesh.length / 1e6).toFixed(1)} MB`);

writeFileSync(
  RESULT,
  JSON.stringify({ ...result, rooms, mainRoom: main.index, has3d: true, plan: main.plan, layout, measurements: main.measurements ?? result.measurements }),
);
rmSync(work, { recursive: true, force: true });
