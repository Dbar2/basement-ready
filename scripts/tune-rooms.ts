// Replays a saved scan through the live room detector, to tune it on real footage.
// Usage: tsx scripts/tune-rooms.ts <scanId>   (needs the scan's analysis.mp4 and the API running)
import { execFileSync } from "node:child_process";
import { RoomDetector, lookOf } from "../src/capture/rooms";
import { scanHeaders } from "./scanAccess";

const id = process.argv[2];
const FPS = 5, EVERY = 6; // the phone sends a frame about every 1.2 s
const raw = execFileSync("ffmpeg", ["-v", "error", "-i", `media/private/scans/${id}/analysis.mp4`, "-vf", "scale=16:16", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 });
const frames = raw.length / 768;
// Scans are private: read with ADMIN_TOKEN from .env.
const result = (await (await fetch(`http://127.0.0.1:8787/api/scans/${id}`, { headers: scanHeaders() })).json()).result;
// Widest door SAM saw in each frame.
const doorWidth = new Map<number, number>();
for (const d of result.detections.filter((x: any) => x.kind === "exit")) for (const t of d.track) doorWidth.set(t[0], Math.max(doorWidth.get(t[0]) ?? 0, t[3]));

const det = new RoomDetector();
const starts: number[] = [];
for (let n = 0; n < frames; n += EVERY) {
  const look = lookOf(raw.subarray(n * 768, n * 768 + 768), 3);
  if (det.push({ sec: n / FPS, look, doorWidth: doorWidth.get(n) ?? 0 })) starts.push(n / FPS);
}
console.log("detected room starts (s):", starts.map((s) => s.toFixed(1)).join(", ") || "none");
console.log("taps on Next room (s):    ", (result.rooms ?? []).slice(1).map((r: any) => r.startS.toFixed(1)).join(", ") || "none");
