// Runs the real pipeline on one video and freezes the result as the "Try a sample basement" demo.
// Usage: pnpm make:sample path/to/basement.mp4 [relative|renter|unsure]
// Needs the dev API running (pnpm dev). Writes public/samples/sample-basement.mp4 and public/samples/sample/.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [video, household = "relative"] = process.argv.slice(2);
if (!video) {
  console.error("Usage: pnpm make:sample path/to/basement.mp4 [relative|renter|unsure]");
  process.exit(1);
}
const API = "http://localhost:8787";
const OUT = "public/samples/sample";

const form = new FormData();
form.append("video", new Blob([await import("node:fs").then((fs) => fs.readFileSync(video))], { type: "video/mp4" }), "basement.mp4");
form.append("household", household);
form.append("address", "");
form.append("municipality", "waterloo-on");
const { id } = (await (await fetch(`${API}/api/scans`, { method: "POST", body: form })).json()) as { id: string };
console.log("job", id);

// Collect the event stream exactly as the browser would see it.
const events: unknown[] = [];
const res = await fetch(`${API}/api/scans/${id}/events`);
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  for (const line of buf.split("\n")) {
    if (line.startsWith("data:")) {
      const e = JSON.parse(line.slice(5));
      events.push(e);
      console.log(`${e.at.toFixed(1)}s  ${e.text}`);
    }
  }
  buf = buf.slice(buf.lastIndexOf("\n") + 1);
}

const { result } = (await (await fetch(`${API}/api/scans/${id}`)).json()) as { result: any };
if (!result) throw new Error("Scan did not finish");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "frames"), { recursive: true });
const frames = new Set<number>(result.detections.map((d: any) => d.frame));
for (const n of frames) {
  const name = `${String(n).padStart(4, "0")}.jpg`;
  const img = await fetch(`${API}/api/scans/${id}/frames/${n}`);
  writeFileSync(join(OUT, "frames", name), Buffer.from(await img.arrayBuffer()));
}
copyFileSync(video, "public/samples/sample-basement.mp4");
writeFileSync(join(OUT, "events.json"), JSON.stringify(events));
writeFileSync(join(OUT, "result.json"), JSON.stringify({ ...result, id: "sample" }));
console.log(`Saved ${frames.size} frames, ${events.length} events and the result to ${OUT}`);
