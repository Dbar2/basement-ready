// Drawing on PDF pages with pdf-lib (MIT): the sheet frame and title block every drawing carries,
// real architectural scales, lines, text that wraps, and lengths in metres with feet and inches.
// The standard PDF fonts only cover Windows-1252 text, so everything drawn goes through `safe`.
import { degrees, LineCapStyle, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

// Black and white only: cities ask for legible black-and-white drawings (Kitchener's Project
// Information form, Section G). Greys stand in for fills.
export const INK = rgb(0.06, 0.06, 0.06);
export const MUTED = rgb(0.38, 0.38, 0.38);
export const FAINT = rgb(0.74, 0.74, 0.74);
export const PAPER = rgb(1, 1, 1);
export const TONE = rgb(0.95, 0.95, 0.95); // the new unit, the house
export const TONE2 = rgb(0.88, 0.88, 0.88); // existing walls, parking, warnings
export const TONE3 = rgb(0.45, 0.45, 0.45); // new walls

// 11 x 17 in, landscape: the usual drawing size cities accept as a PDF.
export const TABLOID: [number, number] = [1224, 792];
export const LETTER: [number, number] = [612, 792];

const WIN1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const REPLACE: Record<string, string> = { "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "✓": "OK", "×": "x", "−": "-", " ": " ", " ": " ", " ": " " };

// Text the standard fonts can draw: known symbols spelled out, anything else dropped.
export function safe(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const r = REPLACE[ch];
    if (r !== undefined) {
      out += r;
      continue;
    }
    const c = ch.codePointAt(0)!;
    if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN1252_EXTRA.includes(ch)) out += ch;
    else if (ch === "\n") out += " ";
  }
  return out;
}

export type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont };

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
}

// ---- Lengths ----------------------------------------------------------------------------

export function ftIn(m: number) {
  const inches = Math.round(m / 0.0254);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
}
export const metres = (m: number) => `${m.toFixed(2)} m`;
export const both = (m: number) => `${metres(m)} (${ftIn(m)})`;
export const mmBoth = (mm: number) => `${Math.round(mm)} mm (${ftIn(mm / 1000)})`;
export const area = (m2: number) => `${m2.toFixed(1)} m² (${Math.round(m2 * 10.7639)} sq ft)`;

// Architectural scales, largest first. `ratio` is real size over paper size.
export const PLAN_SCALES = [
  { label: '1/4" = 1\'-0"', ratio: 48 },
  { label: '3/16" = 1\'-0"', ratio: 64 },
  { label: '1/8" = 1\'-0"', ratio: 96 },
  { label: '1/16" = 1\'-0"', ratio: 192 },
];
export const SITE_SCALES = [
  { label: '1" = 10\'', ratio: 120 },
  { label: '1" = 20\'', ratio: 240 },
  { label: '1" = 30\'', ratio: 360 },
  { label: '1" = 40\'', ratio: 480 },
  { label: '1" = 60\'', ratio: 720 },
];
export const ptPerMetre = (ratio: number) => (1000 / ratio) * (72 / 25.4);

// The largest scale at which a `w` x `h` metre drawing fits in a `boxW` x `boxH` point box.
export function fitScale(scales: { label: string; ratio: number }[], w: number, h: number, boxW: number, boxH: number) {
  return scales.find((s) => w * ptPerMetre(s.ratio) <= boxW && h * ptPerMetre(s.ratio) <= boxH) ?? scales[scales.length - 1];
}

// ---- Drawing ----------------------------------------------------------------------------

type Stroke = { color?: RGB; width?: number; dash?: number[]; opacity?: number };
type TextOpts = { size?: number; font?: PDFFont; color?: RGB; align?: "left" | "center" | "right"; rotate?: number };

export class Sheet {
  constructor(
    public page: PDFPage,
    public fonts: Fonts,
  ) {}
  get width() {
    return this.page.getWidth();
  }
  get height() {
    return this.page.getHeight();
  }
  textWidth(s: string, size = 9, font = this.fonts.regular) {
    return font.widthOfTextAtSize(safe(s), size);
  }
  text(s: string, x: number, y: number, o: TextOpts = {}) {
    const size = o.size ?? 9;
    const font = o.font ?? this.fonts.regular;
    const t = safe(s);
    const w = font.widthOfTextAtSize(t, size);
    const dx = o.align === "center" ? -w / 2 : o.align === "right" ? -w : 0;
    if (o.rotate) {
      const a = (o.rotate * Math.PI) / 180;
      this.page.drawText(t, { x: x + dx * Math.cos(a), y: y + dx * Math.sin(a), size, font, color: o.color ?? INK, rotate: degrees(o.rotate) });
    } else this.page.drawText(t, { x: x + dx, y, size, font, color: o.color ?? INK });
    return w;
  }
  // Wraps to `width`; returns the y below the last line.
  wrap(s: string, x: number, y: number, width: number, o: TextOpts & { leading?: number } = {}) {
    const size = o.size ?? 9;
    const font = o.font ?? this.fonts.regular;
    const leading = o.leading ?? size * 1.3;
    for (const para of safe(s).split(/\s*\|\s*/)) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          this.page.drawText(line, { x, y, size, font, color: o.color ?? INK });
          y -= leading;
          line = word;
        } else line = next;
      }
      if (line) {
        this.page.drawText(line, { x, y, size, font, color: o.color ?? INK });
        y -= leading;
      }
    }
    return y;
  }
  // How tall `wrap` would be, without drawing.
  measure(s: string, width: number, size = 9, font = this.fonts.regular, leading = size * 1.3) {
    let lines = 0;
    for (const para of safe(s).split(/\s*\|\s*/)) {
      let line = "";
      let n = 0;
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          n++;
          line = word;
        } else line = next;
      }
      lines += n + (line ? 1 : 0);
    }
    return lines * leading;
  }
  line(x0: number, y0: number, x1: number, y1: number, o: Stroke = {}) {
    this.page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: o.width ?? 0.75, color: o.color ?? INK, dashArray: o.dash, opacity: o.opacity, lineCap: LineCapStyle.Butt });
  }
  rect(x: number, y: number, w: number, h: number, o: Stroke & { fill?: RGB; stroke?: boolean } = {}) {
    this.page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: o.fill,
      borderColor: o.stroke === false ? undefined : (o.color ?? INK),
      borderWidth: o.stroke === false ? 0 : (o.width ?? 0.75),
      borderDashArray: o.dash,
      opacity: o.opacity,
      borderOpacity: o.opacity,
    });
  }
  poly(points: [number, number][], o: Stroke & { fill?: RGB; close?: boolean } = {}) {
    if (points.length < 2) return;
    // pdf-lib's SVG path has y going down from the path origin; draw from (0, 0) at the page origin.
    const d = points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${-y}`).join(" ") + (o.close === false ? "" : " Z");
    this.page.drawSvgPath(d, { x: 0, y: 0, color: o.fill, borderColor: o.color ?? INK, borderWidth: o.width ?? 0.75, borderDashArray: o.dash, opacity: o.opacity, borderOpacity: o.opacity });
  }
  circle(x: number, y: number, r: number, o: Stroke & { fill?: RGB } = {}) {
    this.page.drawCircle({ x, y, size: r, color: o.fill, borderColor: o.color ?? INK, borderWidth: o.width ?? 0.75 });
  }
  // A dimension string between two points, offset to one side, with ticks and the length.
  dim(x0: number, y0: number, x1: number, y1: number, label: string, offset = 18, size = 7.5) {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    const a = [x0 + nx * offset, y0 + ny * offset], b = [x1 + nx * offset, y1 + ny * offset];
    this.line(x0 + nx * 4, y0 + ny * 4, a[0] + nx * 4, a[1] + ny * 4, { width: 0.4, color: MUTED });
    this.line(x1 + nx * 4, y1 + ny * 4, b[0] + nx * 4, b[1] + ny * 4, { width: 0.4, color: MUTED });
    this.line(a[0], a[1], b[0], b[1], { width: 0.5, color: MUTED });
    for (const p of [a, b]) this.line(p[0] - 3 * (nx + (x1 - x0) / len), p[1] - 3 * (ny + (y1 - y0) / len), p[0] + 3 * (nx + (x1 - x0) / len), p[1] + 3 * (ny + (y1 - y0) / len), { width: 0.8 });
    const angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
    const up = angle > 90 || angle < -90 ? angle + 180 : angle;
    const mx = (a[0] + b[0]) / 2 + nx * 3, my = (a[1] + b[1]) / 2 + ny * 3;
    this.text(label, mx, my, { size, color: INK, align: "center", rotate: Math.abs(up) < 0.5 ? undefined : up });
  }
  northArrow(x: number, y: number, r = 16) {
    this.circle(x, y, r, { width: 0.6 });
    this.poly([[x, y + r - 2], [x - 6, y - r + 4], [x, y - r / 3], [x + 6, y - r + 4]], { fill: INK, width: 0.4 });
    this.text("N", x, y + r + 4, { size: 9, font: this.fonts.bold, align: "center" });
  }
  scaleBar(x: number, y: number, ptPerM: number, label: string) {
    const step = ptPerM >= 40 ? 1 : ptPerM >= 15 ? 2 : 5;
    for (let i = 0; i < 5; i++) this.rect(x + i * step * ptPerM, y, step * ptPerM, 4, { fill: i % 2 ? PAPER : INK, width: 0.5 });
    for (const i of [0, 1, 5]) this.text(`${i * step} m`, x + i * step * ptPerM, y - 9, { size: 6.5, align: "center", color: MUTED });
    this.text(`Scale ${label} on 11 x 17 paper`, x, y + 9, { size: 7, color: MUTED });
  }
}

// ---- The sheet frame ----------------------------------------------------------------------

export type Project = {
  address: string;
  municipality: string;
  legal: string | null;
  pin: string | null;
  owner: string | null;
  // "owner": the owner drew it under the code's exemption. "brief": a designer finishes and signs it.
  signer: "owner" | "brief";
  date: string;
  estimated: boolean; // sizes come from the video, not a tape
  sheets: { number: string; title: string }[];
};

export const STRIP = 214; // the title strip down the right side

// Border, title strip and the drawing area (returned) for one drawing sheet.
export function frame(s: Sheet, p: Project, sheet: { number: string; title: string; scale: string | null }) {
  const W = s.width, H = s.height, m = 22;
  s.rect(m, m, W - 2 * m, H - 2 * m, { width: 1.2 });
  const x0 = W - m - STRIP;
  s.line(x0, m, x0, H - m, { width: 1.2 });
  // Every sheet says it's a draft, at the top of the title strip.
  s.rect(x0 + 1, H - m - 34, STRIP - 2, 33, { fill: TONE2, stroke: false });
  s.wrap("DRAFT, for you or a BCIN designer to check before you submit", x0 + 12, H - m - 12, STRIP - 24, { size: 7.5, font: s.fonts.bold, leading: 9 });
  let y = H - m - 52;
  s.text("ADDITIONAL RESIDENTIAL UNIT", x0 + 12, y, { size: 8.5, font: s.fonts.bold });
  y -= 12;
  s.text("Basement second unit in an existing house", x0 + 12, y, { size: 7.5, color: MUTED });
  y -= 22;
  const row = (label: string, value: string | null, h = 0) => {
    s.text(label.toUpperCase(), x0 + 12, y, { size: 6, color: MUTED, font: s.fonts.bold });
    y -= 10;
    y = s.wrap(value ?? "-", x0 + 12, y, STRIP - 24, { size: 8, leading: 10 }) - 6 - h;
  };
  row("Project address", `${p.address}, ${p.municipality}, Ontario`);
  if (p.legal) row("Legal description", p.legal);
  if (p.pin) row("PIN", p.pin);
  row("Owner", p.owner);
  row(
    p.signer === "owner" ? "Prepared by" : "Status",
    p.signer === "owner"
      ? `${p.owner ? `${p.owner}, owner of the house,` : "The owner of the house,"} under the Building Code's exemption for an owner designing their own house (Div. C 3.2.5.1.(3)(b)).`
      : "DESIGN BRIEF. Measured and laid out by the owner; to be finished, checked and signed by a qualified BCIN designer before it is submitted.",
  );
  if (p.estimated) {
    s.rect(x0 + 8, y - 30, STRIP - 16, 36, { fill: TONE2, stroke: false });
    s.wrap("Sizes measured from a phone video (about ±5–20%). Confirm every dimension on site with a tape before building.", x0 + 14, y - 4, STRIP - 28, { size: 7, leading: 8.6 });
    y -= 44;
  }
  // Sheet list
  y -= 4;
  s.text("SHEETS", x0 + 12, y, { size: 6, color: MUTED, font: s.fonts.bold });
  y -= 11;
  for (const it of p.sheets) {
    const on = it.number === sheet.number;
    s.text(`${it.number}  ${it.title}`, x0 + 12, y, { size: 7, font: on ? s.fonts.bold : s.fonts.regular, color: on ? INK : MUTED });
    y -= 9.5;
  }
  // Bottom block: sheet title, number, scale, date.
  const by = m + 96;
  s.line(x0, by, W - m, by, { width: 1 });
  s.text(sheet.title.toUpperCase(), x0 + 12, by - 18, { size: 10, font: s.fonts.bold });
  s.text(sheet.scale ? `Scale: ${sheet.scale}` : "Not to scale", x0 + 12, by - 32, { size: 7.5, color: MUTED });
  s.text(`Date: ${p.date}`, x0 + 12, by - 43, { size: 7.5, color: MUTED });
  s.text("Made with Basement Ready", x0 + 12, by - 54, { size: 6.5, color: FAINT });
  s.text(sheet.number, W - m - 12, m + 14, { size: 30, font: s.fonts.bold, align: "right" });
  return { x: m + 14, y: m + 14, w: x0 - m - 28, h: H - 2 * m - 28 };
}

export async function newDoc(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Basement Ready");
  doc.setProducer("Basement Ready (pdf-lib)");
  return doc;
}
