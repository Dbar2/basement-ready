// The basement's plan drawn from above as a PNG, for a model to compare with the take (server/planCheck.ts):
// each room filled in its own colour with its number in the middle, walls in black (dashed where the
// camera never saw them), windows blue, doors green, and furnaces, heaters and low ducts or beams marked.
// No fonts and no native code: a small rasteriser and a PNG writer on node:zlib.
import { crc32, deflateSync } from "node:zlib";
import { bounds, inPolygon, polygonArea } from "./model/geometry";
import type { Existing, Pt } from "./model/types";

type RGB = [number, number, number];

// One pale colour per room, told apart easily; named so the room list can say which is which.
export const ROOM_COLOURS: { name: string; rgb: RGB }[] = [
  { name: "blue", rgb: [190, 214, 245] },
  { name: "green", rgb: [196, 234, 196] },
  { name: "yellow", rgb: [246, 234, 170] },
  { name: "pink", rgb: [244, 200, 220] },
  { name: "purple", rgb: [214, 200, 240] },
  { name: "teal", rgb: [180, 228, 226] },
  { name: "grey", rgb: [214, 214, 214] },
  { name: "tan", rgb: [232, 214, 190] },
];
const INK: RGB = [20, 20, 20];
const GUESS: RGB = [150, 150, 150];
const WINDOW: RGB = [30, 110, 230];
const DOOR: RGB = [20, 150, 60];
const MECH: RGB = [170, 40, 40];
const LOW: RGB = [110, 110, 110];

// 5×7 digits, a row of 5 bits each.
const DIGITS = [
  [14, 17, 19, 21, 25, 17, 14], [4, 12, 4, 4, 4, 4, 14], [14, 17, 1, 2, 4, 8, 31], [31, 2, 4, 2, 1, 17, 14], [2, 6, 10, 18, 31, 2, 2],
  [31, 16, 30, 1, 1, 17, 14], [6, 8, 16, 30, 17, 17, 14], [31, 1, 2, 4, 8, 8, 8], [14, 17, 17, 14, 17, 17, 14], [14, 17, 17, 15, 1, 2, 12],
];

class Canvas {
  readonly px: Uint8Array;
  constructor(readonly w: number, readonly h: number) {
    this.px = new Uint8Array(w * h * 3).fill(255);
  }
  dot(x: number, y: number, c: RGB) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px.set(c, (y * this.w + x) * 3);
  }
  // Even-odd scanline fill.
  polygon(pts: [number, number][], c: RGB) {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(this.h - 1, Math.ceil(Math.max(...ys))); y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) this.dot(x, y, c);
    }
  }
  line(a: [number, number], b: [number, number], width: number, c: RGB, dash = 0) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) return;
    const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const [nx, ny] = [(-uy * width) / 2, (ux * width) / 2];
    const step = dash > 0 ? dash : len;
    for (let t = 0; t < len; t += dash > 0 ? 2 * dash : len) {
      const s = Math.min(len, t + step);
      const p: [number, number] = [a[0] + ux * t, a[1] + uy * t], q: [number, number] = [a[0] + ux * s, a[1] + uy * s];
      this.polygon([[p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny], [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny]], c);
    }
  }
  number(n: number, cx: number, cy: number, scale: number, c: RGB) {
    const s = String(n);
    const w = s.length * 6 * scale - scale;
    const [x0, y0, x1, y1] = [cx - w / 2 - 2 * scale, cy - 5.5 * scale, cx + w / 2 + 2 * scale, cy + 5.5 * scale];
    this.polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [255, 255, 255]);
    [...s].forEach((d, i) => {
      DIGITS[Number(d)].forEach((row, y) => {
        for (let x = 0; x < 5; x++) {
          if (row & (16 >> x)) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) this.dot(cx - w / 2 + (i * 6 + x) * scale + dx, cy - 3.5 * scale + y * scale + dy, c);
        }
      });
    });
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) Buffer.from(this.px.buffer, y * this.w * 3, this.w * 3).copy(raw, y * (this.w * 3 + 1) + 1);
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, "ascii");
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
      return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  }
}

// Where a room's number goes: the point inside it, and outside every other room, farthest from its edges.
function labelSpot(e: Existing, i: number): Pt {
  const r = e.rooms[i];
  const b = bounds(r.polygon);
  let best: Pt = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  let score = -Infinity;
  for (let u = 1; u < 16; u++) {
    for (let v = 1; v < 16; v++) {
      const p: Pt = [b.minX + ((b.maxX - b.minX) * u) / 16, b.minZ + ((b.maxZ - b.minZ) * v) / 16];
      if (!inPolygon(p, r.polygon) || e.rooms.some((o, k) => k !== i && inPolygon(p, o.polygon))) continue;
      const away = e.rooms.map((o, k) => {
        if (k === i) return Infinity;
        const q = bounds(o.polygon);
        return Math.hypot(Math.max(q.minX - p[0], 0, p[0] - q.maxX), Math.max(q.minZ - p[1], 0, p[1] - q.maxZ));
      });
      const s = Math.min(p[0] - b.minX, b.maxX - p[0], p[1] - b.minZ, b.maxZ - p[1], ...away);
      if (s > score) [best, score] = [p, s];
    }
  }
  return best;
}

// The plan as a PNG, longest side `size` pixels plus a margin. Room n in the picture is existing.rooms[n - 1].
export function drawPlan(e: Existing, size = 900): Buffer {
  const b = bounds(e.walls.flatMap((w) => [w.a, w.b]).concat(e.rooms.flatMap((r) => r.polygon)));
  const pad = 40;
  const k = size / Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1);
  const c = new Canvas(Math.ceil((b.maxX - b.minX) * k) + 2 * pad, Math.ceil((b.maxZ - b.minZ) * k) + 2 * pad);
  const at = (p: Pt): [number, number] => [pad + (p[0] - b.minX) * k, pad + (p[1] - b.minZ) * k];
  e.rooms.forEach((r, i) => c.polygon(r.polygon.map(at), ROOM_COLOURS[i % ROOM_COLOURS.length].rgb));
  for (const f of e.fixtures) {
    const [sx, sz] = f.sizeM ?? [0.4, 0.4];
    const low = f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead";
    const p0 = at([f.at[0] - sx / 2, f.at[1] - sz / 2]), p1 = at([f.at[0] + sx / 2, f.at[1] + sz / 2]);
    if (low) {
      // A low beam or duct: a grey band with an outline.
      c.line([p0[0], (p0[1] + p1[1]) / 2], [p1[0], (p0[1] + p1[1]) / 2], Math.max(4, p1[1] - p0[1]), [200, 200, 200]);
      c.line([p0[0], p0[1]], [p1[0], p0[1]], 2, LOW, 6);
      c.line([p0[0], p1[1]], [p1[0], p1[1]], 2, LOW, 6);
    } else if (f.kind !== "stairs") {
      c.polygon([[p0[0], p0[1]], [p1[0], p0[1]], [p1[0], p1[1]], [p0[0], p1[1]]], MECH);
    } else {
      // Stairs: treads across the run.
      const n = 6;
      for (let i = 0; i <= n; i++) c.line([p0[0], p0[1] + ((p1[1] - p0[1]) * i) / n], [p1[0], p0[1] + ((p1[1] - p0[1]) * i) / n], 2, INK);
    }
  }
  for (const w of e.walls) c.line(at(w.a), at(w.b), Math.max(3, w.thicknessM * k * 0.6), w.guess ? GUESS : INK, w.guess ? 8 : 0);
  for (const o of e.openings) {
    const w = e.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const u: Pt = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
    const p = (t: number): Pt => [w.a[0] + u[0] * t, w.a[1] + u[1] * t];
    const width = Math.max(4, w.thicknessM * k * 0.6) + 3;
    if (o.kind === "door") c.line(at(p(o.offsetM - o.widthM / 2)), at(p(o.offsetM + o.widthM / 2)), width, [255, 255, 255]);
    c.line(at(p(o.offsetM - o.widthM / 2)), at(p(o.offsetM + o.widthM / 2)), o.kind === "door" ? 4 : width, o.kind === "door" ? DOOR : WINDOW);
  }
  e.rooms.forEach((r, i) => {
    const [x, y] = at(labelSpot(e, i));
    c.number(i + 1, x, y, polygonArea(r.polygon) * k * k > 90_000 ? 6 : 4, INK);
  });
  return c.png();
}
