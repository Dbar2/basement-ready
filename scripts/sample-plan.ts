// Gives the frozen sample a floor plan and a starting layout, so "See an example" shows the 3D staging.
// Runs the local 3D service on the sample video's frames, builds the plan from the sample's SAM finds,
// and writes plan, layout and measurements into public/samples/sample/result.json.
// Usage: SCAN3D_URL=http://127.0.0.1:8790 SCAN3D_TOKEN=dev tsx scripts/sample-plan.ts
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { suggestLayout } from "../server/layout";
import { buildPlan } from "../server/plan";
import { runScan3d, summarize } from "../server/scan3d";

const run = promisify(execFile);
const RESULT = "public/samples/sample/result.json";
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
const s3 = await runScan3d(work, { from: 0, to: frameCount }, {});
const measurements = summarize(s3, result.detections);
const plan = buildPlan(s3, result.detections, measurements.trusted);
if (!plan) throw new Error("No room box from the 3D scan");
const layout = suggestLayout(plan);
console.log(`room ${plan.box.maxX - plan.box.minX} × ${plan.box.maxZ - plan.box.minZ} m, ${plan.areaM2} m², trusted ${plan.trusted}`);
console.log(layout.zones.map((z) => `${z.name} ${z.areaM2} m²`).join(" · "));
for (const c of layout.checks) console.log(`${c.ok === null ? "?" : c.ok ? "ok" : "no"}  ${c.label}`);

writeFileSync(RESULT, JSON.stringify({ ...result, plan, layout, measurements: result.measurements ?? measurements }));
rmSync(work, { recursive: true, force: true });
