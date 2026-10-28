// A 2D floor plan from the 3D scan: the main room's outline, with SAM's windows, doors, stairs
// and mechanicals placed where the scan says they are. Metres, room frame (x across, z deep).
import type { Detection } from "./pipeline";
import { liftBox, type Scan3d } from "./scan3d";

export type Side = "minX" | "maxX" | "minZ" | "maxZ";

export type Plan = {
  version: 1;
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  sides: Record<Side, "wall" | "extent">; // "extent": the camera never saw a wall there
  widthM: number;
  depthM: number;
  areaM2: number;
  ceilingHeightM: number | null;
  openings: { kind: "window" | "door"; side: Side; atM: number; widthM: number; detectionId: string }[];
  stairs: { x0: number; z0: number; x1: number; z1: number; detectionId: string }[];
  fixtures: { kind: "furnace" | "panel"; x: number; z: number; detectionId: string }[];
  scaleSource: "model" | "user_measurement";
  trusted: boolean;
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (n: number) => Math.round(n * 100) / 100;

// Where an object sits in the room: medians of its lifted points over every scan frame it shows in.
function locate(s3: Scan3d, d: Detection) {
  const byFrame = new Map(d.track.map((t) => [t[0], t]));
  const mids: number[][] = [], lows: number[][] = [], highs: number[][] = [];
  s3.scan.frames.forEach((f: any, i: number) => {
    const t = byFrame.get(s3.sentFrames[f.sourceIndex]);
    if (!t) return;
    const lifted = liftBox(s3.scan, s3.depth, i, { x: t[1], y: t[2], w: t[3], h: t[4] });
    if (!lifted) return;
    mids.push(lifted.median);
    lows.push(lifted.p05);
    highs.push(lifted.p95);
  });
  if (!mids.length) return null;
  const axis = (rows: number[][], a: number) => median(rows.map((r) => r[a]));
  return {
    center: [axis(mids, 0), axis(mids, 1), axis(mids, 2)],
    low: [axis(lows, 0), axis(lows, 1), axis(lows, 2)],
    high: [axis(highs, 0), axis(highs, 1), axis(highs, 2)],
    views: mids.length,
  };
}

function nearestSide(box: Plan["box"], x: number, z: number): { side: Side; dist: number } {
  const options: { side: Side; dist: number }[] = [
    { side: "minX", dist: Math.abs(x - box.minX) },
    { side: "maxX", dist: Math.abs(x - box.maxX) },
    { side: "minZ", dist: Math.abs(z - box.minZ) },
    { side: "maxZ", dist: Math.abs(z - box.maxZ) },
  ];
  return options.sort((a, b) => a.dist - b.dist)[0];
}

export function buildPlan(s3: Scan3d, detections: Detection[], trusted: boolean): Plan | null {
  const room = s3.scan.room;
  if (!room?.box) return null;
  const [minX, , minZ] = room.box.min as number[];
  const [maxX, , maxZ] = room.box.max as number[];
  const box = { minX, maxX, minZ, maxZ };
  const sides = { minX: "extent", maxX: "extent", minZ: "extent", maxZ: "extent", ...(room.box.sides ?? {}) } as Plan["sides"];

  const openings: Plan["openings"] = [];
  const stairs: Plan["stairs"] = [];
  const fixtures: Plan["fixtures"] = [];

  for (const d of detections) {
    if (!["window", "exit", "stairs", "mechanical"].includes(d.kind)) continue;
    const at = locate(s3, d);
    if (!at) continue;
    const [cx, , cz] = at.center;
    if (d.kind === "window" || d.kind === "exit") {
      // Openings sit in walls: snap to the nearest side, sized by their spread along it.
      const { side } = nearestSide(box, cx, cz);
      const alongX = side === "minZ" || side === "maxZ";
      const lo = alongX ? box.minX : box.minZ, hi = alongX ? box.maxX : box.maxZ;
      const spread = Math.abs(alongX ? at.high[0] - at.low[0] : at.high[2] - at.low[2]);
      const kind = d.kind === "window" ? "window" : "door";
      const widthM = clamp(spread || (kind === "door" ? 0.86 : 0.8), kind === "door" ? 0.7 : 0.4, kind === "door" ? 1.2 : 2.0);
      const atM = clamp((alongX ? cx : cz) - lo, widthM / 2, hi - lo - widthM / 2);
      // The same window or door tracked twice: keep the one seen most.
      if (openings.some((o) => o.kind === kind && o.side === side && Math.abs(o.atM - atM) < Math.max(o.widthM, widthM) * 0.75)) continue;
      openings.push({ kind, side, atM: round2(atM), widthM: round2(widthM), detectionId: d.id });
    } else if (d.kind === "stairs") {
      const x0 = clamp(Math.min(at.low[0], at.high[0]), minX, maxX), x1 = clamp(Math.max(at.low[0], at.high[0]), minX, maxX);
      const z0 = clamp(Math.min(at.low[2], at.high[2]), minZ, maxZ), z1 = clamp(Math.max(at.low[2], at.high[2]), minZ, maxZ);
      if (x1 - x0 < 0.4 || z1 - z0 < 0.4) continue;
      if (stairs.some((s) => Math.max(s.x0, x0) < Math.min(s.x1, x1) && Math.max(s.z0, z0) < Math.min(s.z1, z1))) continue; // same flight
      stairs.push({ x0: round2(x0), z0: round2(z0), x1: round2(x1), z1: round2(z1), detectionId: d.id });
    } else {
      const kind = d.label.toLowerCase().includes("panel") ? "panel" : "furnace";
      const x = clamp(cx, minX, maxX), z = clamp(cz, minZ, maxZ);
      if (fixtures.some((f) => f.kind === kind && Math.hypot(f.x - x, f.z - z) < 1)) continue;
      fixtures.push({ kind, x: round2(x), z: round2(z), detectionId: d.id });
    }
  }

  const widthM = round2(maxX - minX);
  const depthM = round2(maxZ - minZ);
  return {
    version: 1,
    box: { minX: round2(minX), maxX: round2(maxX), minZ: round2(minZ), maxZ: round2(maxZ) },
    sides,
    widthM,
    depthM,
    areaM2: Math.round(widthM * depthM * 10) / 10,
    ceilingHeightM: room.ceilingHeightM ?? null,
    openings,
    stairs,
    fixtures,
    scaleSource: s3.scan.scaleSource === "user_measurement" ? "user_measurement" : "model",
    trusted,
  };
}
