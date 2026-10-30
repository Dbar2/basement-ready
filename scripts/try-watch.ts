// Runs the watch pass (server/watch.ts) on one take, the way the scan does: the 5 fps analysis video with
// its sound laid back on, uploaded once, then Muse Wonder (or Spark, when it fails). Prints the answer and
// what it cost, and with a rendered basement's truth.json beside the video, how it compares.
//   tsx --env-file=.env scripts/try-watch.ts <video> [--out tmp/watch/<name>.json] [--spark]
// --spark asks Spark 1.3 directly, as the fallback would. About $0.08 a minute of video on Wonder.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { responses, uploadFile } from "../server/meta";
import { MAX_TAKE_S } from "../server/rooms";
import { FALLBACK_MODEL, watchVideo, watchVideoFile, watchWords, type Watch } from "../server/watch";

const run = promisify(execFile);
const video = process.argv[2];
if (!video || !existsSync(video)) throw new Error("usage: try-watch.ts <video> [--out file.json] [--spark]");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const name = basename(dirname(video)).startsWith("b") ? basename(dirname(video)) : basename(video).replace(/\.\w+$/, "");
const work = join("tmp/watch", name);
mkdirSync(work, { recursive: true });

// As server/pipeline.ts prepare(): 5 fps, long side 1280, no sound; the voice on its own.
const analysis = join(work, "analysis.mp4");
if (!existsSync(analysis)) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-t", String(MAX_TAKE_S), "-vf", "fps=5,scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-movflags", "+faststart", analysis]);
}
const wav = join(work, "voice.wav");
let sound = existsSync(wav);
if (!sound) {
  sound = await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-t", String(MAX_TAKE_S), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-map_metadata", "-1", wav]).then(() => true, () => false);
}
const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", analysis]);
const durationS = Number(stdout.trim());
const file = await watchVideoFile(analysis, sound ? wav : null, join(work, "watch.mp4"));
console.log(`${name}: ${durationS.toFixed(1)} s, ${sound ? "with" : "no"} sound, ${(readFileSync(file).length / 1e6).toFixed(1)} MB`);
const fileId = await uploadFile(file, "video/mp4", "walkthrough.mp4");

// --spark: straight to the fallback, by making Wonder's turn fail.
const ask: typeof responses = process.argv.includes("--spark")
  ? async (body: any, signal) => (body.model === FALLBACK_MODEL ? responses(body, signal) : Promise.reject(new Error("skipped")))
  : responses;
const watch: Watch = await watchVideo(fileId, durationS, sound, { ask });
console.log(watchWords(watch));
console.log(`${watch.model}: ${(watch.ms / 1000).toFixed(1)} s, ${watch.tokens.in} in / ${watch.tokens.out} out, $${watch.costUsd.toFixed(3)}`);
const out = arg("out") ?? join(work, `${watch.model}.json`);
writeFileSync(out, JSON.stringify(watch, null, 1) + "\n");
console.log(`wrote ${out}`);

// A rendered basement: rooms, starts, windows and doors against the truth.
const truthPath = join(dirname(video), "truth.json");
if (existsSync(truthPath)) {
  const t = JSON.parse(readFileSync(truthPath, "utf8"));
  console.log("\nroom          truth start   watched start   windows truth/watched   ceiling truth/watched");
  t.rooms.forEach((r: any, i: number) => {
    const w = watch.rooms[i];
    console.log(
      `${r.name.padEnd(14)}${String(r.startS).padStart(8)}${String(w?.visits.find((v) => v[1] - v[0] >= 3)?.[0] ?? "-").padStart(16)}${`${r.windows.length}/${w?.windows.length ?? "-"}`.padStart(22)}   ${r.ceiling}/${w?.ceiling ?? "-"}`,
    );
  });
  if (watch.rooms.length !== t.rooms.length) console.log(`rooms: truth ${t.rooms.length}, watched ${watch.rooms.length}`);
  console.log(`doors: truth ${t.doors.length} between rooms, watched ${watch.doors.filter((d) => d.from.startsWith("r") && d.to.startsWith("r")).length}`);
}
