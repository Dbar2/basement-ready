// SAM 3.1's answers for a whole video, the way a video scan asks for them (server/meta.ts samVideo on the
// uploaded analysis video), saved as JSON for scripts/practice/tracks.ts to score. Replays first, and makes
// new calls only within the budget.
//   tsx --env-file=.env scripts/practice/video.ts --video analysis.mp4 --out answers.json
//     --concepts "support beam,ceiling duct,staircase"   (default: those three)
//     --budget 3 --ledger <file>    stop before new calls would take the ledger past this many dollars
//     --dry                         only say what isn't saved yet and what it would cost
// The video must already be the scan's analysis video: 5 fps, 1280 px on the long side (server/pipeline.ts).
// Set REPLAY_DIR to a private folder.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { samVideo, uploadFile } from "../../server/meta";
import { ReplayMiss } from "../../server/replay";
import { PRICES } from "../../server/spend";

const arg = (name: string, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const VIDEO = arg("video");
const OUT = arg("out");
if (!VIDEO || !OUT) throw new Error("--video and --out are required");
const CONCEPTS = arg("concepts", "support beam,ceiling duct,staircase").split(",").map((s) => s.trim()).filter(Boolean);
const BUDGET = Number(arg("budget", "3"));
const dirs = (process.env.REPLAY_DIR ?? "").split(":").filter(Boolean);
if (!dirs.length) throw new Error("Set REPLAY_DIR to a private folder, so every call is saved and reruns are free");
const LEDGER = arg("ledger", join(dirs[0], "video-spend.jsonl"));

const frames = Number(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", VIDEO], { encoding: "utf8" }).trim().replace(/,$/, ""));
const perCall = Math.max(PRICES.samVideoMinFrames, frames) * PRICES.samVideoFrame;
const spent = () => (existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).reduce((s, l) => s + JSON.parse(l).usd, 0) : 0);

async function ask(): Promise<{ raw: Record<string, string>; missing: string[] }> {
  const raw: Record<string, string> = {};
  const missing: string[] = [];
  let fileId: string;
  try {
    fileId = await uploadFile(VIDEO, "video/mp4", "basement.mp4");
  } catch (err) {
    if (err instanceof ReplayMiss) return { raw, missing: [...CONCEPTS] };
    throw err;
  }
  for (const concept of CONCEPTS) {
    try {
      raw[concept] = (await samVideo(concept, fileId, frames)).replace(/<\|mask;[^|]*\|>/g, "");
    } catch (err) {
      if (err instanceof ReplayMiss) missing.push(concept);
      else throw err;
    }
  }
  return { raw, missing };
}

process.env.META_CACHE = "replay";
let { raw, missing } = await ask();
const cost = missing.length * perCall;
console.log(`${VIDEO}: ${frames} frames. Not saved yet: ${missing.join(", ") || "nothing"} (about $${cost.toFixed(2)}). Ledger: $${spent().toFixed(2)} of $${BUDGET}.`);
if (process.argv.includes("--dry")) process.exit(0);
if (missing.length) {
  if (spent() + cost > BUDGET) {
    console.error(`Stopping: that would take the ledger past $${BUDGET}. Nothing was called.`);
    process.exit(2);
  }
  process.env.META_CACHE = "record";
  ({ raw } = await ask());
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), video: VIDEO, frames, concepts: missing, usd: Math.round(cost * 10000) / 10000 }) + "\n");
}
writeFileSync(OUT, JSON.stringify({ video: VIDEO, frames, raw }, null, 1));
console.log(`Saved ${Object.keys(raw).length} answers to ${OUT}`);
process.exit(0);
