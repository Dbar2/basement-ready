// "The book": what the homeowner walks away with, as one PDF. The decision on the cover, the chosen
// design with the alternatives they weighed, the pictures (their design rendered, the looks and the
// swipes they loved), the mood board, the quote by trade, how ready the permit is, the money they may
// qualify for, a timeline from applying to moving in, and what to do next. Everything in it comes
// from the model, the scan's answer and the dated catalog; nothing is made up on the way.
import { PDFDocument, rgb } from "pdf-lib";
import type { Design, Model } from "../model/types";
import { cityPermit } from "../permit/data";
import { lookPage, localDate } from "../permit/package";
import { embedFonts, LETTER, newDoc, Sheet, type Fonts } from "../permit/pdf";
import { quote as priceDesign, type Quote } from "../quote/quote";
import type { StoredState } from "../workspace";
import { AMBER, drawDesign, FOREST, LEAF, LINE, MINT, MOSS, RED, SAGE } from "./plan";

export type BookPicture = { title: string; jpeg: Buffer; kind: "render" | "favourite" | "look" | "concept" };
export type ReadinessItem = { label: string; ok: boolean | null; detail?: string };

export type BookInput = {
  address: string;
  municipality: string;
  result: any; // the scan's answer: headline, verdict, findings, grants, steps
  model: Model;
  pictures: BookPicture[];
  mood: { title: string; jpeg: Buffer }[]; // the cards they swiped right on
  readiness?: ReadinessItem[]; // the permit's own list when there is one; else from the answer's findings
  state?: StoredState;
  today?: string;
};

export type BookOut = { bytes: Uint8Array; pages: string[]; quote: Quote | null };

const M = 54; // page margin
const cad = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const range = (lo: number, hi: number) => (lo === hi ? cad(lo) : `${cad(lo)}–${cad(hi)}`);
const VERDICT: Record<string, { label: string; color: ReturnType<typeof rgb> }> = {
  yes: { label: "Yes", color: LEAF },
  fix: { label: "Yes, after fixes", color: AMBER },
  no: { label: "Not as it is", color: RED },
};

// A letter page with the book's running head; `y` is where the content starts.
function page(doc: PDFDocument, fonts: Fonts, kicker: string, title: string, o: { address: string }) {
  const s = new Sheet(doc.addPage(LETTER), fonts);
  s.rect(0, 0, s.width, s.height, { fill: rgb(1, 1, 1), stroke: false });
  s.text(kicker.toUpperCase(), M, s.height - M, { size: 8, color: LEAF, font: fonts.bold });
  s.text(o.address, s.width - M, s.height - M, { size: 8, color: MOSS, align: "right" });
  const y = s.wrap(title, M, s.height - M - 26, s.width - 2 * M, { size: 20, font: fonts.bold, color: FOREST, leading: 24 });
  s.text(`Basement Ready · page ${doc.getPageCount()}`, M, 30, { size: 7, color: MOSS });
  return { s, y: y - 8 };
}

// Rows that run onto a new page when they reach the bottom.
class Flow {
  s: Sheet;
  y: number;
  constructor(
    private doc: PDFDocument,
    private fonts: Fonts,
    private name: string, // the page's name in the list of pages
    private title: string,
    private o: { address: string },
    private pages: string[],
  ) {
    const p = page(doc, fonts, name, title, o);
    this.s = p.s;
    this.y = p.y;
    pages.push(name);
  }
  need(h: number) {
    if (this.y - h > 60) return;
    const p = page(this.doc, this.fonts, this.name, `${this.title} (continued)`, this.o);
    this.pages.push(`${this.name} (continued)`);
    this.s = p.s;
    this.y = p.y;
  }
}

export function readinessFrom(result: any, design: Design | null): ReadinessItem[] {
  const findings: ReadinessItem[] = (result?.findings ?? []).map((f: any) => ({
    label: f.title,
    ok: f.status === "likely_ok" || f.status === "standard" ? true : f.status === "likely_fix" ? false : null,
    detail: { standard: "Built into the design", likely_ok: "Looks fine from the scan", likely_fix: "A fix the drawings must show", needs_answer: "Needs your answer", needs_measurement: "Needs a tape measure", designer_checks: "A designer confirms it" }[f.status as string] ?? f.status,
  }));
  const checks: ReadinessItem[] = (result?.layout?.checks ?? []).map((c: any) => ({ label: c.label, ok: c.ok, detail: c.detail }));
  return design ? [...findings, ...checks] : findings;
}

export async function buildBook(input: BookInput): Promise<BookOut> {
  const today = input.today ?? localDate();
  const doc = await newDoc(`Your basement book: ${input.address}`);
  const fonts = await embedFonts(doc);
  const pages: string[] = [];
  const o = { address: input.address };
  const designs = input.model.designs;
  const design = designs.find((d) => d.chosen) ?? designs[0] ?? null;
  const q = design ? priceDesign(input.model, design, { municipality: input.municipality }) : null;
  const ready = input.readiness ?? readinessFrom(input.result, design);

  cover(doc, fonts, input, design, q, ready, today);
  pages.push("Cover");
  designPage(doc, fonts, input, design, o, pages);
  await picturesPages(doc, fonts, input, o, pages);
  await moodPage(doc, fonts, input, design, o, pages);
  if (q) quotePages(doc, fonts, q, o, pages);
  readinessPage(doc, fonts, ready, o, pages);
  moneyPage(doc, fonts, input.result, o, pages);
  timelinePage(doc, fonts, input, q, o, pages);
  nextStepsPage(doc, fonts, input.result, o, pages);
  if (q) sourcesPage(doc, fonts, q, o, pages);

  return { bytes: await doc.save(), pages, quote: q };
}

// ---- Cover ----

function cover(doc: PDFDocument, fonts: Fonts, input: BookInput, design: Design | null, q: Quote | null, ready: ReadinessItem[], today: string) {
  const s = new Sheet(doc.addPage(LETTER), fonts);
  s.rect(0, 0, s.width, s.height, { fill: rgb(0.957, 0.965, 0.949), stroke: false });
  s.rect(0, s.height - 8, s.width, 8, { fill: MINT, stroke: false });
  s.text("BASEMENT READY", M, s.height - M, { size: 9, color: FOREST, font: fonts.bold });
  s.text(today, s.width - M, s.height - M, { size: 9, color: MOSS, align: "right" });
  let y = s.height - 190;
  s.text("YOUR BASEMENT, THE BOOK", M, y, { size: 9, color: LEAF, font: fonts.bold });
  y = s.wrap(input.address, M, y - 30, s.width - 2 * M, { size: 30, font: fonts.bold, color: FOREST, leading: 34 }) - 18;
  const v = VERDICT[input.result?.verdict as string] ?? null;
  if (v) {
    s.rect(M, y - 6, s.textWidth(v.label, 11, fonts.bold) + 20, 22, { fill: v.color, stroke: false });
    s.text(v.label, M + 10, y + 1, { size: 11, font: fonts.bold, color: rgb(1, 1, 1) });
    y -= 34;
  }
  if (input.result?.headline) y = s.wrap(input.result.headline, M, y, s.width - 2 * M, { size: 16, color: FOREST, leading: 21 }) - 26;

  const facts: [string, string][] = [];
  if (design) {
    const area = design.proposed.rooms.filter((r) => r.unit === 2).reduce((t, r) => t + polyArea(r.polygon), 0);
    facts.push(["The design", `${design.name}, about ${area.toFixed(0)} m² (${Math.round(area * 10.7639)} sq ft)`]);
  }
  if (q) {
    facts.push(["Hired out", `${range(q.totalLow, q.totalHigh)} with contingency and HST`]);
    facts.push(["Built yourself", `${range(q.diy.low, q.diy.high)} with contingency and HST`]);
  }
  const done = ready.filter((r) => r.ok === true).length;
  if (ready.length) facts.push(["Permit", `${done} of ${ready.length} checks ready`]);
  for (const [k, val] of facts) {
    s.line(M, y + 14, s.width - M, y + 14, { width: 0.5, color: LINE });
    s.text(k.toUpperCase(), M, y, { size: 8, color: MOSS, font: fonts.bold });
    y = s.wrap(val, M + 130, y, s.width - 2 * M - 130, { size: 11, color: FOREST }) - 12;
  }
  s.wrap("A planning book, not a permit or a contract. Sizes come from your scan; prices are dated shelf prices and published rates. Pictures marked \"virtually staged\" are made by Muse Image from your own photos.", M, 70, s.width - 2 * M, { size: 7.5, color: MOSS });
}

function polyArea(p: [number, number][]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  return Math.abs(a) / 2;
}

// ---- The design and its alternatives ----

function designPage(doc: PDFDocument, fonts: Fonts, input: BookInput, design: Design | null, o: { address: string }, pages: string[]) {
  const { s, y } = page(doc, fonts, "The design", design ? `${design.name}: the plan you picked` : "No design yet", o);
  pages.push("Your design");
  if (!design) {
    s.wrap("Pick a layout on the workspace and it's drawn here.", M, y, s.width - 2 * M, { size: 10, color: MOSS });
    return;
  }
  const others = input.model.designs.filter((d) => d !== design);
  const planH = others.length ? 380 : 520;
  s.rect(M, y - planH, s.width - 2 * M, planH, { fill: rgb(0.985, 0.988, 0.98), color: LINE, width: 0.5 });
  drawDesign(s, design, { x: M + 18, y: y - planH + 18, w: s.width - 2 * M - 36, h: planH - 36 });
  let ky = y - planH - 18;
  const key: [string, ReturnType<typeof rgb>, boolean][] = [["Foundation wall", FOREST, false], ["New wall", LEAF, false], ["30-minute fire separation", RED, true]];
  let kx = M;
  for (const [label, color, dash] of key) {
    s.line(kx, ky + 3, kx + 18, ky + 3, { width: dash ? 0.9 : 2.4, color, dash: dash ? [3, 2] : undefined });
    kx += 24 + s.text(label, kx + 24, ky, { size: 7.5, color: MOSS }) + 18;
  }
  s.circle(kx + 4, ky + 3, 4, { fill: rgb(1, 1, 1), color: FOREST, width: 0.6 });
  s.text("Smoke alarm (S), smoke and CO (S/CO), interconnected with strobes", kx + 12, ky, { size: 7.5, color: MOSS });
  if (!others.length) return;
  ky -= 30;
  s.text("THE OTHER LAYOUTS YOU SAW", M, ky, { size: 8, color: LEAF, font: fonts.bold });
  const w = (s.width - 2 * M - 12 * (Math.min(3, others.length) - 1)) / Math.min(3, others.length);
  others.slice(0, 3).forEach((d, i) => {
    const x = M + i * (w + 12);
    s.rect(x, ky - 150, w, 136, { fill: rgb(0.985, 0.988, 0.98), color: LINE, width: 0.5 });
    drawDesign(s, d, { x: x + 8, y: ky - 120, w: w - 16, h: 96 }, { labels: false });
    s.text(d.name, x + 8, ky - 134, { size: 9, font: fonts.bold, color: FOREST });
    const q = priceDesign(input.model, d, { municipality: input.municipality });
    s.text(`Hired ${range(q.totalLow, q.totalHigh)}`, x + 8, ky - 145, { size: 7.5, color: MOSS });
  });
}

// ---- Pictures and the mood board ----

async function picturesPages(doc: PDFDocument, fonts: Fonts, input: BookInput, o: { address: string }, pages: string[]) {
  const order = ["render", "favourite", "look", "concept"];
  const pics = [...input.pictures].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  if (!pics.length) {
    const { s, y } = page(doc, fonts, "Pictures", "Pictures of your basement", o);
    pages.push("Pictures");
    s.wrap("No pictures yet. Swipe your style while it measures, try a look on the workspace, or render your design from the 3D studio, and they appear here.", M, y, s.width - 2 * M, { size: 10, color: MOSS });
    return;
  }
  // The permit package's look page, four to a page: their design first, then what they loved.
  for (let i = 0; i < pics.length && i < 12; i += 4) {
    await lookPage(doc, pics.slice(i, i + 4).map((p) => ({ title: p.kind === "render" ? `Your design: ${p.title}` : p.title, jpeg: p.jpeg })), input.state ?? {});
    pages.push(i ? "Pictures (continued)" : "Pictures");
  }
}

async function moodPage(doc: PDFDocument, fonts: Fonts, input: BookInput, design: Design | null, o: { address: string }, pages: string[]) {
  const { s, y: top } = page(doc, fonts, "Mood board", "What you loved", o);
  pages.push("Mood board");
  let y = top;
  const mood = input.model.mood;
  const fin = { ...(design?.finishes ?? {}), ...mood.finishes };
  const chips = [mood.style ?? fin.style, fin.floor && `Floor: ${fin.floor}`, fin.walls && `Walls: ${fin.walls}`, fin.kitchen && `Kitchen: ${fin.kitchen}`, fin.bath && `Bath: ${fin.bath}`].filter(Boolean) as string[];
  let x = M;
  for (const c of chips) {
    const w = s.textWidth(c, 9) + 16;
    if (x + w > s.width - M) {
      x = M;
      y -= 24;
    }
    s.rect(x, y - 6, w, 18, { fill: SAGE, stroke: false });
    s.text(c, x + 8, y, { size: 9, color: FOREST });
    x += w + 6;
  }
  y -= 30;
  if (!input.mood.length) {
    s.wrap("Swipe right on the cards while your basement measures and the ones you love fill this board.", M, y, s.width - 2 * M, { size: 10, color: MOSS });
    return;
  }
  // A Pinterest-style board: three columns, each picture at its own height.
  const cols = 3, gap = 8;
  const w = (s.width - 2 * M - gap * (cols - 1)) / cols;
  const colY = Array(cols).fill(y);
  for (const m of input.mood.slice(0, 12)) {
    try {
      const png = m.jpeg[0] === 0x89 && m.jpeg[1] === 0x50;
      const img = png ? await doc.embedPng(m.jpeg) : await doc.embedJpg(m.jpeg);
      const h = (img.height / img.width) * w;
      const c = colY.indexOf(Math.max(...colY));
      if (colY[c] - h < 70) continue;
      s.page.drawImage(img, { x: M + c * (w + gap), y: colY[c] - h, width: w, height: h });
      colY[c] -= h + gap;
    } catch {
      // Not an image pdf-lib reads: leave it out.
    }
  }
  s.text("Virtually staged: their own basement restyled by Muse Image.", M, 46, { size: 7, color: MOSS });
}

// ---- The quote ----

function quotePages(doc: PDFDocument, fonts: Fonts, q: Quote, o: { address: string }, pages: string[]) {
  const { s, y: top } = page(doc, fonts, "The quote", "What it costs, by trade", o);
  pages.push("Quote");
  let y = top;
  const cols = { trade: M, hired: s.width - M - 150, diy: s.width - M };
  s.text("TRADE", cols.trade, y, { size: 7.5, color: MOSS, font: fonts.bold });
  s.text("HIRED OUT", cols.hired, y, { size: 7.5, color: MOSS, font: fonts.bold, align: "right" });
  s.text("BUILT YOURSELF", cols.diy, y, { size: 7.5, color: MOSS, font: fonts.bold, align: "right" });
  y -= 16;
  for (const t of q.byTrade) {
    s.line(M, y + 11, s.width - M, y + 11, { width: 0.4, color: LINE });
    s.text(t.label, cols.trade, y, { size: 10, color: FOREST });
    s.text(range(t.low, t.high), cols.hired, y, { size: 10, color: FOREST, align: "right" });
    s.text(range(t.diyLow, t.diyHigh), cols.diy, y, { size: 10, color: MOSS, align: "right" });
    y -= 18;
  }
  const rows: [string, string, string, boolean][] = [
    ["Subtotal", range(q.subtotal.low, q.subtotal.high), "", false],
    [`Contingency ${q.contingency.pctLow}–${q.contingency.pctHigh}% on the building work`, range(q.contingency.low, q.contingency.high), range(q.diy.contingency.low, q.diy.contingency.high), false],
    [`HST ${q.hst.pct}% (not on permit fees)`, range(q.hst.low, q.hst.high), range(q.diy.hst.low, q.diy.hst.high), false],
    ["Total", range(q.hired.low, q.hired.high), range(q.diy.low, q.diy.high), true],
  ];
  y -= 4;
  for (const [label, hired, diy, bold] of rows) {
    s.line(M, y + 11, s.width - M, y + 11, { width: bold ? 1 : 0.4, color: bold ? FOREST : LINE });
    const f = bold ? fonts.bold : fonts.regular;
    s.text(label, cols.trade, y, { size: bold ? 12 : 9.5, color: FOREST, font: f });
    s.text(hired, cols.hired, y, { size: bold ? 12 : 9.5, color: FOREST, font: f, align: "right" });
    if (diy) s.text(diy, cols.diy, y, { size: bold ? 12 : 9.5, color: bold ? FOREST : MOSS, font: f, align: "right" });
    y -= bold ? 26 : 18;
  }
  y = s.wrap("Built yourself: the materials, the fees, and only the pros the law still needs (engineer, concrete cutter, HVAC designer), with the homeowner rate for the electrical permit.", M, y, s.width - 2 * M, { size: 8, color: MOSS }) - 6;
  if (q.missing.length) {
    y -= 4;
    s.text("NO PRICE FOUND, SO NOT IN THE TOTAL", M, y, { size: 7.5, color: AMBER, font: fonts.bold });
    y = s.wrap(q.missing.join(" · "), M, y - 12, s.width - 2 * M, { size: 8, color: MOSS }) - 6;
  }
  for (const a of q.assumptions) y = s.wrap(a, M, y, s.width - 2 * M, { size: 8, color: MOSS });
  s.wrap(`Shelf prices checked ${q.checked} and later; every line's sources are listed at the end.`, M, Math.max(y - 4, 70), s.width - 2 * M, { size: 8, color: MOSS });

  // Line by line.
  const f = new Flow(doc, fonts, "Quote by line", "Line by line", o, pages);
  for (const t of q.byTrade) {
    f.need(80);
    f.s.text(t.label.toUpperCase(), M, f.y, { size: 8, color: LEAF, font: fonts.bold });
    f.y -= 14;
    for (const l of t.lines) {
      const detail = `${l.qty.toLocaleString("en-CA")} ${l.unit}. ${l.basis}`;
      const h = f.s.measure(detail, s.width - 2 * M - 160, 7.5) + 26;
      f.need(h);
      f.s.text(l.item, M, f.y, { size: 9, color: FOREST, font: fonts.bold });
      f.s.text(range(l.low, l.high), s.width - M, f.y, { size: 9, color: FOREST, align: "right" });
      const parts = [l.material.high ? `materials ${range(l.material.low, l.material.high)}` : null, l.labour ? (l.labour.high ? `labour ${range(l.labour.low, l.labour.high)}` : null) : "labour: no published rate"].filter(Boolean).join(", ");
      f.s.text(parts, s.width - M, f.y - 11, { size: 7, color: l.labour ? MOSS : AMBER, align: "right" });
      let y2 = f.s.wrap(detail, M, f.y - 11, s.width - 2 * M - 160, { size: 7.5, color: MOSS });
      if (l.missing.length) y2 = f.s.wrap(`No price found: ${l.missing.join(", ")}`, M, y2, s.width - 2 * M - 160, { size: 7.5, color: AMBER });
      f.y = Math.min(y2, f.y - 22) - 6;
    }
    f.y -= 6;
  }
}

// ---- Permit readiness ----

function readinessPage(doc: PDFDocument, fonts: Fonts, ready: ReadinessItem[], o: { address: string }, pages: string[]) {
  const done = ready.filter((r) => r.ok === true).length;
  const f = new Flow(doc, fonts, "Permit readiness", `${done} of ${ready.length} permit checks ready`, o, pages);
  const groups: [string, ReadinessItem[], ReturnType<typeof rgb>][] = [
    ["To fix on the drawings", ready.filter((r) => r.ok === false), RED],
    ["Needs you or a designer to confirm", ready.filter((r) => r.ok === null), AMBER],
    ["Ready", ready.filter((r) => r.ok === true), LEAF],
  ];
  // A bar of the three.
  const W = f.s.width - 2 * M;
  let x = M;
  for (const [, items, color] of groups) {
    const w = ready.length ? (W * items.length) / ready.length : 0;
    if (w) f.s.rect(x, f.y - 4, w, 10, { fill: color, stroke: false });
    x += w;
  }
  f.y -= 30;
  for (const [label, items, color] of groups) {
    if (!items.length) continue;
    f.need(30);
    f.s.text(`${label.toUpperCase()} (${items.length})`, M, f.y, { size: 8, color, font: fonts.bold });
    f.y -= 15;
    for (const it of items) {
      f.need(26);
      f.s.circle(M + 3, f.y + 3, 2.5, { fill: color, color, width: 0.4 });
      f.s.text(it.label, M + 12, f.y, { size: 9.5, color: FOREST });
      f.y = it.detail ? f.s.wrap(it.detail, M + 12, f.y - 11, W - 12, { size: 7.5, color: MOSS }) - 5 : f.y - 16;
    }
    f.y -= 6;
  }
}

// ---- Money ----

function moneyPage(doc: PDFDocument, fonts: Fonts, result: any, o: { address: string }, pages: string[]) {
  const grants = (result?.grants ?? []).filter((g: any) => g.qualify !== "no");
  const f = new Flow(doc, fonts, "Money", "Money you may qualify for", o, pages);
  if (!grants.length) {
    f.s.wrap("Answer the money questions on the workspace and the programs that fit show here.", M, f.y, f.s.width - 2 * M, { size: 10, color: MOSS });
    return;
  }
  for (const g of grants) {
    const text = [g.amount, g.apply?.detail, g.apply?.paidWhen ? `Paid ${g.apply.paidWhen}.` : null].filter(Boolean).join(" ");
    f.need(f.s.measure(text, f.s.width - 2 * M - 12, 8.5) + 40);
    f.s.text(g.shortName ?? g.name, M, f.y, { size: 11, color: FOREST, font: fonts.bold });
    f.s.text(g.qualify === "yes" ? "You qualify" : "You may qualify", f.s.width - M, f.y, { size: 8, color: g.qualify === "yes" ? LEAF : AMBER, font: fonts.bold, align: "right" });
    f.y = f.s.wrap(text, M, f.y - 13, f.s.width - 2 * M - 12, { size: 8.5, color: MOSS });
    if (g.source?.url) f.y = f.s.wrap(`Source: ${g.source.title}, ${g.source.url}`, M, f.y, f.s.width - 2 * M, { size: 6.5, color: MOSS });
    f.y -= 10;
  }
}

// ---- Timeline ----

export type Stage = { when: string; title: string; detail: string };

// From applying to moving in: the money that must say yes first, the permit and its review, the
// inspections in the city's order, moving in, then claiming what's paid afterwards.
export function timeline(result: any, municipality: string, q: Quote | null): Stage[] {
  const grants = (result?.grants ?? []).filter((g: any) => g.qualify !== "no");
  const before = grants.filter((g: any) => g.apply?.when === "before_work").map((g: any) => g.shortName);
  const after = grants.filter((g: any) => g.apply?.paidWhen || g.apply?.payout || g.apply?.when === "tax_time").map((g: any) => `${g.shortName}${g.apply?.paidWhen ? `: ${g.apply.paidWhen}` : g.apply?.when === "tax_time" ? ": on your tax return for the year it's finished" : ""}`);
  const { permit, city } = cityPermit(municipality);
  const fee = q?.byTrade.find((t) => t.trade === "permits")?.lines.find((l) => l.id === "permit_building");
  return [
    ...(before.length ? [{ when: "First", title: "Apply for the money that must say yes before work starts", detail: before.join(" · ") }] : []),
    { when: "Week 1", title: "Submit the permit", detail: `To ${permit ? `the City of ${city}` : "your municipality"}, online${fee?.high ? `, with the fee (about ${cad(fee.high)})` : ""}.` },
    { when: "Weeks 1–4", title: "The City reviews it", detail: "About 10–15 business days for a second unit; they may ask for changes before they issue it." },
    { when: "Then", title: "Build, with inspections", detail: permit?.inspections.length ? `Book each one before covering the work: ${permit.inspections.map((i) => i.title).join(", ")}. Plus ESA's electrical inspections.` : "Book the inspections as each stage is ready, and ESA's for the wiring." },
    { when: "After the final", title: "Move in", detail: "The final building inspection passes and the suite can be lived in." },
    ...(after.length ? [{ when: "After", title: "Claim the money", detail: after.join(" · ") }] : []),
  ];
}

function timelinePage(doc: PDFDocument, fonts: Fonts, input: BookInput, q: Quote | null, o: { address: string }, pages: string[]) {
  const { s, y: top } = page(doc, fonts, "Timeline", "From applying to moving in", o);
  pages.push("Timeline");
  const stages = timeline(input.result, input.municipality, q);
  let y = top - 6;
  const lineX = M + 70;
  s.line(lineX, y + 4, lineX, Math.max(80, y - stages.length * 82 + 30), { width: 1.2, color: LINE });
  for (const st of stages) {
    s.circle(lineX, y + 4, 5, { fill: MINT, color: FOREST, width: 0.8 });
    s.text(st.when, lineX - 14, y, { size: 8.5, color: LEAF, font: fonts.bold, align: "right" });
    s.text(st.title, lineX + 16, y, { size: 11.5, color: FOREST, font: fonts.bold });
    y = s.wrap(st.detail, lineX + 16, y - 14, s.width - lineX - 16 - M, { size: 8.5, color: MOSS }) - 20;
  }
}

// ---- Next steps ----

function nextStepsPage(doc: PDFDocument, fonts: Fonts, result: any, o: { address: string }, pages: string[]) {
  const steps = result?.steps ?? [];
  const f = new Flow(doc, fonts, "Next steps", "What to do next", o, pages);
  if (!steps.length) {
    f.s.wrap("Open your workspace for the steps for your city.", M, f.y, f.s.width - 2 * M, { size: 10, color: MOSS });
    return;
  }
  steps.forEach((st: any, i: number) => {
    f.need(60);
    f.s.circle(M + 9, f.y + 4, 9, { fill: SAGE, color: SAGE });
    f.s.text(String(i + 1), M + 9, f.y, { size: 10, color: FOREST, font: fonts.bold, align: "center" });
    f.s.text(st.title, M + 28, f.y, { size: 11.5, color: FOREST, font: fonts.bold });
    if (st.when) f.s.text(st.when, f.s.width - M, f.y, { size: 8, color: MOSS, align: "right" });
    f.y -= 16;
    if (st.detail) f.y = f.s.wrap(st.detail, M + 28, f.y, f.s.width - 2 * M - 28, { size: 8.5, color: MOSS }) - 2;
    for (const t of st.tasks ?? []) {
      f.need(24);
      f.s.text("·", M + 30, f.y, { size: 9, color: LEAF, font: fonts.bold });
      f.y = f.s.wrap(t.detail ? `${t.title}: ${t.detail}` : t.title, M + 38, f.y, f.s.width - 2 * M - 38, { size: 8.5, color: FOREST }) - 2;
    }
    f.y -= 12;
  });
}

// ---- Sources ----

function sourcesPage(doc: PDFDocument, fonts: Fonts, q: Quote, o: { address: string }, pages: string[]) {
  const seen = new Map<string, { title: string; checked: string; store?: string; sku?: string | null }>();
  for (const l of q.byTrade.flatMap((t) => t.lines)) for (const src of l.sources) if (!seen.has(src.url)) seen.set(src.url, src);
  const f = new Flow(doc, fonts, "Sources", "Where every price comes from", o, pages);
  for (const [url, src] of seen) {
    const head = `${src.title}${src.store ? `, ${src.store}` : ""}${src.sku ? `, SKU ${src.sku}` : ""} (checked ${src.checked})`;
    f.need(30);
    f.y = f.s.wrap(head, M, f.y, f.s.width - 2 * M, { size: 7.5, color: FOREST }) - 1;
    // Long links break every 90 characters so they stay on the page.
    f.y = f.s.wrap(url.match(/.{1,90}/g)!.join(" "), M, f.y, f.s.width - 2 * M, { size: 6.5, color: MOSS }) - 6;
  }
}
