// A design drawn for the book: rooms in a light tone with their names and areas, walls by kind
// (foundation, kept, new, and the 30-minute fire separation drawn double), doors with their swing,
// windows, and the alarms. Fitted to any box, so the same drawing makes the big plan and the small
// cards of the alternatives. Not a permit sheet: that's server/permit.
import { rgb } from "pdf-lib";
import type { Design, Pt, Wall } from "../model/types";
import type { Sheet } from "../permit/pdf";

export const FOREST = rgb(0.059, 0.165, 0.118); // brand ink #0F2A1E
export const MOSS = rgb(0.29, 0.365, 0.322); // muted ink #4A5D52
export const LEAF = rgb(0.122, 0.478, 0.29); // accent text #1F7A4A
export const SAGE = rgb(0.902, 0.922, 0.894); // surface #E6EBE4
export const LINE = rgb(0.835, 0.867, 0.831); // border #D5DDD4
export const MINT = rgb(0.294, 0.89, 0.541); // fill only #4BE38A
export const AMBER = rgb(0.549, 0.416, 0); // fix #8C6A00
export const RED = rgb(0.706, 0.137, 0.094); // stop #B42318

const ROOM_FILL: Record<string, ReturnType<typeof rgb>> = {
  bedroom: rgb(0.93, 0.95, 0.92),
  living: rgb(0.95, 0.96, 0.94),
  kitchen: rgb(0.92, 0.94, 0.9),
  bathroom: rgb(0.9, 0.93, 0.93),
  stairs: rgb(0.88, 0.88, 0.86),
  mechanical: rgb(0.86, 0.86, 0.84),
};

export type Box = { x: number; y: number; w: number; h: number };

function polyArea(p: Pt[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  return Math.abs(s) / 2;
}

export function drawDesign(s: Sheet, d: Design, box: Box, o: { labels?: boolean } = {}) {
  const pts = [...d.proposed.walls.flatMap((w) => [w.a, w.b]), ...d.proposed.rooms.flatMap((r) => r.polygon)];
  if (!pts.length) return;
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minZ = Math.min(...pts.map((p) => p[1])), maxZ = Math.max(...pts.map((p) => p[1]));
  const k = Math.min(box.w / (maxX - minX || 1), box.h / (maxZ - minZ || 1));
  const ox = box.x + (box.w - (maxX - minX) * k) / 2;
  const oy = box.y + box.h - (box.h - (maxZ - minZ) * k) / 2;
  const P = (p: Pt): [number, number] => [ox + (p[0] - minX) * k, oy - (p[1] - minZ) * k];
  const small = k < 25;

  for (const r of d.proposed.rooms) s.poly(r.polygon.map(P), { fill: ROOM_FILL[r.kind] ?? SAGE, color: LINE, width: 0.4 });

  const walls = new Map(d.proposed.walls.map((w) => [w.id, w]));
  const weight = (w: Wall) => (w.kind === "foundation" ? (small ? 2 : 4) : w.kind === "existing" ? (small ? 1.2 : 2.4) : small ? 1.4 : 2.8);
  for (const w of d.proposed.walls) {
    const [a, b] = [P(w.a), P(w.b)];
    s.line(a[0], a[1], b[0], b[1], { width: weight(w), color: w.kind === "new" ? LEAF : FOREST });
    if (w.rating) {
      // The fire separation: a second line alongside, so it reads in black and white too.
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
      const off = small ? 1.6 : 3.2;
      s.line(a[0] + n[0] * off, a[1] + n[1] * off, b[0] + n[0] * off, b[1] + n[1] * off, { width: small ? 0.5 : 0.9, color: RED, dash: [3, 2] });
    }
  }

  for (const op of d.proposed.openings) {
    const w = walls.get(op.wallId);
    if (!w) continue;
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const u: Pt = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    const c: Pt = [w.a[0] + u[0] * op.offsetM, w.a[1] + u[1] * op.offsetM];
    const e0 = P([c[0] - (u[0] * op.widthM) / 2, c[1] - (u[1] * op.widthM) / 2]);
    const e1 = P([c[0] + (u[0] * op.widthM) / 2, c[1] + (u[1] * op.widthM) / 2]);
    // Clear the wall under the opening, then draw what fills it.
    s.line(e0[0], e0[1], e1[0], e1[1], { width: weight(w) + 1.2, color: rgb(1, 1, 1) });
    if (op.kind === "window") {
      s.line(e0[0], e0[1], e1[0], e1[1], { width: small ? 0.8 : 1.4, color: rgb(0.184, 0.435, 0.859) });
      if (op.status === "new" && !small) s.text("NEW ESCAPE WINDOW", (e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2 + 6, { size: 6, color: rgb(0.184, 0.435, 0.859), align: "center", font: s.fonts.bold });
    } else {
      // A quarter-circle swing, into the room on the left of a -> b unless it swings the other way.
      const n: Pt = op.swing === "right" ? [u[1], -u[0]] : [-u[1], u[0]];
      const hinge = op.swing === "right" ? e1 : e0;
      const r = op.widthM * k;
      const leaf = [hinge[0] + n[0] * r, hinge[1] - n[1] * r] as const;
      s.line(hinge[0], hinge[1], leaf[0], leaf[1], { width: 0.6, color: op.rating ? RED : FOREST });
      const steps = 8;
      const other = op.swing === "right" ? e0 : e1;
      const pts2: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * (Math.PI / 2);
        const vx = (leaf[0] - hinge[0]) * Math.cos(t) + (other[0] - hinge[0]) * Math.sin(t);
        const vy = (leaf[1] - hinge[1]) * Math.cos(t) + (other[1] - hinge[1]) * Math.sin(t);
        pts2.push([hinge[0] + vx, hinge[1] + vy]);
      }
      s.poly(pts2, { close: false, width: 0.35, color: MOSS, dash: [1.5, 1.5] });
      if (op.rating && !small) s.text("20 MIN", (e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2 - 9, { size: 5.5, color: RED, align: "center", font: s.fonts.bold });
    }
  }

  for (const a of d.proposed.alarms) {
    const [x, y] = P(a.at);
    const r = small ? 2.2 : 4.5;
    s.circle(x, y, r, { fill: a.kind === "smoke" ? rgb(1, 1, 1) : MINT, color: FOREST, width: 0.6 });
    if (!small) s.text(a.kind === "smoke" ? "S" : a.kind === "co" ? "CO" : "S/CO", x + r + 2, y - 2, { size: 5.5, color: FOREST, font: s.fonts.bold });
  }

  if (o.labels === false) return;
  for (const r of d.proposed.rooms) {
    const cx = r.polygon.reduce((t, p) => t + p[0], 0) / r.polygon.length;
    const cz = r.polygon.reduce((t, p) => t + p[1], 0) / r.polygon.length;
    const [x, y] = P([cx, cz]);
    const area = polyArea(r.polygon);
    if (small) continue;
    s.text(r.name, x, y + 2, { size: 7.5, color: FOREST, align: "center", font: s.fonts.bold });
    s.text(`${area.toFixed(1)} m²  ·  ${Math.round(area * 10.7639)} sq ft`, x, y - 7, { size: 6, color: MOSS, align: "center" });
  }
}
