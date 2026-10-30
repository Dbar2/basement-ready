// What pointing finds in a whole video, the way a video scan does it (server/pipeline.ts): the watch pass
// says when each furnace, water heater, panel, rough-in and bulkhead was filmed (server/watch.ts), Spark
// marks it on a frame there, and SAM tracks them all in one request (server/pointFinds.ts). Saves the
// watch and the finds as JSON, for looking at each find's clearest frame. Replays first; new calls only
// within the budget.
//   tsx --env-file=.env scripts/practice/points.ts --video analysis.mp4 [--audio input.mp4] --out finds.json
//     --budget 4 --ledger <file>   --dry
// The video must already be the scan's analysis video: 5 fps, 1280 px on the long side.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { jpegSize } from "../../server/concepts";
import { dataUrl, responses, uploadFile } from "../../server/meta";
import { pointInVideo } from "../../server/pointFinds";
import { ReplayMiss } from "../../server/replay";
import { onSpend } from "../../server/spend";
import { watchVideo, watchVideoFile } from "../../server/watch";

const arg = (name: string, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const VIDEO = arg("video");
const OUT = arg("out");
if (!VIDEO || !OUT) throw new Error("--video and --out are required");
const BUDGET = Number(arg("budget", "4"));
const dirs = (process.env.REPLAY_DIR ?? "").split(":").filter(Boolean);
if (!dirs.length) throw new Error("Set REPLAY_DIR to a private folder, so every call is saved and reruns are free");
const LEDGER = arg("ledger", join(dirs[0], "points-spend.jsonl"));
// What a new run of one video costs at most: the watch, a few marks and one SAM pass over the video.
const ESTIMATE = 0.6;
const FPS = 5;

const work = join(tmpdir(), "br-points", basename(VIDEO, ".mp4"));
mkdirSync(join(work, "frames"), { recursive: true });
const framePath = (n: number) => join(work, "frames", `${String(n).padStart(4, "0")}.jpg`);
if (!existsSync(framePath(1))) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", VIDEO, "-vsync", "0", "-q:v", "2", "-start_number", "0", join(work, "frames", "%04d.jpg")]);
const frameCount = readdirSync(join(work, "frames")).filter((f) => f.endsWith(".jpg")).length;
const wav = arg("audio") ? join(work, "voice.wav") : null;
if (wav && !existsSync(wav)) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", arg("audio"), "-t", "120", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-map_metadata", "-1", wav]);
const [w, h] = jpegSize(readFileSync(framePath(0))) ?? [720, 1280];
const spent = () => (existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).reduce((s, l) => s + JSON.parse(l).usd, 0) : 0);

async function run() {
  const file = await watchVideoFile(VIDEO, wav, join(work, "watch.mp4"));
  const watch = await watchVideo(await uploadFile(file, "video/mp4", "walkthrough.mp4"), frameCount / FPS, Boolean(wav));
  const fileId = await uploadFile(VIDEO, "video/mp4", "basement.mp4");
  let missed = false;
  const ask = async (body: unknown) => {
    try {
      return await responses(body);
    } catch (err) {
      if (err instanceof ReplayMiss) missed = true;
      throw err;
    }
  };
  const pointed = await pointInVideo(watch, { frameUrl: (n) => dataUrl(framePath(n), "image/jpeg"), fileId, frameCount, fps: FPS, w, h }, ask);
  if (missed) throw new ReplayMiss("a mark isn't saved yet");
  return { watch, pointed };
}

let usd = 0;
onSpend((_k, u) => (usd += u));
process.env.META_CACHE = "replay";
let result = await run().catch((err) => (err instanceof ReplayMiss || /Replay has no saved answer/.test(String(err)) ? null : Promise.reject(err)));
console.log(`${VIDEO}: ${frameCount} frames. ${result ? "Everything is saved." : `Not all saved yet (about $${ESTIMATE} at most).`} Ledger: $${spent().toFixed(2)} of $${BUDGET}.`);
if (!result) {
  if (process.argv.includes("--dry")) process.exit(0);
  if (spent() + ESTIMATE > BUDGET) {
    console.error(`Stopping: that could take the ledger past $${BUDGET}. Nothing was called.`);
    process.exit(2);
  }
  usd = 0;
  process.env.META_CACHE = "record";
  result = await run();
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), video: VIDEO, usd: Math.round(usd * 10000) / 10000 }) + "\n");
}
const { watch, pointed } = result!;
writeFileSync(OUT, JSON.stringify({ video: VIDEO, frameCount, size: [w, h], watch, finds: pointed.finds, costUsd: pointed.costUsd }, null, 1));
console.log(`Watch saw: ${watch.rooms.flatMap((r) => [...r.fixtures.map((f) => `${f.kind}@${f.atS}`), ...r.low.filter((l) => l.kind === "bulkhead").map((l) => `bulkhead@${l.atS}`)]).join(", ") || "nothing to point at"}`);
console.log(`Pointed finds: ${pointed.finds.map((d) => `${d.label} f${d.frame} c${(d.confidence ?? 0).toFixed(2)} n${d.framesSeen}`).join(", ") || "none"} (marks and SAM: $${pointed.costUsd.toFixed(3)})`);
process.exit(0);
