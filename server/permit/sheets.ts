// The drawing sheets of the permit package, one function each: cover with key plan, site plan,
// existing and proposed floor plans, a cross-section, the escape-window detail, the general notes,
// and the work that needs a licensed pro. Each returns the notes it printed, so tests can check them.
import type { PDFDocument, PDFImage } from "pdf-lib";
import { AERIAL_YEAR, type SiteGeometry } from "../property";
import type { Profile, StoredState } from "../workspace";
import type { CityPermit, Note, OntarioDiy } from "./data";
import { area, both, FAINT, fitScale, frame, INK, TONE, mmBoth, MUTED, PAPER, type Project, ptPerMetre, Sheet, SITE_SCALES, TABLOID, TONE2, type Fonts } from "./pdf";
import { drawPlan, type Geometry } from "./plans";

export type SheetCtx = {
  doc: PDFDocument;
  fonts: Fonts;
  project: Project;
  result: any;
  geo: Geometry | null;
  site: SiteGeometry | null;
  state: StoredState;
  profile: Profile | null;
  permit: CityPermit | null;
  diy: OntarioDiy;
  city: string;
  aerial: PDFImage | null;
};

export type Printed = { number: string; title: string; notes: string[] };

const SQFT = 10.7639;
const owners = (p: Profile | null) => (p?.owners.length ? p.owners.map((o) => `${o.first} ${o.last}`.trim()).join(", ") : null);

function newSheet(ctx: SheetCtx, number: string, title: string, scale: string | null) {
  const s = new Sheet(ctx.doc.addPage(TABLOID), ctx.fonts);
  const area0 = frame(s, ctx.project, { number, title, scale });
  return { s, area: area0 };
}

// After drawing, the scale is known; write it into the title block.
function stampScale(s: Sheet, label: string) {
  const x0 = s.width - 22 - 214;
  s.rect(x0 + 8, 22 + 96 - 38, 196, 11, { fill: PAPER, stroke: false });
  s.text(`Scale: ${label}`, x0 + 12, 22 + 96 - 32, { size: 7.5, color: MUTED });
}

function suiteArea(ctx: SheetCtx) {
  const zones = ctx.geo?.layout?.zones.filter((z) => z.kind !== "stairs" && z.kind !== "mechanical") ?? [];
  const fromZones = zones.reduce((sum, z) => sum + z.areaM2, 0);
  return fromZones > 0 ? fromZones : (ctx.geo?.main?.plan.areaM2 ?? ctx.result?.plan?.areaM2 ?? null);
}

export function scopeOfWork(ctx: SheetCtx) {
  const kind = ctx.geo?.layout?.kind === "studio" ? "a studio (bachelor) unit" : "a one-bedroom unit";
  const parts = [
    `Create a second dwelling unit (additional residential unit), ${kind}, in the basement of the existing house`,
    "new partition walls, a bathroom and a kitchen",
    "a fire separation between the two homes",
    "hard-wired, interconnected smoke and CO alarms in both homes",
  ];
  if (ctx.geo?.egress && !ctx.geo.egress.existing) parts.push("a new escape window in the bedroom (structural design by an engineer, see A7)");
  else if (ctx.geo?.egress) parts.push("the bedroom window made an escape window (A5)");
  return `${parts.join("; ")}. No change to the building's footprint or height.`;
}

// ---- A0 Cover --------------------------------------------------------------------------------

// On the cover and every sheet's title block: these are drawn from a phone video.
export const DRAFT = "Draft, for you or a BCIN designer to check before you submit";

export function coverSheet(ctx: SheetCtx): Printed {
  const { s, area: a } = newSheet(ctx, "A0", "Cover and key plan", null);
  const p = ctx.result?.property ?? null;
  let y = a.y + a.h - 30;
  s.text("Additional residential unit in the basement", a.x + 10, y, { size: 22, font: s.fonts.bold });
  y -= 22;
  s.text(`${ctx.project.address}, ${ctx.project.municipality}, Ontario`, a.x + 10, y, { size: 13, color: MUTED });
  y -= 22;
  s.rect(a.x + 6, y - 6, 430, 18, { fill: TONE2, stroke: false });
  s.text(DRAFT, a.x + 12, y, { size: 9.5, font: s.fonts.bold });
  y -= 30;
  const colW = (a.w - 40) / 2;
  const rows: [string, string | null][] = [
    ["Owner(s)", owners(ctx.profile)],
    ["Applicant", owners(ctx.profile) ? `${owners(ctx.profile)} (owner)` : null],
    ["Contact", ctx.profile ? [ctx.profile.phone, ctx.profile.email].filter(Boolean).join(" · ") : null],
    ["Legal description", ctx.project.legal],
    ["PIN / roll number", [ctx.project.pin, ctx.profile?.rollNumber].filter(Boolean).join(" / ") || null],
    ["Zoning", p?.zone ? `${p.zone.code}${p.zone.label ? `, ${p.zone.label}` : ""}${p.zone.bylaw ? ` (${p.zone.bylaw})` : ""}` : null],
    ["Lot area", p?.lotAreaM2 ? `${p.lotAreaM2.toLocaleString("en-CA")} m² (public records)` : null],
    ["Existing house", p?.building ? `${p.building.storeys ?? "?"} storey${p.building.storeys === 1 ? "" : "s"}, footprint about ${p.building.footprintM2 ?? "?"} m²` : null],
  ];
  let ry = y;
  for (const [label, value] of rows) {
    s.text(label.toUpperCase(), a.x + 10, ry, { size: 6.5, color: MUTED, font: s.fonts.bold });
    ry = s.wrap(value ?? "To fill in", a.x + 120, ry, colW - 120, { size: 9, color: value ? INK : MUTED }) - 5;
  }
  // Scope and areas.
  ry -= 8;
  s.text("SCOPE OF WORK", a.x + 10, ry, { size: 6.5, color: MUTED, font: s.fonts.bold });
  ry = s.wrap(scopeOfWork(ctx), a.x + 120, ry, colW - 120, { size: 9 }) - 8;
  const suite = suiteArea(ctx);
  const facts: [string, string][] = [
    ["Units after the work", "2 (the house and the basement unit)"],
    ["New unit's floor area", suite ? `${area(suite)}, estimated` : "To measure"],
    ["Finished ceiling in the unit", ctx.geo?.ceilingM ? `about ${both(ctx.geo.ceilingM)}${ctx.state.tape?.ceilingMm ? " (taped)" : " (from the scan)"}` : "To measure (1.95 m minimum)"],
    ["Building Code", "O. Reg. 163/24 (2024 Building Code), Part 9 and Part 11 for the existing house"],
  ];
  for (const [label, value] of facts) {
    s.text(label.toUpperCase(), a.x + 10, ry, { size: 6.5, color: MUTED, font: s.fonts.bold });
    ry = s.wrap(value, a.x + 120, ry, colW - 120, { size: 9 }) - 5;
  }
  ry -= 10;
  s.text("DRAWINGS", a.x + 10, ry, { size: 6.5, color: MUTED, font: s.fonts.bold });
  for (const it of ctx.project.sheets) {
    s.text(`${it.number}`, a.x + 120, ry, { size: 9, font: s.fonts.bold });
    s.text(it.title, a.x + 145, ry, { size: 9 });
    ry -= 13;
  }
  // Key plan: the lot and the house, the unit's floor marked.
  const kx = a.x + colW + 40, kw = colW - 10, kh = 300, ky = y - kh + 10;
  s.text("KEY PLAN", kx, y + 4, { size: 6.5, color: MUTED, font: s.fonts.bold });
  s.rect(kx, ky, kw, kh, { color: FAINT, width: 0.5 });
  if (ctx.site?.parcel || ctx.site?.footprint) {
    const pts = [...(ctx.site.parcel ?? []), ...(ctx.site.footprint ?? [])];
    const minX = Math.min(...pts.map((q) => q[0])), maxX = Math.max(...pts.map((q) => q[0]));
    const minY = Math.min(...pts.map((q) => q[1])), maxY = Math.max(...pts.map((q) => q[1]));
    const k = Math.min((kw - 40) / (maxX - minX || 1), (kh - 40) / (maxY - minY || 1));
    const X = (x: number) => kx + 20 + (x - minX) * k + ((kw - 40) - (maxX - minX) * k) / 2;
    const Y = (yy: number) => ky + 20 + (yy - minY) * k + ((kh - 40) - (maxY - minY) * k) / 2;
    if (ctx.site.parcel) s.poly(ctx.site.parcel.map(([x, yy]) => [X(x), Y(yy)]), { width: 0.8, dash: [6, 3] });
    if (ctx.site.footprint) s.poly(ctx.site.footprint.map(([x, yy]) => [X(x), Y(yy)]), { fill: TONE, width: 1.2 });
    const c = ctx.site.footprint ?? ctx.site.parcel!;
    const cx = c.reduce((t, q) => t + q[0], 0) / c.length, cy = c.reduce((t, q) => t + q[1], 0) / c.length;
    s.text("BASEMENT UNIT IN THIS HOUSE", X(cx), Y(cy) - 3, { size: 6.5, font: s.fonts.bold, align: "center" });
    s.northArrow(kx + kw - 24, ky + kh - 28, 12);
  } else s.wrap("No open public data outlines this house. Sketch the lot and the house here from your survey or deed.", kx + 14, ky + kh / 2, kw - 28, { size: 9, color: MUTED });
  // Who drew it.
  const sy = ky - 30;
  s.text("WHO PREPARED THESE DRAWINGS", kx, sy, { size: 6.5, color: MUTED, font: s.fonts.bold });
  const who = ctx.permit?.signerNote ?? "A design brief, for a BCIN designer to check, finish and sign before it's submitted.";
  s.wrap(who, kx, sy - 12, kw, { size: 8.5 });
  const notes = [DRAFT, scopeOfWork(ctx), who];
  return { number: "A0", title: "Cover and key plan", notes };
}

// ---- A1 Site plan ----------------------------------------------------------------------------

const KIND = { entrance: "Entrance", parking: "Parking", walkway: "Walkway" } as const;

export function sitePlan(ctx: SheetCtx): Printed {
  const { s, area: a } = newSheet(ctx, "A1", "Site plan", null);
  const notes: string[] = [];
  const site = ctx.site;
  const features = ctx.state.site?.features ?? [];
  if (!site || (!site.parcel && !site.footprint)) {
    s.wrap("The lot's outline isn't in the public data we can use for this address. Draw the lot lines, the house, the driveway with its parking spaces, the walkway to the unit's entrance, and the window wells, with distances to the lot lines.", a.x + 20, a.y + a.h - 40, a.w - 40, { size: 11 });
    notes.push("Site plan to draw by hand");
    return { number: "A1", title: "Site plan", notes };
  }
  // Traced points live on the aerial photo (0..1); turn them into metres around the address point.
  const toM = ([u, v]: [number, number]): [number, number] => [(u - 0.5) * 2 * site.aerial.halfWidthM, (0.5 - v) * 2 * site.aerial.halfHeightM];
  const traced = features.map((f) => ({ ...f, pts: f.points.map(toM) }));
  const pts = [...(site.parcel ?? []), ...(site.footprint ?? []), ...site.others.flat(), ...traced.flatMap((f) => f.pts)];
  const minX = Math.min(...pts.map((q) => q[0])), maxX = Math.max(...pts.map((q) => q[0]));
  const minY = Math.min(...pts.map((q) => q[1])), maxY = Math.max(...pts.map((q) => q[1]));
  const legendH = 110;
  const scale = fitScale(SITE_SCALES, maxX - minX, maxY - minY, a.w - 140, a.h - legendH - 90);
  const k = ptPerMetre(scale.ratio);
  const ox = a.x + 70 + (a.w - 140 - (maxX - minX) * k) / 2, oy = a.y + legendH + 40 + (a.h - legendH - 90 - (maxY - minY) * k) / 2;
  const X = (x: number) => ox + (x - minX) * k, Y = (y: number) => oy + (y - minY) * k;

  if (site.parcel) {
    s.poly(site.parcel.map(([x, y]) => [X(x), Y(y)]), { width: 1.2, dash: [10, 3, 2, 3] });
    // Each lot line's length.
    const r = site.parcel;
    for (let i = 0; i < r.length; i++) {
      const p0 = r[i], p1 = r[(i + 1) % r.length];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (len < 5) continue;
      s.dim(X(p0[0]), Y(p0[1]), X(p1[0]), Y(p1[1]), both(len), -14, 6.5);
    }
  }
  for (const o of site.others) s.poly(o.map(([x, y]) => [X(x), Y(y)]), { width: 0.8, fill: PAPER });
  if (site.footprint) {
    s.poly(site.footprint.map(([x, y]) => [X(x), Y(y)]), { width: 1.6, fill: TONE });
    const f = site.footprint;
    const cx = f.reduce((t, q) => t + q[0], 0) / f.length, cy = f.reduce((t, q) => t + q[1], 0) / f.length;
    const storeys = ctx.result?.property?.building?.storeys;
    s.text("EXISTING HOUSE", X(cx), Y(cy) + 6, { size: 8, font: s.fonts.bold, align: "center" });
    s.text(`${storeys ? `${storeys} storey${storeys === 1 ? "" : "s"}, ` : ""}new unit in the basement`, X(cx), Y(cy) - 4, { size: 6.5, align: "center" });
    // Distance from the house to each long lot line.
    if (site.parcel) {
      const r = site.parcel;
      const edges = r.map((p0, i) => ({ p0, p1: r[(i + 1) % r.length], len: Math.hypot(r[(i + 1) % r.length][0] - p0[0], r[(i + 1) % r.length][1] - p0[1]) })).filter((e) => e.len > 6);
      for (const e of edges) {
        const ex = e.p1[0] - e.p0[0], ey = e.p1[1] - e.p0[1];
        // The nearest point of the house measured square to this lot line (not past its ends).
        let best = { d: Infinity, at: f[0], foot: e.p0 as [number, number] };
        for (const q of f) {
          const t = ((q[0] - e.p0[0]) * ex + (q[1] - e.p0[1]) * ey) / (e.len * e.len);
          if (t <= 0.02 || t >= 0.98) continue;
          const foot: [number, number] = [e.p0[0] + t * ex, e.p0[1] + t * ey];
          const d = Math.hypot(q[0] - foot[0], q[1] - foot[1]);
          if (d < best.d) best = { d, at: q, foot };
        }
        if (best.d > 0.5 && best.d < 60) {
          s.line(X(best.at[0]), Y(best.at[1]), X(best.foot[0]), Y(best.foot[1]), { width: 0.5, color: MUTED, dash: [2, 2] });
          s.text(both(best.d), (X(best.at[0]) + X(best.foot[0])) / 2 + 3, (Y(best.at[1]) + Y(best.foot[1])) / 2 + 2, { size: 6, color: MUTED });
        }
      }
    }
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
      s.text(f.label || "ENTRANCE TO UNIT", x + 9, y - 3, { size: 6.5, font: s.fonts.bold });
    }
  }
  s.northArrow(a.x + a.w - 40, a.y + a.h - 40);
  s.scaleBar(a.x + 20, a.y + a.h - 30, k, scale.label);
  stampScale(s, scale.label);
  // Legend and notes.
  const parking = features.filter((f) => f.kind === "parking").length;
  const lines = [
    site.parcel
      ? `Lot lines and the house outline from public GIS data (${site.sources.join("; ")}). Not a survey: distances are approximate.`
      : `House outline from public GIS data (${site.sources.join("; ")}). No open parcel data covers this lot: draw the lot lines and their distances from your survey or deed. Not a survey.`,
    features.length ? `Entrances, parking and walkway traced by the owner on the Region of Waterloo's ${AERIAL_YEAR} aerial photo (open data).` : "Mark the entrance to the unit, the parking spaces and the walkway on the aerial photo in the workspace.",
    parking ? `${parking} parking area${parking === 1 ? "" : "s"} shown. Check the number of spaces your zone requires (see your result's zoning check).` : "Show the parking spaces required by zoning.",
    "Show any window wells and the escape window on the house wall when they're new (see A5).",
  ];
  let ny = a.y + legendH - 12;
  s.line(a.x, a.y + legendH, a.x + a.w, a.y + legendH, { width: 0.5, color: FAINT });
  lines.forEach((t, i) => {
    ny = s.wrap(`${i + 1}. ${t}`, a.x + 4, ny, a.w - 8, { size: 7, leading: 9 });
  });
  notes.push(...lines);
  return { number: "A1", title: "Site plan", notes };
}

// ---- A2/A3 Floor plans -----------------------------------------------------------------------

export function floorPlan(ctx: SheetCtx, mode: "existing" | "proposed"): Printed {
  const number = mode === "existing" ? "A2" : "A3";
  const title = mode === "existing" ? "Existing basement plan" : "Proposed basement plan";
  const { s, area: a } = newSheet(ctx, number, title, null);
  if (!ctx.geo) {
    s.wrap("We couldn't measure this video, so there's no plan to draw here. Measure the basement with a tape, or ask your designer to.", a.x + 20, a.y + a.h - 40, a.w - 40, { size: 11 });
    return { number, title, notes: [] };
  }
  const label = drawPlan(s, a, ctx.geo, mode);
  stampScale(s, label);
  const notes = mode === "proposed" ? ["fire separation", "Smoke and CO alarms", ...ctx.geo.alarms.map((x) => x.why)] : ["Existing basement as filmed and measured"];
  return { number, title, notes };
}

// ---- A4 Section ------------------------------------------------------------------------------

export function crossSection(ctx: SheetCtx): Printed {
  const { s, area: a } = newSheet(ctx, "A4", "Cross-section", null);
  const g = ctx.geo;
  const ceiling = g?.ceilingM ?? null;
  const beam = g?.beamM ?? null;
  const k = 150; // points per metre, schematic
  const fin = (ceiling ?? 2.1);
  const left = a.x + 170, base = a.y + 170, width = 3.6 * k;
  const Yh = (m: number) => base + m * k;
  // Slab and foundation wall.
  s.rect(left - 50, base - 18, width + 70, 18, { fill: TONE2, width: 0.6 });
  s.text("CONCRETE FLOOR SLAB (EXISTING)", left + width / 2, base - 12, { size: 6.5, align: "center" });
  s.rect(left - 50, base - 18, 34, (fin + 0.45) * k + 18, { fill: TONE2, width: 0.6 });
  s.text("FOUNDATION WALL (EXISTING)", left - 58, base + 0.15 * k, { size: 6.5, rotate: 90 });
  // Floor joists of the house above, sitting on the wall.
  const joist = Yh(fin + 0.02);
  s.rect(left - 16, joist, width + 36, 0.24 * k, { width: 0.6 });
  for (let i = 0; i <= 9; i++) s.line(left + i * 0.4 * k, joist, left + i * 0.4 * k, joist + 0.24 * k, { width: 0.4, color: MUTED });
  s.text("EXISTING FLOOR JOISTS OF THE HOUSE ABOVE, SOUND BATTS BETWEEN (A6)", left + width / 2, joist + 0.24 * k + 8, { size: 6.5, align: "center" });
  // Finished ceiling: the fire separation.
  s.rect(left - 16, Yh(fin) - 3, width + 36, 3, { fill: INK, stroke: false });
  s.wrap("SUITE CEILING: 15.9 mm (5/8\") TYPE X GYPSUM BOARD ON RESILIENT CHANNEL, JOINTS TAPED AND SEALED: SMOKE-TIGHT FIRE SEPARATION (A6, NOTE 3)", left + width + 30, Yh(fin) + 4, a.x + a.w - (left + width + 30) - 8, { size: 6.5, leading: 8 });
  // Stud wall along the foundation.
  s.rect(left - 16, base, 0.09 * k, Yh(fin) - 3 - base, { width: 0.6, fill: PAPER });
  s.text("2x4 STUD WALL, INSULATION, VAPOUR BARRIER, DRYWALL", left - 2, base + 0.15 * k, { size: 6.5, rotate: 90 });
  // A beam or duct drop.
  const drop = Yh(beam ?? Math.max(1.85, fin - 0.2));
  const bx = left + 2.3 * k;
  s.rect(bx, drop, 0.3 * k, Yh(fin) - 3 - drop, { width: 0.8, fill: TONE2 });
  s.text("BEAM / DUCT", bx + 0.15 * k, drop + (Yh(fin) - drop) / 2 - 3, { size: 6, align: "center" });
  s.dim(bx + 0.42 * k, base, bx + 0.42 * k, drop, beam != null ? `${both(beam)} clear${beam < 1.85 ? ": BELOW 1.85 m, confirm and fix" : ""}` : "Measure: 1.85 m min.", -14);
  s.dim(left + 1.0 * k, base, left + 1.0 * k, Yh(fin) - 3, ceiling != null ? `${both(ceiling)} finished${ceiling < 1.95 ? ": BELOW 1.95 m" : ""}` : "Measure: 1.95 m min.", -14);
  // Window in the foundation, and grade.
  const sill = ctx.state.tape?.egressSillMm ? ctx.state.tape.egressSillMm / 1000 : null;
  const wh = (ctx.state.tape?.egressHeightMm ?? 600) / 1000;
  const wy = Yh(sill ?? Math.max(0.9, fin - wh - 0.15));
  s.rect(left - 50, wy, 34, wh * k, { fill: PAPER, width: 0.8 });
  s.line(left - 50, wy + (wh * k) / 2, left - 16, wy + (wh * k) / 2, { width: 0.4 });
  const grade = Yh(fin - 0.1);
  s.line(left - 150, grade, left - 50, grade, { width: 1 });
  s.text("APPROX. GRADE", left - 148, grade + 4, { size: 6, color: MUTED });
  s.text("WINDOW (A5)", left - 56, wy + wh * k + 6, { size: 6, align: "right" });
  s.dim(left - 50, base, left - 50, wy, sill != null ? `sill ${both(sill)}` : "sill: measure", 40);
  const notes = [
    "Finished ceiling height in the unit at least 1.95 m over the required area (Building Code 9.5.3.1.(2)).",
    "Clear height under beams and ducts at least 1.85 m (9.5.3.1.(3)).",
    "Section is schematic: heights are from the scan or the owner's tape as labelled.",
  ];
  let ny = a.y + 120;
  for (const [i, t] of notes.entries()) ny = s.wrap(`${i + 1}. ${t}`, a.x + 4, ny, a.w - 8, { size: 7.5, leading: 10 });
  return { number: "A4", title: "Cross-section", notes };
}

// ---- A5 Escape window -------------------------------------------------------------------------

export function egressDetail(ctx: SheetCtx): Printed {
  const { s, area: a } = newSheet(ctx, "A5", "Bedroom escape window", null);
  const tape = ctx.state.tape ?? {};
  const widthMm = tape.egressWidthMm ?? (ctx.geo?.egress?.existing ? Math.round((ctx.geo.egress.widthM ?? 0) * 1000) : null);
  const heightMm = tape.egressHeightMm ?? null;
  const sillMm = tape.egressSillMm ?? null;
  const areaM2 = widthMm && heightMm ? (widthMm * heightMm) / 1e6 : null;
  const k = 0.24; // points per mm, schematic
  const floor = a.y + 190;
  const sill = (sillMm ?? 1100) * k, w = (widthMm ?? 600) * k, h = (heightMm ?? 600) * k;
  // Elevation from inside the bedroom.
  const ex = a.x + 90;
  s.text("ELEVATION FROM INSIDE THE BEDROOM", ex, floor + sill + h + 56, { size: 7, font: s.fonts.bold });
  s.line(ex - 40, floor, ex + w + 60, floor, { width: 1 });
  s.text("FINISHED FLOOR", ex - 40, floor - 10, { size: 6.5, color: MUTED });
  s.rect(ex, floor + sill, w, h, { width: 1.4 });
  s.rect(ex + 5, floor + sill + 5, w - 10, h - 10, { width: 0.5, color: MUTED });
  s.dim(ex, floor + sill + h, ex + w, floor + sill + h, widthMm ? `${mmBoth(widthMm)} clear (${tape.egressWidthMm ? "taped" : "from the scan"})` : "Clear width: measure", 16);
  s.dim(ex + w, floor + sill + h, ex + w, floor + sill, heightMm ? `${mmBoth(heightMm)} clear` : "Clear height: measure", 16);
  s.dim(ex - 14, floor, ex - 14, floor + sill, sillMm ? `sill ${mmBoth(sillMm)}` : "Sill height: measure", 14);
  // Section through the wall and the well.
  const sx = a.x + 430;
  const grade = floor + sill + h + 40;
  s.text("SECTION THROUGH THE WINDOW WELL", sx, floor + sill + h + 56, { size: 7, font: s.fonts.bold });
  s.rect(sx, floor - 20, 36, grade - floor + 40, { fill: TONE2, width: 0.6 });
  s.rect(sx, floor + sill, 36, h, { fill: PAPER, width: 1 });
  const wellFloor = floor + sill - 40;
  const wellX = sx + 36 + 550 * k;
  s.rect(sx + 36, wellFloor - 14, 550 * k + 10, 14, { fill: TONE2, width: 0.5 });
  s.text("DRAINED GRAVEL", sx + 40, wellFloor - 24, { size: 6, color: MUTED });
  s.line(wellX, wellFloor - 14, wellX, grade + 6, { width: 1.4 });
  s.line(wellX, grade, wellX + 80, grade, { width: 1 });
  s.text("GRADE", wellX + 6, grade + 4, { size: 6, color: MUTED });
  s.dim(sx + 36, floor + sill + h / 2, wellX, floor + sill + h / 2, "550 mm (1'-10\") min. clear", 12);
  // The checks.
  const checks: [string, string, boolean | null][] = [
    ["Clear opening area", areaM2 != null ? `${areaM2.toFixed(2)} m² (needs 0.35 m²)` : "Width x height: measure both", areaM2 == null ? null : areaM2 >= 0.35],
    ["Smallest side", widthMm && heightMm ? `${Math.min(widthMm, heightMm)} mm (needs 380 mm)` : "Measure: no side under 380 mm", widthMm && heightMm ? Math.min(widthMm, heightMm) >= 380 : null],
    ["Opens without tools or keys", "Casement or slider that opens fully from inside and stays open", null],
    ["Window well", "550 mm clear in front of the window; a cover opens from inside", null],
    ["Sill height", sillMm ? `${sillMm} mm above the floor (Kitchener advises 1.5 m or less)` : "Measure the sill height", sillMm ? sillMm <= 1500 : null],
    ["Foundation cut", "Over 1.2 m wide: an engineer designs the opening and lintel (A7)", null],
  ];
  let cy = a.y + a.h - 30;
  const cx = a.x + a.w - 330;
  s.text("WHAT THE CODE ASKS (Building Code 9.9.10.1, 9.15.4.3)", cx, cy, { size: 7.5, font: s.fonts.bold });
  cy -= 16;
  for (const [label, value, ok] of checks) {
    s.rect(cx, cy - 3, 8, 8, { width: 0.6, fill: ok === false ? TONE2 : PAPER });
    if (ok === true) s.text("X", cx + 4, cy - 1.5, { size: 6, align: "center", font: s.fonts.bold });
    s.text(label, cx + 14, cy, { size: 7.5, font: s.fonts.bold });
    cy = s.wrap(value, cx + 14, cy - 10, 300, { size: 7.5, color: MUTED }) - 6;
  }
  const newCut = ctx.geo?.egress && !ctx.geo.egress.existing;
  const notes = [
    "Each floor level with a bedroom has a window that opens from inside without tools, with an unobstructed opening of at least 0.35 m² and no dimension under 380 mm (Building Code 9.9.10.1.(1)).",
    "A window well in front of it leaves at least 550 mm clear in front of the window (9.9.10.1.(3)).",
    newCut
      ? "NEW OPENING IN THE FOUNDATION WALL: an engineer designs the opening and its lintel when it's wider than 1.2 m (9.15.4.3.(3)); attach their drawing or letter (A7). Concrete cutting by a contractor."
      : "Existing opening: if it's enlarged past 1.2 m wide or cut lower, an engineer designs the opening and its lintel (A7).",
  ];
  let ny = a.y + 120;
  for (const [i, t] of notes.entries()) ny = s.wrap(`${i + 1}. ${t}`, a.x + 4, ny, a.w - 8, { size: 7.5, leading: 10 });
  return { number: "A5", title: "Bedroom escape window", notes };
}

// ---- A6 Notes --------------------------------------------------------------------------------

export function generalNotes(ctx: SheetCtx): Printed {
  const { s, area: a } = newSheet(ctx, "A6", "General notes and specifications", null);
  const applies = (n: Note) => !n.when || n.when === "always" || (n.when === "fuel_burning" && ctx.geo?.fuelBurning) || (n.when === "egress_new" && ctx.geo?.egress && !ctx.geo.egress.existing);
  const notes = ctx.diy.notes.filter(applies);
  const colW = (a.w - 40) / 3;
  let col = 0, y = a.y + a.h - 20;
  const printed: string[] = [];
  notes.forEach((n, i) => {
    const body = `${i + 1}. ${n.title.toUpperCase()}: ${n.text}`;
    const cite = `${n.source.section ? `${n.source.section}, ` : ""}${n.source.title}`;
    const need = s.measure(body, colW - 10, 7.2, s.fonts.regular, 9) + s.measure(cite, colW - 10, 6, s.fonts.regular, 7.4) + 10;
    if (y - need < a.y + 10) {
      col++;
      y = a.y + a.h - 20;
    }
    const x = a.x + 10 + col * (colW + 10);
    y = s.wrap(body, x, y, colW - 10, { size: 7.2, leading: 9 });
    y = s.wrap(cite, x, y, colW - 10, { size: 6, leading: 7.4, color: MUTED }) - 8;
    printed.push(`${n.title}: ${n.text}`);
  });
  return { number: "A6", title: "General notes and specifications", notes: printed };
}

// ---- A7 Needs a pro ----------------------------------------------------------------------------

export function needsPro(ctx: SheetCtx, separateHeating: boolean): Printed {
  const { s, area: a } = newSheet(ctx, "A7", "Work that needs a licensed pro", null);
  const egressCut = Boolean(ctx.geo?.egress && !ctx.geo.egress.existing);
  const applies = (when: string) => when === "always" || (when === "egress_cut" && egressCut) || (when === "separate_heating" && separateHeating);
  let y = a.y + a.h - 24;
  s.wrap("These parts of the work can't be drawn or done by the owner alone. Attach each pro's drawings, calculations or letter to the permit application where noted.", a.x + 10, y, a.w - 20, { size: 9.5 });
  y -= 34;
  const printed: string[] = [];
  for (const item of ctx.diy.needsPro) {
    const live = applies(item.when);
    const head = `${item.title}${live ? "" : " (only if you do this)"}`;
    s.rect(a.x + 10, y - 2, 6, 6, { fill: live ? INK : PAPER, width: 0.6 });
    s.text(head, a.x + 24, y - 1, { size: 9, font: s.fonts.bold, color: live ? INK : MUTED });
    s.text(`Who: ${item.who}`, a.x + a.w / 2, y - 1, { size: 8, color: MUTED });
    y = s.wrap(item.detail, a.x + 24, y - 13, a.w - 40, { size: 8 });
    y = s.wrap(`${item.source.section ? `${item.source.section}, ` : ""}${item.source.title}${item.registry ? ` · Find one: ${item.registry.url}` : ""}`, a.x + 24, y, a.w - 40, { size: 6.5, color: MUTED }) - 10;
    printed.push(item.title);
  }
  return { number: "A7", title: "Work that needs a licensed pro", notes: printed };
}
