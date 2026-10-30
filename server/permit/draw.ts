// Drawing the model on a sheet: walls by kind (foundation solid, existing grey, new hatched), doors
// with their swings and widths, windows tagged width by height, dimension chains along the outside
// walls in feet-inches with millimetres, rated fire-separation lines, alarms with their strobe and
// interconnection, room names with areas and ceiling heights, and areas outside the work X'd out.
// Every line comes from the permit model (server/permit/model.ts).
import type { Opening, Pt, Room } from "../model/types";
import { at, bounds, type Box, centroid, dir, inPolygon, type PermitModel, type PFixture, project, type PWall, roomArea, wallLen } from "./model";
import { area, dimText, FAINT, ftIn, INK, MUTED, PAPER, ptPerMetre, type Sheet, sizeText, TONE, TONE2, TONE3 } from "./pdf";

export type Area = { x: number; y: number; w: number; h: number };
export type Scale = { label: string; ratio: number };
export type View = { X: (x: number) => number; Y: (z: number) => number; P: (p: Pt) => [number, number]; k: number; scale: Scale; box: Box };

// Room for the dimension chains around a plan, in points.
export const PAD = 66;

// The box centred in the area at this scale. Paper y grows up; the plan's z grows down the page.
export function makeView(a: Area, box: Box, scale: Scale): View {
  const k = ptPerMetre(scale.ratio);
  const w = (box.maxX - box.minX) * k, h = (box.maxZ - box.minZ) * k;
  const ox = a.x + (a.w - w) / 2, top = a.y + (a.h + h) / 2;
  const X = (x: number) => ox + (x - box.minX) * k;
  const Y = (z: number) => top - (z - box.minZ) * k;
  return { X, Y, P: (p) => [X(p[0]), Y(p[1])], k, scale, box };
}

const normal = (w: Pick<PWall, "a" | "b">): Pt => {
  const d = dir(w);
  return [-d[1], d[0]];
};
const add = (p: Pt, v: Pt, s = 1): Pt => [p[0] + v[0] * s, p[1] + v[1] * s];

// Which side of a wall its thickness goes: a foundation wall's goes outside, away from the rooms.
export function outward(w: PWall, rooms: Room[]): number {
  const n = normal(w);
  const mid = at(w, wallLen(w) / 2);
  const inside = rooms.some((r) => inPolygon(add(mid, n, 0.15), r.polygon));
  return inside ? -1 : 1;
}

function band(w: PWall, t0: number, t1: number, rooms: Room[]): Pt[] {
  const n = normal(w);
  const a = at(w, t0), b = at(w, t1);
  if (w.kind === "foundation") {
    const o = outward(w, rooms) * w.thicknessM;
    return [a, b, add(b, n, o), add(a, n, o)];
  }
  const h = w.thicknessM / 2;
  return [add(a, n, -h), add(b, n, -h), add(b, n, h), add(a, n, h)];
}

// The solid parts of a wall between its openings, as [t0, t1] along it.
export function solidSpans(w: PWall, openings: Opening[]): [number, number][] {
  const L = wallLen(w);
  const cuts = openings
    .filter((o) => o.wallId === w.id)
    .map((o) => [Math.max(0, o.offsetM - o.widthM / 2), Math.min(L, o.offsetM + o.widthM / 2)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let t = 0;
  for (const [c0, c1] of cuts) {
    if (c0 > t + 0.01) out.push([t, c0]);
    t = Math.max(t, c1);
  }
  if (L > t + 0.01) out.push([t, L]);
  return out;
}

export type PlanOpts = {
  mode: "plan" | "ceiling" | "light";
  review: boolean; // the owner's review copy: guesses marked to confirm
  windows: PermitModel["windows"];
};

// Walls, openings and fixtures of the proposed design.
export function drawWalls(s: Sheet, v: View, m: PermitModel, o: PlanOpts) {
  const { walls, openings, rooms } = m.design.proposed;
  const light = o.mode !== "plan";
  for (const w of walls) {
    for (const [t0, t1] of solidSpans(w, openings)) {
      const poly = band(w, t0, t1, rooms).map(v.P);
      if (w.kind === "foundation") s.poly(poly, { fill: light ? TONE3 : INK, width: 0.5 });
      else if (w.kind === "existing") s.poly(poly, { fill: light ? TONE : TONE2, width: 0.6 });
      else {
        s.poly(poly, { fill: PAPER, width: light ? 0.5 : 0.8 });
        if (!light) s.hatch(poly, 2.6, { width: 0.3 });
      }
      if (o.review && w.guess) s.poly(band(w, t0, t1, rooms).map(v.P), { width: 0.6, dash: [2, 2], color: MUTED });
    }
  }
  // Rated lines over the walls: 30 minutes, continuous along each rated wall.
  if (o.mode === "plan")
    for (const w of walls.filter((x) => x.rating === "30min")) {
      for (const [t0, t1] of solidSpans(w, openings)) s.line(...v.P(at(w, t0)), ...v.P(at(w, t1)), { width: 2.4, dash: [7, 2.2, 1.6, 2.2] });
    }
  for (const op of openings) {
    const w = walls.find((x) => x.id === op.wallId);
    if (!w) continue;
    if (op.kind === "window") drawWindow(s, v, w, op, m, o);
    else if (o.mode === "plan") drawDoor(s, v, w, op, rooms);
  }
}

function drawWindow(s: Sheet, v: View, w: PWall, op: Opening, m: PermitModel, o: PlanOpts) {
  const rooms = m.design.proposed.rooms;
  const n = normal(w);
  const t0 = op.offsetM - op.widthM / 2, t1 = op.offsetM + op.widthM / 2;
  const poly = band(w, t0, t1, rooms);
  s.poly(poly.map(v.P), { fill: PAPER, width: 0.6 });
  // Glass: two lines along the middle of the wall.
  const c0 = [(poly[0][0] + poly[3][0]) / 2, (poly[0][1] + poly[3][1]) / 2] as Pt, c1 = [(poly[1][0] + poly[2][0]) / 2, (poly[1][1] + poly[2][1]) / 2] as Pt;
  for (const off of [-0.025, 0.025]) s.line(...v.P(add(c0, n, off)), ...v.P(add(c1, n, off)), { width: 0.5 });
  if (o.mode !== "plan") return;
  const info = o.windows.find((x) => x.id === op.id);
  if (!info) return;
  // The tag goes inside, clear of the dimension chains outside.
  const side = w.kind === "foundation" ? -outward(w, rooms) : 1;
  const tagAt = v.P(add(at(w, op.offsetM), n, side * 0.42));
  const label = `${info.tag} ${sizeText(info.widthM, info.heightM)}`;
  const status = info.change === "keep" ? "EXISTING" : info.change === "new" ? "NEW" : "ENLARGED";
  const tw = Math.max(s.textWidth(label, 6.2, s.fonts.bold), s.textWidth(status, 5.5)) + 8;
  s.rect(tagAt[0] - tw / 2, tagAt[1] - 9, tw, 19, { fill: PAPER, width: 0.6 });
  s.text(label, tagAt[0], tagAt[1] + 2.5, { size: 6.2, font: s.fonts.bold, align: "center" });
  s.text(status + (info.escape ? ", ESCAPE" : ""), tagAt[0], tagAt[1] - 5.5, { size: 5.3, align: "center" });
}

function drawDoor(s: Sheet, v: View, w: PWall, op: Opening, rooms: Room[]) {
  const n = normal(w);
  const t0 = op.offsetM - op.widthM / 2, t1 = op.offsetM + op.widthM / 2;
  // Swing into unit 2's open space where there is one.
  const probe = add(at(w, op.offsetM), n, 0.5);
  const into = rooms.some((r) => r.unit === 2 && r.kind !== "stairs" && r.kind !== "mechanical" && inPolygon(probe, r.polygon)) ? 1 : -1;
  const hinge = op.swing === "right" ? at(w, t1) : at(w, t0);
  const latch = op.swing === "right" ? at(w, t0) : at(w, t1);
  const leaf = add(hinge, n, into * op.widthM);
  const [hx, hy] = v.P(hinge), [lx, ly] = v.P(leaf), [ex, ey] = v.P(latch);
  s.line(hx, hy, lx, ly, { width: 0.8 });
  arc(s, hx, hy, lx, ly, ex, ey);
  const lab = v.P(add(at(w, op.offsetM), n, -into * (w.thicknessM / 2 + 0.22)));
  s.text(dimText(op.widthM), lab[0], lab[1] - 2.5, { size: 5.5, align: "center", color: MUTED });
  if (op.rating === "20min") {
    // The rated door's tag: a diamond with 20, beside the leaf.
    const c = v.P(add(add(at(w, op.offsetM), n, into * (op.widthM * 0.55)), dir(w), op.swing === "right" ? -0.28 : 0.28));
    s.poly([[c[0], c[1] + 7], [c[0] + 7, c[1]], [c[0], c[1] - 7], [c[0] - 7, c[1]]], { fill: PAPER, width: 0.8 });
    s.text("20", c[0], c[1] - 2.2, { size: 5.5, align: "center", font: s.fonts.bold });
  }
}

// A quarter-circle door swing from the hinge, between the open leaf and the closed position.
export function arc(s: Sheet, hx: number, hy: number, ax: number, ay: number, bx: number, by: number) {
  const r = Math.hypot(ax - hx, ay - hy);
  const a0 = Math.atan2(ay - hy, ax - hx);
  let a1 = Math.atan2(by - hy, bx - hx);
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = a0 + ((a1 - a0) * i) / 12;
    pts.push([hx + r * Math.cos(t), hy + r * Math.sin(t)]);
  }
  s.poly(pts, { close: false, width: 0.4, color: MUTED, dash: [2, 2] });
}

// Stairs with their treads, the furnace, water heater, panel and plumbing rough-ins.
export function drawFixtures(s: Sheet, v: View, fixtures: PFixture[]) {
  for (const f of fixtures) {
    const size = f.sizeM ?? [0.5, 0.5];
    const x0 = v.X(f.at[0] - size[0] / 2), x1 = v.X(f.at[0] + size[0] / 2), y0 = v.Y(f.at[1] + size[1] / 2), y1 = v.Y(f.at[1] - size[1] / 2);
    if (f.kind === "stairs") {
      s.rect(x0, y0, x1 - x0, y1 - y0, { width: 0.7, fill: PAPER });
      const alongX = size[0] >= size[1];
      const n = Math.max(4, Math.round((alongX ? size[0] : size[1]) / 0.25));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        if (alongX) s.line(x0 + t * (x1 - x0), y0, x0 + t * (x1 - x0), y1, { width: 0.4 });
        else s.line(x0, y0 + t * (y1 - y0), x1, y0 + t * (y1 - y0), { width: 0.4 });
      }
      // The run arrow, up the stair.
      const [ax, ay, bx, by] = alongX ? [x0 + 4, (y0 + y1) / 2, x1 - 6, (y0 + y1) / 2] : [(x0 + x1) / 2, y0 + 4, (x0 + x1) / 2, y1 - 6];
      s.line(ax, ay, bx, by, { width: 0.6 });
      const ang = Math.atan2(by - ay, bx - ax);
      s.poly([[bx, by], [bx - 5 * Math.cos(ang - 0.45), by - 5 * Math.sin(ang - 0.45)], [bx - 5 * Math.cos(ang + 0.45), by - 5 * Math.sin(ang + 0.45)]], { fill: INK, width: 0.3 });
      s.text("UP", (x0 + x1) / 2 + (alongX ? 0 : 7), (y0 + y1) / 2 + (alongX ? 4 : 0), { size: 6, font: s.fonts.bold, align: "center" });
      continue;
    }
    if (f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead" || f.kind === "post") continue;
    const cx = v.X(f.at[0]), cy = v.Y(f.at[1]);
    if (f.kind === "water_heater") {
      s.circle(cx, cy, Math.max(5, (size[0] / 2) * v.k), { width: 0.7, fill: PAPER });
      s.text("WH", cx, cy - 2, { size: 5.5, align: "center" });
    } else if (f.kind === "plumbing") {
      s.circle(cx, cy, 3.5, { width: 0.6, fill: PAPER });
      s.text("RI", cx + 6, cy - 2, { size: 5, color: MUTED });
    } else {
      s.rect(x0, y0, Math.max(6, x1 - x0), Math.max(4, y1 - y0), { width: 0.7, fill: PAPER });
      s.text(f.kind === "furnace" ? "FURNACE" : "PANEL", cx, cy - 2.2, { size: 5, align: "center" });
    }
  }
}

// Unit 2's floor, toned, and the 15-minute ceiling's edge just inside it.
export function drawUnit(s: Sheet, v: View, polys: Pt[][], o: { tone: boolean; ceiling15: boolean }) {
  for (const p of polys) if (o.tone) s.poly(p.map(v.P), { fill: TONE, width: 0 });
  if (!o.ceiling15 || !polys.length) return;
  const b = bounds(polys.flat());
  const inset = 0.2;
  const [x0, y0] = v.P([b.minX + inset, b.maxZ - inset]), [x1, y1] = v.P([b.maxX - inset, b.minZ + inset]);
  s.rect(x0, y0, x1 - x0, y1 - y0, { width: 0.7, dash: [3, 1.5], color: MUTED });
  const label = "15-MIN CEILING OVER ALL OF UNIT 2 (A4, A6 C1)";
  s.text(label, x1 - 4, y1 - 9, { size: 5.3, align: "right", color: MUTED });
}

// The bathroom's and kitchen's fixtures: from the design's furniture where it has them, otherwise
// set along the room's wall farthest into the suite's outside wall.
export function drawRoomFixtures(s: Sheet, v: View, m: PermitModel) {
  const furn = m.design.proposed.furniture ?? [];
  const LABEL: Record<string, string> = { toilet: "WC", vanity: "LAV", shower: "SHOWER", kitchen: "COUNTER", fridge: "FRIDGE", washer_dryer: "W/D" };
  const fixed = furn.filter((f) => LABEL[f.kind]);
  if (fixed.length) {
    for (const f of fixed) {
      const [w, d] = f.sizeM;
      const r = (f.rotDeg * Math.PI) / 180;
      const corners: Pt[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [f.at[0] + x * Math.cos(r) - z * Math.sin(r), f.at[1] + x * Math.sin(r) + z * Math.cos(r)]);
      s.poly(corners.map(v.P), { width: 0.5, color: MUTED, fill: PAPER });
      const [cx, cy] = v.P(f.at);
      s.text(LABEL[f.kind], cx, cy - 2, { size: 4.6, align: "center", color: MUTED });
    }
    return;
  }
  const outer = bounds(m.design.proposed.rooms.filter((r) => r.unit === 2).flatMap((r) => r.polygon));
  for (const room of m.design.proposed.rooms.filter((r) => r.unit === 2 && (r.kind === "bathroom" || r.kind === "kitchen"))) {
    const z = bounds(room.polygon);
    const items = room.kind === "bathroom" ? ["WC", "LAV", "SHOWER"] : ["FRIDGE", "SINK", "RANGE"];
    const alongX = z.maxX - z.minX >= z.maxZ - z.minZ;
    const atMin = alongX ? Math.abs(z.minZ - outer.minZ) < Math.abs(outer.maxZ - z.maxZ) : Math.abs(z.minX - outer.minX) < Math.abs(outer.maxX - z.maxX);
    const len = alongX ? z.maxX - z.minX : z.maxZ - z.minZ;
    const depth = Math.min(0.6, alongX ? z.maxZ - z.minZ : z.maxX - z.minX);
    items.forEach((label, i) => {
      const wide = label === "SHOWER" ? Math.min(0.9, len / 3) : Math.min(0.6, len / 3.4);
      const a = (len / items.length) * (i + 0.5) - wide / 2;
      let x0: number, z0: number, x1: number, z1: number;
      if (alongX) {
        x0 = z.minX + a;
        x1 = x0 + wide;
        z0 = atMin ? z.minZ + 0.06 : z.maxZ - depth - 0.06;
        z1 = z0 + depth;
      } else {
        z0 = z.minZ + a;
        z1 = z0 + wide;
        x0 = atMin ? z.minX + 0.06 : z.maxX - depth - 0.06;
        x1 = x0 + depth;
      }
      const [px0, py0] = v.P([x0, z1]), [px1, py1] = v.P([x1, z0]);
      s.rect(px0, py0, px1 - px0, py1 - py0, { width: 0.5, color: MUTED, fill: PAPER });
      if (label === "WC") s.circle((px0 + px1) / 2, (py0 + py1) / 2, Math.min(px1 - px0, py1 - py0) / 3, { width: 0.4, color: MUTED });
      s.text(label, (px0 + px1) / 2, (py0 + py1) / 2 - 2, { size: label.length > 4 ? 4.2 : 4.8, align: "center", color: MUTED });
    });
  }
}

// Room names, areas, sizes and ceiling heights.
export function drawRoomLabels(s: Sheet, v: View, m: PermitModel, o: { ceiling: boolean; unitTag: boolean }) {
  const rooms = m.design.proposed.rooms;
  for (const r of rooms) {
    if (r.kind === "stairs") continue;
    const b = bounds(r.polygon);
    // A kitchen that's only a counter along the wall: its fixtures say what it is.
    if (r.kind === "kitchen" && Math.min(b.maxX - b.minX, b.maxZ - b.minZ) < 1.2) continue;
    // Leave a stair or furnace room drawn inside this one out of where the label goes.
    const inner = rooms.filter((x) => x !== r && (x.kind === "stairs" || x.kind === "mechanical")).map((x) => bounds(x.polygon));
    let c = centroid(r.polygon);
    for (const ib of inner) if (c[0] > ib.minX - 0.4 && c[0] < ib.maxX + 0.4 && c[1] > ib.minZ - 0.4 && c[1] < ib.maxZ + 0.4) c = [c[0], ib.maxZ + 0.9 < b.maxZ ? ib.maxZ + 0.9 : ib.minZ - 0.9];
    const [cx, cy] = v.P(c);
    const wide = (b.maxX - b.minX) * v.k;
    const name = (r.unit === 2 ? r.name : `${r.name}${r.unit === 1 ? " (unit 1)" : r.unit === "shared" && r.kind !== "mechanical" ? " (shared)" : ""}`).toUpperCase();
    const lines: [string, number, boolean][] = [[name, 7, true]];
    lines.push([area(roomArea(r, rooms)), 5.8, false]);
    if (r.unit === 2) lines.push([`${ftIn(b.maxX - b.minX)} x ${ftIn(b.maxZ - b.minZ)}`, 5.5, false]);
    const clg = r.ceilingM ?? m.ceilingM;
    if (o.ceiling && clg) lines.push([`CLG ${ftIn(clg)} (${Math.round(clg * 1000)})`, 5.5, false]);
    const tall = (b.maxZ - b.minZ) * v.k;
    const width = (t: string, size: number, bold: boolean) => s.textWidth(t, size, bold ? s.fonts.bold : s.fonts.regular) + 6;
    const turned = width(name, 7, true) > wide && width(name, 7, true) <= tall && wide >= 30;
    const room = turned ? tall : wide;
    let y = (turned ? cx - (lines.length * 7.5) / 2 + 5 : cy + (lines.length * 7.5) / 2 - 5);
    for (const [t, size, bold] of lines) {
      if (width(t, size, bold) > room) continue;
      const style = { size, align: "center" as const, font: bold ? s.fonts.bold : s.fonts.regular, color: bold ? INK : MUTED };
      if (turned) {
        s.text(t, y, cy, { ...style, rotate: 90 });
        y += size + 2.2;
      } else {
        s.text(t, cx, y, style);
        y -= size + 2.2;
      }
    }
  }
  if (o.unitTag) {
    const unit = rooms.filter((r) => r.unit === 2);
    if (unit.length) {
      const b = bounds(unit.flatMap((r) => r.polygon));
      const [x, y] = v.P([b.minX, b.minZ]);
      s.rect(x + 6, y - 20, 50, 14, { fill: PAPER, width: 0.9 });
      s.text("UNIT 2", x + 31, y - 15.5, { size: 7.5, font: s.fonts.bold, align: "center" });
    }
  }
}

// Smoke and CO alarms: a circle with S.A., C.O. or both, rays for the strobe, and a dashed line
// joining them all (they're interconnected).
export function drawAlarms(s: Sheet, pts: { kind: "smoke" | "co" | "combo"; at: [number, number] }[]) {
  if (!pts.length) return;
  // The interconnection, nearest neighbour to nearest neighbour.
  const left = [...pts];
  let cur = left.shift()!;
  while (left.length) {
    left.sort((a, b) => Math.hypot(a.at[0] - cur.at[0], a.at[1] - cur.at[1]) - Math.hypot(b.at[0] - cur.at[0], b.at[1] - cur.at[1]));
    const next = left.shift()!;
    s.line(cur.at[0], cur.at[1], next.at[0], next.at[1], { width: 0.5, dash: [1.5, 2], color: MUTED });
    cur = next;
  }
  for (const a of pts) alarmSymbol(s, a.at[0], a.at[1], a.kind);
}

export function alarmSymbol(s: Sheet, x: number, y: number, kind: "smoke" | "co" | "combo") {
  for (let i = 0; i < 4; i++) {
    const t = Math.PI / 4 + (i * Math.PI) / 2;
    s.line(x + 8 * Math.cos(t), y + 8 * Math.sin(t), x + 11 * Math.cos(t), y + 11 * Math.sin(t), { width: 0.6 });
  }
  s.circle(x, y, 7, { fill: PAPER, width: 0.9 });
  const t = kind === "smoke" ? "S.A." : kind === "co" ? "C.O." : "S/CO";
  s.text(t, x, y - 1.8, { size: kind === "combo" ? 4.4 : 4.8, align: "center", font: s.fonts.bold });
}

// Areas inside the basement's outline that aren't part of any room: outside this work.
export function drawOutside(s: Sheet, v: View, rooms: Room[], box: Box) {
  const step = 0.25;
  const nx = Math.ceil((box.maxX - box.minX) / step), nz = Math.ceil((box.maxZ - box.minZ) / step);
  if (nx * nz > 40000) return;
  const free: boolean[][] = [];
  for (let i = 0; i < nz; i++) {
    free.push([]);
    for (let j = 0; j < nx; j++) {
      const p: Pt = [box.minX + (j + 0.5) * step, box.minZ + (i + 0.5) * step];
      free[i].push(!rooms.some((r) => inPolygon(p, r.polygon)));
    }
  }
  // Greedy rectangles of free cells.
  for (let i = 0; i < nz; i++)
    for (let j = 0; j < nx; j++) {
      if (!free[i][j]) continue;
      let w = 0;
      while (j + w < nx && free[i][j + w]) w++;
      let h = 1;
      while (i + h < nz && free[i + h].slice(j, j + w).every(Boolean)) h++;
      for (let a = i; a < i + h; a++) for (let b = j; b < j + w; b++) free[a][b] = false;
      if (w * h * step * step < 1.2) continue;
      const x0 = v.X(box.minX + j * step), x1 = v.X(box.minX + (j + w) * step), y0 = v.Y(box.minZ + i * step), y1 = v.Y(box.minZ + (i + h) * step);
      s.line(x0, y0, x1, y1, { width: 0.5, color: MUTED });
      s.line(x0, y1, x1, y0, { width: 0.5, color: MUTED });
      const label = "NOT PART OF THIS WORK";
      if (Math.abs(x1 - x0) > s.textWidth(label, 6) + 10) {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        s.rect(cx - s.textWidth(label, 6) / 2 - 3, cy - 4, s.textWidth(label, 6) + 6, 11, { fill: PAPER, stroke: false });
        s.text(label, cx, cy - 1, { size: 6, align: "center", color: MUTED });
      }
    }
}

// ---- Dimension chains ---------------------------------------------------------------------------

// Along each edge of unit 2: one chain through every window and door edge and every wall that
// meets that edge, then the overall length further out. One chain per edge, however many scanned
// walls make up that edge.
export function drawChains(s: Sheet, v: View, m: PermitModel, clipBox?: Box) {
  const { walls, openings } = m.design.proposed;
  const polys = [...m.design.proposed.rooms.filter((r) => r.unit === 2), ...m.existing.rooms.filter((r) => r.unit === 2)].map((r) => r.polygon);
  if (!polys.length) return;
  const ub = bounds(polys.flat());
  const edges: { a: Pt; b: Pt; out: Pt }[] = [
    { a: [ub.minX, ub.minZ], b: [ub.maxX, ub.minZ], out: [0, -1] },
    { a: [ub.minX, ub.maxZ], b: [ub.maxX, ub.maxZ], out: [0, 1] },
    { a: [ub.minX, ub.minZ], b: [ub.minX, ub.maxZ], out: [-1, 0] },
    { a: [ub.maxX, ub.minZ], b: [ub.maxX, ub.maxZ], out: [1, 0] },
  ];
  for (const e of edges) {
    const edge = { a: e.a, b: e.b };
    const L = wallLen(edge);
    if (L < 0.5) continue;
    if (clipBox) {
      const mid = at(edge, L / 2);
      if (mid[0] < clipBox.minX - 0.5 || mid[0] > clipBox.maxX + 0.5 || mid[1] < clipBox.minZ - 0.5 || mid[1] > clipBox.maxZ + 0.5) continue;
    }
    // Walls lying along this edge, and how thick the edge is outward.
    const along = walls.filter((w) => {
      const P = project(edge, w.a), Q = project(edge, w.b);
      return Math.abs(P.off) < 0.15 && Math.abs(Q.off) < 0.15 && Math.max(P.t, Q.t) > 0.05 && Math.min(P.t, Q.t) < L - 0.05;
    });
    const face = Math.max(0.06, ...along.map((w) => (w.kind === "foundation" ? w.thicknessM : w.thicknessM / 2)));
    const ts = [0, L];
    for (const w of along)
      for (const o of openings.filter((x) => x.wallId === w.id)) {
        const c = project(edge, at(w, o.offsetM)).t;
        ts.push(c - o.widthM / 2, c + o.widthM / 2);
      }
    for (const x of walls) {
      if (along.includes(x)) continue;
      for (const p of [x.a, x.b]) {
        const pr = project(edge, p);
        if (Math.abs(pr.off) < 0.2 && pr.t > 0.05 && pr.t < L - 0.05) ts.push(pr.t);
      }
    }
    const sorted = [...new Set(ts.map((t) => Math.round(Math.max(0, Math.min(L, t)) * 1000) / 1000))].sort((p, q) => p - q).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 0.03);
    const n = normal(edge);
    const side = n[0] * e.out[0] + n[1] * e.out[1] > 0 ? 1 : -1;
    const off1 = face + 0.18 + 14 / v.k, off2 = off1 + 16 / v.k;
    const w0 = { ...edge, id: "edge", thicknessM: face, kind: "existing", rating: null } as PWall;
    for (let i = 0; i + 1 < sorted.length; i++) chainSeg(s, v, w0, sorted[i], sorted[i + 1], n, side * off1, i, face);
    if (sorted.length > 2) chainSeg(s, v, w0, 0, L, n, side * off2, 0, face);
  }
}

function chainSeg(s: Sheet, v: View, w: PWall, t0: number, t1: number, n: Pt, off: number, i: number, face: number) {
  const a = add(at(w, t0), n, off), b = add(at(w, t1), n, off);
  const [ax, ay] = v.P(a), [bx, by] = v.P(b);
  s.line(ax, ay, bx, by, { width: 0.45, color: MUTED });
  // Extension lines back toward the wall, and ticks.
  for (const [t, [px, py]] of [[t0, [ax, ay]], [t1, [bx, by]]] as [number, [number, number]][]) {
    const [wx, wy] = v.P(add(at(w, t), n, Math.sign(off) * (face + 0.06)));
    s.line(wx, wy, px + (px - wx) * 0.04, py + (py - wy) * 0.04, { width: 0.3, color: MUTED });
    s.line(px - 3, py - 3, px + 3, py + 3, { width: 0.8 });
  }
  const len = t1 - t0;
  const label = dimText(len);
  const span = Math.hypot(bx - ax, by - ay);
  const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  const up = ang > 90 || ang < -90 ? ang + 180 : ang;
  const size = 5.6;
  const tw = s.textWidth(label, size);
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  // Text sits outside the line; a short segment's label is staggered further out.
  const out = v.P(add(at(w, (t0 + t1) / 2), n, off + Math.sign(off) * 0.01));
  const ox = out[0] - mx, oy = out[1] - my;
  const ol = Math.hypot(ox, oy) || 1;
  const push = tw + 4 > span ? 10 + (i % 2) * 8 : 2.5;
  const r = (up * Math.PI) / 180;
  // Glyphs rise along u from the baseline; when "outside" points the other way, drop the baseline
  // by the text's height so the words still sit clear of the line.
  const ux = -Math.sin(r), uy = Math.cos(r);
  const below = (ox / ol) * ux + (oy / ol) * uy < 0 ? size * 0.75 : 0;
  const tx = mx + (ox / ol) * (push + below), ty = my + (oy / ol) * (push + below);
  s.text(label, tx, ty, { size, align: "center", rotate: Math.abs(up) < 0.5 ? undefined : up });
}

// ---- Legend -------------------------------------------------------------------------------------

export type LegendItem = { draw: (x: number, y: number) => void; label: string };

export function legendBox(s: Sheet, x: number, y: number, w: number, title: string, items: LegendItem[]) {
  const rowH = 13;
  const h = 16 + items.length * rowH + 4;
  s.rect(x, y - h, w, h, { fill: PAPER, width: 0.6 });
  s.text(title, x + 6, y - 11, { size: 6.5, font: s.fonts.bold });
  items.forEach((it, i) => {
    const yy = y - 22 - i * rowH;
    it.draw(x + 8, yy);
    s.wrap(it.label, x + 42, yy + 2, w - 48, { size: 5.8, leading: 6.6 });
  });
  return h;
}

export const LEGEND = {
  foundation: (s: Sheet): LegendItem => ({ draw: (x, y) => s.rect(x, y - 3, 26, 6, { fill: INK, width: 0.5 }), label: "Foundation wall (existing, concrete)" }),
  existing: (s: Sheet): LegendItem => ({ draw: (x, y) => s.rect(x, y - 3, 26, 6, { fill: TONE2, width: 0.6 }), label: "Existing wall" }),
  new: (s: Sheet): LegendItem => ({
    draw: (x, y) => {
      s.rect(x, y - 3, 26, 6, { fill: PAPER, width: 0.8 });
      s.hatch([[x, y - 3], [x + 26, y - 3], [x + 26, y + 3], [x, y + 3]], 2.6, { width: 0.3 });
    },
    label: "New wall: 2x4 studs at 16\" o.c. (A6, W1)",
  }),
  rated30: (s: Sheet): LegendItem => ({ draw: (x, y) => s.line(x, y, x + 26, y, { width: 2.4, dash: [7, 2.2, 1.6, 2.2] }), label: "30-minute fire separation, continuous (A6, W2)" }),
  rated15: (s: Sheet): LegendItem => ({
    draw: (x, y) => {
      s.rect(x, y - 4, 26, 8, { width: 0.6, dash: [3, 1.5] });
      s.hatch([[x, y - 4], [x + 26, y - 4], [x + 26, y + 4], [x, y + 4]], 4, { width: 0.25, color: MUTED });
    },
    label: "15-minute ceiling (floor above) over all of unit 2 (A6, C1)",
  }),
  door20: (s: Sheet): LegendItem => ({
    draw: (x, y) => {
      s.poly([[x + 13, y + 6], [x + 20, y], [x + 13, y - 6], [x + 6, y]], { fill: PAPER, width: 0.8 });
      s.text("20", x + 13, y - 2, { size: 5.5, align: "center", font: s.fonts.bold });
    },
    label: "20-minute door, self-closer, positive latch, lever handle",
  }),
  alarms: (s: Sheet): LegendItem => ({ draw: (x, y) => alarmSymbol(s, x + 13, y, "smoke"), label: "S.A. smoke, C.O. carbon monoxide, S/CO both: hard-wired, strobe (rays)" }),
  interconnect: (s: Sheet): LegendItem => ({ draw: (x, y) => s.line(x, y, x + 26, y, { width: 0.6, dash: [1.5, 2], color: MUTED }), label: "Interconnected: any alarm sounds every alarm in both units" }),
  outside: (s: Sheet): LegendItem => ({
    draw: (x, y) => {
      s.rect(x, y - 4, 26, 8, { width: 0.4, color: MUTED });
      s.line(x, y - 4, x + 26, y + 4, { width: 0.4, color: MUTED });
      s.line(x, y + 4, x + 26, y - 4, { width: 0.4, color: MUTED });
    },
    label: "Unexcavated or outside this work",
  }),
};
