// What the pictures of a scan are made from, read from storage: the best angles (server/views/angles.ts),
// the design to draw (server/views/seed.ts until the shared model has one), and what SAM saw in each
// angle's frame. The example reads the same things from its committed files.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { Detection } from "../pipeline";
import { keys, storage } from "../storage";
import { assumedIntrinsics, pickAngles, pickDesignAngles, poseAt, viewsFromArea, viewsFromMesh, type Angle, type Spot, type View } from "./angles";
import { designFromScan } from "./seed";
import type { Design, Furniture } from "../model/types";

export const SAMPLE = "sample";

export async function readStored(key: string): Promise<Buffer | null> {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

// The example's files: public/ in development, dist/ once built.
export function sampleFile(path: string): Buffer | null {
  for (const root of ["public", "dist"]) {
    const p = join(root, "samples", "sample", path);
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

export async function scanResult(scanId: string): Promise<any | null> {
  if (scanId === SAMPLE) {
    const f = sampleFile("result.json");
    return f ? JSON.parse(f.toString("utf8")) : null;
  }
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId));
  return (scan?.result as any) ?? null;
}

// The example kept only its camera spots and a few frames: angles come from the spots that have a
// frame, seen against its solid surface, with a typical phone's lens.
function sampleViews(result: any): View[] {
  const spotsFile = sampleFile("3d/scan.json"), mesh = sampleFile("3d/mesh.bin");
  if (!spotsFile || !mesh) return [];
  const spots: Spot[] = JSON.parse(spotsFile.toString("utf8")).frames ?? [];
  const frames = [...new Set((result.detections ?? []).map((d: Detection) => d.frame) as number[])].filter((n) => sampleFile(`frames/${String(n).padStart(4, "0")}.jpg`));
  const at = frames.map((n) => poseAt(spots, n)).filter((s): s is Spot => s !== null);
  const buf = mesh.buffer.slice(mesh.byteOffset, mesh.byteOffset + mesh.byteLength);
  const nv = new DataView(buf).getUint32(4, true), nf = new DataView(buf).getUint32(8, true);
  const pos = new Int16Array(buf, 12 + nf * 12, nv * 3);
  const boxes = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number; ceilingM: number }>();
  for (const r of result.rooms ?? []) {
    if (!r.plan) continue;
    const p = r.placement ?? { turn: 0, x: 0, z: 0 };
    const t = (p.turn * Math.PI) / 2, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
    const b = r.plan.box;
    const xs = [b.minX, b.maxX].flatMap((x) => [b.minZ, b.maxZ].map((z) => c * x - s * z + p.x));
    const zs = [b.minX, b.maxX].flatMap((x) => [b.minZ, b.maxZ].map((z) => s * x + c * z + p.z));
    boxes.set(r.index, { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), ceilingM: r.plan.ceilingHeightM ?? 2.3 });
  }
  return viewsFromMesh(at, pos, boxes, assumedIntrinsics(1280, 720));
}

// Every candidate view of a scan, with the design they're judged against. Cached per process: once a
// scan is done its frames and 3D never change.
const cache = new Map<string, Promise<{ views: View[]; furniture: Furniture[]; mainRoom: number | null } | null>>();
function viewsOf(scanId: string) {
  if (!cache.has(scanId)) {
    cache.set(
      scanId,
      (async () => {
        const result = await scanResult(scanId);
        if (!result) return null;
        const furniture = designFromScan(result)?.proposed.furniture ?? [];
        if (scanId === SAMPLE) return { views: sampleViews(result), furniture, mainRoom: result.mainRoom ?? null };
        const views: View[] = [];
        for (const room of (result.rooms ?? []) as { index: number; has3d: boolean; placement?: any }[]) {
          if (!room.has3d) continue;
          const [json, depth] = await Promise.all([readStored(keys.scan3d(scanId, "scan.json", room.index)), readStored(keys.scan3d(scanId, "depth.bin", room.index))]);
          if (!json) continue;
          views.push(...viewsFromArea({ room: room.index, scan: JSON.parse(json.toString("utf8")), depth, placement: room.placement ?? null, hasFrame: (n) => n < (result.frameCount ?? Infinity) }));
        }
        return { views, furniture, mainRoom: result.mainRoom ?? null };
      })().catch((err) => {
        cache.delete(scanId);
        throw err;
      }),
    );
  }
  return cache.get(scanId)!;
}

// The best angles of every measured room of a scan, 4 to 6 each (perRoom), the design's room first.
// Judged against the scan's design: none from inside its furniture, the ones that show it first.
export async function bestAngles(scanId: string, perRoom = 5): Promise<Angle[]> {
  const v = await viewsOf(scanId);
  if (!v) return [];
  const angles = pickAngles(v.views, perRoom, v.furniture);
  return angles.sort((a, b) => Number(b.room === v.mainRoom) - Number(a.room === v.mainRoom) || a.room - b.room);
}

// The design's own pictures: the `n` angles, from any room, that show it best, each piece in two or more.
export async function designAngles(scanId: string, n = 5): Promise<Angle[]> {
  const v = await viewsOf(scanId);
  return v ? pickDesignAngles(v.views, n, v.furniture) : [];
}

// The design to picture: the scan's suggested layout, furnished, until the shared model holds one.
export async function designFor(scanId: string): Promise<Design | null> {
  const result = await scanResult(scanId);
  return result ? designFromScan(result) : null;
}

type Box = { x: number; y: number; w: number; h: number };
export type Anchor = { kind: "window" | "door" | "stairs"; box: Box };

// The windows, doors and stairs SAM outlined in a frame (or the nearest frame it tracked them in, up
// to 2 frames off): what a finished picture of that angle must keep in place.
export async function anchorsAt(scanId: string, frame: number): Promise<Anchor[]> {
  const result = await scanResult(scanId);
  const out: Anchor[] = [];
  for (const d of (result?.detections ?? []) as Detection[]) {
    const kind = d.kind === "window" ? "window" : d.kind === "exit" ? "door" : d.kind === "stairs" ? "stairs" : null;
    if (!kind) continue;
    const t = [...d.track].sort((a, b) => Math.abs(a[0] - frame) - Math.abs(b[0] - frame))[0];
    if (!t || Math.abs(t[0] - frame) > 2) continue;
    // Cut off by the edge of the picture: too unsure to hold a picture to.
    if (t[3] * t[4] < 0.004) continue;
    out.push({ kind, box: { x: t[1], y: t[2], w: t[3], h: t[4] } });
  }
  return out;
}

export const frameUrl = (scanId: string, n: number) => (scanId === SAMPLE ? `/samples/sample/frames/${String(n).padStart(4, "0")}.jpg` : `/api/scans/${scanId}/frames/${n}`);
export const meshUrl = (scanId: string) => (scanId === SAMPLE ? "/samples/sample/3d/mesh.bin" : `/api/scans/${scanId}/3d/mesh.bin?room=all`);
