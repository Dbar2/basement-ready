// The permit set, in three copies. The review copy is the owner's: a Draft watermark on every sheet
// and the list of what's left on the cover. The submit copy is what goes to the City: no watermark,
// nothing left to fill, no app name, and it's only made once nothing is left. The share copy is the
// drawings alone, for a designer or builder: no forms, no contact details.
import { PDFDocument, rgb } from "pdf-lib";
import { permitFee } from "../steps";
import { packFor } from "../rules";
import type { SiteGeometry } from "../property";
import type { Profile, StoredState } from "../workspace";
import { cityPermit, DEMO_ADDRESS, type CityForm } from "./data";
import { designerNeed, type DesignerNeed, quartsFilters } from "./designer";
import { FIELD_MAPS, fetchOfficialPdf, fillAcroForm, permitRows, summarySheet, type FormValues } from "./forms";
import { suiteAreaM2 } from "../model/suite";
import { permitModel, type PermitModel, unitRooms } from "./model";
import { embedFonts, type Fonts, INK, LETTER, MUTED, newDoc, type Project, Sheet, type Signer } from "./pdf";
import { asksWaterMeter, fingerprint, readiness, type Readiness } from "./readiness";
import { basementPlan, ceilingPlan, coverSheet, details, elevations, finishSheets, mainFloor, notesSheet, type Printed, scopeOfWork, type SheetCtx, SHEETS, sitePlan } from "./sheets";

// Today in Ontario, as the forms want it: YYYY-MM-DD.
export const localDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

export type Copy = "review" | "submit" | "share";

export type PackageInput = {
  result: any;
  municipality: string;
  address: string;
  profile: Profile | null;
  state: StoredState;
  site: SiteGeometry | null;
  aerialJpeg: Buffer | null;
  favourites: { title: string; jpeg: Buffer }[];
  copy?: Copy;
  share?: boolean; // the same as copy "share"
  today?: string;
  fetchPdf?: (url: string) => Promise<Uint8Array | null>; // tests pass their own
};

export type FormOutcome = { id: string; title: string; status: "filled" | "summary" | "unavailable"; set: string[] };
export type PackageOut = { bytes: Uint8Array; sheets: Printed[]; forms: FormOutcome[]; pages: number; signer: "owner" | "brief"; readiness: Readiness; copy: Copy };

// The submit copy asked for while things are still left.
export class NotReady extends Error {
  constructor(public left: number) {
    super(`${left} thing${left === 1 ? "" : "s"} left before you can submit.`);
  }
}

// Who draws and signs: the owner under the Code's exemption only where the city accepts owner-drawn
// plans (its pack says signer "owner"), nothing needs a designer, and the owner hasn't picked one.
export function formPlace(municipality: string, state: StoredState, need?: DesignerNeed) {
  const { authority, permit } = cityPermit(municipality);
  const ownerDraws = state.permit?.signer !== "designer" && permit?.signer === "owner" && !need?.needed;
  return { authority, signer: (ownerDraws ? "owner" : "brief") as "owner" | "brief", ownerDraws };
}

// Everything the Permit tab shows and the PDF prints about where the set stands.
export function permitStatus(input: Pick<PackageInput, "result" | "municipality" | "state" | "profile">) {
  const { result, state, profile } = input;
  const model = permitModel(result, state);
  const { city, permit } = cityPermit(input.municipality);
  const need = designerNeed({ municipality: input.municipality, citySigner: permit?.signer ?? "brief", unitsNow: Math.max(1, result?.property?.unitsRegistered ?? 1), structural: Boolean(model?.windows.some((w) => w.change !== "keep")) });
  if (permit?.signer !== "owner" && need.reasons.length === 1 && need.reasons[0].startsWith("This city")) need.reasons[0] = `We haven't confirmed that ${city === "Ontario" ? "your city" : city} accepts drawings by the homeowner, so a BCIN designer signs them.`;
  const place = formPlace(input.municipality, state, need);
  const d = state.permit?.designer ?? {};
  const signer: Signer = place.ownerDraws ? { kind: "owner" } : { kind: "designer", name: d.name ?? null, bcin: d.bcin ?? null, firm: d.firm ?? null, firmBcin: d.firmBcin ?? null };
  const { reviewed: _r, submittedAt: _s, permitNumber: _n, ...permitInputs } = state.permit ?? {};
  // What the drawings show: a sheet looked over goes back on the list when this changes.
  const reviewKey = fingerprint({ existing: model?.existing, proposed: model?.design.proposed, windows: model?.windows, tape: state.tape, permit: permitInputs, site: state.site, signer });
  const overhead = Boolean(model?.design.proposed.fixtures.some((f) => f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead"));
  const ready = readiness({
    mainWalls: model?.mainWalls ?? [],
    windows: model?.windows ?? [],
    heights: { ceilingMm: state.tape?.ceilingMm ?? null, beamMm: state.tape?.beamMm ?? null, overhead },
    profile,
    upstairs: state.permit?.upstairs ?? null,
    lotLines: state.permit?.lotLines ?? [],
    waterMeter: asksWaterMeter(input.municipality) ? (state.permit?.waterMeter ?? {}) : null,
    sheets: SHEETS,
    reviewed: state.permit?.reviewed ?? [],
    reviewKey,
    designer: { needed: need.needed, chosen: !place.ownerDraws, reasons: need.reasons, name: d.name ?? null, bcin: d.bcin ?? null },
    checks: designChecks(model, result),
  });
  return { model, city, permit, need, place, signer, reviewKey, readiness: ready, quarts: quartsFilters(need, city), sheets: SHEETS };
}

// What the design itself still gets wrong: the layout's failed checks, an escape window on an
// outside wall, and the heights once they're taped. The studio's own checks (server/model/checks.ts)
// join these when its model is the one drawn.
export function designChecks(model: PermitModel | null, result: any) {
  if (!model) return [];
  const out: { id: string; label: string; detail: string; ok: boolean | null }[] = [];
  if (model.from === "scan")
    for (const [i, c] of ((result?.layout?.checks ?? []) as { label: string; ok: boolean | null; detail: string }[]).entries()) {
      if (/escape window/i.test(c.label)) continue;
      out.push({ id: `layout${i + 1}`, label: `Design: ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}`, detail: `${c.detail} Change it in your design.`, ok: c.ok });
    }
  const bedroom = unitRooms(model).some((r) => r.kind === "bedroom");
  if (bedroom) out.push({ id: "escape", label: "Design: the bedroom has an escape window in an outside wall", detail: "There's no outside wall beside the bedroom for one. Move the bedroom in your design.", ok: model.windows.some((w) => w.escape) });
  if (model.ceilingM != null && !model.estimated) out.push({ id: "ceiling", label: "Design: ceiling at least 1.95 m", detail: `Taped at ${model.ceilingM.toFixed(2)} m. Lower the floor or raise the ceiling.`, ok: model.ceilingM >= 1.95 });
  if (model.beamM != null && !model.estimated) out.push({ id: "beam", label: "Design: at least 1.85 m under beams and ducts", detail: `${model.beamM.toFixed(2)} m under the lowest. Move the duct or lower the floor.`, ok: model.beamM >= 1.85 });
  return out;
}

export function formValues(
  input: Pick<PackageInput, "profile" | "address" | "result" | "site" | "state">,
  municipality: string,
  scope: string,
  areaM2: number | null,
  bedrooms: number,
  today: string,
  place: { authority: string; ownerDraws: boolean } = { authority: `City of ${municipality}`, ownerDraws: false },
): FormValues {
  const cost = input.result?.cost;
  const p = input.profile;
  const names = p?.owners.map((o) => `${o.first} ${o.last}`.trim()).filter(Boolean) ?? [];
  return {
    ownerNames: names.join(" and "),
    owners: p?.owners ?? [],
    phone: p?.phone ?? "",
    email: p?.email ?? "",
    street: input.result?.demo ? DEMO_ADDRESS : input.address,
    municipality,
    postalCode: p?.postalCode ?? "",
    mailing: p?.mailingAddress || null,
    legal: p?.legalDescription || null,
    pin: p?.pin || null,
    roll: p?.rollNumber || null,
    date: today,
    permitNumber: input.state.permit?.permitNumber ?? null,
    scope,
    areaM2,
    bedrooms,
    city: place.authority === "your municipality" ? "" : place.authority,
    valueCAD: cost?.low != null && cost?.high != null ? Math.round((cost.low + cost.high) / 2 / 1000) * 1000 : null,
    ownerBuilds: input.state.build?.path === "diy" || input.state.build?.path === "mix",
    ownerDraws: place.ownerDraws,
  };
}

// Which of the city's forms this project needs.
export function formsNeeded(forms: CityForm[], o: { ownerDraws: boolean; ownerBuilds: boolean }) {
  return forms.filter((f) => f.required === "always" || (f.required === "owner_designer" && o.ownerDraws) || (f.required === "designer" && !o.ownerDraws) || (f.required === "owner_builder" && o.ownerBuilds) || f.required === "if_asked");
}

// A studio's sleeping area isn't a bedroom on the forms.
export const bedroomsOf = (m: PermitModel | null) => (!m ? 1 : m.design.layout === "studio" ? 0 : unitRooms(m).filter((r) => r.kind === "bedroom").length);

export async function buildPermitPackage(input: PackageInput): Promise<PackageOut> {
  const copy: Copy = input.copy ?? (input.share ? "share" : "review");
  const today = input.today ?? localDate();
  const status = permitStatus(input);
  if (copy === "submit" && status.readiness.left > 0) throw new NotReady(status.readiness.left);
  const { authority, permit } = cityPermit(input.municipality);
  const demo = Boolean(input.result?.demo);
  const address = demo ? DEMO_ADDRESS : input.address || input.result?.property?.address || "";
  const doc = await newDoc(`Permit drawings: ${address}`, copy !== "submit");
  const fonts = await embedFonts(doc);
  const model = status.model;
  const project: Project = {
    address,
    municipality: input.result?.property?.municipality ?? status.city,
    copy: copy === "submit" ? "submit" : "review",
    left: status.readiness.left,
    estimated: Boolean(model?.estimated),
    signer: status.signer,
    date: today,
    revision: { no: "0", date: today, text: copy === "submit" ? "Issued for permit" : "Draft for review" },
    sheets: SHEETS,
  };
  const ctx: SheetCtx = {
    doc,
    fonts,
    project,
    result: input.result,
    model,
    site: input.site,
    state: input.state,
    profile: copy === "share" ? null : input.profile,
    permit,
    municipality: input.municipality,
    readiness: status.readiness,
    storeys: Math.max(1, input.result?.property?.building?.storeys ?? 1),
  };
  const sheets: Printed[] = [coverSheet(ctx), sitePlan(ctx), ...basementPlan(ctx), mainFloor(ctx), ...ceilingPlan(ctx), elevations(ctx), details(ctx), notesSheet(ctx)];
  finishSheets(ctx, sheets);

  // The forms, filled from the profile: Schedule 1 says "Homeowner" when the owner draws.
  const outcomes: FormOutcome[] = [];
  const areaM2 = suiteAreaM2(model?.design);
  const values = formValues(input, project.municipality, scopeOfWork(ctx), areaM2, bedroomsOf(model), today, status.place);
  if (copy !== "share" && permit) {
    const needed = formsNeeded(permit.forms, { ownerDraws: status.place.ownerDraws, ownerBuilds: input.state.build?.path !== "hire" });
    for (const form of needed) {
      const map = FIELD_MAPS[form.id];
      const bytes = form.fill === "acroform" && map && form.url ? await (input.fetchPdf ?? fetchOfficialPdf)(form.url) : null;
      if (bytes && map) {
        try {
          const filled = await fillAcroForm(bytes, map, values);
          const src = await PDFDocument.load(filled.bytes);
          for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page);
          outcomes.push({ id: form.id, title: form.title, status: "filled", set: Object.keys(filled.set) });
          continue;
        } catch {
          // A form that won't load falls back to the summary below.
        }
      }
      // A form we couldn't fill gets a page of answers to copy: the owner's help, not the City's, so
      // the submit copy leaves it out.
      if (copy !== "submit") await summarySheet(doc, form, permitRows(values), form.url ? "Copy these answers into the form's PDF, or into the online form." : "This form is filled in online or at the counter. Copy these answers into it.");
      outcomes.push({ id: form.id, title: form.title, status: form.url ? "unavailable" : "summary", set: [] });
    }
  }

  // The owner's pages: how to submit, and the look they picked. Not part of what the City gets.
  if (copy === "review") {
    await submitPage(doc, input, permit, authority, suiteAreaM2(model?.design));
    if (input.favourites.length) await lookPage(doc, input.favourites, input.state);
  }
  const bytes = await doc.save();
  return { bytes, sheets, forms: outcomes, pages: doc.getPageCount(), signer: status.place.signer, readiness: status.readiness, copy };
}

async function submitPage(doc: PDFDocument, input: PackageInput, permit: ReturnType<typeof cityPermit>["permit"], authority: string, suiteM2: number | null) {
  const fonts = await embedFonts(doc);
  const s = new Sheet(doc.addPage(LETTER), fonts);
  const { pack } = packFor(input.municipality);
  let y = s.height - 54;
  s.text("HOW TO SUBMIT", 48, y, { size: 8, color: MUTED, font: fonts.bold });
  y -= 24;
  y = s.wrap(authority === "your municipality" ? "Apply to your municipality's building department" : `Apply to the ${authority}`, 48, y, s.width - 96, { size: 18, font: fonts.bold, leading: 21 }) - 6;
  y = s.wrap("This is your review copy. When the Permit tab says nothing is left, download the submit copy: that's the one you upload.", 48, y, s.width - 96, { size: 10 }) - 8;
  if (!permit) {
    s.wrap("Ask the building department which forms and drawings it needs.", 48, y, s.width - 96, { size: 10 });
    return;
  }
  y = s.wrap(`${/^find/i.test(permit.portal.label) ? "" : "Online: "}${permit.portal.label}, ${permit.portal.url}`, 48, y, s.width - 96, { size: 10 }) - 10;
  s.text("WHAT TO UPLOAD", 48, y, { size: 8, color: MUTED, font: fonts.bold });
  y -= 14;
  for (const u of permit.upload) {
    s.text(u.what, 48, y, { size: 9.5, font: fonts.bold });
    y = s.wrap(u.where, 230, y, s.width - 278, { size: 9 }) - 6;
  }
  // On unit 2's floor, as the cover, the forms, Money and the book have it (server/model/suite.ts).
  const fee = permitFee(pack, suiteM2 ?? input.result?.plan?.areaM2 ?? null);
  if (fee) {
    y -= 6;
    s.text("FEE", 48, y, { size: 8, color: MUTED, font: fonts.bold });
    y -= 14;
    y = s.wrap(`${fee.amount ? `About $${fee.amount.toLocaleString("en-CA")}${fee.estimate ? " (estimate)" : ""}. ` : ""}${fee.note}`, 48, y, s.width - 96, { size: 9 }) - 4;
    if (fee.source) y = s.wrap(`Source: ${fee.source.title}, ${fee.source.url}`, 48, y, s.width - 96, { size: 7.5, color: MUTED }) - 8;
  }
  s.text("INSPECTIONS TO BOOK, IN ORDER", 48, y, { size: 8, color: MUTED, font: fonts.bold });
  y -= 14;
  permit.inspections.forEach((it, i) => {
    if (y < 80) return;
    y = s.wrap(`${i + 1}. ${it.title}: ${it.when}`, 48, y, s.width - 96, { size: 9 }) - 2;
  });
  s.wrap(`Source: ${permit.inspectionsSource.title}, ${permit.inspectionsSource.url}`, 48, Math.max(60, y - 8), s.width - 96, { size: 7.5, color: MUTED });
}

// `fonts`: the book passes its own brand fonts; the permit package uses the standard ones.
export async function lookPage(doc: PDFDocument, favourites: PackageInput["favourites"], state: StoredState, fonts?: Fonts) {
  fonts ??= await embedFonts(doc);
  const s = new Sheet(doc.addPage(LETTER), fonts);
  s.rect(0, 0, s.width, s.height, { fill: rgb(1, 1, 1), stroke: false });
  let y = s.height - 54;
  s.text("THE LOOK WE PICKED", 48, y, { size: 8, color: MUTED, font: fonts.bold });
  y -= 22;
  s.text("Proposed finishes, for reference", 48, y, { size: 16, font: fonts.bold });
  y -= 16;
  const finish = { light: "Light oak", warm: "Warm wood", deep: "Deep green" }[state.ideas?.finish ?? "light"];
  y = s.wrap(`Our own basement photos, virtually staged with Muse Image, and the ${finish} finish from the 3D. Not part of the permit review.`, 48, y, s.width - 96, { size: 9, color: MUTED }) - 10;
  const w = (s.width - 96 - 12) / 2;
  let col = 0;
  for (const f of favourites.slice(0, 4)) {
    try {
      const png = f.jpeg[0] === 0x89 && f.jpeg[1] === 0x50;
      const img = png ? await doc.embedPng(f.jpeg) : await doc.embedJpg(f.jpeg);
      const h = Math.min((img.height / img.width) * w, 300);
      const iw = (img.width / img.height) * h;
      const x = 48 + col * (w + 12);
      s.page.drawImage(img, { x, y: y - h, width: iw, height: h });
      s.text(f.title, x, y - h - 12, { size: 8.5, font: fonts.bold, color: INK });
      s.text("Virtually staged", x, y - h - 23, { size: 7, color: MUTED });
      col++;
      if (col === 2) {
        col = 0;
        y -= h + 40;
      }
    } catch {
      // Not an image pdf-lib reads: leave it out.
    }
  }
}

// The numbers every document shares, from the chosen design: unit 2's floor (server/model/suite.ts),
// its bedrooms and the scope of work. The permit set, its forms, the designer's brief and the grant
// applications all print these.
export function projectFacts(result: any, model: PermitModel | null) {
  return { areaM2: suiteAreaM2(model?.design), bedrooms: bedroomsOf(model), scope: scopeOfWork({ model, result }) };
}

// The values the forms route fills: the same as the package's.
export function formInputs(input: Pick<PackageInput, "result" | "municipality" | "state" | "profile">) {
  const status = permitStatus(input);
  return { status, ...projectFacts(input.result, status.model) };
}
