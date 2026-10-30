// A cached app take (scripts/eval/plan-takes.ts) turned into a scan you can open in the studio, through
// the same code a new scan runs: the plan read from every area at once, the areas placed on it (each on
// the one floor), the merged 3D, the whole plan with SAM's finds, and Spark's review when asked.
// Writes to this checkout's own dev database and storage, so run it with the API stopped:
//
//   PGLITE_DIR=.data/pglite LOCAL_STORAGE_DIR=media/private SCAN3D_URL=http://127.0.0.1:8791 SCAN3D_TOKEN=dev \
//     tsx --env-file=.env scripts/eval/plan-scan.ts --take b2-finished-family [--review]
//
// The 3D service only needs /floorplan: `run_local.py serve --no-model` is enough.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromFloorPlan, type BasementScan } from "../../server/basement";
import { db, migrateDb, schema } from "../../server/db";
import { readBasementPlan } from "../../server/floorplan";
import { finishRooms, saveBasement3d, type Detection } from "../../server/pipeline";
import { mainRoom } from "../../server/rooms";
import { runFloorPlan, type Scan3d } from "../../server/scan3d";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const take = arg("take");
if (!take) throw new Error("--take <cached take>");
const dir = join("tmp/eval/plan", take);
const bundle = JSON.parse(readFileSync(join(dir, "bundle.json"), "utf8"));
if (bundle.kind !== "tracked") throw new Error("only app (tracked) takes have a whole plan");

const ab = (path: string) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const scans: Scan3d[] = bundle.areas.map((a: { dir: string }) => {
  const scan = JSON.parse(readFileSync(join(dir, a.dir, "scan.json"), "utf8"));
  let mesh: ArrayBuffer | undefined;
  try {
    mesh = ab(join(dir, a.dir, "mesh.bin"));
  } catch {}
  return { scan, ply: ab(join(dir, a.dir, "points.ply")), depth: ab(join(dir, a.dir, "depth.bin")), mesh, sentFrames: scan.sentFrames };
});
const spans = bundle.areas.map((a: { span: { from: number; to: number } }) => a.span);
// The walk as server/basement.ts trackedWalk reads it: every third frame.
const idx: number[] = [], pos: [number, number][] = [], cams: number[][] = [];
bundle.cams.forEach((c: number[] | null, n: number) => {
  if (!c || n % 3) return;
  idx.push(n);
  pos.push([c[0], c[2]]);
  cams.push(c);
});

const first = await runFloorPlan(scans, cams);
const placed = fromFloorPlan(first, scans, spans, idx, pos);
if (!placed) throw new Error("no rooms in the plan");
const b: BasementScan = { ...placed, tracked: { cameras: cams, frames: idx, plan: first } };
console.log("placements", JSON.stringify(b.placements));

// --dry: the plan and Spark's review only, printed; nothing written.
if (process.argv.includes("--dry")) {
  const fp = await readBasementPlan(dir, b, bundle.detections ?? [], { review: process.argv.includes("--review"), log: async (t) => console.log(t) });
  console.log(JSON.stringify({ rooms: fp?.rooms.map((r) => [r.id, r.areaM2, r.kind]), doubtful: fp?.walls.filter((w) => w.guess).map((w) => w.id), doors: fp?.openings.filter((o) => o.kind === "door").map((o) => o.rooms), edits: fp?.edits, review: fp?.review }, null, 1));
  process.exit(0);
}
await migrateDb();
const [basement] = await db.insert(schema.basements).values({ claimToken: `eval-${take}`, address: `Test basement ${take}` }).returning();
const [scan] = await db.insert(schema.scans).values({ basementId: basement.id, status: "running", frameCount: bundle.frameCount }).returning();
const detections: Detection[] = bundle.detections ?? [];
const rooms = await finishRooms(scan.id, b.spans.map((s, index) => ({ index, ...s })), b.scans, detections, async () => {}, b.placements);
await saveBasement3d(scan.id, b);
const floorPlan = await readBasementPlan(dir, b, detections, { review: process.argv.includes("--review"), log: async (t) => console.log(t) });
const main = mainRoom(rooms);
const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const result = { ...sample, id: scan.id, demo: false, frameCount: bundle.frameCount, detections, rooms, floorPlan, mainRoom: main?.index ?? null, plan: main?.plan ?? null, measurements: main?.measurements ?? null, has3d: true, concepts: null };
await db.update(schema.scans).set({ status: "done", result, finishedAt: new Date() }).where((await import("drizzle-orm")).eq(schema.scans.id, scan.id));
console.log(`scan ${scan.id}: ${floorPlan?.rooms.length ?? 0} rooms, ${floorPlan?.walls.length ?? 0} walls (${floorPlan?.walls.filter((w) => w.guess).length ?? 0} doubtful), ${floorPlan?.openings.length ?? 0} openings`);
console.log(`review: ${JSON.stringify(floorPlan?.review)}; edits: ${JSON.stringify(floorPlan?.edits)}`);
console.log(`open /scans/${scan.id}/studio and /scans/${scan.id}/plan with localStorage br-claims = ${JSON.stringify([{ basementId: basement.id, claimToken: basement.claimToken }])}`);
process.exit(0);
