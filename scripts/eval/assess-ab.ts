// The verdict agent (server/assess.ts) on two models over the rendered basements: the same SAM finds,
// proof frames and rules go to each, code applies the true measurements (so the 3D's error is left out),
// and each reading is scored against truth.json: the escape window, the fire separations, the verdict.
//   tsx --env-file=.env scripts/eval/assess-ab.ts [--only b2,b3] [--runs 2] [--models muse-spark-1.3,muse-wonder-1.0]
// SAM runs once per basement and is recorded (REPLAY_DIR, default the main checkout's media/private/replay),
// so a rerun costs only the readings: about $0.03 each on Spark and $0.10 on Wonder. Each reading is saved
// to tmp/eval/ab/<id>/, and the scores to tmp/eval/ab/report.md.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { finishAssessment, readWithSpark } from "../../server/assess";
import { uploadFile, samVideo } from "../../server/meta";
import { bestFrame, parseSam } from "../../server/sam";
import type { Measurements } from "../../server/scan3d";

process.env.PGLITE_DIR ??= "memory://"; // the pipeline module opens a database; this script needs none
const { ANALYSIS_FPS, CONCEPTS } = await import("../../server/pipeline");

// SAM's answer on the whole video for one concept, as finds, the way server/pipeline.ts videoStage makes
// them (keep the two in step): an object must hold for half a second to count.
function videoFinds(c: (typeof CONCEPTS)[number], raw: string) {
  return parseSam(raw)
    .filter((t) => t.frames.length >= Math.ceil(ANALYSIS_FPS / 2))
    .slice(0, 6)
    .map((t, i) => {
      const b = bestFrame(t);
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
        track: [],
      };
    });
}

const run = promisify(execFile);
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const MAIN = process.env.BR_MAIN ?? join(process.cwd(), "..", "..", "..");
const MEDIA = existsSync("media/eval") ? "media" : join(MAIN, "media");
process.env.REPLAY_DIR ??= join(MEDIA, "private", "replay");
const OUT = "tmp/eval/ab";
const ONLY = arg("only", "").split(",").filter(Boolean);
const RUNS = Number(arg("runs", "2"));
const MODELS = arg("models", "muse-spark-1.3,muse-wonder-1.0").split(",");

type Said = "fix" | "ok" | "open";
type Truth = { id: string; durationS: number; expected: { egressWindow: boolean; fixes: string[]; verdict: "yes" | "fix"; minCeilingM: number; minClearanceM: number | null } };

// What the model-read rules should say. The height rules are left out: code decides them from measurements.
const RULES: Record<string, string[]> = {
  egress: ["egress_window_bedroom_area", "egress_window_min_dimension"],
  fire: ["fire_separation_between_units"],
  service: ["service_room_separation"],
};
const expectedOf = (t: Truth): Record<string, "fix" | "ok"> => ({
  egress: t.expected.egressWindow ? "ok" : "fix",
  fire: t.expected.fixes.includes("fire_separation_between_units") ? "fix" : "ok",
  service: t.expected.fixes.includes("service_room_separation") ? "fix" : "ok",
});
const said = (statuses: string[]): Said => (statuses.includes("likely_fix") ? "fix" : statuses.includes("likely_ok") ? "ok" : "open");
// right: what was due. hedge: no claim where none was needed. missed: no claim where a fix was due. wrong: the opposite.
const grade = (want: "fix" | "ok", got: Said) => (got === want ? "right" : got === "open" ? (want === "fix" ? "missed" : "hedge") : "wrong");

// The true sizes, as a tape-measured scan would give them.
const measured = (t: Truth): Measurements => ({
  ceilingHeightM: t.expected.minCeilingM,
  widthM: null,
  depthM: null,
  scaleSource: "arkit",
  confidence: "high",
  expectedErrorPct: 0.5,
  pass: null,
  trusted: true,
  warnings: [],
  clearances: t.expected.minClearanceM != null ? [{ detectionId: "truth", label: "Lowest", clearanceM: t.expected.minClearanceM }] : [],
});

async function finds(id: string, work: string, video: string) {
  const saved = join(work, "detections.json");
  if (existsSync(saved)) return JSON.parse(readFileSync(saved, "utf8"));
  // As server/pipeline.ts prepare(): the same analysis video and frames, so SAM's answers replay.
  const analysis = join(work, "analysis.mp4");
  mkdirSync(join(work, "frames"), { recursive: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-t", "300", "-vf", "fps=5,scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-movflags", "+faststart", analysis]);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", analysis, "-vsync", "0", "-q:v", "2", "-start_number", "0", join(work, "frames", "%04d.jpg")]);
  const frameCount = readdirSync(join(work, "frames")).length;
  process.env.META_CACHE = process.env.SAM_CACHE ?? "record"; // SAM_CACHE=replay: only what is saved, never a new call
  const fileId = await uploadFile(analysis, "video/mp4", "basement.mp4");
  const all = (await Promise.all(CONCEPTS.map(async (c) => videoFinds(c, await samVideo(c.concept, fileId, frameCount))))).flat();
  process.env.META_CACHE = "off";
  console.log(`${id}: ${all.length} finds over ${frameCount} frames`);
  writeFileSync(saved, JSON.stringify(all));
  return all;
}

const rows: string[] = [];
const totals = new Map<string, { right: number; hedge: number; missed: number; wrong: number; verdict: number; n: number; usd: number; s: number }>();
const ids = readdirSync(join(MEDIA, "eval")).filter((d) => existsSync(join(MEDIA, "eval", d, "walkthrough.mp4")) && (!ONLY.length || ONLY.some((o) => d.startsWith(o))));
for (const id of ids) {
  const truth: Truth = JSON.parse(readFileSync(join(MEDIA, "eval", id, "truth.json"), "utf8"));
  const work = join(OUT, id);
  mkdirSync(work, { recursive: true });
  const detections = await finds(id, work, join(MEDIA, "eval", id, "walkthrough.mp4"));
  if (!existsSync(join(work, "frames"))) throw new Error(`${id}: no frames; delete ${work}/detections.json to rebuild`);
  const want = expectedOf(truth);
  for (const model of MODELS) {
    for (let n = 1; n <= RUNS; n++) {
      const ctx = { dir: work, household: "unsure" as const, municipality: "waterloo-on", model };
      const started = Date.now();
      const read = await readWithSpark(ctx, [...detections], "", []);
      const s = (Date.now() - started) / 1000;
      writeFileSync(join(work, `${model}-${n}.json`), JSON.stringify(read.model, null, 1));
      const { result } = finishAssessment(ctx, read, detections, measured(truth));
      const t = totals.get(model) ?? { right: 0, hedge: 0, missed: 0, wrong: 0, verdict: 0, n: 0, usd: 0, s: 0 };
      const cells = Object.entries(RULES).map(([k, ruleIds]) => {
        const got = said(result.findings.filter((f) => ruleIds.includes(f.ruleId)).map((f) => f.status));
        const g = grade(want[k], got);
        t[g as "right"]++;
        return `${got} (${g})`;
      });
      const verdictOk = result.verdict === truth.expected.verdict;
      t.verdict += Number(verdictOk);
      t.n++;
      t.usd += read.costUsd;
      t.s += s;
      totals.set(model, t);
      rows.push(`| ${id} | ${model} #${n} | ${cells.join(" | ")} | ${result.verdict}${verdictOk ? "" : " ✗"} | ${result.heldBack} | $${read.costUsd.toFixed(3)} | ${s.toFixed(0)} s |`);
      console.log(rows.at(-1));
    }
  }
}

const head = `| Basement | Model | Escape window | Fire separation | Furnace room | Verdict | Held back | Cost | Time |\n|---|---|---|---|---|---|---|---|---|`;
const sum = [...totals].map(([m, t]) => `| ${m} | ${t.right} | ${t.hedge} | ${t.missed} | ${t.wrong} | ${t.verdict}/${t.n} | $${(t.usd / t.n).toFixed(3)} | ${(t.s / t.n).toFixed(0)} s |`);
const report = `# Verdict agent: ${MODELS.join(" vs ")}

${ids.length} rendered basements, ${RUNS} readings each per model. Each model gets the same SAM finds, proof frames and rules; code applies the true measurements, so the 3D's error is left out. Expected: the escape window is a fix only in b1; fire separation in b1 and b3; the furnace room in b1. Verdicts: b1 fix, b2 yes, b3 fix.

Right: the claim that was due. Hedge: no claim where none was needed. Missed: no claim where a fix was due. Wrong: the opposite claim.

| Model | Right | Hedge | Missed | Wrong | Verdict right | Cost a reading | Time |
|---|---|---|---|---|---|---|---|
${sum.join("\n")}

${head}
${rows.join("\n")}
`;
writeFileSync(join(OUT, "report.md"), report);
console.log(`\n${sum.join("\n")}\nwrote ${join(OUT, "report.md")}`);
