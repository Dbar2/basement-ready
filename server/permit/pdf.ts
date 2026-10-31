// Drawing on PDF pages with pdf-lib (MIT): the sheet frame and title block every drawing carries,
// real architectural scales, lines, text that wraps, and lengths in metres with feet and inches.
// The standard PDF fonts only cover Windows-1252 text, so everything drawn goes through `safe`.
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { clip, degrees, endPath, LineCapStyle, PDFDocument, popGraphicsState, pushGraphicsState, rectangle, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

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

// The brand's own type for the homeowner's book (brand/ui.md): Hanken Grotesk 400 and 800 and Geist Mono 400,
// static cuts of the OFL fonts in server/fonts, subset into the PDF. The permit sheets keep the standard fonts.
const BRAND_FONTS = ["HankenGrotesk-Regular.ttf", "HankenGrotesk-ExtraBold.ttf", "GeistMono-Regular.ttf"] as const;
let brandBytes: Promise<Buffer[]> | null = null;

export async function embedBrandFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  brandBytes ??= Promise.all(BRAND_FONTS.map((f) => readFile(new URL(`../fonts/${f}`, import.meta.url))));
  const [regular, bold, mono] = await brandBytes;
  return {
    regular: await doc.embedFont(regular, { subset: true }),
    bold: await doc.embedFont(bold, { subset: true }),
    mono: await doc.embedFont(mono, { subset: true }),
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
// Feet and inches first, then millimetres: how a dimension string reads on the plans.
export const dimText = (m: number) => `${ftIn(m)} (${Math.round(m * 1000)})`;
// A window or door size, width by height, in inches and millimetres: 24"x30" (610x760).
export const sizeText = (w: number, h: number | null) => (h == null ? `${Math.round(w / 0.0254)}" (${Math.round(w * 1000)})` : `${Math.round(w / 0.0254)}"x${Math.round(h / 0.0254)}" (${Math.round(w * 1000)}x${Math.round(h * 1000)})`);

// Floor plans: metric scales of 1:50 or larger, largest first. `ratio` is real size over paper size.
export const PLAN_SCALES = [
  { label: "1:20", ratio: 20 },
  { label: "1:25", ratio: 25 },
  { label: "1:30", ratio: 30 },
  { label: "1:40", ratio: 40 },
  { label: "1:50", ratio: 50 },
];
// Schematic views (the house above, the key plan): smaller scales are fine.
export const SMALL_SCALES = [...PLAN_SCALES, { label: "1:75", ratio: 75 }, { label: "1:100", ratio: 100 }, { label: "1:150", ratio: 150 }, { label: "1:200", ratio: 200 }];
export const DETAIL_SCALES = [
  { label: "1:5", ratio: 5 },
  { label: "1:10", ratio: 10 },
  { label: "1:20", ratio: 20 },
  { label: "1:25", ratio: 25 },
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
  return largestFit(scales, w, h, boxW, boxH) ?? scales[scales.length - 1];
}
// The same, or null when it doesn't fit even at the smallest of these scales.
export function largestFit(scales: { label: string; ratio: number }[], w: number, h: number, boxW: number, boxH: number) {
  return scales.find((s) => w * ptPerMetre(s.ratio) <= boxW && h * ptPerMetre(s.ratio) <= boxH) ?? null;
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
  // Draws `fn` clipped to a rectangle (a plan cut into two sheets at a match line).
  clipped(x: number, y: number, w: number, h: number, fn: () => void) {
    this.page.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath());
    fn();
    this.page.pushOperators(popGraphicsState());
  }
  // Diagonal hatching inside a convex polygon (new walls, the rated ceiling).
  hatch(points: [number, number][], spacing = 3, o: Stroke = {}) {
    if (points.length < 3) return;
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const lo = Math.min(...xs) - Math.max(...ys), hi = Math.max(...xs) - Math.min(...ys);
    // Lines x - y = c, clipped to the polygon.
    for (let c = Math.ceil(lo / spacing) * spacing; c <= hi; c += spacing) {
      const hits: [number, number][] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
        const f0 = x0 - y0 - c, f1 = x1 - y1 - c;
        if ((f0 <= 0 && f1 > 0) || (f0 > 0 && f1 <= 0)) {
          const t = f0 / (f0 - f1);
          hits.push([x0 + t * (x1 - x0), y0 + t * (y1 - y0)]);
        }
      }
      hits.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i + 1 < hits.length; i += 2) this.line(hits[i][0], hits[i][1], hits[i + 1][0], hits[i + 1][1], { width: o.width ?? 0.35, color: o.color ?? INK, dash: o.dash });
    }
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
    this.text(`${label} on 11 x 17`, x, y + 9, { size: 7, color: MUTED });
  }
}


// ---- The sheet frame ----------------------------------------------------------------------

// Who signs the drawings: the owner under the Code's exemption, or a BCIN designer.
export type Signer = { kind: "owner" } | { kind: "designer"; name: string | null; bcin: string | null; firm: string | null; firmBcin: string | null };

export type Project = {
  address: string; // the property only: no owner's name or phone on the drawings
  municipality: string;
  // "review": the owner's copy, with a Draft watermark and what's left to do. "submit": the clean set.
  copy: "review" | "submit";
  left: number; // things left before the set can be submitted (review copy)
  estimated: boolean; // sizes still from the video (review copy only says so)
  signer: Signer;
  date: string;
  revision: { no: string; date: string; text: string };
  sheets: { number: string; title: string }[];
};

export const STRIP = 214; // the title strip down the right side
const M = 22; // page margin

// The 2024 Code's exemption for an owner designing a unit in their own house.
export const OWNER_EXEMPTION = "Div. C, 3.2.5.1.(3)(b)";

// Border, title strip and the drawing area (returned) for one drawing sheet.
export function frame(s: Sheet, p: Project, sheet: { number: string; title: string; scale: string | null }) {
  const W = s.width, H = s.height;
  s.rect(M, M, W - 2 * M, H - 2 * M, { width: 1.2 });
  const x0 = W - M - STRIP, L = x0 + 10, R = W - M - 10, inner = R - L;
  s.line(x0, M, x0, H - M, { width: 1.2 });
  let y = H - M;

  // Room for the City's stamps.
  const stampH = 112;
  s.line(x0, y - stampH, W - M, y - stampH, { width: 0.6 });
  s.text("FOR CITY USE (STAMPS)", L, y - 10, { size: 5.5, color: FAINT, font: s.fonts.bold });
  if (p.copy === "review") {
    s.rect(x0 + 6, y - stampH + 6, STRIP - 12, 40, { fill: TONE2, stroke: false });
    s.text("DRAFT FOR YOUR REVIEW", L, y - stampH + 32, { size: 9, font: s.fonts.bold });
    s.text(p.left > 0 ? `${p.left} thing${p.left === 1 ? "" : "s"} left before you can submit: see A0` : "Ready: download the submit copy", L, y - stampH + 18, { size: 7 });
    if (p.estimated) s.text("Sizes from the video, about ±5-20%, until taped", L, y - stampH + 10, { size: 6, color: MUTED });
  }
  y -= stampH + 14;

  // The project: the property, nothing about the people.
  s.text("ADDITIONAL RESIDENTIAL UNIT (UNIT 2)", L, y, { size: 8, font: s.fonts.bold });
  y -= 10;
  s.text("in the basement of an existing house", L, y, { size: 7, color: MUTED });
  y -= 14;
  s.text("PROPERTY", L, y, { size: 5.5, color: MUTED, font: s.fonts.bold });
  y = s.wrap(`${p.address}, ${p.municipality}, Ontario`, L, y - 10, inner, { size: 8, leading: 9.5 }) - 8;

  // Revisions.
  s.text("REVISIONS", L, y, { size: 5.5, color: MUTED, font: s.fonts.bold });
  y -= 4;
  const cols = [L, L + 22, L + 74];
  const rowH = 11;
  s.line(L, y, R, y, { width: 0.5 });
  for (const [i, h] of ["NO.", "DATE", "DESCRIPTION"].entries()) s.text(h, cols[i] + 2, y - 8, { size: 5.5, color: MUTED });
  y -= rowH;
  for (let r = 0; r < 4; r++) {
    s.line(L, y, R, y, { width: 0.4, color: FAINT });
    if (r === 0) {
      s.text(p.revision.no, cols[0] + 2, y - 8, { size: 6.5 });
      s.text(p.revision.date, cols[1] + 2, y - 8, { size: 6.5 });
      s.text(p.revision.text, cols[2] + 2, y - 8, { size: 6.5 });
    }
    y -= rowH;
  }
  s.line(L, y, R, y, { width: 0.5 });
  for (const c of cols.slice(1)) s.line(c, y, c, y + rowH * 5, { width: 0.4, color: FAINT });
  y -= 14;

  // Sheet list.
  s.text("DRAWINGS", L, y, { size: 5.5, color: MUTED, font: s.fonts.bold });
  y -= 10;
  for (const it of p.sheets) {
    const on = it.number === sheet.number;
    s.text(`${it.number}  ${it.title}`, L, y, { size: 6.5, font: on ? s.fonts.bold : s.fonts.regular, color: on ? INK : MUTED });
    y -= 8.5;
  }

  // Bottom block: sheet title, scale, date, number.
  const by = M + 74;
  s.line(x0, by, W - M, by, { width: 1 });
  s.wrap(sheet.title.toUpperCase(), L, by - 14, inner - 60, { size: 9.5, font: s.fonts.bold, leading: 11 });
  s.text(sheet.scale ? `Scale ${sheet.scale} on 11 x 17` : "Not to scale", L, by - 40, { size: 7, color: MUTED });
  s.text(`Date ${p.date}`, L, by - 50, { size: 7, color: MUTED });
  if (p.copy === "review") s.text("Made with Basement Ready", L, by - 62, { size: 6, color: FAINT });
  s.text(sheet.number, R, M + 12, { size: 28, font: s.fonts.bold, align: "right" });

  // The statement box, above the bottom block.
  statementBox(s, p.signer, { x: x0, y: by, w: STRIP });
  return { x: M + 14, y: M + 14, w: x0 - M - 28, h: H - 2 * M - 28 };
}

export const STATEMENT_H = 128;

// Name, signature and date of whoever takes responsibility for the design: the homeowner under the
// Code's exemption, or the designer with their BCIN.
function statementBox(s: Sheet, signer: Signer, at: { x: number; y: number; w: number }) {
  const L = at.x + 10, R = at.x + at.w - 10;
  const top = at.y + STATEMENT_H;
  s.line(at.x, top, at.x + at.w, top, { width: 1 });
  let y = top - 11;
  const field = (label: string, value: string | null, x: number, width: number, yy: number) => {
    s.line(x, yy, x + width, yy, { width: 0.5 });
    if (value) s.text(value, x + 1, yy + 2.5, { size: 7 });
    s.text(label, x + 1, yy - 7, { size: 5.5, color: MUTED });
  };
  if (signer.kind === "owner") {
    s.text("DESIGNER: HOMEOWNER", L, y, { size: 7.5, font: s.fonts.bold });
    y = s.wrap(`The owner designed this unit in their own house. Exempt from designer registration under the Building Code, ${OWNER_EXEMPTION}. The owner takes responsibility for this design.`, L, y - 10, R - L, { size: 6.3, leading: 7.6 });
    y -= 14;
    field("NAME (HOMEOWNER)", null, L, R - L, y);
    y -= 26;
    field("SIGNATURE", null, L, (R - L) * 0.62, y);
    field("DATE", null, L + (R - L) * 0.68, (R - L) * 0.32, y);
  } else {
    s.text("DESIGNER (BCIN)", L, y, { size: 7.5, font: s.fonts.bold });
    y = s.wrap("I have reviewed this design, take responsibility for it, and am qualified under the Building Code to be its designer.", L, y - 10, R - L, { size: 6.3, leading: 7.6 });
    y -= 13;
    field("NAME", signer.name, L, (R - L) * 0.62, y);
    field("BCIN", signer.bcin, L + (R - L) * 0.68, (R - L) * 0.32, y);
    y -= 22;
    field("FIRM", signer.firm, L, (R - L) * 0.62, y);
    field("FIRM BCIN", signer.firmBcin, L + (R - L) * 0.68, (R - L) * 0.32, y);
    y -= 22;
    field("SIGNATURE", null, L, (R - L) * 0.62, y);
    field("DATE", null, L + (R - L) * 0.68, (R - L) * 0.32, y);
  }
}

// The review copy's diagonal "DRAFT", over the drawing area.
export function watermark(s: Sheet) {
  const t = "DRAFT";
  const size = 150;
  const w = s.fonts.bold.widthOfTextAtSize(t, size);
  const cx = (s.width - STRIP) / 2, cy = s.height / 2;
  const a = (30 * Math.PI) / 180;
  s.page.drawText(t, { x: cx - (w / 2) * Math.cos(a) + (size / 3) * Math.sin(a), y: cy - (w / 2) * Math.sin(a) - (size / 3) * Math.cos(a), size, font: s.fonts.bold, color: rgb(0.5, 0.5, 0.5), opacity: 0.13, rotate: degrees(30) });
}

export async function newDoc(title: string, branded = true) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  // The submit copy carries no app name, not even in the file's properties.
  doc.setCreator(branded ? "Basement Ready" : "");
  doc.setProducer(branded ? "Basement Ready (pdf-lib)" : "pdf-lib");
  return doc;
}
