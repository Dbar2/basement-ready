// Pulls one scan into media/private/scans/<id>/ (git-ignored, private), so any session can study a take
// locally:
// - scan.json: the scan, its events and its answer
// - the take as filmed, with its sound
// - analysis.mp4: the 5 fps video SAM and the 3D read
// - frames/: every frame
// - 3d/: each room's and the whole basement's 3D files
// - plan.png: the plan as "Is this your basement?" draws it
// It reads with the admin key (server/admin.ts), ADMIN_TOKEN in .env.
//   tsx --env-file=.env scripts/pull-scan.ts <scanId> [--api https://www.basementready.com] [--no-frames]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_ROOMS } from "../server/rooms";

const id = process.argv[2];
if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("usage: pull-scan.ts <scanId> [--api URL] [--no-frames]");
const at = process.argv.indexOf("--api");
const API = (at > 0 ? process.argv[at + 1] : process.env.BR_API ?? "https://www.basementready.com").replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN?.trim();
if (!token) throw new Error("ADMIN_TOKEN isn't set: add it to .env (the same value as on the server)");
const headers = { Authorization: `Bearer ${token}` };
const out = join("media/private/scans", id);

async function get(path: string): Promise<Buffer | null> {
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function save(path: string, file: string) {
  const body = await get(path);
  if (!body) return false;
  mkdirSync(join(out, file, ".."), { recursive: true });
  writeFileSync(join(out, file), body);
  return true;
}

const raw = await get(`/admin/api/scans/${id}`);
if (!raw) throw new Error(`No scan ${id} at ${API}, or the key isn't accepted there`);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "scan.json"), raw);
const { scan, result } = JSON.parse(raw.toString("utf8"));
console.log(`${id}: ${scan.status}, ${scan.source}, ${scan.city}, ${scan.frameCount ?? 0} frames, $${scan.costUsd.toFixed(2)}`);

if (scan.input) console.log(`  the take: ${(await save(`/admin/scans/${id}/file?name=${encodeURIComponent(scan.input)}`, scan.input.split("/").pop())) ? scan.input : "missing"}`);
console.log(`  analysis.mp4: ${(await save(`/api/scans/${id}/video`, "analysis.mp4")) ? "saved" : "missing"}`);
if (scan.inputs?.capture) await save(`/admin/scans/${id}/file?name=capture.json`, "capture.json");
if (result) await save(`/admin/scans/${id}/plan.png`, "plan.png");

if (!process.argv.includes("--no-frames")) {
  const n = scan.frameCount ?? 0;
  let got = 0;
  for (let start = 0; start < n; start += 8) {
    const batch = Array.from({ length: Math.min(8, n - start) }, (_, k) => start + k);
    const ok = await Promise.all(batch.map((f) => save(`/api/scans/${id}/frames/${f}`, join("frames", `${String(f).padStart(4, "0")}.jpg`))));
    got += ok.filter(Boolean).length;
  }
  console.log(`  frames: ${got} of ${n}`);
}

// The 3D: each room's files, then the whole basement put together.
const files3d = ["scan.json", "points.ply", "surfels.bin", "mesh.bin"];
let saved3d = 0;
for (let room = 0; room < MAX_ROOMS; room++) {
  const ok = await Promise.all(files3d.map((f) => save(`/api/scans/${id}/3d/${f}?room=${room}`, join("3d", `room-${room}`, f))));
  if (!ok.some(Boolean)) break;
  saved3d += ok.filter(Boolean).length;
  for (const f of ["depth.bin"]) if (await save(`/admin/scans/${id}/file?name=${encodeURIComponent(room ? `3d/room-${room}/${f}` : `3d/${f}`)}`, join("3d", `room-${room}`, f))) saved3d++;
}
for (const f of ["scan.json", "surfels.bin", "mesh.bin"]) if (await save(`/api/scans/${id}/3d/${f}?room=all`, join("3d", "basement", f))) saved3d++;
console.log(`  3D files: ${saved3d}`);
console.log(`→ ${out}`);
