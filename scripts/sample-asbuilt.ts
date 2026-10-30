// Paints the example's as-built 3D (server/asBuilt.ts does this for real scans) into
// public/samples/sample/3d/asbuilt/. The example's committed 3D keeps only where the camera stood, not
// its lens or depth, so this measures the example's frames again with the local 3D service (the same
// frames and model as scripts/sample-plan.ts, so the same cameras), checks they still match, and paints
// the plan the example's model is seeded with (server/model/routes.ts sampleModel).
// Usage: SCAN3D_URL=http://127.0.0.1:8790 SCAN3D_TOKEN=dev SCAN3D_PYTHON=…/services/scan3d/.venv/bin/python tsx scripts/sample-asbuilt.ts
// Run it again whenever the example's plan (result.json) or the model's seeding changes.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { areasOf, firstCamera, paintRequest, type Area } from "../server/asBuilt";
import { basementViewpoints, scanBasement, type RoomPlacement } from "../server/basement";
import type { Scan3d } from "../server/scan3d";
import { seedModel } from "../server/model/seed";
import { asBuiltKey, buildAsBuilt } from "../src/three/AsBuiltModel";

void areasOf; // the server reads areas from storage; here they come straight from the 3D service
const PY = process.env.SCAN3D_PYTHON ?? "services/scan3d/.venv/bin/python";
const SAMPLE = "public/samples/sample";
const OUT = `${SAMPLE}/3d/asbuilt`;
const work = resolve("tmp/asbuilt/sample-work");

const result = JSON.parse(readFileSync(`${SAMPLE}/result.json`, "utf8"));
// The measuring is kept in tmp/ between runs (--fresh measures again).
const cached = join(work, "basement.json");
let b: { scans: Scan3d[]; placements: RoomPlacement[] };
if (existsSync(cached) && !process.argv.includes("--fresh")) {
  const kept = JSON.parse(readFileSync(cached, "utf8"));
  b = { placements: kept.placements, scans: kept.scans.map((s: any, i: number) => ({ ...s, depth: new Uint8Array(readFileSync(join(work, `area-${i}-depth.bin`))).buffer, ply: new ArrayBuffer(0) })) };
} else {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "frames"), { recursive: true });
  // The pipeline's frames: 5 a second, 1280 on the long side (as scripts/sample-plan.ts).
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${SAMPLE}-basement.mp4`, "-vf", "fps=5,scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'", "-q:v", "2", "-start_number", "0", join(work, "frames", "%04d.jpg")]);
  const measured = await scanBasement(work, readdirSync(join(work, "frames")).length, {}, async (t) => console.log(t));
  if (!measured) throw new Error("No 3D from the local service");
  b = measured;
  b.scans.forEach((s3, i) => writeFileSync(join(work, `area-${i}-depth.bin`), Buffer.from(s3.depth)));
  writeFileSync(cached, JSON.stringify({ placements: b.placements, scans: b.scans.map((s3) => ({ scan: s3.scan, sentFrames: s3.sentFrames })) }));
}

// MapAnything doesn't measure the same frames to the millimetre twice, so this measuring is fitted onto
// the committed camera path (a turn about the vertical, a shift and a scale): the plan was drawn in
// that frame. The fit has to be tight, or the paint would land beside the walls.
const files = b.scans.map((s3, i) => ({ scan: s3.scan, placement: b.placements[i], frameNumbers: (s3.scan.frames ?? []).map((f: { sourceIndex: number }) => s3.sentFrames[f.sourceIndex]) }));
const now = basementViewpoints(files).frames;
const then: { frame: number; pose: number[][] }[] = JSON.parse(readFileSync(`${SAMPLE}/3d/scan.json`, "utf8")).frames;
const pairs = now.flatMap((f) => {
  const g = then.find((x) => x.frame === f.frame);
  return g ? [[f.pose.map((r) => r[3]), g.pose.map((r) => r[3])]] : [];
});
if (pairs.length < 8) throw new Error("Too few of the committed cameras were measured again: run scripts/sample-plan.ts first.");
const mean = (k: 0 | 1, i: number) => pairs.reduce((a, p) => a + p[k][i], 0) / pairs.length;
const [px, py, pz, qx, qy, qz] = [mean(0, 0), mean(0, 1), mean(0, 2), mean(1, 0), mean(1, 1), mean(1, 2)];
let A = 0, B = 0, N = 0;
for (const [p, q] of pairs) {
  const [ax, az, bx, bz] = [p[0] - px, p[2] - pz, q[0] - qx, q[2] - qz];
  A += ax * bx + az * bz;
  B += ax * bz - az * bx;
  N += ax * ax + az * az;
}
const theta = Math.atan2(B, A), scale = Math.hypot(A, B) / N, c = Math.cos(theta), sn = Math.sin(theta);
const fit = (p: number[]) => [scale * (c * (p[0] - px) - sn * (p[2] - pz)) + qx, scale * (p[1] - py) + qy, scale * (sn * (p[0] - px) + c * (p[2] - pz)) + qz];
const miss = pairs.map(([p, q]) => Math.hypot(...fit(p).map((v, i) => v - q[i])));
const rms = Math.sqrt(miss.reduce((a, m) => a + m * m, 0) / miss.length);
console.log(`fit: turned ${((theta * 180) / Math.PI).toFixed(2)}°, scaled ${scale.toFixed(4)}; cameras off by ${(rms * 100).toFixed(1)} cm (rms), ${(Math.max(...miss) * 100).toFixed(1)} cm at most`);
if (rms > 0.05 || Math.max(...miss) > 0.15) throw new Error("This measuring doesn't fit the committed one: run scripts/sample-plan.ts first, then this.");
// Each frame's pose in the committed frame, kept in room units so depth scales with it (areaScale).
const rot = [[c, 0, -sn], [0, 1, 0], [sn, 0, c]];
const committedPose = (P: number[][]) => {
  const R = [0, 1, 2].map((r) => [0, 1, 2].map((col) => rot[r][0] * P[0][col] + rot[r][1] * P[1][col] + rot[r][2] * P[2][col]));
  const t = fit([P[0][3], P[1][3], P[2][3]]).map((v) => v / scale);
  return [...R.map((row, r) => [...row, t[r]]), [0, 0, 0, 1]];
};

const existing = seedModel(result, {}, "2026-10-30T00:00:00.000Z")!.existing;
const areas: Area[] = b.scans.map((s3, i) => {
  const room = result.rooms.find((r: { index: number }) => r.index === i) ?? result.rooms[0];
  const placed = basementViewpoints([files[i]]).frames;
  const frames = (s3.scan.frames ?? []).map((f: { pose: number[][] }, j: number) => ({ ...f, pose: committedPose(placed[j].pose) }));
  return { room, placement: { turn: 0, x: 0, z: 0 }, scan: { ...s3.scan, frames, sentFrames: s3.sentFrames }, depth: Buffer.from(s3.depth), areaScale: scale };
});
const k = existing.scale.factor ?? 1;
const stairTop = firstCamera(areas, k);
const model = buildAsBuilt(existing, { stairTop });
const { job, frames, depths } = await paintRequest({ model, existing, areas }, async (n) => readFileSync(join(work, "frames", `${String(n).padStart(4, "0")}.jpg`)));
const depthFiles = depths.map((d, i) => {
  const path = join(work, `depth-${i}.bin`);
  writeFileSync(path, d.data);
  return { path, shape: d.shape };
});
writeFileSync(join(work, "job.json"), JSON.stringify({ ...job, images: frames.map((f) => join(work, "frames", f.name)), depthFiles }));
rmSync(OUT, { recursive: true, force: true });
execFileSync(PY, ["-m", "scan3d.texture", join(work, "job.json"), OUT], { stdio: "inherit", env: { ...process.env, PYTHONPATH: resolve("services/scan3d") } });
const index = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8"));
writeFileSync(join(OUT, "index.json"), JSON.stringify({ ...index, key: asBuiltKey(model), stairTop, floorY: 0 }));
console.log(Object.entries(index.surfaces as Record<string, { coverage: number }>).map(([id, e]) => `${id} ${Math.round(e.coverage * 100)}%`).join(" · "));
process.exit(0); // the server modules keep a database open
