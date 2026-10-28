// Runs the 3D scan room by room on a saved scan's frames, to compare against one scan of everything.
// Usage: SCAN3D_URL=http://127.0.0.1:8790 SCAN3D_TOKEN=dev tsx scripts/try-rooms-3d.ts <scan folder> <room start s> [more starts…]
// The scan folder holds frames/0000.jpg… at 5 fps (media/private/scans/<id>). Free: only the local 3D service runs.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { roomRanges } from "../server/rooms";
import { runScan3d } from "../server/scan3d";

const [dir, ...starts] = process.argv.slice(2);
if (!dir || !starts.length) {
  console.error("Usage: tsx scripts/try-rooms-3d.ts <scan folder> <room start s> [more starts…]");
  process.exit(1);
}
const frameCount = readdirSync(join(dir, "frames")).filter((f) => f.endsWith(".jpg")).length;
const ranges = roomRanges(starts.map((s) => ({ startS: Number(s) })), frameCount, 5);

for (const r of ranges) {
  const started = Date.now();
  try {
    const { scan } = await runScan3d(dir, r, {});
    const room = scan.room ?? {};
    const q = scan.quality ?? {};
    console.log(
      `room ${r.index + 1} (${r.from / 5}–${r.to / 5} s, ${scan.frames.length} views, ${((Date.now() - started) / 1000).toFixed(0)} s):`,
      `${room.widthM ?? "?"} × ${room.depthM ?? "?"} m, ceiling ${room.ceilingHeightM ?? "?"} m`,
      `| doubled walls: ${q.wallsDoubled ? "yes" : "no"}, flat floor: ${q.pass?.flatFloor}, level ceiling: ${q.pass?.ceilingLevelWithin5cm}`,
    );
    for (const w of q.warnings ?? []) console.log(`   ${w}`);
  } catch (err) {
    console.log(`room ${r.index + 1}: failed, ${err instanceof Error ? err.message : err}`);
  }
}
