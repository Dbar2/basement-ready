// The live map while filming: the newest 3D rebuild, turned to match the one before so it doesn't
// flip, the camera's place and heading on it, and what isn't filmed yet (a side of the room box with
// no wall seen, the ceiling). Pure, so a test can drive it without a phone or a 3D service.
//
// Map frame: the 3D service's room frame seen from above, X to the right and Z down the screen
// (+Y up, toward you). Yaw is degrees clockwise from the top of the map, like a compass.
import { turnDelta, wrap } from "./paint";

export type Side = "minX" | "maxX" | "minZ" | "maxZ";
export type MapPoint = { x: number; z: number; yaw: number; heading: number | null; seq: number };
export type LiveMap = {
  box: { min: [number, number, number]; max: [number, number, number]; sides: Record<Side, "wall" | "extent"> } | null;
  walls: [[number, number], [number, number]][];
  path: MapPoint[];
  newest: MapPoint | null;
  newestView: number | null;
  ceiling: boolean;
};

// Round the box clockwise from the top of the map.
export const SIDES: Side[] = ["minZ", "maxX", "maxZ", "minX"];
// The ceiling counts as filmed once the phone has painted this much of it (Capture's DONE_AT).
export const CEILING_DONE = 0.45;
// Under this, the ceiling is low enough to warn about. The live 3D's scale can be 20% out, so only
// clearly low ceilings count.
export const LOW_CEILING_M = 1.9;
// A side counts as in front of, or behind, the camera within this many degrees.
const AHEAD_DEG = 50;
// The compass and the 3D only agree on a heading when enough frames' offsets line up (0.75 is about
// ±40° of scatter; random headings from a compass that's no use come out far lower).
const MIN_AGREEMENT = 0.75;
const MIN_PAIRS = 3;

const rad = Math.PI / 180;

// ---------- keeping the map steady between rebuilds ----------

// Every rebuild fits its own room axes (X along the longer side), so the same basement can come back
// turned a quarter or a half. The frames two rebuilds share say by how much: turn the new one so they
// face where they did. The first rebuild is turned so the first frame (the top of the stairs) faces up.
// Returns how many clockwise quarter turns to show the new rebuild with.
export function quarterTurns(path: MapPoint[], shownBefore: ReadonlyMap<number, number> | null): number {
  if (!path.length) return 0;
  const shared = shownBefore ? path.filter((p) => shownBefore.has(p.seq)) : [];
  let target: number;
  if (shared.length) {
    let sx = 0, sy = 0;
    for (const p of shared) {
      const d = turnDelta(p.yaw, shownBefore!.get(p.seq)!) * rad;
      sx += Math.cos(d);
      sy += Math.sin(d);
    }
    target = Math.atan2(sy, sx) / rad;
  } else target = turnDelta(path[0].yaw, 0);
  return ((Math.round(target / 90) % 4) + 4) % 4;
}

// A point turned clockwise by `turns` quarter turns on the map (x right, z down).
export function turnPoint(x: number, z: number, turns: number): [number, number] {
  switch (((turns % 4) + 4) % 4) {
    case 1:
      return [-z, x];
    case 2:
      return [-x, -z];
    case 3:
      return [z, -x];
    default:
      return [x, z];
  }
}

// Each frame's yaw as shown, to line the next rebuild up with.
export function shownYaws(path: MapPoint[], turns: number): Map<number, number> {
  return new Map(path.map((p) => [p.seq, wrap(p.yaw + 90 * turns)]));
}

// ---------- the compass on the map ----------

// The compass reading minus the map's yaw, averaged over the frames that have both: add it to a map yaw
// to get a compass heading, take it away from the compass to place the marker. Null without a compass,
// or when the frames disagree too much to trust (a steel beam or the furnace pulls the compass about).
export function compassOffset(path: MapPoint[]): number | null {
  const pairs = path.filter((p) => p.heading != null);
  if (pairs.length < MIN_PAIRS) return null;
  let sx = 0, sy = 0;
  for (const p of pairs) {
    const d = (p.heading! - p.yaw) * rad;
    sx += Math.cos(d);
    sy += Math.sin(d);
  }
  const agreement = Math.hypot(sx, sy) / pairs.length;
  if (agreement < MIN_AGREEMENT) return null;
  return wrap(Math.atan2(sy, sx) / rad);
}

// Which way the camera faces on the map now: the compass, between rebuilds, once the two agree;
// otherwise the newest frame's own yaw.
export function markerYaw(map: LiveMap, compass: number | null): number | null {
  if (!map.newest) return null;
  const offset = compassOffset(map.path);
  return offset != null && compass != null ? wrap(compass - offset) : map.newest.yaw;
}

// ---------- what isn't filmed yet ----------

export type Edge = { side: Side; a: [number, number]; b: [number, number]; filmed: boolean };

// The four sides of the room box as lines on the floor, clockwise from the top.
export function edges(map: LiveMap): Edge[] {
  if (!map.box) return [];
  const [x0, , z0] = map.box.min;
  const [x1, , z1] = map.box.max;
  const line: Record<Side, [[number, number], [number, number]]> = {
    minZ: [[x0, z0], [x1, z0]],
    maxX: [[x1, z0], [x1, z1]],
    maxZ: [[x1, z1], [x0, z1]],
    minX: [[x0, z1], [x0, z0]],
  };
  return SIDES.map((side) => ({ side, a: line[side][0], b: line[side][1], filmed: map.box!.sides[side] === "wall" }));
}

export type Where = "ahead" | "left" | "right" | "behind";

// Where a side sits from someone standing at (x, z) facing `yaw`: toward its nearest point.
export function whereIs(edge: Edge, x: number, z: number, yaw: number): { where: Where; turn: number; distance: number } {
  const [ax, az] = edge.a, [bx, bz] = edge.b;
  const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
  const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2)) : 0;
  const px = ax + t * (bx - ax), pz = az + t * (bz - az);
  const bearing = Math.atan2(px - x, -(pz - z)) / rad;
  const turn = turnDelta(yaw, bearing);
  const where: Where = Math.abs(turn) <= AHEAD_DEG ? "ahead" : Math.abs(turn) >= 180 - AHEAD_DEG ? "behind" : turn < 0 ? "left" : "right";
  return { where, turn, distance: Math.hypot(px - x, pz - z) };
}

export type MapGap = { side: Side; where: Where; turn: number };

// The side not filmed yet that's furthest out of the picture: the one to turn toward next. Null when
// every side has a wall, or there's no camera on the map.
export function nextSide(map: LiveMap, yaw: number | null): MapGap | null {
  if (!map.newest || yaw == null) return null;
  const { x, z } = map.newest;
  let best: MapGap | null = null;
  for (const e of edges(map)) {
    if (e.filmed) continue;
    const w = whereIs(e, x, z, yaw);
    if (!best || Math.abs(w.turn) > Math.abs(best.turn)) best = { side: e.side, where: w.where, turn: w.turn };
  }
  return best;
}

// The ceiling is a gap until either the 3D found it or the phone has pointed at enough of it.
export function ceilingMissing(map: LiveMap | null, painted: number): boolean {
  return !map?.ceiling && painted < CEILING_DONE;
}

export const sidesFilmed = (map: LiveMap) => (map.box ? SIDES.filter((s) => map.box!.sides[s] === "wall").length : 0);

export function lowCeiling(ceilingM: number | null, map: LiveMap | null): boolean {
  return Boolean(map?.ceiling) && ceilingM != null && ceilingM > 0.5 && ceilingM < LOW_CEILING_M;
}

// One short line under the map, in plain words.
export function mapStatus(map: LiveMap | null, ceilingGap: boolean): string {
  if (!map?.box) return ceilingGap ? "Ceiling not filmed yet" : "";
  const open = 4 - sidesFilmed(map);
  if (open === 0) return ceilingGap ? "Ceiling not filmed yet" : "All four sides filmed";
  const sides = `${open} ${open === 1 ? "side" : "sides"} not filmed yet`;
  return ceilingGap ? `${sides} · ceiling too` : sides;
}

// ---------- fitting the map in its panel ----------

// The box (or, before there is one, the path) as shown, for framing the view.
export function bounds(map: LiveMap, turns: number) {
  const pts: [number, number][] = map.box
    ? [
        [map.box.min[0], map.box.min[2]],
        [map.box.max[0], map.box.max[2]],
      ]
    : map.path.map((p) => [p.x, p.z]);
  if (map.newest) pts.push([map.newest.x, map.newest.z]);
  if (!pts.length) return { cx: 0, cz: 0, size: 4 };
  const shown = pts.map(([x, z]) => turnPoint(x, z, turns));
  const xs = shown.map((p) => p[0]), zs = shown.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, size: Math.max(3, x1 - x0, z1 - z0) };
}
