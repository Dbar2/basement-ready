// "Download permit package": one PDF with the drawings (A0–A7), the city's forms filled from the
// owner profile, a page on how and where to submit, and the look they picked. The share version
// (for builders and designers) leaves out the forms and the owner's contact details.
import { PDFDocument, rgb } from "pdf-lib";
import { permitFee } from "../steps";
import { packFor } from "../rules";
import type { SiteGeometry } from "../property";
import type { Profile, StoredState } from "../workspace";
import { cityPermit, ontarioDiy, type CityForm } from "./data";
import { FIELD_MAPS, fetchOfficialPdf, fillAcroForm, permitRows, summarySheet, type FormValues } from "./forms";
import { embedFonts, INK, LETTER, MUTED, newDoc, type Project, Sheet } from "./pdf";
import { basementGeometry } from "./plans";
import { coverSheet, crossSection, egressDetail, floorPlan, generalNotes, needsPro, type Printed, scopeOfWork, type SheetCtx, sitePlan } from "./sheets";

// Today in Waterloo Region, as the forms want it: YYYY-MM-DD.
export const localDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

export type PackageInput = {
  result: any;
  municipality: string;
  address: string;
  profile: Profile | null;
  state: StoredState;
  site: SiteGeometry | null;
  aerialJpeg: Buffer | null;
  favourites: { title: string; jpeg: Buffer }[];
  share: boolean; // drawings only, no forms or contact details
  today?: string;
  fetchPdf?: (url: string) => Promise<Uint8Array | null>; // tests pass their own
};

export type FormOutcome = { id: string; title: string; status: "filled" | "summary" | "unavailable"; set: string[] };
export type PackageOut = { bytes: Uint8Array; sheets: Printed[]; forms: FormOutcome[]; pages: number; signer: "owner" | "brief" };

const SHEETS = [
  { number: "A0", title: "Cover and key plan" },
  { number: "A1", title: "Site plan" },
  { number: "A2", title: "Existing basement plan" },
  { number: "A3", title: "Proposed basement plan" },
  { number: "A4", title: "Cross-section" },
  { number: "A5", title: "Bedroom escape window" },
  { number: "A6", title: "General notes" },
  { number: "A7", title: "Work that needs a pro" },
];

export function formValues(input: Pick<PackageInput, "profile" | "address" | "result" | "site" | "state">, municipality: string, scope: string, areaM2: number | null, bedrooms: number, today: string): FormValues {
  const cost = input.result?.cost;
  const p = input.profile;
  const names = p?.owners.map((o) => `${o.first} ${o.last}`.trim()).filter(Boolean) ?? [];
  return {
    ownerNames: names.join(" and "),
    owners: p?.owners ?? [],
    phone: p?.phone ?? "",
    email: p?.email ?? "",
    street: input.address,
    municipality,
    postalCode: p?.postalCode ?? "",
    mailing: p?.mailingAddress || null,
    legal: p?.legalDescription || input.site?.legalDescription || null,
    pin: p?.pin || input.site?.pin || null,
    roll: p?.rollNumber || input.site?.rollNumber || null,
    date: today,
    permitNumber: input.state.permit?.permitNumber ?? null,
    scope,
    areaM2,
    bedrooms,
    city: `City of ${municipality}`,
    valueCAD: cost?.low != null && cost?.high != null ? Math.round((cost.low + cost.high) / 2 / 1000) * 1000 : null,
    ownerBuilds: input.state.build?.path === "diy" || input.state.build?.path === "mix",
  };
}

// Which of the city's forms this project needs.
export function formsNeeded(forms: CityForm[], o: { ownerDraws: boolean; ownerBuilds: boolean }) {
  return forms.filter((f) => f.required === "always" || (f.required === "owner_designer" && o.ownerDraws) || (f.required === "designer" && !o.ownerDraws) || (f.required === "owner_builder" && o.ownerBuilds) || f.required === "if_asked");
}

export async function buildPermitPackage(input: PackageInput): Promise<PackageOut> {
  const today = input.today ?? localDate();
  const { city, permit } = cityPermit(input.municipality);
  const diy = ontarioDiy();
  const doc = await newDoc(`Permit package: ${input.address}`);
  const fonts = await embedFonts(doc);
  const geo = basementGeometry(input.result, input.state);
  const profile = input.share ? null : input.profile;
  const ownerNames = input.profile?.owners.map((o) => `${o.first} ${o.last}`.trim()).join(" and ") || null;
  const signer = input.state.permit?.signer === "designer" ? "brief" : (permit?.signer ?? "owner");
  const project: Project = {
    address: input.address || input.result?.property?.address || "Address to add",
    municipality: input.result?.property?.municipality ?? city,
    legal: input.profile?.legalDescription || input.site?.legalDescription || null,
    pin: input.profile?.pin || input.site?.pin || null,
    owner: input.share ? null : ownerNames,
    signer,
    date: today,
    estimated: Boolean(geo?.estimated),
    sheets: SHEETS,
  };
  const ctx: SheetCtx = {
    doc,
    fonts,
    project,
    result: input.result,
    geo,
    site: input.site,
    state: input.state,
    profile,
    permit: permit ? { ...permit, signerNote: signer === "brief" && permit.signer !== "brief" ? "A designer finishes and signs these drawings." : permit.signerNote } : null,
    diy,
    city,
    aerial: null,
  };
  const sheets: Printed[] = [coverSheet(ctx), sitePlan(ctx), floorPlan(ctx, "existing"), floorPlan(ctx, "proposed"), crossSection(ctx), egressDetail(ctx), generalNotes(ctx), needsPro(ctx, false)];

  // The forms.
  const outcomes: FormOutcome[] = [];
  const areaM2 = (geo?.layout?.zones ?? []).filter((z) => z.kind !== "stairs" && z.kind !== "mechanical").reduce((s, z) => s + z.areaM2, 0) || geo?.main?.plan.areaM2 || null;
  const values = formValues(input, project.municipality, scopeOfWork(ctx), areaM2, geo?.layout?.kind === "studio" ? 0 : 1, today);
  if (!input.share && permit) {
    const needed = formsNeeded(permit.forms, { ownerDraws: signer === "owner", ownerBuilds: input.state.build?.path !== "hire" });
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
      await summarySheet(doc, form, permitRows(values), form.url ? `We couldn't fill this form's PDF here. Copy these answers into it, or into the City's online form.` : "This form is filled in online or at the counter. Copy these answers into it.");
      outcomes.push({ id: form.id, title: form.title, status: form.url ? "unavailable" : "summary", set: [] });
    }
  }

  await submitPage(doc, input, permit, city);
  if (input.favourites.length) await lookPage(doc, input.favourites, input.state);
  const bytes = await doc.save();
  return { bytes, sheets, forms: outcomes, pages: doc.getPageCount(), signer };
}

async function submitPage(doc: PDFDocument, input: PackageInput, permit: ReturnType<typeof cityPermit>["permit"], city: string) {
  const fonts = await embedFonts(doc);
  const s = new Sheet(doc.addPage(LETTER), fonts);
  const { pack } = packFor(input.municipality);
  let y = s.height - 54;
  s.text("HOW TO SUBMIT", 48, y, { size: 8, color: MUTED, font: fonts.bold });
  y -= 24;
  y = s.wrap(`Apply to the City of ${city}`, 48, y, s.width - 96, { size: 18, font: fonts.bold, leading: 21 }) - 6;
  if (!permit) {
    s.wrap("Your city isn't researched yet: ask its building department which forms and drawings it needs.", 48, y, s.width - 96, { size: 10 });
    return;
  }
  y = s.wrap(`Online: ${permit.portal.label}, ${permit.portal.url}`, 48, y, s.width - 96, { size: 10 }) - 10;
  s.text("WHAT TO UPLOAD", 48, y, { size: 8, color: MUTED, font: fonts.bold });
  y -= 14;
  for (const u of permit.upload) {
    s.text(u.what, 48, y, { size: 9.5, font: fonts.bold });
    y = s.wrap(u.where, 230, y, s.width - 278, { size: 9 }) - 6;
  }
  const fee = permitFee(pack, input.result?.plan?.areaM2 ?? null);
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

export async function lookPage(doc: PDFDocument, favourites: PackageInput["favourites"], state: StoredState) {
  const fonts = await embedFonts(doc);
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
