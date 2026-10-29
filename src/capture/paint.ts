// "Paint the room": which parts of the walls, ceiling and floor have been in the picture.
// The basement around the phone is a sphere of 24 compass slices (15° each) by 5 bands: floor, low
// wall, mid wall, high wall and ceiling. Each orientation reading paints the cells inside the lens's
// view, but only while the picture is steady and bright enough to be any use to the 3D.
// Pure and fed one reading at a time, so a test can drive it without a phone.
import type { Lens } from "./media";

export const COLS = 24;
export const COL_DEG = 360 / COLS;
export const BANDS = ["floor", "low", "mid", "high", "ceiling"] as const;
export type Band = (typeof BANDS)[number];
export type Group = "walls" | "ceiling" | "floor";

// Where each band starts and ends, in degrees above the horizon. Standing in a basement about 2 m
// from a wall, the wall runs from roughly 40° down to 25° up.
export const BAND_EDGES = [-90, -40, -14, 8, 28, 90];
const GROUP_BANDS: Record<Group, number[]> = { floor: [0], walls: [1, 2, 3], ceiling: [4] };
// Which wall band to aim at when several are missing: the one a level phone sees first.
const AIM_ORDER = [2, 3, 1, 4, 0];

// The part of the picture that counts, in degrees, with the phone upright. A little inside the full
// field of view: the 3D gets little from the very edge of a frame.
export const LENS_FOV: Record<Lens, { h: number; v: number }> = {
  wide: { h: 36, v: 58 },
  ultrawide: { h: 62, v: 90 },
};

// Seconds of steady filming that fill a cell.
export const FILL_SEC = 0.7;
// Turning faster than this blurs the frame, so it doesn't paint.
const MAX_TURN_DEG_PER_S = 90;
// A reading after a long gap only counts for this long.
const MAX_STEP_MS = 120;

export type View = { heading: number; elev: number }; // degrees: compass, and above the horizon

const rad = Math.PI / 180;
export const wrap = (deg: number) => ((deg % 360) + 360) % 360;
// Signed shortest turn from a to b, -180..180; negative is to the left.
export const turnDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;

// Compass heading of the rear camera from absolute alpha, beta, gamma (W3C: x east, y north, z up).
export function cameraHeading(alpha: number, beta: number, gamma: number) {
  const [a, b, g] = [alpha * rad, beta * rad, gamma * rad];
  const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  return wrap(Math.atan2(east, north) / rad);
}

// Unit vector for a compass heading and elevation: x east, y up, z north.
function dir(heading: number, elev: number): [number, number, number] {
  const h = heading * rad, e = elev * rad;
  return [Math.cos(e) * Math.sin(h), Math.sin(e), Math.cos(e) * Math.cos(h)];
}

// Each cell is sampled at 3×3 points, so a view that covers part of a cell paints part of it.
const SAMPLES: [number, number][][] = (() => {
  const out: [number, number][][] = [];
  for (let b = 0; b < BANDS.length; b++) {
    for (let c = 0; c < COLS; c++) {
      const pts: [number, number][] = [];
      for (const fy of [1 / 6, 1 / 2, 5 / 6]) {
        const elev = BAND_EDGES[b] + (BAND_EDGES[b + 1] - BAND_EDGES[b]) * fy;
        for (const fx of [1 / 6, 1 / 2, 5 / 6]) pts.push([(c + fx) * COL_DEG, elev]);
      }
      out.push(pts);
    }
  }
  return out;
})();
const SAMPLE_DIRS = SAMPLES.map((pts) => pts.map(([h, e]) => dir(h, e)));

export const cellIndex = (band: number, col: number) => band * COLS + col;
export const colOf = (heading: number) => Math.floor(wrap(heading) / COL_DEG) % COLS;
export const bandCentre = (band: number) => (BAND_EDGES[band] + BAND_EDGES[band + 1]) / 2;

// How much of each cell a view sees, 0..1 per cell.
export function seen(view: View, fov: { h: number; v: number }): Float32Array {
  const out = new Float32Array(BANDS.length * COLS);
  const f = dir(view.heading, view.elev);
  const h = view.heading * rad;
  const r: [number, number, number] = [Math.cos(h), 0, -Math.sin(h)];
  // up = f × r
  const u: [number, number, number] = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const tanH = Math.tan((fov.h / 2) * rad), tanV = Math.tan((fov.v / 2) * rad);
  for (let i = 0; i < SAMPLE_DIRS.length; i++) {
    let hit = 0;
    for (const d of SAMPLE_DIRS[i]) {
      const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
      if (z <= 0.05) continue;
      const x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
      const y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
      if (Math.abs(x / z) <= tanH && Math.abs(y / z) <= tanV) hit++;
    }
    out[i] = hit / 9;
  }
  return out;
}

export class CoverageGrid {
  // Seconds of steady filming in each cell, band-major: index = band * COLS + col.
  readonly paint = new Float32Array(BANDS.length * COLS);
  private last: { view: View; at: number } | null = null;

  // One orientation reading. `ok` is false when the picture is too dark or shaking.
  push(view: View, at: number, fov: { h: number; v: number }, ok = true) {
    const prev = this.last;
    this.last = { view, at };
    if (!prev || !ok) return false;
    const dt = Math.min(MAX_STEP_MS, at - prev.at);
    if (dt <= 0) return false;
    // How far the camera actually moved: near straight up, a big compass swing is a small move.
    const a = dir(prev.view.heading, prev.view.elev), b = dir(view.heading, view.elev);
    const moved = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / rad;
    if ((moved / Math.max(dt, 16)) * 1000 > MAX_TURN_DEG_PER_S) return false;
    const share = seen(view, fov);
    for (let i = 0; i < share.length; i++) if (share[i]) this.paint[i] += (share[i] * dt) / 1000;
    return true;
  }

  // 0..1 for each cell.
  fill(i: number) {
    return Math.min(1, this.paint[i] / FILL_SEC);
  }

  // A different part of the basement: what was painted here doesn't say much about there.
  fade(keep = 0.3) {
    for (let i = 0; i < this.paint.length; i++) this.paint[i] = Math.min(this.paint[i], FILL_SEC) * keep;
  }

  reset() {
    this.paint.fill(0);
    this.last = null;
  }

  // 0..1: how much of a group is painted.
  percent(group: Group) {
    let sum = 0;
    for (const b of GROUP_BANDS[group]) for (let c = 0; c < COLS; c++) sum += this.fill(cellIndex(b, c));
    return sum / (GROUP_BANDS[group].length * COLS);
  }
}

// ---------- which way to go next ----------

export type Turn = "left" | "right" | "around";
export type Tilt = "up" | "down";
export type Gap = { col: number; band: number; turn: Turn | null; tilt: Tilt | null; side: "left" | "right" | "behind" | "ahead" };

const MISSING = 0.5; // a cell under half painted is missed
const MIN_RUN = 3; // 45°: smaller gaps fill themselves while walking

// The biggest stretch of the group not filmed yet, and how to get the camera onto it.
export function nextGap(fill: (i: number) => number, view: View, group: Group): Gap | null {
  const bands = GROUP_BANDS[group];
  const missing = Array.from({ length: COLS }, (_, c) => bands.reduce((m, b) => m + (fill(cellIndex(b, c)) < MISSING ? 1 : 0), 0) / bands.length);
  const open = missing.map((m) => m >= 0.5);
  if (!open.some(Boolean)) return null;
  // The longest run of open columns, wrapping round; on a tie, the one nearest where the phone points.
  let best: { len: number; mid: number; turn: number } | null = null;
  const all = open.every(Boolean);
  for (let start = 0; start < COLS; start++) {
    if (!open[start] || (!all && open[(start - 1 + COLS) % COLS])) continue;
    let len = 0;
    while (len < COLS && open[(start + len) % COLS]) len++;
    const mid = wrap((start + len / 2) * COL_DEG);
    const turn = Math.abs(turnDelta(view.heading, mid));
    if (!best || len > best.len || (len === best.len && turn < best.turn)) best = { len, mid, turn };
    if (all) break;
  }
  if (!best || best.len < MIN_RUN) return null;
  // With the whole group open (nothing filmed yet), go for what's in front.
  const target = all ? view.heading : best.mid;
  const col = colOf(target);
  // The band in that stretch with the most missing; on a tie, the one a level phone sees.
  const aim = AIM_ORDER.filter((b) => bands.includes(b));
  const band = aim.reduce((pick, b) => (fill(cellIndex(b, col)) < fill(cellIndex(pick, col)) ? b : pick), aim[0]);
  const delta = turnDelta(view.heading, target);
  const turn: Turn | null = Math.abs(delta) < 35 ? null : Math.abs(delta) > 135 ? "around" : delta < 0 ? "left" : "right";
  const lift = bandCentre(band) - view.elev;
  // Wall bands sit inside the picture when the phone is level; only the low band needs a tilt.
  const tilt: Tilt | null = band === 4 || band === 3 ? (lift > 15 ? "up" : null) : lift < -15 ? "down" : null;
  const side = turn === "around" ? "behind" : turn ?? "ahead";
  return { col, band, turn, tilt, side };
}

// What to call the gap on screen: "the lower left wall", "the ceiling behind you".
export function describeGap(g: Gap): string {
  const where = g.side === "behind" ? "behind you" : g.side === "ahead" ? "over there" : `to your ${g.side}`;
  if (g.band === 4) return `The ceiling ${where}`;
  if (g.band === 0) return `The floor ${where}`;
  const height = g.band === 1 ? "lower " : g.band === 3 ? "upper " : "";
  if (g.side === "left" || g.side === "right") return `The ${height}${g.side} wall`;
  return `The ${height}wall ${where}`;
}

// ---------- holding a hint steady ----------

// A direction only shows once it has held for `holdMs`, and clears once it has been gone for
// `clearMs`, so compass jitter can't flip the arrow (or the voice) between left and right.
export class Steady<T extends string> {
  private candidate: T | null = null;
  private since = 0;
  value: T | null = null;

  constructor(
    private holdMs = 2500,
    private clearMs = 1200,
  ) {}

  push(next: T | null, at: number): T | null {
    if (next !== this.candidate) {
      this.candidate = next;
      this.since = at;
    }
    const held = at - this.since;
    if (next === null) {
      if (this.value !== null && held >= this.clearMs) this.value = null;
    } else if (next !== this.value && held >= this.holdMs) this.value = next;
    return this.value;
  }

  reset() {
    this.candidate = null;
    this.value = null;
  }
}
