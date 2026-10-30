// The basement as drawings: the rooms where the scan placed them (src/components/basementPlan.ts),
// the chosen layout moved into the same frame, smoke and CO alarms placed by the code's rules, and
// both floor plans drawn to a real scale with sizes, names, areas and the notes a reviewer looks for.
import type { Layout, LayoutZone, Plan, PlanSide, RoomResult } from "../../src/api";
import { basementRooms, placeLayout } from "../../src/components/basementPlan";
import { suggestLayout } from "../layout";
import type { StoredState } from "../workspace";
import { area, both, fitScale, FAINT, INK, TONE, MUTED, PAPER, PLAN_SCALES, ptPerMetre, type Sheet, TONE2, TONE3 } from "./pdf";

export type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Alarm = { kind: "smoke" | "co" | "combo"; x: number; z: number; why: string };

export type Geometry = {
  rooms: { name: string; plan: Plan }[]; // every area of the basement, in one frame
  main: { name: string; plan: Plan } | null; // the area the suite goes in
  layout: Layout | null; // the chosen layout, in the same frame
  box: Box;
  ceilingM: number | null; // finished height we can stand behind: tape first, then the scan
  beamM: number | null; // clear height under the lowest beam or duct
  fuelBurning: boolean; // a furnace or water heater burns gas: CO alarms
  estimated: boolean;
  alarms: Alarm[];
  egress: { side: PlanSide; atM: number; widthM: number; existing: boolean; ok: boolean | null } | null;
};

const union = (boxes: Box[]): Box => ({
  minX: Math.min(...boxes.map((b) => b.minX)),
  maxX: Math.max(...boxes.map((b) => b.maxX)),
  minZ: Math.min(...boxes.map((b) => b.minZ)),
  maxZ: Math.max(...boxes.map((b) => b.maxZ)),
});

// The layout the homeowner picked on the Ideas tab, or the suggested one.
export function chosenLayout(result: any, state: StoredState | null | undefined): Layout | null {
  const plan = result?.plan as Plan | null;
  const pick = state?.ideas;
  if (plan && (pick?.kind || pick?.side)) return suggestLayout(plan as any, { kind: pick.kind ?? null, side: pick.side ?? null }) as unknown as Layout;
  return (result?.layout as Layout | null) ?? (plan ? (suggestLayout(plan as any) as unknown as Layout) : null);
}

// Smoke alarms in each sleeping room and between the sleeping rooms and the rest of the suite;
// CO alarms beside the sleeping area when anything in the house burns fuel (Building Code 9.10.19,
// 9.33.4; see data/rules/ontario-diy.json for the sections and wording).
export function placeAlarms(layout: Layout | null, main: Plan | null, fuelBurning: boolean): Alarm[] {
  // On the ceiling, a little off the room's middle so the room's name stays readable on the plan.
  const center = (z: { x0: number; z0: number; x1: number; z1: number }) => ({ x: (z.x0 + z.x1) / 2, z: z.z0 + (z.z1 - z.z0) * 0.25 });
  if (!layout) {
    if (!main) return [];
    const b = main.box;
    return [{ kind: fuelBurning ? "combo" : "smoke", x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, why: "One per storey of the suite" }];
  }
  const out: Alarm[] = [];
  const beds = layout.zones.filter((z) => z.kind === "bedroom");
  const living = layout.zones.find((z) => z.kind === "living") ?? null;
  for (const bed of beds) {
    const c = center(bed);
    const studio = layout.kind === "studio";
    out.push({ kind: studio && fuelBurning ? "combo" : "smoke", x: c.x, z: c.z, why: studio ? "In the sleeping area" : "In each bedroom" });
    if (studio || !living) continue;
    // Outside the bedroom door, in the living space: between the bedroom and the rest of the suite.
    const door = [...layout.doors].sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
    const lc = center(living);
    const at = door ?? { x: lc.x, z: lc.z };
    const inLiving = {
      x: Math.min(living.x1 - 0.4, Math.max(living.x0 + 0.4, at.x + Math.sign(lc.x - at.x || 1) * 0.6)),
      z: Math.min(living.z1 - 0.4, Math.max(living.z0 + 0.4, at.z + Math.sign(lc.z - at.z || 1) * 0.6)),
    };
    out.push({ kind: fuelBurning ? "combo" : "smoke", ...inLiving, why: fuelBurning ? "Outside the bedroom: smoke, and CO next to where people sleep" : "Between the bedroom and the rest of the suite" });
  }
  if (!beds.length && living) out.push({ kind: fuelBurning ? "combo" : "smoke", ...center(living), why: "One per storey of the suite" });
  // A service room with a fuel-burning furnace gets its own CO alarm, and a bedroom that shares a
  // wall with it gets CO inside the bedroom too (9.32.3.9A.(4), 9.32.3.9B.(1)).
  const mech = layout.zones.find((z) => z.kind === "mechanical");
  if (fuelBurning && mech) {
    out.push({ kind: "co", ...center(mech), why: "In the room with the fuel-burning furnace" });
    const touches = (a: LayoutZone, b: LayoutZone) => a.x0 <= b.x1 + 0.05 && b.x0 <= a.x1 + 0.05 && a.z0 <= b.z1 + 0.05 && b.z0 <= a.z1 + 0.05;
    for (const alarm of out) {
      const bed = beds.find((b) => Math.abs(center(b).x - alarm.x) < 0.01 && Math.abs(center(b).z - alarm.z) < 0.01);
      if (bed && touches(bed, mech)) Object.assign(alarm, { kind: "combo", why: "In the bedroom, which shares a wall with the furnace room" });
    }
  }
  return out;
}

export function basementGeometry(result: any, state: StoredState | null | undefined): Geometry | null {
  const placed = basementRooms(result?.rooms as RoomResult[] | undefined);
  const mainRoom: RoomResult | undefined = (result?.rooms ?? []).find((r: RoomResult) => r.index === result?.mainRoom);
  let rooms: { name: string; plan: Plan }[];
  let main: { name: string; plan: Plan } | null = null;
  let layout = chosenLayout(result, state);
  if (placed) {
    rooms = placed.map((p) => ({ name: p.room.name, plan: p.plan }));
    const m = placed.find((p) => p.room.index === result.mainRoom) ?? placed[0];
    main = { name: m.room.name, plan: m.plan };
    if (layout && m.room.placement) layout = placeLayout(layout, m.room.placement);
  } else if (result?.plan) {
    rooms = [{ name: mainRoom?.name ?? "Basement", plan: result.plan }];
    main = rooms[0];
  } else return null;
  const tape = state?.tape ?? {};
  const scanCeiling = main?.plan.ceilingHeightM ?? result?.measurements?.ceilingHeightM ?? null;
  const clearances: number[] = (result?.measurements?.clearances ?? []).map((c: { clearanceM: number }) => c.clearanceM);
  // A furnace or water heater may burn gas; a panel or a floor drain doesn't.
  const fuelBurning =
    rooms.some((r) => r.plan.fixtures.some((f) => f.kind === "furnace" || f.kind === "water_heater")) ||
    (result?.detections ?? []).some((d: { kind: string; label?: string }) => d.kind === "mechanical" && /furnace|water heater/i.test(d.label ?? ""));
  const win = layout?.window ?? null;
  const bedOk = layout?.checks.find((c) => /escape window/i.test(c.label))?.ok ?? null;
  let egress: Geometry["egress"] = null;
  const bed = layout?.zones.find((z) => z.kind === "bedroom") ?? null;
  if (win && bedOk) egress = { side: win.side, atM: win.atM, widthM: win.widthM, existing: true, ok: win.widthM >= 0.38 ? null : false };
  else if (bed && main) {
    // A new escape window on the bedroom's outside wall.
    const b = main.plan.box;
    const touching = (["minX", "maxX", "minZ", "maxZ"] as PlanSide[]).find((s) => Math.abs((s === "minX" ? bed.x0 - b.minX : s === "maxX" ? b.maxX - bed.x1 : s === "minZ" ? bed.z0 - b.minZ : b.maxZ - bed.z1)) < 0.05);
    if (touching) {
      const along = touching === "minZ" || touching === "maxZ" ? (bed.x0 + bed.x1) / 2 - b.minX : (bed.z0 + bed.z1) / 2 - b.minZ;
      egress = { side: touching, atM: along, widthM: 0.6, existing: false, ok: null };
    }
  }
  return {
    rooms,
    main,
    layout,
    box: union(rooms.map((r) => r.plan.box)),
    ceilingM: tape.ceilingMm ? tape.ceilingMm / 1000 : scanCeiling,
    beamM: tape.beamMm ? tape.beamMm / 1000 : clearances.length ? Math.min(...clearances) : null,
    fuelBurning,
    estimated: !tape.ceilingMm && rooms.some((r) => r.plan.scaleSource !== "user_measurement" || !r.plan.trusted),
    alarms: placeAlarms(layout, main?.plan ?? null, fuelBurning),
    egress,
  };
}

// ---- Drawing ----------------------------------------------------------------------------

type Area = { x: number; y: number; w: number; h: number };

function sideEnds(b: Box, side: PlanSide): [[number, number], [number, number]] {
  if (side === "minZ") return [[b.minX, b.minZ], [b.maxX, b.minZ]];
  if (side === "maxZ") return [[b.minX, b.maxZ], [b.maxX, b.maxZ]];
  if (side === "minX") return [[b.minX, b.minZ], [b.minX, b.maxZ]];
  return [[b.maxX, b.minZ], [b.maxX, b.maxZ]];
}
const INWARD: Record<PlanSide, [number, number]> = { minX: [1, 0], maxX: [-1, 0], minZ: [0, 1], maxZ: [0, -1] };

const inchDoor = (m: number) => `${Math.round(m / 0.0254)}" door`;

export function drawPlan(s: Sheet, area0: Area, g: Geometry, mode: "existing" | "proposed") {
  // Leave room for dimensions and the legend under the drawing.
  const legendH = 118;
  const box = g.box;
  const w = box.maxX - box.minX, d = box.maxZ - box.minZ;
  const scale = fitScale(PLAN_SCALES, w, d, area0.w - 120, area0.h - legendH - 90);
  const k = ptPerMetre(scale.ratio);
  const ox = area0.x + 60 + (area0.w - 120 - w * k) / 2;
  const oy = area0.y + legendH + 40 + (area0.h - legendH - 90 + d * k) / 2; // top edge of the drawing in page y
  const X = (x: number) => ox + (x - box.minX) * k;
  const Y = (z: number) => oy - (z - box.minZ) * k;
  const wallW = Math.max(4, 0.2 * k);

  // The suite's outline, softly filled, on the proposed plan.
  if (mode === "proposed" && g.main) {
    const b = g.main.plan.box;
    s.rect(X(b.minX), Y(b.maxZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k, { fill: TONE, stroke: false });
  }
  if (mode === "proposed" && g.layout) {
    for (const z of g.layout.zones.filter((z) => z.kind === "mechanical")) s.rect(X(z.x0), Y(z.z1), (z.x1 - z.x0) * k, (z.z1 - z.z0) * k, { fill: TONE2, stroke: false });
  }

  // Walls as two parallel lines with the wall's thickness between them (Kitchener's drawing standard).
  const T = 0.2; // foundation wall plus the new stud wall, in metres
  const band = (p0: number[], p1: number[], n: [number, number], t: number, fill: typeof TONE) =>
    s.poly([[X(p0[0]), Y(p0[1])], [X(p1[0]), Y(p1[1])], [X(p1[0] - n[0] * t), Y(p1[1] - n[1] * t)], [X(p0[0] - n[0] * t), Y(p0[1] - n[1] * t)]], { fill, width: 0.6 });
  for (const r of g.rooms) {
    const b = r.plan.box;
    for (const side of ["minX", "maxX", "minZ", "maxZ"] as PlanSide[]) {
      const [[x0, z0], [x1, z1]] = sideEnds(b, side);
      if (r.plan.sides[side] === "wall") band([x0, z0], [x1, z1], INWARD[side], T, TONE2);
      else s.line(X(x0), Y(z0), X(x1), Y(z1), { width: 0.8, dash: [5, 4], color: MUTED });
    }
    // Openings, cut into their walls.
    for (const o of r.plan.openings) {
      const [[x0, z0], [x1, z1]] = sideEnds(b, o.side);
      const len = Math.hypot(x1 - x0, z1 - z0) || 1;
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      const a = o.atM - o.widthM / 2, c = o.atM + o.widthM / 2;
      const p0 = [x0 + ux * a, z0 + uz * a], p1 = [x0 + ux * c, z0 + uz * c];
      const [nx, nz] = INWARD[o.side];
      if (r.plan.sides[o.side] === "wall") {
        band(p0, p1, INWARD[o.side], T, PAPER);
        s.line(X(p0[0]), Y(p0[1]), X(p1[0]), Y(p1[1]), { width: 1.2, color: PAPER });
      }
      if (o.kind === "window") {
        for (const off of [-0.07, -0.13]) s.line(X(p0[0] + nx * off), Y(p0[1] + nz * off), X(p1[0] + nx * off), Y(p1[1] + nz * off), { width: 0.6 });
        s.text(`W ${both(o.widthM)}`, X((p0[0] + p1[0]) / 2 + nx * 0.45), Y((p0[1] + p1[1]) / 2 + nz * 0.45) - 3, { size: 6.5, align: "center" });
      } else {
        const leaf = [p0[0] + nx * o.widthM, p0[1] + nz * o.widthM];
        s.line(X(p0[0]), Y(p0[1]), X(leaf[0]), Y(leaf[1]), { width: 0.6 });
        arc(s, X(p0[0]), Y(p0[1]), X(leaf[0]), Y(leaf[1]), X(p1[0]), Y(p1[1]));
        s.text(`${inchDoor(o.widthM)}`, X((p0[0] + p1[0]) / 2 + nx * (o.widthM + 0.3)), Y((p0[1] + p1[1]) / 2 + nz * (o.widthM + 0.3)) - 3, { size: 6.5, align: "center" });
      }
    }
    for (const st of r.plan.stairs) {
      const x0 = X(st.x0), y0 = Y(st.z1), x1 = X(st.x1), y1 = Y(st.z0);
      s.rect(x0, y0, x1 - x0, y1 - y0, { width: 0.6 });
      const along = st.x1 - st.x0 > st.z1 - st.z0;
      const n = Math.max(4, Math.round((along ? st.x1 - st.x0 : st.z1 - st.z0) / 0.25));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        if (along) s.line(x0 + t * (x1 - x0), y0, x0 + t * (x1 - x0), y1, { width: 0.4 });
        else s.line(x0, y0 + t * (y1 - y0), x1, y0 + t * (y1 - y0), { width: 0.4 });
      }
      s.text("STAIRS UP", (x0 + x1) / 2, (y0 + y1) / 2 - 3, { size: 6.5, align: "center", font: s.fonts.bold });
    }
    for (const f of r.plan.fixtures) {
      const size = Math.max(10, 0.6 * k);
      s.rect(X(f.x) - size / 2, Y(f.z) - size / 2, size, size, { width: 0.6 });
      s.line(X(f.x) - size / 2, Y(f.z) - size / 2, X(f.x) + size / 2, Y(f.z) + size / 2, { width: 0.4 });
      s.text({ panel: "ELEC. PANEL", furnace: "FURNACE", water_heater: "WATER HEATER", plumbing: "PLUMBING ROUGH-IN" }[f.kind], X(f.x), Y(f.z) - size / 2 - 8, { size: 6, align: "center" });
    }
    // Room label: only the existing plan, or areas outside the suite.
    if (mode === "existing" || r.plan !== g.main?.plan || !g.layout) {
      const cx = X((b.minX + b.maxX) / 2), cy = Y((b.minZ + b.maxZ) / 2);
      s.text(r.name.toUpperCase(), cx, cy + 6, { size: 8, font: s.fonts.bold, align: "center" });
      s.text(`${area(r.plan.areaM2)}`, cx, cy - 4, { size: 6.5, align: "center", color: MUTED });
      if (r.plan.ceilingHeightM != null) s.text(`Ceiling about ${both(r.plan.ceilingHeightM)}`, cx, cy - 13, { size: 6.5, align: "center", color: MUTED });
      if (mode === "existing") s.text(`${both(b.maxX - b.minX)} x ${both(b.maxZ - b.minZ)}`, cx, cy - 22, { size: 6, align: "center", color: MUTED });
    }
  }

  if (mode === "proposed" && g.layout) drawLayout(s, g, X, Y, k, wallW);

  // Overall dimensions.
  s.dim(X(box.minX), Y(box.minZ), X(box.maxX), Y(box.minZ), both(w), 22);
  s.dim(X(box.minX), Y(box.maxZ), X(box.minX), Y(box.minZ), both(d), 22);

  legend(s, { x: area0.x, y: area0.y, w: area0.w, h: legendH - 10 }, mode, g);
  return scale.label;
}

// A quarter-circle door swing from the hinge, between the open leaf and the closed position.
function arc(s: Sheet, hx: number, hy: number, ax: number, ay: number, bx: number, by: number) {
  const r = Math.hypot(ax - hx, ay - hy);
  const a0 = Math.atan2(ay - hy, ax - hx), a1raw = Math.atan2(by - hy, bx - hx);
  let a1 = a1raw;
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = a0 + ((a1 - a0) * i) / 12;
    pts.push([hx + r * Math.cos(t), hy + r * Math.sin(t)]);
  }
  s.poly(pts, { close: false, width: 0.4, color: MUTED, dash: [2, 2] });
}

function drawLayout(s: Sheet, g: Geometry, X: (x: number) => number, Y: (z: number) => number, k: number, wallW: number) {
  const L = g.layout!;
  // New walls: two lines 120 mm apart (2x4 and drywall), filled dark so they read as new work.
  const T = 0.12;
  const wallRect = (x0: number, z0: number, x1: number, z1: number, fill: typeof TONE, stroke = true) => {
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
    const a = alongX ? { x: Math.min(x0, x1), z: z0 - T / 2, w: Math.abs(x1 - x0), d: T } : { x: x0 - T / 2, z: Math.min(z0, z1), w: T, d: Math.abs(z1 - z0) };
    s.rect(X(a.x), Y(a.z + a.d), a.w * k, a.d * k, { fill, width: stroke ? 0.6 : 0, stroke });
  };
  for (const wl of L.walls) wallRect(wl.x0, wl.z0, wl.x1, wl.z1, TONE3);
  for (const d of L.doors) {
    const half = d.widthM / 2;
    if (d.along === "x") wallRect(d.x - half, d.z, d.x + half, d.z, PAPER, false);
    else wallRect(d.x, d.z - half, d.x, d.z + half, PAPER, false);
    const hx = d.along === "x" ? X(d.x - half) : X(d.x), hy = d.along === "x" ? Y(d.z) : Y(d.z - half);
    const ex = d.along === "x" ? X(d.x + half) : X(d.x), ey = d.along === "x" ? Y(d.z) : Y(d.z + half);
    const lx = d.along === "x" ? hx : hx + d.widthM * k, ly = d.along === "x" ? hy + d.widthM * k : hy;
    s.line(hx, hy, lx, ly, { width: 0.6 });
    arc(s, hx, hy, lx, ly, ex, ey);
    s.text(inchDoor(d.widthM), (hx + ex) / 2 + (d.along === "x" ? 0 : 10), (hy + ey) / 2 + (d.along === "x" ? -9 : 0), { size: 6, align: "center", color: MUTED });
  }
  for (const z of L.zones.filter((z) => z.kind !== "stairs")) zoneLabel(s, z, X, Y, k);
  for (const z of L.zones) fixtures(s, z, g.main?.plan.box ?? g.box, X, Y, k);
  // Alarms.
  for (const a of g.alarms) {
    const x = X(a.x), y = Y(a.z);
    s.circle(x, y, 7, { fill: PAPER, width: 0.8 });
    s.text(a.kind === "smoke" ? "S" : a.kind === "co" ? "CO" : "S/CO", x, y - 2.2, { size: a.kind === "combo" ? 4.6 : 6, align: "center", font: s.fonts.bold });
  }
  // The escape window.
  if (g.egress && g.main) {
    const b = g.main.plan.box;
    const [[x0, z0], [x1, z1]] = sideEnds(b, g.egress.side);
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const p = [x0 + ux * g.egress.atM, z0 + uz * g.egress.atM];
    const [nx, nz] = INWARD[g.egress.side];
    const out = [p[0] - nx * 0.9, p[1] - nz * 0.9];
    s.line(X(p[0]), Y(p[1]), X(out[0]), Y(out[1]), { width: 0.6 });
    s.circle(X(out[0]), Y(out[1]), 9, { fill: PAPER, width: 0.8 });
    s.text("A5", X(out[0]), Y(out[1]) - 3, { size: 6.5, align: "center", font: s.fonts.bold });
    s.text(g.egress.existing ? "BEDROOM WINDOW: ESCAPE WINDOW, SEE A5" : "NEW ESCAPE WINDOW, SEE A5", X(out[0]), Y(out[1]) - 18, { size: 6, align: "center", font: s.fonts.bold });
    if (!g.egress.existing) {
      const a = g.egress.atM - 0.3, c = g.egress.atM + 0.3;
      const q0 = [x0 + ux * a, z0 + uz * a], q1 = [x0 + ux * c, z0 + uz * c];
      s.poly([[X(q0[0]), Y(q0[1])], [X(q1[0]), Y(q1[1])], [X(q1[0] - nx * 0.2), Y(q1[1] - nz * 0.2)], [X(q0[0] - nx * 0.2), Y(q0[1] - nz * 0.2)]], { fill: PAPER, width: 0.6 });
      for (const off of [-0.07, -0.13]) s.line(X(q0[0] + nx * off), Y(q0[1] + nz * off), X(q1[0] + nx * off), Y(q1[1] + nz * off), { width: 0.6 });
    }
  }
  // The way out: from the living space to the exit (the stairs or a door of the main area).
  const living = L.zones.find((z) => z.kind === "living");
  const exit = g.main?.plan.openings.find((o) => o.kind === "door") ?? null;
  const stairs = L.zones.find((z) => z.kind === "stairs") ?? null;
  if (living && (exit || stairs)) {
    const from = [(living.x0 + living.x1) / 2, (living.z0 + living.z1) / 2];
    let to: number[];
    if (exit && g.main) {
      const [[x0, z0], [x1, z1]] = sideEnds(g.main.plan.box, exit.side);
      const len = Math.hypot(x1 - x0, z1 - z0) || 1;
      to = [x0 + ((x1 - x0) / len) * exit.atM, z0 + ((z1 - z0) / len) * exit.atM];
    } else to = [(stairs!.x0 + stairs!.x1) / 2, (stairs!.z0 + stairs!.z1) / 2];
    const cx = X(from[0]), cy = Y(from[1]), tx = X(to[0]), ty = Y(to[1]);
    const fx = cx + (tx - cx) * 0.45, fy = cy + (ty - cy) * 0.45;
    s.line(fx, fy, tx, ty, { width: 0.8, dash: [4, 3] });
    const ang = Math.atan2(ty - fy, tx - fx);
    s.poly([[tx, ty], [tx - 7 * Math.cos(ang - 0.4), ty - 7 * Math.sin(ang - 0.4)], [tx - 7 * Math.cos(ang + 0.4), ty - 7 * Math.sin(ang + 0.4)]], { fill: INK, width: 0.4 });
    s.text("EXIT", fx + 6, fy - 3, { size: 6.5, font: s.fonts.bold });
  }
}

function zoneLabel(s: Sheet, z: LayoutZone, X: (x: number) => number, Y: (z: number) => number, k: number) {
  const cx = X((z.x0 + z.x1) / 2), cy = Y((z.z0 + z.z1) / 2);
  const wide = (z.x1 - z.x0) * k, tall = (z.z1 - z.z0) * k;
  const label = z.kind === "mechanical" ? "FURNACE ROOM" : z.name.toUpperCase();
  const need = s.textWidth(label, 7.5, s.fonts.bold) + 8;
  // A narrow room gets its name turned to run along it; one too small for either gets none.
  if (wide < need && tall >= need && wide >= 14) {
    s.text(label, cx + 3, cy, { size: 7.5, font: s.fonts.bold, align: "center", rotate: 90 });
    if (tall > need + 50 && z.areaM2 >= 2) s.text(area(z.areaM2), cx + 13, cy, { size: 6, align: "center", color: MUTED, rotate: 90 });
    return;
  }
  if (wide < need || tall < 18) return;
  s.text(label, cx, cy + 5, { size: 7.5, font: s.fonts.bold, align: "center" });
  if (z.areaM2 >= 2 && wide >= s.textWidth(area(z.areaM2), 6) + 6) s.text(area(z.areaM2), cx, cy - 5, { size: 6, align: "center", color: MUTED });
  const dims = `${both(z.x1 - z.x0)} x ${both(z.z1 - z.z0)}`;
  if (tall > 40 && z.kind !== "kitchen" && z.kind !== "bathroom" && wide >= s.textWidth(dims, 5.5) + 6) s.text(dims, cx, cy - 14, { size: 5.5, align: "center", color: MUTED });
}

// Plumbing fixtures and kitchen appliances, along the zone's outside wall.
function fixtures(s: Sheet, z: LayoutZone, room: Box, X: (x: number) => number, Y: (z: number) => number, k: number) {
  const items = z.kind === "bathroom" ? ["WC", "LAV", "SHOWER"] : z.kind === "kitchen" ? ["FRIDGE", "SINK", "RANGE"] : [];
  if (!items.length) return;
  const alongX = z.x1 - z.x0 >= z.z1 - z.z0;
  const atMinSide = alongX ? Math.abs(z.z0 - room.minZ) < Math.abs(room.maxZ - z.z1) : Math.abs(z.x0 - room.minX) < Math.abs(room.maxX - z.x1);
  const len = alongX ? z.x1 - z.x0 : z.z1 - z.z0;
  const depth = Math.min(0.6, alongX ? z.z1 - z.z0 : z.x1 - z.x0);
  items.forEach((label, i) => {
    const wide = label === "SHOWER" ? Math.min(0.9, len / 3) : Math.min(0.6, len / 3.4);
    const a = (len / items.length) * (i + 0.5) - wide / 2;
    let x0: number, z0: number, x1: number, z1: number;
    if (alongX) {
      x0 = z.x0 + a;
      x1 = x0 + wide;
      z0 = atMinSide ? z.z0 : z.z1 - depth;
      z1 = z0 + depth;
    } else {
      z0 = z.z0 + a;
      z1 = z0 + wide;
      x0 = atMinSide ? z.x0 : z.x1 - depth;
      x1 = x0 + depth;
    }
    s.rect(X(x0), Y(z1), (x1 - x0) * k, (z1 - z0) * k, { width: 0.5, color: MUTED, fill: PAPER });
    s.text(label, X((x0 + x1) / 2), Y((z0 + z1) / 2) - 2, { size: label.length > 4 ? 4.2 : 5, align: "center", color: MUTED });
  });
}

function legend(s: Sheet, a: Area, mode: "existing" | "proposed", g: Geometry) {
  s.line(a.x, a.y + a.h, a.x + a.w, a.y + a.h, { width: 0.5, color: FAINT });
  let x = a.x + 4;
  const y = a.y + a.h - 16;
  const item = (draw: (x: number, y: number) => void, label: string, width = 150) => {
    draw(x, y);
    s.text(label, x + 30, y - 3, { size: 6.5 });
    x += width;
  };
  item((x, y) => s.rect(x, y - 3, 24, 6, { fill: TONE2, width: 0.6 }), "Existing wall (seen on video)");
  item((x, y) => s.line(x, y, x + 24, y, { width: 0.8, dash: [5, 4], color: MUTED }), "Edge not seen on video: confirm");
  if (mode === "proposed") {
    item((x, y) => s.rect(x, y - 2, 24, 4, { fill: TONE3, width: 0.6 }), "New wall, see wall type W1", 140);
    item((x, y) => s.circle(x + 12, y, 6), "S smoke, CO carbon monoxide alarm", 170);
    item((x, y) => s.rect(x, y - 5, 24, 10, { fill: TONE, width: 0.4, color: FAINT }), "The new unit", 100);
  }
  const notes =
    mode === "existing"
      ? [
          "Existing basement as filmed and measured. Areas are inside the walls.",
          `Ceiling heights shown are from the scan${g.ceilingM ? `; the suite's lowest measured height is about ${both(g.ceilingM)}` : ""}. Confirm with a tape.`,
          "No existing structure (beams, posts, foundation walls) is to be removed or changed unless shown on A3 and A7.",
        ]
      : [
          "W1: 38 x 89 mm (2x4) studs at 406 mm (16\") o.c., pressure-treated bottom plate (9.23.2.3), 12.7 mm (1/2\") gypsum board both sides.",
          "Suite ceiling and walls between the two homes: fire separation per A6, note 3 (15.9 mm (5/8\") Type X gypsum board, smoke-tight).",
          "Smoke and CO alarms: hard-wired, interconnected within the suite and with the main house, with battery backup. See A6.",
          g.fuelBurning ? "Furnace room: walls and ceiling 15.9 mm (5/8\") Type X gypsum board. Keep combustion air and clearances per the furnace label." : "Mechanical equipment stays accessible.",
        ];
  let ny = a.y + a.h - 34;
  notes.forEach((n, i) => {
    ny = s.wrap(`${i + 1}. ${n}`, a.x + 4, ny, a.w - 8, { size: 6.8, leading: 8.6 });
  });
}
