// The drawing sheets of the permit set, one function each, all at 11 x 17: the cover (with what's
// left to do on the review copy), the site plan, unit 2's basement plan, unit 1's main floor, the
// basement ceiling plan, the elevations of walls with new or bigger windows, the details, and the
// notes an examiner looks for. Each returns the notes it printed, so tests can check them.
import type { PDFDocument } from "pdf-lib";
import type { Pt } from "../model/types";
import { AERIAL_YEAR, type SiteGeometry } from "../property";
import type { Profile, StoredState } from "../workspace";
import type { CityPermit } from "./data";
import { boxesMeet, drawAlarms, drawChains, drawFixtures, drawOutside, drawRoomFixtures, drawRoomLabels, drawUnit, drawWalls, LEGEND, legendBox, makeView, outward, PAD, type Area, type PageBox, type Scale, type View } from "./draw";
import { homesAfter } from "../eligibility";
import { areaText, suiteAreaM2 } from "../model/suite";
import { bounds, type Box, centroid, dir, drawnHeightM, escapeHeightNeededMm, escapeOk, PROPOSED_ESCAPE, type PermitModel, type PermitWindow, type PWall, unitOutline, unitRooms, wallLen } from "./model";

// What a window's tag says about escape: only a size that meets the rule is called an escape window.
const escapeLabel = (w: PermitWindow) => (!w.escape ? "" : w.meets ? " ESCAPE WINDOW" : w.meets === null ? " WINDOW: ESCAPE SIZE TO BE TAPED" : " WINDOW: TOO SMALL TO ESCAPE");
import { citeText, notesFor } from "./notes";
import { area, both, DETAIL_SCALES, dimText, FAINT, fitScale, frame, ftIn, INK, largestFit, mmBoth, MUTED, OWNER_EXEMPTION, PAPER, PLAN_SCALES, type Project, ptPerMetre, Sheet, sizeText, SITE_SCALES, SMALL_SCALES, TABLOID, TONE, TONE2, TONE3, watermark, type Fonts } from "./pdf";
import type { Geometry } from "./plans";
import type { Readiness } from "./readiness";

export type SheetCtx = {
  doc: PDFDocument;
  fonts: Fonts;
  project: Project;
  result: any;
  model: PermitModel | null;
  site: SiteGeometry | null;
  state: StoredState;
  profile: Profile | null;
  permit: CityPermit | null;
  municipality: string;
  readiness: Readiness;
  storeys: number;
};

export type Printed = { number: string; title: string; notes: string[]; scale: Scale | null; page: number };

export const SHEETS = [
  { number: "A0", title: "Cover, key plan and project data" },
  { number: "A1", title: "Site plan" },
  { number: "A2", title: "Basement plan: unit 2" },
  { number: "A3", title: "Main floor: unit 1 (schematic)" },
  { number: "A4", title: "Basement ceiling plan" },
  { number: "A5", title: "Elevations: windows" },
  { number: "A6", title: "Details and assemblies" },
  { number: "A7", title: "Notes" },
];

const review = (ctx: SheetCtx) => ctx.project.copy === "review";

function newSheet(ctx: SheetCtx, number: string, title: string, scale: string | null) {
  const s = new Sheet(ctx.doc.addPage(TABLOID), ctx.fonts);
  const a = frame(s, ctx.project, { number, title, scale });
  return { s, a, page: ctx.doc.getPageCount() - 1 };
}

// After drawing, the scale is known; write it into the title block.
function stampScale(s: Sheet, label: string) {
  const x0 = s.width - 22 - 214;
  s.rect(x0 + 8, 22 + 74 - 44, 196, 11, { fill: PAPER, stroke: false });
  s.text(`Scale ${label} on 11 x 17`, x0 + 10, 22 + 74 - 40, { size: 7, color: MUTED });
}

function heading(s: Sheet, x: number, y: number, text: string, scale?: string | null) {
  s.text(text.toUpperCase(), x, y, { size: 8.5, font: s.fonts.bold });
  const w = s.textWidth(text.toUpperCase(), 8.5, s.fonts.bold);
  s.line(x, y - 3, x + w, y - 3, { width: 0.6 });
  if (scale) s.text(scale, x + w + 8, y, { size: 7, color: MUTED });
}

export function scopeOfWork(o: { model?: PermitModel | null; geo?: Geometry | null; result: any }) {
  const m = o.model ?? null;
  const studio = m ? m.design.layout === "studio" || !unitRooms(m).some((r) => r.kind === "bedroom") : o.geo?.layout?.kind === "studio";
  const parts = [
    `Create a second dwelling unit (additional residential unit), ${studio ? "a studio (bachelor) unit" : "a one-bedroom unit"}, in the basement of the existing house`,
    "new partition walls, a bathroom and a kitchen",
    "a fire separation between the two units",
    "hard-wired, interconnected smoke and CO alarms in both units",
  ];
  const win = m?.windows.find((w) => w.escape);
  if (win?.change === "new" || (!m && o.geo?.egress && !o.geo.egress.existing)) parts.push("a new escape window in the bedroom (opening designed by an engineer)");
  else if (win?.change === "enlarge") parts.push("the bedroom window enlarged to an escape window (opening designed by an engineer)");
  return `${parts.join("; ")}. No change to the building's footprint or height.`;
}

// ---- A0 Cover --------------------------------------------------------------------------------

export function coverSheet(ctx: SheetCtx): Printed {
  const { s, a, page } = newSheet(ctx, "A0", SHEETS[0].title, null);
  const m = ctx.model;
  const p = ctx.result?.property ?? null;
  let y = a.y + a.h - 30;
  s.text("Additional residential unit in the basement", a.x + 10, y, { size: 22, font: s.fonts.bold });
  y -= 22;
  s.text(`${ctx.project.address}, ${ctx.project.municipality}, Ontario`, a.x + 10, y, { size: 13, color: MUTED });
  y -= 30;
  const colW = (a.w - 40) / 2;
  const rows: [string, string][] = [];
  if (p?.zone) rows.push(["Zoning", `${p.zone.code}${p.zone.label ? `, ${p.zone.label}` : ""}${p.zone.bylaw ? ` (${p.zone.bylaw})` : ""}`]);
  // The homes there now (at least the house) and the new one: as the forms and the money count them.
  const units = homesAfter(p);
  rows.push(["Units after the work", units === 2 ? "2: the house (unit 1) and the basement unit (unit 2)" : `${units}: the ${units - 1} homes there now and the basement unit (unit ${units})`]);
  if (m) {
    const suite = suiteAreaM2(m.design);
    if (suite != null) rows.push(["Unit 2 floor area", areaText(suite)]);
    const beds = m.design.layout === "studio" ? 0 : unitRooms(m).filter((r) => r.kind === "bedroom").length;
    rows.push(["Unit 2 bedrooms", beds ? String(beds) : "Studio (no separate bedroom)"]);
    if (m.ceilingM) rows.push(["Finished ceiling in unit 2", `${both(m.ceilingM)} (1.95 m required)`]);
    if (m.beamM) rows.push(["Clear under beams and ducts", `${both(m.beamM)} (1.85 m required)`]);
  }
  if (p?.building?.storeys) rows.push(["Existing house", `${p.building.storeys} storey${p.building.storeys === 1 ? "" : "s"} over the basement`]);
  rows.push(["Building Code", "O. Reg. 163/24 (2024 Building Code), Part 9, with Part 11 alternatives for an existing house"]);
  rows.push(["Major occupancy", "Group C, residential: a house with an additional unit"]);
  rows.push(["Prepared by", ctx.project.signer.kind === "owner" ? `The homeowner, exempt under ${OWNER_EXEMPTION}` : `${ctx.project.signer.name ?? "Designer"}, BCIN ${ctx.project.signer.bcin ?? ""}`.trim()]);
  let ry = y;
  for (const [label, value] of rows) {
    s.text(label.toUpperCase(), a.x + 10, ry, { size: 6.5, color: MUTED, font: s.fonts.bold });
    ry = s.wrap(value, a.x + 140, ry, colW - 140, { size: 9 }) - 5;
  }
  ry -= 8;
  s.text("SCOPE OF WORK", a.x + 10, ry, { size: 6.5, color: MUTED, font: s.fonts.bold });
  ry = s.wrap(scopeOfWork(ctx), a.x + 140, ry, colW - 140, { size: 9 }) - 12;
  s.text("DRAWINGS", a.x + 10, ry, { size: 6.5, color: MUTED, font: s.fonts.bold });
  for (const it of ctx.project.sheets) {
    s.text(it.number, a.x + 140, ry, { size: 9, font: s.fonts.bold });
    s.text(it.title, a.x + 165, ry, { size: 9 });
    ry -= 13;
  }

  // Right column: the review copy's list, or the key plan.
  const kx = a.x + colW + 40, kw = colW - 10;
  let ky = y + 4;
  if (review(ctx)) {
    const r = ctx.readiness;
    const todo = r.items.filter((i) => !i.done);
    s.rect(kx, ky - 22, kw, 26, { fill: TONE2, stroke: false });
    s.text(r.left ? `${r.left} THING${r.left === 1 ? "" : "S"} LEFT BEFORE YOU CAN SUBMIT` : "NOTHING LEFT: DOWNLOAD THE SUBMIT COPY", kx + 8, ky - 13, { size: 10, font: s.fonts.bold });
    ky -= 38;
    for (const it of todo.slice(0, 26)) {
      s.rect(kx + 2, ky - 2, 7, 7, { width: 0.6 });
      ky = s.wrap(it.label, kx + 16, ky, kw - 20, { size: 8.5, leading: 10 }) - 3;
    }
    if (todo.length > 26) s.text(`and ${todo.length - 26} more on the Permit tab`, kx + 16, ky, { size: 8, color: MUTED });
    ky -= 14;
  }
  const kh = Math.min(260, ky - a.y - 30);
  if (kh > 120) {
    s.text("KEY PLAN", kx, ky, { size: 6.5, color: MUTED, font: s.fonts.bold });
    keyPlan(s, ctx, { x: kx, y: ky - kh - 6, w: kw, h: kh });
  }
  return { number: "A0", title: SHEETS[0].title, notes: [scopeOfWork(ctx)], scale: null, page };
}

function keyPlan(s: Sheet, ctx: SheetCtx, b: Area) {
  s.rect(b.x, b.y, b.w, b.h, { color: FAINT, width: 0.5 });
  const site = ctx.site;
  const rings = [...(site?.parcel ? [site.parcel] : []), ...(site?.footprint ? [site.footprint] : [])];
  if (!rings.length) {
    s.wrap("The house, with unit 2 in its basement. Lot and house outlines: see the site plan, A1.", b.x + 14, b.y + b.h / 2, b.w - 28, { size: 9, color: MUTED });
    return;
  }
  const pts = rings.flat();
  const minX = Math.min(...pts.map((q) => q[0])), maxX = Math.max(...pts.map((q) => q[0]));
  const minY = Math.min(...pts.map((q) => q[1])), maxY = Math.max(...pts.map((q) => q[1]));
  const k = Math.min((b.w - 40) / (maxX - minX || 1), (b.h - 40) / (maxY - minY || 1));
  const X = (x: number) => b.x + 20 + (x - minX) * k + (b.w - 40 - (maxX - minX) * k) / 2;
  const Y = (y: number) => b.y + 20 + (y - minY) * k + (b.h - 40 - (maxY - minY) * k) / 2;
  if (site!.parcel) s.poly(site!.parcel.map(([x, y]) => [X(x), Y(y)]), { width: 0.8, dash: [6, 3] });
  if (site!.footprint) {
    s.poly(site!.footprint.map(([x, y]) => [X(x), Y(y)]), { fill: TONE, width: 1.2 });
    const c = centroid(site!.footprint as Pt[]);
    s.text("UNIT 2 IN THE BASEMENT", X(c[0]), Y(c[1]) - 3, { size: 6.5, font: s.fonts.bold, align: "center" });
  }
  s.northArrow(b.x + b.w - 24, b.y + b.h - 28, 12);
}

// ---- A1 Site plan ----------------------------------------------------------------------------

export function sitePlan(ctx: SheetCtx): Printed {
  const { s, a, page } = newSheet(ctx, "A1", SHEETS[1].title, null);
  const notes: string[] = [];
  const site = ctx.site;
  const features = ctx.state.site?.features ?? [];
  const lot = (ctx.state.permit?.lotLines ?? []).filter((l) => l.mm != null);
  const legendH = 110;
  const listLot = () => lot.map((l) => {
    const w = ctx.model?.windows.find((x) => x.id === l.id);
    return `Wall with window ${w?.tag ?? ""}: ${both((l.mm as number) / 1000)} to the lot line.`;
  });
  if (!site || (!site.parcel && !site.footprint)) {
    const lines = [
      "The lot lines, the house, the driveway with its parking, the walkway to the unit's entrance and the window wells are shown on the plan of survey submitted with this application, marked up with the unit's entrance.",
      ...listLot(),
    ];
    let y = a.y + a.h - 40;
    for (const t of lines) y = s.wrap(t, a.x + 20, y, a.w - 40, { size: 11 }) - 8;
    notes.push(...lines);
    return { number: "A1", title: SHEETS[1].title, notes, scale: null, page };
  }
  // Traced points live on the aerial photo (0..1); turn them into metres around the address point.
  const toM = ([u, v]: [number, number]): [number, number] => [(u - 0.5) * 2 * site.aerial.halfWidthM, (0.5 - v) * 2 * site.aerial.halfHeightM];
  const traced = features.map((f) => ({ ...f, pts: f.points.map(toM) }));
  const pts = [...(site.parcel ?? []), ...(site.footprint ?? []), ...site.others.flat(), ...traced.flatMap((f) => f.pts)];
  const minX = Math.min(...pts.map((q) => q[0])), maxX = Math.max(...pts.map((q) => q[0]));
  const minY = Math.min(...pts.map((q) => q[1])), maxY = Math.max(...pts.map((q) => q[1]));
  const scale = fitScale(SITE_SCALES, maxX - minX, maxY - minY, a.w - 140, a.h - legendH - 90);
  const k = ptPerMetre(scale.ratio);
  const ox = a.x + 70 + (a.w - 140 - (maxX - minX) * k) / 2, oy = a.y + legendH + 40 + (a.h - legendH - 90 - (maxY - minY) * k) / 2;
  const X = (x: number) => ox + (x - minX) * k, Y = (y: number) => oy + (y - minY) * k;
  if (site.parcel) {
    s.poly(site.parcel.map(([x, y]) => [X(x), Y(y)]), { width: 1.2, dash: [10, 3, 2, 3] });
    const r = site.parcel;
    for (let i = 0; i < r.length; i++) {
      const p0 = r[i], p1 = r[(i + 1) % r.length];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (len >= 5) s.dim(X(p0[0]), Y(p0[1]), X(p1[0]), Y(p1[1]), both(len), -14, 6.5);
    }
  }
  for (const o of site.others) s.poly(o.map(([x, y]) => [X(x), Y(y)]), { width: 0.8, fill: PAPER });
  if (site.footprint) {
    s.poly(site.footprint.map(([x, y]) => [X(x), Y(y)]), { width: 1.6, fill: TONE });
    const c = centroid(site.footprint as Pt[]);
    const storeys = ctx.result?.property?.building?.storeys;
    s.text("EXISTING HOUSE", X(c[0]), Y(c[1]) + 6, { size: 8, font: s.fonts.bold, align: "center" });
    s.text(`${storeys ? `${storeys} storey${storeys === 1 ? "" : "s"}, ` : ""}unit 2 in the basement`, X(c[0]), Y(c[1]) - 4, { size: 6.5, align: "center" });
  }
  for (const f of traced) {
    const P = f.pts.map(([x, y]) => [X(x), Y(y)] as [number, number]);
    if (f.kind === "parking") {
      s.poly(P, { width: 0.9, fill: TONE2, close: P.length > 2 });
      const c = P.reduce((t, q) => [t[0] + q[0] / P.length, t[1] + q[1] / P.length], [0, 0]);
      s.text(f.label || "PARKING", c[0], c[1] - 3, { size: 6.5, font: s.fonts.bold, align: "center" });
    } else if (f.kind === "walkway") {
      s.poly(P, { width: 2.2, dash: [3, 2], close: false });
      const mid = P[Math.floor((P.length - 1) / 2)];
      s.text(f.label || "WALKWAY", mid[0] + 6, mid[1] - 10, { size: 6.5, font: s.fonts.bold });
    } else {
      const [x, y] = P[0];
      s.poly([[x, y + 7], [x - 6, y - 5], [x + 6, y - 5]], { fill: INK, width: 0.4 });
      s.text(f.label || "ENTRANCE TO UNIT 2", x + 9, y - 3, { size: 6.5, font: s.fonts.bold });
    }
  }
  s.northArrow(a.x + a.w - 40, a.y + a.h - 40);
  s.scaleBar(a.x + 20, a.y + a.h - 30, k, scale.label);
  stampScale(s, scale.label);
  const lines = [
    site.parcel
      ? `Lot lines and the house outline from public GIS data (${site.sources.join("; ")}); not a survey.`
      : `House outline from public GIS data (${site.sources.join("; ")}). Lot lines and setbacks: see the plan of survey submitted with this application.`,
    features.length ? `Unit 2's entrance, parking and walkway as traced on the Region of Waterloo's ${AERIAL_YEAR} aerial photo (open data).` : "Unit 2's entrance, parking and walkway: as marked on the plan of survey.",
    ...listLot(),
    "Window wells at escape windows: 550 mm clear in front of the window (A6).",
  ];
  let ny = a.y + legendH - 12;
  s.line(a.x, a.y + legendH, a.x + a.w, a.y + legendH, { width: 0.5, color: FAINT });
  lines.forEach((t, i) => {
    ny = s.wrap(`${i + 1}. ${t}`, a.x + 4, ny, a.w - 8, { size: 7, leading: 9 });
  });
  notes.push(...lines);
  return { number: "A1", title: SHEETS[1].title, notes, scale, page };
}

// ---- Plan layout ---------------------------------------------------------------------------

const LEGEND_W = 196;

// The largest scale of 1:50 or larger the plan fits at with the legend beside it. If it doesn't fit
// even at 1:50, it's cut into tiles at match lines, each on its own sheet, never drawn smaller.
export function planLayout(a: Area, box: Box): { scale: Scale; tiles: Box[]; area: Area } {
  const side: Area = { x: a.x + LEGEND_W + 8, y: a.y, w: a.w - LEGEND_W - 8, h: a.h };
  const availW = side.w - 2 * PAD, availH = side.h - 2 * PAD;
  const w = box.maxX - box.minX, h = box.maxZ - box.minZ;
  const fit = largestFit(PLAN_SCALES, w, h, availW, availH);
  if (fit) return { scale: fit, tiles: [box], area: side };
  const scale = PLAN_SCALES[PLAN_SCALES.length - 1];
  const k = ptPerMetre(scale.ratio);
  const lap = 0.3;
  let nx = Math.max(1, Math.ceil((w * k) / availW)), nz = Math.max(1, Math.ceil((h * k) / availH));
  while ((w / nx + 2 * lap) * k > availW) nx++;
  while ((h / nz + 2 * lap) * k > availH) nz++;
  const tiles: Box[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++)
      tiles.push({
        minX: Math.max(box.minX, box.minX + (i * w) / nx - lap),
        maxX: Math.min(box.maxX, box.minX + ((i + 1) * w) / nx + lap),
        minZ: Math.max(box.minZ, box.minZ + (j * h) / nz - lap),
        maxZ: Math.min(box.maxZ, box.minZ + ((j + 1) * h) / nz + lap),
      });
  return { scale, tiles, area: side };
}

const planBox = (m: PermitModel) => {
  const pts = [...m.design.proposed.rooms.flatMap((r) => r.polygon), ...m.design.proposed.walls.flatMap((w) => [w.a, w.b])];
  return bounds(pts);
};

// What a plan shows: the whole basement when it fits at 1:50 or larger, otherwise unit 2 and what's
// around it (the stair, the rooms beside it), with the rest of the basement cut off at a break line.
export function planFrame(a: Area, m: PermitModel) {
  const whole = planBox(m);
  const all = planLayout(a, whole);
  if (all.tiles.length === 1) return { ...all, whole, cropped: false };
  const u = bounds(unitOutline(m).flat());
  const crop: Box = { minX: Math.max(whole.minX, u.minX - 1), maxX: Math.min(whole.maxX, u.maxX + 1), minZ: Math.max(whole.minZ, u.minZ - 1), maxZ: Math.min(whole.maxZ, u.maxZ + 1) };
  return { ...planLayout(a, crop), whole: crop, cropped: true };
}

// Match lines where a tile meets the next.
function matchLines(s: Sheet, v: View, tile: Box, whole: Box, tiles: Box[], number: (i: number) => string) {
  const lap = 0.3;
  const edges: { at: number; vertical: boolean; other: number }[] = [];
  const near = (p: number, q: number) => Math.abs(p - q) < 0.01;
  tiles.forEach((o, j) => {
    if (o === tile) return;
    const overlapX = o.minX < tile.maxX && o.maxX > tile.minX, overlapZ = o.minZ < tile.maxZ && o.maxZ > tile.minZ;
    if (overlapZ && near(o.minX, tile.maxX - 2 * lap)) edges.push({ at: tile.maxX - lap, vertical: true, other: j });
    if (overlapZ && near(o.maxX, tile.minX + 2 * lap)) edges.push({ at: tile.minX + lap, vertical: true, other: j });
    if (overlapX && near(o.minZ, tile.maxZ - 2 * lap)) edges.push({ at: tile.maxZ - lap, vertical: false, other: j });
    if (overlapX && near(o.maxZ, tile.minZ + 2 * lap)) edges.push({ at: tile.minZ + lap, vertical: false, other: j });
  });
  for (const e of edges) {
    const [x0, y0] = e.vertical ? v.P([e.at, Math.max(whole.minZ, tile.minZ)]) : v.P([Math.max(whole.minX, tile.minX), e.at]);
    const [x1, y1] = e.vertical ? v.P([e.at, Math.min(whole.maxZ, tile.maxZ)]) : v.P([Math.min(whole.maxX, tile.maxX), e.at]);
    s.line(x0, y0, x1, y1, { width: 1.2, dash: [12, 3, 3, 3] });
    s.text(`MATCH LINE: SEE ${number(e.other)}`, (x0 + x1) / 2 + (e.vertical ? 4 : 0), (y0 + y1) / 2 + (e.vertical ? 0 : 4), { size: 7, font: s.fonts.bold, rotate: e.vertical ? 90 : undefined, align: "center" });
  }
}

// A cropped plan: break lines where the rest of the basement goes on.
function breakLines(s: Sheet, v: View, crop: Box, whole: Box) {
  const label = "REST OF THE BASEMENT (UNIT 1): NOT PART OF THIS WORK";
  const sides: [Pt, Pt, boolean][] = [];
  if (crop.minX > whole.minX + 0.01) sides.push([[crop.minX, crop.minZ], [crop.minX, crop.maxZ], true]);
  if (crop.maxX < whole.maxX - 0.01) sides.push([[crop.maxX, crop.minZ], [crop.maxX, crop.maxZ], true]);
  if (crop.minZ > whole.minZ + 0.01) sides.push([[crop.minX, crop.minZ], [crop.maxX, crop.minZ], false]);
  if (crop.maxZ < whole.maxZ - 0.01) sides.push([[crop.minX, crop.maxZ], [crop.maxX, crop.maxZ], false]);
  for (const [a, b, vertical] of sides) {
    const [x0, y0] = v.P(a), [x1, y1] = v.P(b);
    s.line(x0, y0, x1, y1, { width: 0.7, dash: [10, 2, 2, 2] });
    s.text(label, (x0 + x1) / 2 + (vertical ? -4 : 0), (y0 + y1) / 2 + (vertical ? 0 : 4), { size: 5.8, color: MUTED, rotate: vertical ? 90 : undefined, align: "center" });
  }
}

// ---- A2 Basement plan, unit 2 ------------------------------------------------------------------

export function basementPlan(ctx: SheetCtx): Printed[] {
  const m = ctx.model;
  if (!m) {
    const { s, a, page } = newSheet(ctx, "A2", SHEETS[2].title, null);
    s.wrap("There's no plan of this basement yet. Film it again, or give your designer the room sizes.", a.x + 20, a.y + a.h - 40, a.w - 40, { size: 11 });
    return [{ number: "A2", title: SHEETS[2].title, notes: [], scale: null, page }];
  }
  const probe = new Sheet(ctx.doc.addPage(TABLOID), ctx.fonts);
  const a0 = frame(probe, ctx.project, { number: "A2", title: SHEETS[2].title, scale: null });
  ctx.doc.removePage(ctx.doc.getPageCount() - 1);
  const lay = planFrame(a0, m);
  const box = lay.whole;
  const out: Printed[] = [];
  const numberOf = (i: number) => (lay.tiles.length > 1 ? `A2.${i + 1}` : "A2");
  lay.tiles.forEach((tile, i) => {
    const number = numberOf(i);
    const { s, a, page } = newSheet(ctx, number, SHEETS[2].title, lay.scale.label);
    const area0 = { ...lay.area, y: a.y, h: a.h };
    const v = makeView({ x: area0.x + PAD, y: area0.y + PAD, w: area0.w - 2 * PAD, h: area0.h - 2 * PAD }, tile, lay.scale);
    const draw = () => {
      drawOutside(s, v, m.existing.rooms, bounds(m.existing.rooms.flatMap((r) => r.polygon)));
      // Unit 2 softly toned; the rated ceiling's outline just inside it.
      drawUnit(s, v, unitOutline(m), { tone: true, ceiling15: true });
      drawFixtures(s, v, m.design.proposed.fixtures);
      drawRoomFixtures(s, v, m);
      drawWalls(s, v, m, { mode: "plan", review: review(ctx), windows: m.windows });
      drawRoomLabels(s, v, m, { ceiling: true, unitTag: true, ...(lay.tiles.length > 1 ? { tile, tiles: lay.tiles, whole: box, continues: numberOf } : {}) });
      drawAlarms(s, m.design.proposed.alarms.map((x) => ({ kind: x.kind, at: v.P(x.at) })));
    };
    const [cx0, cy0] = v.P([tile.minX, tile.maxZ]), [cx1, cy1] = v.P([tile.maxX, tile.minZ]);
    if (lay.tiles.length > 1 || lay.cropped) s.clipped(cx0 - 2, cy0 - 2, cx1 - cx0 + 4, cy1 - cy0 + 4, draw);
    else draw();
    if (lay.tiles.length > 1) s.clipped(cx0 - PAD, cy0 - PAD, cx1 - cx0 + 2 * PAD, cy1 - cy0 + 2 * PAD, () => drawChains(s, v, m, tile));
    else drawChains(s, v, m, lay.cropped ? tile : undefined);
    if (lay.tiles.length > 1) matchLines(s, v, tile, box, lay.tiles, numberOf);
    if (lay.cropped) breakLines(s, v, tile, planBox(m));
    planLegend(s, ctx, a, v, m);
    out.push({ number, title: SHEETS[2].title, notes: ["fire separation", ...m.design.proposed.alarms.map((x) => x.why)], scale: lay.scale, page });
  });
  return out;
}

function planLegend(s: Sheet, ctx: SheetCtx, a: Area, v: View, m: PermitModel) {
  let y = a.y + a.h;
  heading(s, a.x, y - 8, "Basement plan: unit 2", v.scale.label);
  y -= 22;
  y -= legendBox(s, a.x, y, LEGEND_W - 6, "WALLS", [LEGEND.foundation(s), LEGEND.existing(s), LEGEND.new(s), LEGEND.outside(s)]) + 8;
  y -= legendBox(s, a.x, y, LEGEND_W - 6, "FIRE SEPARATION (A6, A7 NOTE 4)", [LEGEND.rated30(s), LEGEND.rated15(s), LEGEND.door20(s)]) + 8;
  y -= legendBox(s, a.x, y, LEGEND_W - 6, "ALARMS (A7 NOTES 8-9)", [LEGEND.alarms(s), LEGEND.interconnect(s)]) + 8;
  const keyNotes = [
    "Windows tagged W#: width x height of the clear opening, inches (mm); sill heights on A5.",
    "Doors: clear width, inches (mm).",
    "Dimensions: feet-inches (mm), inside face of the foundation wall.",
    `Areas are inside the walls. CLG: finished ceiling height.`,
    "Stair, furnace room and the suite's walls to unit 1 are 30-minute separations, continuous to the floor above and through bulkheads.",
  ];
  s.text("KEY NOTES", a.x, y - 4, { size: 6.5, font: s.fonts.bold });
  y -= 14;
  keyNotes.forEach((t, i) => {
    y = s.wrap(`${i + 1}. ${t}`, a.x, y, LEGEND_W - 8, { size: 6, leading: 7.4 }) - 2;
  });
  s.scaleBar(a.x, a.y + 18, v.k, v.scale.label);
  if (review(ctx) && m.design.proposed.walls.some((w: PWall) => w.guess)) s.wrap("Dashed outlines: walls the camera didn't see. Check them before you submit.", a.x, a.y + 46, LEGEND_W - 8, { size: 6, color: MUTED });
}

// ---- A3 Main floor, unit 1 -----------------------------------------------------------------

export function mainFloor(ctx: SheetCtx): Printed {
  const { s, a, page } = newSheet(ctx, "A3", SHEETS[3].title, null);
  const m = ctx.model;
  if (!m) return { number: "A3", title: SHEETS[3].title, notes: [], scale: null, page };
  const foot = bounds(m.existing.rooms.flatMap((r) => r.polygon));
  const up = ctx.state.permit?.upstairs;
  const floors = Math.max(1, Math.min(3, Math.max(ctx.storeys, ...(up?.bedrooms ?? []).map((b) => b.floor))));
  const colW = (a.w - LEGEND_W - 8) / floors;
  const fw = foot.maxX - foot.minX, fh = foot.maxZ - foot.minZ;
  const scale = largestFit(SMALL_SCALES, fw, fh, colW - 2 * PAD, a.h - 2 * PAD - 40) ?? SMALL_SCALES[SMALL_SCALES.length - 1];
  const notes: string[] = [];
  const stair = m.design.proposed.fixtures.find((f) => f.kind === "stairs") ?? null;
  for (let f = 1; f <= floors; f++) {
    const area0 = { x: a.x + LEGEND_W + 8 + (f - 1) * colW + PAD, y: a.y + PAD, w: colW - 2 * PAD, h: a.h - 2 * PAD - 40 };
    const v = makeView(area0, foot, scale);
    heading(s, area0.x - PAD + 20, a.y + a.h - 10, f === 1 ? "Main floor (unit 1)" : f === 2 ? "Second floor (unit 1)" : "Third floor (unit 1)", "schematic");
    // The house's outline: the basement's outline below it.
    const [x0, y0] = v.P([foot.minX, foot.maxZ]), [x1, y1] = v.P([foot.maxX, foot.minZ]);
    s.rect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8, { fill: TONE3, width: 0.6 });
    s.rect(x0, y0, x1 - x0, y1 - y0, { fill: PAPER, width: 0.6 });
    s.text(`${ftIn(fw)} (${Math.round(fw * 1000)})`, (x0 + x1) / 2, y1 + 12, { size: 6, align: "center", color: MUTED });
    s.text(`${ftIn(fh)} (${Math.round(fh * 1000)})`, x0 - 12, (y0 + y1) / 2, { size: 6, align: "center", color: MUTED, rotate: 90 });
    const alarms: { kind: "smoke" | "co" | "combo"; at: [number, number] }[] = [];
    if (f === 1 && stair?.sizeM) {
      // The stair down, inside a 30-minute enclosure with a 20-minute door at the top.
      const sb: Box = { minX: stair.at[0] - stair.sizeM[0] / 2, maxX: stair.at[0] + stair.sizeM[0] / 2, minZ: stair.at[1] - stair.sizeM[1] / 2, maxZ: stair.at[1] + stair.sizeM[1] / 2 };
      const [sx0, sy0] = v.P([sb.minX, sb.maxZ]), [sx1, sy1] = v.P([sb.maxX, sb.minZ]);
      s.rect(sx0, sy0, sx1 - sx0, sy1 - sy0, { width: 0.7, fill: PAPER });
      const alongX = stair.sizeM[0] >= stair.sizeM[1];
      const treads = Math.max(4, Math.round((alongX ? stair.sizeM[0] : stair.sizeM[1]) / 0.25));
      for (let i = 1; i < treads; i++) {
        const t = i / treads;
        if (alongX) s.line(sx0 + t * (sx1 - sx0), sy0, sx0 + t * (sx1 - sx0), sy1, { width: 0.4 });
        else s.line(sx0, sy0 + t * (sy1 - sy0), sx1, sy0 + t * (sy1 - sy0), { width: 0.4 });
      }
      s.rect(sx0 - 3, sy0 - 3, sx1 - sx0 + 6, sy1 - sy0 + 6, { width: 2.4, dash: [7, 2.2, 1.6, 2.2] });
      const label = "DN TO UNIT 2";
      const lw = s.textWidth(label, 6, s.fonts.bold) + 6;
      s.rect((sx0 + sx1) / 2 - lw / 2, (sy0 + sy1) / 2 - 4, lw, 11, { fill: PAPER, stroke: false });
      s.text(label, (sx0 + sx1) / 2, (sy0 + sy1) / 2 - 1, { size: 6, align: "center", font: s.fonts.bold });
      // The door at the top, on the side facing the middle of the house.
      const hc: Pt = [(foot.minX + foot.maxX) / 2, (foot.minZ + foot.maxZ) / 2];
      const toward: Pt = alongX ? [stair.at[0], hc[1] > stair.at[1] ? sb.maxZ : sb.minZ] : [hc[0] > stair.at[0] ? sb.maxX : sb.minX, stair.at[1]];
      const c = v.P(toward);
      s.poly([[c[0], c[1] + 7], [c[0] + 7, c[1]], [c[0], c[1] - 7], [c[0] - 7, c[1]]], { fill: PAPER, width: 0.8 });
      s.text("20", c[0], c[1] - 2.2, { size: 5.5, align: "center", font: s.fonts.bold });
      alarms.push({ kind: "smoke", at: v.P([stair.at[0], Math.min(foot.maxZ - 0.5, sb.maxZ + 0.7)]) });
    }
    const beds = (up?.bedrooms ?? []).filter((b) => b.floor === f);
    const centres: Pt[] = beds.map((b) => [foot.minX + b.at[0] * fw, foot.minZ + b.at[1] * fh]);
    centres.forEach((c, i) => {
      const half = 1.5;
      const bx0 = Math.max(foot.minX, c[0] - half), bx1 = Math.min(foot.maxX, c[0] + half), bz0 = Math.max(foot.minZ, c[1] - half), bz1 = Math.min(foot.maxZ, c[1] + half);
      const [px0, py0] = v.P([bx0, bz1]), [px1, py1] = v.P([bx1, bz0]);
      s.rect(px0, py0, px1 - px0, py1 - py0, { width: 0.6, dash: [4, 2] });
      s.text(`BEDROOM ${i + 1}`, (px0 + px1) / 2, (py0 + py1) / 2 + 9, { size: 6.5, font: s.fonts.bold, align: "center" });
      alarms.push({ kind: "smoke", at: v.P([c[0], c[1] - 0.5]) });
    });
    if (centres.length) {
      // Outside the bedrooms, toward the middle of the floor: smoke, and CO with a fuel-burning furnace.
      const mid = centroid(centres);
      const hc: Pt = [(foot.minX + foot.maxX) / 2, (foot.minZ + foot.maxZ) / 2];
      const d = Math.hypot(hc[0] - mid[0], hc[1] - mid[1]) || 1;
      const hall: Pt = [mid[0] + ((hc[0] - mid[0]) / d) * Math.min(2, d), mid[1] + ((hc[1] - mid[1]) / d) * Math.min(2, d)];
      alarms.push({ kind: m.fuelBurning ? "combo" : "smoke", at: v.P(hall) });
    } else if (f > 1 || !stair) {
      alarms.push({ kind: m.fuelBurning ? "combo" : "smoke", at: v.P([(foot.minX + foot.maxX) / 2, (foot.minZ + foot.maxZ) / 2]) });
    }
    drawAlarms(s, alarms);
    notes.push(`Floor ${f}: ${alarms.length} alarm${alarms.length === 1 ? "" : "s"}`);
  }
  // Legend and notes.
  let y = a.y + a.h;
  heading(s, a.x, y - 8, "Unit 1", "schematic");
  y -= 22;
  y -= legendBox(s, a.x, y, LEGEND_W - 6, "LEGEND", [LEGEND.rated30(s), LEGEND.door20(s), LEGEND.alarms(s), LEGEND.interconnect(s)]) + 10;
  const lines = [
    "Unit 1 is not altered except for the work shown. The outline is the house's, over the basement; rooms are placed by the owner.",
    "Smoke alarms on every floor and in every bedroom of unit 1, and between the bedrooms and the rest of each floor, interconnected with unit 2's, hard-wired with battery backup and a strobe (9.10.19.3., 9.10.19.5.(2)).",
    m.fuelBurning ? "CO alarms outside the sleeping areas of unit 1, interconnected (9.32.3.9A.)." : "No fuel-burning appliance: CO alarms are not required.",
    "The stair to the basement is enclosed by a 30-minute fire separation, with a 20-minute self-closing, positive-latching door (A2).",
  ];
  lines.forEach((t, i) => {
    y = s.wrap(`${i + 1}. ${t}`, a.x, y, LEGEND_W - 8, { size: 6.3, leading: 7.8 }) - 3;
  });
  notes.push(...lines);
  return { number: "A3", title: SHEETS[3].title, notes, scale, page };
}

// ---- A4 Ceiling plan ------------------------------------------------------------------------

// Cut into the same sheets as the floor plan (A2.1 under A4.1, and so on), so each pair shows the same
// part of the same design at the same scale.
export function ceilingPlan(ctx: SheetCtx): Printed[] {
  const m = ctx.model;
  if (!m) {
    const { page } = newSheet(ctx, "A4", SHEETS[4].title, null);
    return [{ number: "A4", title: SHEETS[4].title, notes: [], scale: null, page }];
  }
  const probe = new Sheet(ctx.doc.addPage(TABLOID), ctx.fonts);
  const a0 = frame(probe, ctx.project, { number: "A4", title: SHEETS[4].title, scale: null });
  ctx.doc.removePage(ctx.doc.getPageCount() - 1);
  const lay = planFrame(a0, m);
  const scale = lay.scale;
  const split = lay.tiles.length > 1;
  const numberOf = (i: number) => (split ? `A4.${i + 1}` : "A4");
  const ceiling = m.ceilingM, beam = m.beamM;
  const checks: [string, string, boolean | null][] = [
    ["Finished ceiling in unit 2", ceiling ? `${both(ceiling)}; 1.95 m (6'-5") required` : "1.95 m (6'-5\") required", ceiling ? ceiling >= 1.95 : null],
    ["Clear under beams and ducts", beam ? `${both(beam)}; 1.85 m (6'-1") required` : "1.85 m (6'-1\") required", beam ? beam >= 1.85 : null],
  ];
  const lines = [
    "The 15-minute ceiling (15.9 mm Type X gypsum board, assembly C1 on A6) covers all of unit 2, continuous over and around every bulkhead, beam and duct, sealed at every penetration.",
    "Supply and return ducts in unit 2 are best dropped to the floor. A duct smoke detector shuts off the furnace when one system serves both units (A7).",
    "Pot lights and fans in the rated ceiling are boxed in drywall in the joist space.",
  ];
  return lay.tiles.map((tile, i) => {
    const { s, a, page } = newSheet(ctx, numberOf(i), SHEETS[4].title, scale.label);
    const area0 = { ...lay.area, y: a.y, h: a.h };
    const v = makeView({ x: area0.x + PAD, y: area0.y + PAD, w: area0.w - 2 * PAD, h: area0.h - 2 * PAD }, tile, scale);
    const [cx0, cy0] = v.P([tile.minX, tile.maxZ]), [cx1, cy1] = v.P([tile.maxX, tile.minZ]);
    const draw = () => {
      // The rated ceiling: all of unit 2.
      for (const p of unitOutline(m)) s.hatch(p.map(v.P), 7, { width: 0.25, color: FAINT });
      drawWalls(s, v, m, { mode: "ceiling", review: review(ctx), windows: m.windows });
      // Beams, ducts and bulkheads, dashed, with the clear height under each: the bands first, the room
      // names over them, then each band's label where it covers no name.
      const overheads = m.design.proposed.fixtures.filter((f) => f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead" || f.kind === "post");
      const corners = (f: (typeof overheads)[number]) => {
        const sz = f.sizeM ?? [0.3, 0.3];
        return [...v.P([f.at[0] - sz[0] / 2, f.at[1] + sz[1] / 2]), ...v.P([f.at[0] + sz[0] / 2, f.at[1] - sz[1] / 2])] as [number, number, number, number];
      };
      for (const f of overheads) {
        const [x0, y0, x1, y1] = corners(f);
        if (f.kind === "post") s.rect(x0, y0, Math.max(5, x1 - x0), Math.max(5, y1 - y0), { fill: INK, width: 0.4 });
        else s.rect(x0, y0, x1 - x0, y1 - y0, { width: 0.9, dash: [6, 3], fill: f.kind === "bulkhead" ? TONE : undefined });
      }
      const taken = drawRoomLabels(s, v, m, { ceiling: true, unitTag: false, ...(split ? { tile, tiles: lay.tiles, whole: lay.whole, continues: numberOf } : {}) });
      for (const f of overheads) {
        const [x0, y0, x1, y1] = corners(f);
        if (f.kind === "post") {
          s.text("POST", x1 + 4, (y0 + y1) / 2 - 2, { size: 5.5 });
          continue;
        }
        const h = f.heightM ?? null;
        const what = `${f.kind === "beam" ? "EXISTING BEAM" : f.kind === "duct" ? "EXISTING DUCT" : "BULKHEAD, RATED, CONTINUOUS"}${h ? `: ${ftIn(h)} (${Math.round(h * 1000)}) CLEAR${h < 1.85 ? ", UNDER 1.85 m" : ""}` : ""}`;
        const texts = review(ctx) && f.guess ? [`${what} (placed from the video: check where it runs)`, `${what} (check where it runs)`, what] : [what];
        // Along the part of it this sheet shows, or just beside it: inside the sheet, over no room's
        // name and no other label. Too long for any such spot, its note gets shorter, then goes.
        const lx0 = Math.max(Math.min(x0, x1), cx0), lx1 = Math.min(Math.max(x0, x1), cx1), ly0 = Math.max(Math.min(y0, y1), cy1), ly1 = Math.min(Math.max(y0, y1), cy0);
        const horizontal = Math.abs(x1 - x0) >= Math.abs(y0 - y1);
        const boxAt = (tw: number, t: number, d: number): PageBox =>
          horizontal
            ? { x0: lx0 + t * (lx1 - lx0) - tw / 2 - 2, x1: lx0 + t * (lx1 - lx0) + tw / 2 + 2, y0: (ly0 + ly1) / 2 - 3.5 + d, y1: (ly0 + ly1) / 2 + 5.5 + d }
            : { x0: (lx0 + lx1) / 2 - 5 + d, x1: (lx0 + lx1) / 2 + 5 + d, y0: ly0 + t * (ly1 - ly0) - tw / 2 - 2, y1: ly0 + t * (ly1 - ly0) + tw / 2 + 2 };
        const onSheet = (b: PageBox) => b.x0 >= cx0 && b.x1 <= cx1 && b.y0 >= cy1 && b.y1 <= cy0;
        const spots = [0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95].flatMap((t) => [0, 11, -11, 22, -22, 33, -33, 44, -44].map((d) => [t, d] as const));
        let pick: { text: string; at: PageBox } | null = null;
        for (const text of texts) {
          const tw = s.textWidth(text, 5.8);
          const spot = spots.find(([t, d]) => onSheet(boxAt(tw, t, d)) && !taken.some((b) => boxesMeet(boxAt(tw, t, d), b)));
          if (spot) {
            pick = { text, at: boxAt(tw, ...spot) };
            break;
          }
        }
        if (!pick) {
          // Nowhere clear: the short text where it covers the least.
          const text = texts[texts.length - 1], tw = s.textWidth(text, 5.8);
          const cover = (b: PageBox) => taken.reduce((sum, o) => sum + Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0)) * Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0)), 0);
          const inside = spots.filter(([t, d]) => onSheet(boxAt(tw, t, d)));
          const best = (inside.length ? inside : spots).reduce((x, y) => (cover(boxAt(tw, ...y)) < cover(boxAt(tw, ...x)) ? y : x));
          pick = { text, at: boxAt(tw, ...best) };
        }
        const { text, at } = pick;
        taken.push(at);
        if (horizontal) {
          s.rect(at.x0, at.y0, at.x1 - at.x0, 9, { fill: PAPER, stroke: false });
          s.text(text, (at.x0 + at.x1) / 2, at.y0 + 2, { size: 5.8, align: "center", font: s.fonts.bold });
        } else s.text(text, (at.x0 + at.x1) / 2 + 2, (at.y0 + at.y1) / 2, { size: 5.8, align: "center", font: s.fonts.bold, rotate: 90 });
      }
      // The duct smoke detector, at the furnace's return.
      const furnace = m.design.proposed.fixtures.find((f) => f.kind === "furnace");
      if (furnace) {
        const [fx, fy] = v.P(furnace.at);
        s.rect(fx - 9, fy + 8, 18, 9, { fill: PAPER, width: 0.7 });
        s.text("DSD", fx, fy + 10.5, { size: 5.5, align: "center", font: s.fonts.bold });
        s.text("duct smoke detector, return duct", fx + 12, fy + 10.5, { size: 5.3, color: MUTED });
      }
    };
    if (split || lay.cropped) s.clipped(cx0 - 2, cy0 - 2, cx1 - cx0 + 4, cy1 - cy0 + 4, draw);
    else draw();
    if (split) matchLines(s, v, tile, lay.whole, lay.tiles, numberOf);
    if (lay.cropped) breakLines(s, v, tile, planBox(m));
    // The heights, checked.
    let y = a.y + a.h;
    heading(s, a.x, y - 8, "Basement ceiling plan", scale.label);
    y -= 22;
    y -= legendBox(s, a.x, y, LEGEND_W - 6, "LEGEND", [
      LEGEND.rated15(s),
      { draw: (x, yy) => s.rect(x, yy - 3, 26, 6, { width: 0.9, dash: [6, 3] }), label: "Beam, duct or bulkhead overhead, with the clear height under it" },
      { draw: (x, yy) => s.rect(x + 10, yy - 3, 6, 6, { fill: INK, width: 0.4 }), label: "Post" },
    ]) + 10;
    s.text("HEIGHTS (9.5.3.1.(2) AND (3))", a.x, y, { size: 6.5, font: s.fonts.bold });
    y -= 12;
    for (const [label, value, ok] of checks) {
      s.text(ok === true ? "MEETS" : ok === false ? "BELOW" : "", a.x, y, { size: 6, font: s.fonts.bold });
      s.text(label, a.x + 34, y, { size: 6.5, font: s.fonts.bold });
      y = s.wrap(value, a.x + 34, y - 8, LEGEND_W - 40, { size: 6.3 }) - 4;
    }
    y -= 4;
    lines.forEach((t, j) => {
      y = s.wrap(`${j + 1}. ${t}`, a.x, y, LEGEND_W - 8, { size: 6.3, leading: 7.8 }) - 3;
    });
    s.scaleBar(a.x, a.y + 18, v.k, scale.label);
    stampScale(s, scale.label);
    return { number: numberOf(i), title: SHEETS[4].title, notes: [...checks.map((c) => `${c[0]}: ${c[1]}`), ...lines], scale, page };
  });
}

// ---- A5 Elevations ------------------------------------------------------------------------------

export function elevations(ctx: SheetCtx): Printed {
  const m = ctx.model;
  const { s, a, page } = newSheet(ctx, "A5", SHEETS[5].title, null);
  if (!m) return { number: "A5", title: SHEETS[5].title, notes: [], scale: null, page };
  const changed = m.windows.filter((w) => w.change !== "keep");
  const shown = changed.length ? changed : m.windows.filter((w) => w.escape);
  const walls = [...new Set(shown.map((w) => w.wallId))].map((id) => m.design.proposed.walls.find((w) => w.id === id)!).filter(Boolean).slice(0, 2);
  const notes: string[] = [];
  if (!walls.length) {
    s.wrap("No window in the basement changes, so there's no elevation to show.", a.x + 20, a.y + a.h - 40, a.w - 40, { size: 11 });
    return { number: "A5", title: SHEETS[5].title, notes, scale: null, page };
  }
  const top = (m.ceilingM ?? 2.1) + 0.25; // top of the foundation wall, at the floor joists
  const houseH = 2.7; // the storey above, drawn schematically
  const rowH = (a.h - 30) / walls.length;
  const maxL = Math.max(...walls.map(wallLen));
  const scale = largestFit([...PLAN_SCALES, { label: "1:75", ratio: 75 }, { label: "1:100", ratio: 100 }], maxL + 1, top + houseH + 0.6, a.w - 2 * PAD - 230, rowH - 70) ?? { label: "1:100", ratio: 100 };
  const k = ptPerMetre(scale.ratio);
  walls.forEach((w, i) => {
    const L = wallLen(w);
    const base = a.y + a.h - (i + 1) * rowH + 50;
    const left = a.x + PAD + (a.w - 2 * PAD - 230 - L * k) / 2;
    const Y = (h: number) => base + h * k;
    // Seen from outside: someone facing the wall has its far end on their left or right; on paper
    // (y up) the plan's z runs down, so turn the wall's direction and outside into paper terms.
    const d = dir(w), side = outward(w, m.design.proposed.rooms);
    const n: Pt = [-d[1] * side, d[0] * side];
    const face: Pt = [-n[0], n[1]]; // the viewer looks back at the wall, in paper terms
    const right: Pt = [face[1], -face[0]];
    const flip = d[0] * right[0] + -d[1] * right[1] < 0;
    const X = (t: number) => left + (flip ? L - t : t) * k;
    const wins = shown.filter((x) => x.wallId === w.id);
    heading(s, a.x + 10, base + (top + houseH) * k + 30, `Elevation ${i + 1}: the wall with ${wins.map((x) => x.tag).join(", ")}`, scale.label);
    // Foundation below grade, the house wall above (schematic).
    const ops = m.design.proposed.openings.filter((o) => o.wallId === w.id && o.kind === "window");
    const gradeH = Math.max(...wins.map((x) => (x.sillM ?? 0.9) + drawnHeightM(x)), top - 0.6) + 0.1;
    s.rect(X(0), Y(0), L * k, top * k, { fill: TONE2, width: 0.8 });
    s.rect(X(0), Y(top), L * k, houseH * k, { fill: PAPER, width: 0.8 });
    s.text("EXISTING HOUSE WALL ABOVE (NO CHANGE)", X(L / 2), Y(top + houseH / 2), { size: 6.5, align: "center", color: MUTED });
    s.line(X(-0.6), Y(gradeH), X(L + 0.6), Y(gradeH), { width: 1.2 });
    s.text("GRADE", X(L + 0.65), Y(gradeH) - 2, { size: 6, color: MUTED });
    s.line(X(-0.6), Y(0), X(L + 0.6), Y(0), { width: 0.5, dash: [5, 3], color: MUTED });
    s.text("BASEMENT FLOOR", X(L + 0.65), Y(0) - 2, { size: 6, color: MUTED });
    // Windows: the other ones on this wall as they are, the changed ones at their new size, each with
    // its well.
    for (const op of ops) {
      const info = m.windows.find((x) => x.id === op.id)!;
      const wm = info.widthM, hm = drawnHeightM(info), sill = info.sillM ?? 0.9;
      const lx = Math.min(X(op.offsetM - wm / 2), X(op.offsetM + wm / 2)), rx = lx + wm * k;
      // A height nobody has measured yet is drawn dashed: a placeholder, not a size.
      s.rect(lx, Y(sill), wm * k, hm * k, { fill: PAPER, width: info.change === "keep" ? 0.8 : 1.4, ...(info.heightM == null ? { dash: [3, 2] } : {}) });
      s.line(lx, Y(sill), rx, Y(sill + hm), { width: 0.3, color: MUTED });
      if (info.was) s.rect(X(op.offsetM) - (info.was.widthM / 2) * k, Y(sill + hm - (info.was.heightM ?? 0.3)), info.was.widthM * k, (info.was.heightM ?? 0.3) * k, { width: 0.6, dash: [3, 2], color: MUTED });
      // The well, behind the grade line.
      s.rect(lx - 0.1 * k, Y(sill - 0.2), (wm + 0.2) * k, (gradeH + 0.1 - sill + 0.2) * k, { width: 0.6, dash: [4, 2] });
      const tag = [`${info.tag}: ${info.change === "new" ? "NEW" : info.change === "enlarge" ? "ENLARGED" : "EXISTING"}${escapeLabel(info)}`, info.heightM == null ? `${sizeText(wm, null)} wide, height to be taped` : sizeText(wm, hm)];
      s.text(tag[0], rx + 0.18 * k, Y(sill + hm / 2) + 3, { size: 6.5, font: s.fonts.bold });
      s.text(tag[1], rx + 0.18 * k, Y(sill + hm / 2) - 6, { size: 6.3 });
      s.dim(lx - 6, Y(0), lx - 6, Y(sill), `sill ${dimText(sill)}`, 10, 5.8);
    }
    // Where the windows sit along the wall.
    const ts = [0, L, ...wins.flatMap((x) => {
      const op = ops.find((o) => o.id === x.id)!;
      return [op.offsetM - x.widthM / 2, op.offsetM + x.widthM / 2];
    })].map((t) => X(t)).sort((p, q) => p - q);
    for (let j = 0; j + 1 < ts.length; j++) s.dim(ts[j], Y(0) - 8, ts[j + 1], Y(0) - 8, dimText((ts[j + 1] - ts[j]) / k), -12, 5.8);
    // Lot line and the window area, beside the elevation.
    const bx = a.x + a.w - 230;
    let by = base + (top + houseH) * k;
    for (const x of wins) {
      const lot = ctx.state.permit?.lotLines?.find((l) => l.id === x.id)?.mm ?? null;
      const lines = [
        `${x.tag}${x.room ? `, ${x.room.toLowerCase()}` : ""}`,
        x.heightM == null ? `Clear opening ${sizeText(x.widthM, null)} wide, height to be taped${x.escape ? `: an escape window needs it at least ${escapeHeightNeededMm(x.widthM)} mm tall` : ""}` : `Clear opening ${sizeText(x.widthM, x.heightM)}: ${(x.widthM * x.heightM).toFixed(2)} m²${x.escape ? (x.meets ? ", meets 0.35 m²" : ", under 0.35 m²") : ""}`,
        x.was ? `Existing ${sizeText(x.was.widthM, x.was.heightM)} enlarged (dashed)` : x.change === "new" ? "New opening cut in the foundation wall" : "Existing window, no change",
        lot != null ? `To the lot line: ${both(lot / 1000)}` : "",
        x.change !== "keep" ? "Opening and lintel designed by an engineer (A7 note 2)." : "",
      ].filter(Boolean);
      for (const [j, t] of lines.entries()) {
        by = s.wrap(t, bx, by, 220, { size: j === 0 ? 7.5 : 6.8, font: j === 0 ? s.fonts.bold : s.fonts.regular }) - 2;
      }
      by -= 8;
      notes.push(...lines);
    }
  });
  stampScale(s, scale.label);
  return { number: "A5", title: SHEETS[5].title, notes, scale, page };
}

// ---- A6 Details --------------------------------------------------------------------------------

export function details(ctx: SheetCtx): Printed {
  const { s, a, page } = newSheet(ctx, "A6", SHEETS[6].title, "as noted");
  const m = ctx.model;
  const notes: string[] = [];
  const colW = a.w / 3;
  const esc = m?.windows.find((w) => w.escape) ?? null;
  const kitchener = ctx.municipality.startsWith("kitchener");

  // 1. The escape window, in section through the wall and the well.
  {
    const k = ptPerMetre(20);
    const base = a.y + 200;
    // The bedroom's escape window as A5 draws it; the proposed size only when there isn't one yet.
    const sill = esc ? (esc.sillM ?? 0.9) : PROPOSED_ESCAPE.sillM, h = esc ? drawnHeightM(esc) : PROPOSED_ESCAPE.heightM, w = esc ? esc.widthM : PROPOSED_ESCAPE.widthM;
    const heightKnown = !esc || esc.heightM != null;
    const top = Math.max(sill + h + 0.3, (m?.ceilingM ?? 2.1) + 0.1);
    const grade = Math.min(top - 0.15, sill + h + 0.1);
    heading(s, a.x + 10, a.y + a.h - 10, "1. Escape window (bedroom)", "1:20");
    const fx = a.x + 110; // inside face of the foundation wall
    const Yh = (m2: number) => base + m2 * k;
    // Foundation wall, cut by the opening.
    s.rect(fx, Yh(0), 0.2 * k, sill * k, { fill: TONE3, width: 0.6 });
    s.rect(fx, Yh(sill + h), 0.2 * k, (top - sill - h) * k, { fill: TONE3, width: 0.6 });
    // The new stud wall inside, with the drywall return into the opening.
    s.rect(fx - 0.115 * k, Yh(0), 0.089 * k, sill * k, { fill: PAPER, width: 0.5 });
    s.rect(fx - 0.115 * k, Yh(sill + h), 0.089 * k, (top - sill - h) * k, { fill: PAPER, width: 0.5 });
    s.rect(fx - 0.128 * k, Yh(0), 0.0127 * k, sill * k, { fill: TONE2, width: 0.3 });
    s.rect(fx - 0.128 * k, Yh(sill + h), 0.0127 * k, (top - sill - h) * k, { fill: TONE2, width: 0.3 });
    // Floor joists of the house above.
    s.rect(fx - 0.3 * k, Yh(top), 1.2 * k, 0.24 * k, { width: 0.5 });
    s.text("FLOOR ABOVE", fx + 0.35 * k, Yh(top) + 0.09 * k, { size: 5.3, color: MUTED });
    // The window: frame and sash in the opening.
    s.rect(fx + 0.06 * k, Yh(sill), 0.08 * k, h * k, { fill: PAPER, width: 0.8 });
    s.line(fx + 0.1 * k, Yh(sill), fx + 0.1 * k, Yh(sill + h), { width: 0.4 });
    // The well outside: drained gravel at its foot, its wall 550 mm clear of the window, up past grade.
    const wellIn = fx + 0.2 * k + 0.55 * k;
    s.rect(fx + 0.2 * k, Yh(sill - 0.25), 0.6 * k, 0.15 * k, { fill: TONE2, width: 0.4 });
    s.text("DRAINED GRAVEL", fx + 0.85 * k, Yh(sill - 0.2), { size: 5.3, color: MUTED });
    s.rect(wellIn, Yh(sill - 0.25), 0.03 * k, (grade + 0.1 - sill + 0.25) * k, { fill: INK, width: 0.3 });
    s.line(wellIn + 0.03 * k, Yh(grade), wellIn + 0.8 * k, Yh(grade), { width: 1 });
    s.text("GRADE", wellIn + 0.08 * k, Yh(grade) + 3, { size: 5.5, color: MUTED });
    s.text("WINDOW WELL", wellIn + 0.08 * k, Yh(grade) - 9, { size: 5.5, color: MUTED });
    s.line(fx - 0.6 * k, Yh(0), fx + 0.25 * k, Yh(0), { width: 1 });
    s.text("FINISHED FLOOR", fx - 0.6 * k, Yh(0) - 8, { size: 5.5, color: MUTED });
    s.dim(fx + 0.2 * k, Yh(sill + h / 2), wellIn, Yh(sill + h / 2), "550 (1'-10\") MIN. CLEAR", 8, 5.5);
    s.dim(fx - 0.2 * k, Yh(0), fx - 0.2 * k, Yh(sill), dimText(sill), 10, 5.5);
    s.dim(fx - 0.2 * k, Yh(sill), fx - 0.2 * k, Yh(sill + h), heightKnown ? `${dimText(h)} CLEAR` : "HEIGHT TO BE TAPED", 10, 5.5);
    s.text("FOUNDATION", fx + 0.1 * k, Yh(sill / 2), { size: 5.3, rotate: 90, color: PAPER, align: "center" });
    let ty = base - 24;
    const area2 = w * h;
    const checks = [
      ...(heightKnown
        ? [
            `Clear opening ${sizeText(w, h)} = ${area2.toFixed(2)} m², at least 0.35 m²: ${escapeOk(w, h) ? "meets" : "does not meet"}`,
            `No side under 380 mm: smallest ${Math.round(Math.min(w, h) * 1000)} mm`,
          ]
        : [
            `Clear opening ${sizeText(w, null)} wide; its height is to be taped. At least 0.35 m² needs it ${escapeHeightNeededMm(w)} mm tall or more; if it isn't, it's enlarged`,
            `No side under 380 mm: ${Math.round(w * 1000)} mm wide`,
          ]),
      `Sill ${Math.round(sill * 1000)} mm above the floor${sill <= 1.0 ? "" : "; a fixed step or built-in below it"} (no Code maximum in a basement, 9.9.10.1.(2); kept at 1.0 m or less where it's new)`,
      "Opens from inside without tools or keys and stays open on its own",
      "Window well 550 mm clear in front; a cover opens from inside without tools",
      kitchener ? "Built to the City of Kitchener's egress window detail, pp. 23-24 of its second-unit guide" : "To Building Code 9.9.10.1.",
    ];
    for (const c of checks) ty = s.wrap(`- ${c}`, a.x + 10, ty, colW - 20, { size: 6.5, leading: 8 }) - 1;
    notes.push(...checks);
  }

  // 2. W1, the typical wall on the foundation.
  {
    const k = ptPerMetre(10);
    const x0 = a.x + colW + 30, base = a.y + 250;
    heading(s, a.x + colW + 10, a.y + a.h - 10, "2. W1: wall on the foundation", "1:10");
    const H = 0.9; // a slice of the wall's height
    s.rect(x0, base, 0.2 * k, H * k, { fill: TONE3, width: 0.6 }); // concrete
    s.rect(x0 + 0.2 * k, base, 0.025 * k, H * k, { fill: PAPER, width: 0.4 }); // air gap
    s.rect(x0 + 0.225 * k, base + 0.04 * k, 0.089 * k, (H - 0.04) * k, { fill: PAPER, width: 0.5 }); // studs + batt
    s.hatch([[x0 + 0.225 * k, base + 0.04 * k], [x0 + 0.314 * k, base + 0.04 * k], [x0 + 0.314 * k, base + H * k], [x0 + 0.225 * k, base + H * k]], 4, { width: 0.25, color: MUTED });
    s.line(x0 + 0.316 * k, base + 0.02 * k, x0 + 0.316 * k, base + H * k, { width: 1.1, dash: [3, 1.5] }); // vapour barrier
    s.rect(x0 + 0.318 * k, base + 0.01 * k, 0.0127 * k, (H - 0.01) * k, { fill: TONE2, width: 0.4 }); // drywall
    s.rect(x0 + 0.225 * k, base, 0.089 * k, 0.038 * k, { fill: TONE2, width: 0.5 }); // bottom plate
    s.line(x0 + 0.225 * k, base + 0.002 * k, x0 + 0.314 * k, base + 0.002 * k, { width: 1.6 }); // sill gasket
    s.line(x0 - 0.1 * k, base, x0 + 0.6 * k, base, { width: 1 });
    const call = (y: number, t: string) => {
      s.line(x0 + 0.34 * k, base + y * k, x0 + 0.42 * k, base + y * k, { width: 0.4 });
      s.wrap(t, x0 + 0.43 * k, base + y * k + 2, colW - 0.5 * k - 20, { size: 6, leading: 7 });
    };
    call(0.85, "12.7 mm (1/2\") gypsum board");
    call(0.7, "Vapour barrier, 0.15 mm poly, on the warm (room) side, lapped and sealed, into the rim joist space");
    call(0.52, "38 x 89 mm (2x4) studs at 400 mm (16\") o.c., insulation to at least match what's there");
    call(0.32, "Air space; existing foundation insulation kept (cut any old blanket's vapour barrier)");
    call(0.16, "Existing concrete foundation wall");
    call(0.02, "Bottom plate on a sill gasket (0.05 mm poly or Type S roll roofing), or pressure-treated");
    let ty = base - 26;
    const t = ["Single top plate on non-loadbearing walls; interior partitions: 2x4 at 16\" o.c., 12.7 mm gypsum each side.", "Foam insulation covered by drywall or another listed protection."];
    for (const c of t) ty = s.wrap(`- ${c}`, a.x + colW + 10, ty, colW - 20, { size: 6.5, leading: 8 }) - 1;
    notes.push("W1 typical wall: bottom plate on a sill gasket, insulation, vapour barrier on the warm side", ...t);
  }

  // 3. The rated assemblies.
  {
    const x0 = a.x + 2 * colW + 10;
    heading(s, x0, a.y + a.h - 10, "3. Fire-rated assemblies", "not to scale");
    const blocks: [string, string[]][] = [
      ["W2: 30-minute wall between the units, around the stair and the furnace room", ["38 x 89 mm (2x4) studs at 400 mm (16\") o.c.", "15.9 mm (5/8\") Type X gypsum board both sides, joints taped and filled", "Sound-absorbing insulation in the stud spaces", "Fire-stopped at top and bottom; continuous to the underside of the floor above (Table 11.5.1.1.-C, C156)"]],
      ["C1: 15-minute ceiling over unit 2", ["15.9 mm (5/8\") Type X gypsum board on the underside of the existing joists (or on resilient channel), joints taped and filled", "150 mm sound-absorbing insulation in the joist spaces", "Continuous over and around bulkheads, beams and ducts; penetrations fire-stopped to CAN/ULC-S115", "Beams and posts holding the floor above wrapped in 15.9 mm Type X (9.10.8.3.(2))"]],
      ["D20: door in the fire separation", ["20-minute rated door and frame, or an existing 45 mm solid-core wood door (C160)", "Self-closing device, positive latch, lever handle (9.10.13.10.(1))", "No glass unless rated"]],
    ];
    let y = a.y + a.h - 34;
    for (const [title, lines] of blocks) {
      // A small layered sketch: studs between two boards, or boards under joists.
      const sx = x0 + 4, sw = 70, sy = y - 44;
      if (title.startsWith("W2")) {
        s.rect(sx, sy, sw, 34, { fill: PAPER, width: 0.4 });
        s.rect(sx, sy, 5, 34, { fill: TONE2, width: 0.5 });
        s.rect(sx + sw - 5, sy, 5, 34, { fill: TONE2, width: 0.5 });
        for (let i = 0; i < 3; i++) s.rect(sx + 14 + i * 18, sy + 2, 9, 30, { width: 0.4 });
      } else if (title.startsWith("C1")) {
        for (let i = 0; i < 4; i++) s.rect(sx + 4 + i * 18, sy + 12, 7, 22, { width: 0.4 });
        s.rect(sx, sy + 6, sw, 5, { fill: TONE2, width: 0.5 });
        s.hatch([[sx, sy + 12], [sx + sw, sy + 12], [sx + sw, sy + 34], [sx, sy + 34]], 5, { width: 0.2, color: MUTED });
      } else {
        s.rect(sx + 10, sy, 50, 34, { width: 0.8 });
        s.poly([[sx + 35, sy + 24], [sx + 42, sy + 17], [sx + 35, sy + 10], [sx + 28, sy + 17]], { fill: PAPER, width: 0.8 });
        s.text("20", sx + 35, sy + 15, { size: 5.5, align: "center", font: s.fonts.bold });
      }
      let ly = s.wrap(title, sx + sw + 8, y, colW - sw - 30, { size: 6.8, font: s.fonts.bold, leading: 8 }) - 2;
      for (const l of lines) ly = s.wrap(`- ${l}`, sx + sw + 8, ly, colW - sw - 30, { size: 6.2, leading: 7.4 }) - 1;
      y = Math.min(ly, sy) - 16;
      notes.push(title, ...lines);
    }
  }
  return { number: "A6", title: SHEETS[6].title, notes, scale: { label: "1:20", ratio: 20 }, page };
}

// ---- A7 Notes ------------------------------------------------------------------------------------

export function notesSheet(ctx: SheetCtx): Printed {
  const { s, a, page } = newSheet(ctx, "A7", SHEETS[7].title, null);
  const m = ctx.model;
  const list = notesFor({ fuelBurning: m?.fuelBurning ?? true, stairs: Boolean(m?.design.proposed.fixtures.some((f) => f.kind === "stairs") ?? true), escapeNew: Boolean(m?.windows.some((w) => w.change !== "keep")) });
  const colW = (a.w - 40) / 3;
  let col = 0, y = a.y + a.h - 20;
  const printed: string[] = [];
  list.forEach((n, i) => {
    const body = `${i + 1}. ${n.title.toUpperCase()}: ${n.text}`;
    const cite = n.cites.map(citeText).join("; ");
    const need = s.measure(body, colW - 10, 7, s.fonts.regular, 8.6) + s.measure(cite, colW - 10, 5.8, s.fonts.regular, 7) + 10;
    if (y - need < a.y + 10) {
      col++;
      y = a.y + a.h - 20;
    }
    const x = a.x + 10 + col * (colW + 10);
    y = s.wrap(body, x, y, colW - 10, { size: 7, leading: 8.6 });
    y = s.wrap(cite, x, y, colW - 10, { size: 5.8, leading: 7, color: MUTED }) - 8;
    printed.push(`${n.id}: ${n.title}: ${n.text}`);
  });
  return { number: "A7", title: SHEETS[7].title, notes: printed, scale: null, page };
}

// The review copy's watermark goes over everything drawn on a sheet.
export function finishSheets(ctx: SheetCtx, printed: Printed[]) {
  if (!review(ctx)) return;
  for (const p of printed) watermark(new Sheet(ctx.doc.getPage(p.page), ctx.fonts));
}
