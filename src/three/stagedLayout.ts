// Where the starting layout's furniture stands (src/three/StagedBasement.tsx draws it), worked out
// apart from the drawing so it can be checked (tests/unit/staged-layout.test.ts): every piece inside
// its room, clear of the others, of the stairs, of each door's swing (both sides of a new wall's door,
// inside the room for one in the outside walls), and leaving a way from the exit to every door.
// Bathrooms and kitchens are built in against their walls and stay where the layout puts them.
import type { Layout, LayoutZone, Plan, PlanSide } from "../api";

export type V3 = [number, number, number];
export type Rect = { x0: number; x1: number; z0: number; z1: number };

// Overlap, or nearer than `gap`, with 2 cm to spare.
export const clash = (a: Rect, b: Rect, gap = 0) => a.x0 < b.x1 + gap - 0.02 && a.x1 > b.x0 - gap + 0.02 && a.z0 < b.z1 + gap - 0.02 && a.z1 > b.z0 - gap + 0.02;

const SIDES: PlanSide[] = ["maxZ", "minZ", "maxX", "minX"];

// Which edge of a zone is against the room's wall: furniture backs onto it.
export function backOf(z: LayoutZone, box: Plan["box"], prefer: PlanSide | null) {
  const touch = (side: PlanSide) => onBox(z, box, side);
  return (prefer && touch(prefer) && prefer) || SIDES.find(touch) || "maxZ";
}
const onBox = (z: LayoutZone, box: Plan["box"], side: PlanSide) =>
  side === "maxZ" ? Math.abs(z.z1 - box.maxZ) < 0.05 : side === "minZ" ? Math.abs(z.z0 - box.minZ) < 0.05 : side === "maxX" ? Math.abs(z.x1 - box.maxX) < 0.05 : Math.abs(z.x0 - box.minX) < 0.05;

// Facing away from the back wall, for something whose front is +Z.
const YAW: Record<PlanSide, number> = { minZ: 0, maxZ: Math.PI, minX: Math.PI / 2, maxX: -Math.PI / 2 };

// A zone's own frame: u along its back edge, v out into the zone from it.
export function zoneFrame(z: LayoutZone, back: PlanSide) {
  const alongX = back === "minZ" || back === "maxZ";
  const uMin = alongX ? z.x0 : z.z0,
    uMax = alongX ? z.x1 : z.z1;
  const vStart = back === "maxZ" ? z.z1 : back === "minZ" ? z.z0 : back === "maxX" ? z.x1 : z.x0;
  const dir = back.startsWith("max") ? -1 : 1;
  const depth = alongX ? z.z1 - z.z0 : z.x1 - z.x0;
  const at = (u: number, v: number): [number, number] => (alongX ? [u, vStart + dir * v] : [vStart + dir * v, u]);
  const p = (u: number, v: number, y = 0): V3 => {
    const [x, zz] = at(u, v);
    return [x, y, zz];
  };
  // The yaw that turns a +Z front from (u, v) towards (u2, v2).
  const face = (u: number, v: number, u2: number, v2: number) => {
    const [x, zz] = at(u, v),
      [x2, z2] = at(u2, v2);
    return Math.atan2(x2 - x, z2 - zz);
  };
  // A footprint in plan coordinates.
  const rect = (u0: number, u1: number, v0: number, v1: number): Rect => {
    const [ax, az] = at(u0, v0),
      [bx, bz] = at(u1, v1);
    return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) };
  };
  return { uMin, uMax, uMid: (uMin + uMax) / 2, len: uMax - uMin, depth, at, p, face, rect, yaw: YAW[back], back };
}
export type Frame = ReturnType<typeof zoneFrame>;

// ---------- what stays clear ----------

const SWING_M = 0.9; // in front of a door, each side: its leaf swings there and you walk through
const WINDOW_M = 0.3; // nothing stands against the wall under a window
const LANDING_M = 1.0; // at the foot of the stairs (server/layout.ts LANDING_M)

// A strip `depth` deep into the room in front of an opening in the outside walls.
function inFront(box: Plan["box"], o: Plan["openings"][number], depth: number, pad: number): Rect {
  const alongX = o.side === "minZ" || o.side === "maxZ";
  const c = (alongX ? box.minX : box.minZ) + o.atM;
  const [a0, a1] = [c - o.widthM / 2 - pad, c + o.widthM / 2 + pad];
  if (o.side === "minZ") return { x0: a0, x1: a1, z0: box.minZ, z1: box.minZ + depth };
  if (o.side === "maxZ") return { x0: a0, x1: a1, z0: box.maxZ - depth, z1: box.maxZ };
  if (o.side === "minX") return { x0: box.minX, x1: box.minX + depth, z0: a0, z1: a1 };
  return { x0: box.maxX - depth, x1: box.maxX, z0: a0, z1: a1 };
}

// The landing at the foot of each flight whose foot the scan could tell.
function landings(plan: Plan): Rect[] {
  return plan.stairs.flatMap((st) => {
    if (!st.bottom) return [];
    const alongX = st.x1 - st.x0 >= st.z1 - st.z0;
    const [lo, hi] = alongX ? [st.x0, st.x1] : [st.z0, st.z1];
    const b = alongX ? st.bottom[0] : st.bottom[1];
    const [a0, a1] = Math.abs(b - hi) <= Math.abs(b - lo) ? [hi, hi + LANDING_M] : [lo - LANDING_M, lo];
    return [alongX ? { x0: a0, x1: a1, z0: st.z0, z1: st.z1 } : { x0: st.x0, x1: st.x1, z0: a0, z1: a1 }];
  });
}

// The floor in front of every door where nothing may stand: both sides of a door in a new wall, the
// room's side of one in the outside walls; and the stairs' landing.
export function doorClear(plan: Plan, layout: Layout): Rect[] {
  const out: Rect[] = [];
  for (const d of layout.doors) {
    const h = d.widthM / 2 + 0.1;
    out.push(d.along === "x" ? { x0: d.x - h, x1: d.x + h, z0: d.z - SWING_M, z1: d.z + SWING_M } : { x0: d.x - SWING_M, x1: d.x + SWING_M, z0: d.z - h, z1: d.z + h });
  }
  for (const o of plan.openings) if (o.kind === "door") out.push(inFront(plan.box, o, SWING_M, 0.1));
  return [...out, ...landings(plan)];
}

// ---------- the way out ----------

const CELL = 0.1;
const CLEAR_FURNITURE = 0.35; // a 0.7 m way past furniture
const CLEAR_WALL = 0.2; // through a 0.4 m gap or wider: any doorway

// Can you walk from the way out (the doors in the outside walls, or the foot of the stairs) to every
// door, past `pieces`? On a 10 cm grid over the room: the new walls (less their doorways), the stairs
// and the furniture are in the way. Returns the doors it can't reach.
export function wayOut(plan: Plan, layout: Layout, pieces: Rect[]): { ok: boolean; unreached: number } {
  const b = plan.box;
  const nx = Math.ceil((b.maxX - b.minX) / CELL),
    nz = Math.ceil((b.maxZ - b.minZ) / CELL);
  const centre = (i: number, k: number): [number, number] => [b.minX + (i + 0.5) * CELL, b.minZ + (k + 0.5) * CELL];
  // Each new wall less its doorway, as segments.
  const solid = layout.walls.flatMap((w): [number, number, number, number][] => {
    const alongX = Math.abs(w.x1 - w.x0) >= Math.abs(w.z1 - w.z0);
    const [lo, hi] = alongX ? [Math.min(w.x0, w.x1), Math.max(w.x0, w.x1)] : [Math.min(w.z0, w.z1), Math.max(w.z0, w.z1)];
    const c = alongX ? w.z0 : w.x0;
    const gaps = layout.doors
      .filter((d) => (alongX ? d.along === "x" && Math.abs(d.z - c) < 0.05 && d.x > lo && d.x < hi : d.along === "z" && Math.abs(d.x - c) < 0.05 && d.z > lo && d.z < hi))
      .map((d) => [(alongX ? d.x : d.z) - d.widthM / 2, (alongX ? d.x : d.z) + d.widthM / 2])
      .sort((p, q) => p[0] - q[0]);
    const out: [number, number, number, number][] = [];
    let t = lo;
    for (const [g0, g1] of gaps) {
      if (g0 > t) out.push(alongX ? [t, c, g0, c] : [c, t, c, g0]);
      t = Math.max(t, g1);
    }
    if (t < hi) out.push(alongX ? [t, c, hi, c] : [c, t, c, hi]);
    return out;
  });
  const distSeg = (px: number, pz: number, [ax, az, bx, bz]: [number, number, number, number]) => {
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(px - ax - t * dx, pz - az - t * dz);
  };
  const distRect = (px: number, pz: number, r: Rect) => Math.hypot(Math.max(r.x0 - px, 0, px - r.x1), Math.max(r.z0 - pz, 0, pz - r.z1));
  const stairs = plan.stairs.map((s) => ({ x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 }));
  const free = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const [x, z] = centre(i, k);
      if (solid.some((s) => distSeg(x, z, s) < CLEAR_WALL)) continue;
      if (stairs.some((r) => distRect(x, z, r) === 0)) continue;
      if (pieces.some((r) => distRect(x, z, r) < CLEAR_FURNITURE)) continue;
      free[k * nx + i] = 1;
    }
  // The free cells within reach of a point (a door's centre is in the wall, so look around it).
  const near = (x: number, z: number, r = 0.4) => {
    const out: number[] = [];
    const ci = Math.floor((x - b.minX) / CELL),
      ck = Math.floor((z - b.minZ) / CELL);
    const m = Math.ceil(r / CELL);
    for (let k = ck - m; k <= ck + m; k++) for (let i = ci - m; i <= ci + m; i++) if (i >= 0 && k >= 0 && i < nx && k < nz && free[k * nx + i]) out.push(k * nx + i);
    return out;
  };
  const outside = plan.openings.filter((o) => o.kind === "door").map((o) => {
    const r = inFront(b, o, 0.3, -o.widthM / 2);
    return [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2] as [number, number];
  });
  const foot = plan.stairs.flatMap((s) => (s.bottom ? [s.bottom] : []));
  const inner = layout.doors.map((d) => [d.x, d.z] as [number, number]);
  const exits = [...outside, ...foot];
  const starts = (exits.length ? exits : inner.slice(0, 1)).flatMap(([x, z]) => near(x, z));
  const targets = [...outside, ...inner];
  if (!starts.length) return { ok: !targets.length, unreached: targets.length };
  const seen = new Uint8Array(nx * nz);
  const queue = [...new Set(starts)];
  queue.forEach((c) => (seen[c] = 1));
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const i = c % nx,
      k = (c - i) / nx;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di,
        kk = k + dk;
      if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
      const n = kk * nx + ii;
      if (free[n] && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  const unreached = targets.filter(([x, z]) => !near(x, z).some((c) => seen[c])).length;
  return { ok: unreached === 0, unreached };
}

// ---------- placing ----------

// Footprints, in a zone's frame: u across, v out from the back. Measured from the models
// (public/staging/models) and the pieces drawn in StagedBasement.tsx.
const SOFA = { u: 1.1, v0: 0.025, v1: 0.975 };
const COFFEE = { u: 0.6, v: 0.3, at: 1.55 }; // modern_coffee_table_01, turned across the sofa
const ARMCHAIR = { half: 0.6, along: 1.25, at: 2.35 }; // modern_arm_chair_01 and the lounge chair, side by side
const LOUNGE_CHAIR = { half: 0.6, at: 2.75 }; // mid_century_lounge_chair, facing the sofa
const DINING = { 4: { u: 0.75, v: 0.88 }, 2: { u: 0.42, v: 0.86 } } as const;
const SIDEBOARD = { u: 0.9, v: 0.45 }; // modern_wooden_cabinet at 0.72
const BED = { u: 0.86, v0: 0.02, v1: 2.16 }; // the bed at v 1.1, its headboard on the back
const NIGHTSTAND = { u: 0.28, v0: 0.04, v1: 0.5, along: 1.13 };
const APART_M = 0.6; // between the lounge and the dining set: a way through and room to pull a chair out

export type Piece = { kind: "sofa" | "coffee" | "armchair" | "lounge_chair" | "dining" | "sideboard" | "bed" | "nightstand"; rect: Rect };
export type LivingSpot = {
  f: Frame; // the lounge's frame: the sofa backs onto f.back
  u: number; // the lounge's middle along its back
  lv: number; // how far out from the back the sofa stands
  chairs: "two" | "one" | "none"; // two armchairs beside the coffee table, one lounge chair across it, or none
  table: boolean; // the coffee table: left out where it would block the way past
  rug: number; // the rug's middle along the back, kept off the walls
  dining: { f: Frame; u: number; v: number; seats: 2 | 4 } | null;
  sideboard: { u: number } | null; // against the far edge of f
  pieces: Piece[];
};
export type BedSpot = { f: Frame; u: number; tables: number[] /* u of each nightstand */; rug: number | null /* its middle, kept off the walls */; pieces: Piece[] };
export type Arrangement = { living: Map<LayoutZone, LivingSpot>; bedroom: Map<LayoutZone, BedSpot> };

type Ctx = { zone: LayoutZone; blocked: Rect[]; clear: Rect[]; windows: Rect[] };
const inside = (r: Rect, z: LayoutZone) => r.x0 >= z.x0 - 0.02 && r.x1 <= z.x1 + 0.02 && r.z0 >= z.z0 - 0.02 && r.z1 <= z.z1 + 0.02;
const fits = (c: Ctx, r: Rect, againstWall = false) => inside(r, c.zone) && !c.blocked.some((b) => clash(r, b)) && !c.clear.some((b) => clash(r, b)) && !(againstWall && c.windows.some((w) => clash(r, w)));

// `u`, moved in so something `half` wide either side of it stays inside the frame's span.
const within = (f: Frame, u: number, half: number) => (f.len <= 2 * half ? f.uMid : Math.min(f.uMax - half, Math.max(f.uMin + half, u)));
export const RUG_HALF = 1.3; // the lounge's rug, 2.6 m across (or the zone's width)

// Offsets from the middle, nearest first: 0, +s, −s, +2s, …
const offsets = (half: number, step = 0.2) => {
  const out = [0];
  for (let d = step; d <= half + 1e-6; d += step) out.push(d, -d);
  return out;
};

// The sides a zone's furniture can back onto: a side of the room first (the preferred one first),
// then a new wall's side, then an open side.
function backsOf(z: LayoutZone, plan: Plan, layout: Layout, prefer: PlanSide | null): PlanSide[] {
  const walled = (side: PlanSide) => {
    if (onBox(z, plan.box, side)) return 2;
    const alongX = side === "minZ" || side === "maxZ";
    const c = side === "minZ" ? z.z0 : side === "maxZ" ? z.z1 : side === "minX" ? z.x0 : z.x1;
    const [lo, hi] = alongX ? [z.x0, z.x1] : [z.z0, z.z1];
    const covered = layout.walls.reduce((s, w) => {
      const wAlongX = Math.abs(w.x1 - w.x0) >= Math.abs(w.z1 - w.z0);
      if (wAlongX !== alongX || Math.abs((alongX ? w.z0 : w.x0) - c) > 0.05) return s;
      const [a, b] = alongX ? [Math.min(w.x0, w.x1), Math.max(w.x0, w.x1)] : [Math.min(w.z0, w.z1), Math.max(w.z0, w.z1)];
      return s + Math.max(0, Math.min(b, hi) - Math.max(a, lo));
    }, 0);
    return covered >= 0.6 * (hi - lo) ? 1 : 0;
  };
  const first = backOf(z, plan.box, prefer);
  return [...SIDES].sort((a, b) => Number(b === first) - Number(a === first) || walled(b) - walled(a));
}

function placeBedroom(c: Ctx, plan: Plan, layout: Layout): BedSpot | null {
  const z = c.zone;
  const prefer = layout.window?.side ?? null;
  for (const back of backsOf(z, plan, layout, prefer)) {
    const f = zoneFrame(z, back);
    if (f.depth < BED.v1 || f.len < 2 * BED.u) continue;
    for (const du of offsets(f.len / 2 - BED.u)) {
      const u = f.uMid + du;
      const bed = f.rect(u - BED.u, u + BED.u, BED.v0, BED.v1);
      if (!fits(c, bed)) continue;
      const tables = f.len >= 2.9 ? [-1, 1].map((s) => u + s * NIGHTSTAND.along).filter((t) => fits(c, f.rect(t - NIGHTSTAND.u, t + NIGHTSTAND.u, NIGHTSTAND.v0, NIGHTSTAND.v1))) : [];
      const pieces: Piece[] = [{ kind: "bed", rect: bed }, ...tables.map((t): Piece => ({ kind: "nightstand", rect: f.rect(t - NIGHTSTAND.u, t + NIGHTSTAND.u, NIGHTSTAND.v0, NIGHTSTAND.v1) }))];
      return { f, u, tables, rug: f.depth >= 2.9 ? within(f, u, 1.15) : null, pieces };
    }
  }
  return null;
}

// The lounge: a sofa on its back edge, the coffee table in front, chairs round it.
function lounge(f: Frame, u: number, lv: number, chairs: LivingSpot["chairs"], table: boolean): Piece[] {
  const out: Piece[] = [{ kind: "sofa", rect: f.rect(u - SOFA.u, u + SOFA.u, lv + SOFA.v0, lv + SOFA.v1) }];
  if (table) out.push({ kind: "coffee", rect: f.rect(u - COFFEE.u, u + COFFEE.u, lv + COFFEE.at - COFFEE.v, lv + COFFEE.at + COFFEE.v) });
  if (chairs === "two")
    for (const s of [-1, 1]) {
      const cu = u + s * ARMCHAIR.along;
      out.push({ kind: "armchair", rect: f.rect(cu - ARMCHAIR.half, cu + ARMCHAIR.half, lv + ARMCHAIR.at - ARMCHAIR.half, lv + ARMCHAIR.at + ARMCHAIR.half) });
    }
  if (chairs === "one") out.push({ kind: "lounge_chair", rect: f.rect(u - LOUNGE_CHAIR.half, u + LOUNGE_CHAIR.half, lv + LOUNGE_CHAIR.at - LOUNGE_CHAIR.half, lv + LOUNGE_CHAIR.at + LOUNGE_CHAIR.half) });
  return out;
}

const LOUNGES_TRIED = 40; // lounges a dining spot is looked for beside, before settling for no dining
const WAYS_TRIED = 200; // way-out checks before taking what fits

// The living space: a lounge at one end, dining as far from it as fits. Of the places the lounge fits,
// the first in this order: on a side of the room (`prefer` first), then a new wall, then open; with
// chairs, then without; against the back, then out from it; centred, then off-centre.
function placeLiving(c: Ctx, plan: Plan, layout: Layout, others: Rect[]): LivingSpot | null {
  const z = c.zone;
  const lounges: { f: Frame; u: number; lv: number; chairs: LivingSpot["chairs"]; table: boolean; pieces: Piece[] }[] = [];
  // With the coffee table everywhere it fits first; only then the sofa on its own.
  for (const table of [true, false])
    for (const back of backsOf(z, plan, layout, null)) {
      const f = zoneFrame(z, back);
      if (f.len < 2 * SOFA.u) continue;
      const kinds: LivingSpot["chairs"][] = !table ? ["none"] : f.len >= 3.6 ? ["two", "one", "none"] : ["one", "none"];
      for (const chairs of kinds)
        for (let lv = 0; lv <= f.depth - (table ? COFFEE.at + COFFEE.v : SOFA.v1) + 1e-6; lv += 0.2)
          for (const du of offsets(f.len / 2 - SOFA.u)) {
            const u = f.uMid + du;
            const pieces = lounge(f, u, lv, chairs, table);
            if (pieces.every((p) => fits(c, p.rect, p.kind === "sofa"))) lounges.push({ f, u, lv, chairs, table, pieces });
          }
    }
  if (!lounges.length) return null;
  const tableAt = (l: (typeof lounges)[number]) => l.f.at(l.u, l.lv + COFFEE.at);
  // The dining set in either direction, clear of the lounge by APART_M, as far from its coffee table as it goes.
  const diningFor = (l: (typeof lounges)[number]): LivingSpot["dining"] => {
    const [tx, tz] = tableAt(l);
    for (const seats of [4, 2] as const) {
      let best: { d: NonNullable<LivingSpot["dining"]>; far: number } | null = null;
      for (const side of [l.f.back, l.f.back === "minZ" || l.f.back === "maxZ" ? "minX" : "minZ"] as PlanSide[]) {
        const f = zoneFrame(z, side);
        const { u: hu, v: hv } = DINING[seats];
        for (let v = hv; v <= f.depth - hv + 1e-6; v += 0.2)
          for (let u = f.uMin + hu; u <= f.uMax - hu + 1e-6; u += 0.2) {
            const r = f.rect(u - hu, u + hu, v - hv, v + hv);
            if (!fits(c, r) || l.pieces.some((p) => clash(r, p.rect, APART_M))) continue;
            const [x, zz] = f.at(u, v);
            const far = Math.hypot(x - tx, zz - tz);
            if (!best || far > best.far) best = { d: { f, u, v, seats }, far };
          }
      }
      if (best) return best.d;
    }
    return null;
  };
  const sideboardFor = (l: (typeof lounges)[number], d: LivingSpot["dining"], taken: Rect[]) => {
    const f = l.f;
    if (!onBox(z, plan.box, oppositeOf(f.back))) return null;
    const near = d && d.f.back === f.back ? d.u : f.uMid;
    for (const du of offsets(1.2)) {
      const u = near + du;
      const r = f.rect(u - SIDEBOARD.u, u + SIDEBOARD.u, f.depth - SIDEBOARD.v, f.depth);
      if (fits(c, r, true) && !taken.some((t) => clash(r, t, 0.3))) return { u };
    }
    return null;
  };
  const build = (l: (typeof lounges)[number], dining: LivingSpot["dining"]): LivingSpot => {
    const pieces = [...l.pieces];
    if (dining) {
      const { u: hu, v: hv } = DINING[dining.seats];
      pieces.push({ kind: "dining", rect: dining.f.rect(dining.u - hu, dining.u + hu, dining.v - hv, dining.v + hv) });
    }
    const sideboard = dining ? sideboardFor(l, dining, pieces.map((p) => p.rect)) : null;
    if (sideboard) pieces.push({ kind: "sideboard", rect: l.f.rect(sideboard.u - SIDEBOARD.u, sideboard.u + SIDEBOARD.u, l.f.depth - SIDEBOARD.v, l.f.depth) });
    return { f: l.f, u: l.u, lv: l.lv, chairs: l.chairs, table: l.table, rug: within(l.f, l.u, RUG_HALF), dining, sideboard, pieces };
  };
  const way = (s: LivingSpot) => wayOut(plan, layout, [...others, ...s.pieces.map((p) => p.rect)]).ok;
  let ways = 0;
  for (const l of lounges.slice(0, LOUNGES_TRIED)) {
    const d = diningFor(l);
    if (!d) continue;
    const s = build(l, d);
    if (way(s)) return s;
    if (++ways >= WAYS_TRIED) break;
  }
  ways = 0;
  for (const l of lounges) {
    const s = build(l, null);
    if (way(s)) return s;
    if (++ways >= WAYS_TRIED) break;
  }
  // Nothing leaves a way past: the first that's clear of the doors, at least.
  return build(lounges[0], null);
}
const oppositeOf = (s: PlanSide): PlanSide => (s === "minX" ? "maxX" : s === "maxX" ? "minX" : s === "minZ" ? "maxZ" : "minZ");

// Every bedroom and living space in the layout, furnished. The same plan and layout always give the
// same answer, worked out once.
const cache = new WeakMap<Layout, { plan: Plan; a: Arrangement }>();
export function arrange(plan: Plan, layout: Layout): Arrangement {
  const hit = cache.get(layout);
  if (hit && hit.plan === plan) return hit.a;
  const clear = doorClear(plan, layout);
  const stairs = plan.stairs.map((s) => ({ x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 }));
  const windows = plan.openings.filter((o) => o.kind === "window").map((o) => inFront(plan.box, o, WINDOW_M, 0.1));
  const ctx = (z: LayoutZone): Ctx => ({ zone: z, blocked: [...stairs, ...layout.zones.filter((o) => o !== z && o.kind !== z.kind).map((o) => ({ x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1 }))], clear, windows });
  const a: Arrangement = { living: new Map(), bedroom: new Map() };
  for (const z of layout.zones.filter((x) => x.kind === "bedroom")) {
    const s = placeBedroom(ctx(z), plan, layout);
    if (s) a.bedroom.set(z, s);
  }
  // What else stands in the way: the beds, and the kitchen's counters.
  const others = [...[...a.bedroom.values()].flatMap((s) => s.pieces.map((p) => p.rect)), ...layout.zones.filter((x) => x.kind === "kitchen").map((k) => ({ x0: k.x0, x1: k.x1, z0: k.z0, z1: k.z1 }))];
  for (const z of layout.zones.filter((x) => x.kind === "living")) {
    const s = placeLiving(ctx(z), plan, layout, others);
    if (s) {
      a.living.set(z, s);
      others.push(...s.pieces.map((p) => p.rect));
    }
  }
  cache.set(layout, { plan, a });
  return a;
}
