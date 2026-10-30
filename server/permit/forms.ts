// The city's own forms, filled from the owner profile and the plan. Fillable PDFs are fetched from
// the official address (cached, never shipped with the app), their fields set, and kept editable for
// signing. A form we can't fill as a PDF gets a summary sheet: every answer laid out to copy.
import { createHash } from "node:crypto";
import { PDFCheckBox, PDFDict, PDFDocument, PDFName, PDFRadioGroup, PDFTextField, StandardFonts } from "pdf-lib";
import { storage } from "../storage";
import type { CityForm } from "./data";
import { embedFonts, INK, LETTER, MUTED, safe, Sheet } from "./pdf";

export type FormValues = {
  ownerNames: string;
  owners: { first: string; last: string }[];
  phone: string;
  email: string;
  street: string; // "45 Avondale Ave S"
  municipality: string;
  postalCode: string;
  mailing: string | null;
  legal: string | null;
  pin: string | null;
  roll: string | null;
  date: string; // YYYY-MM-DD
  permitNumber: string | null;
  scope: string;
  areaM2: number | null;
  bedrooms: number;
  city: string; // "City of Waterloo", "Township of Woolwich"; empty when we don't know
  valueCAD: number | null; // the project's estimated value
  ownerBuilds: boolean; // the owner is their own builder
  ownerDraws: boolean; // the owner signs Schedule 1 as an exempt designer (only where the city allows it)
};

// A text value, a checkbox (true/false), or a radio choice ({ pick: the option's opening words }).
type FieldValue = string | boolean | { pick: string } | null;
type FieldMap = Record<string, (v: FormValues) => FieldValue>;

// Schedule 1, Section D, third declaration: the basis is "Homeowner" (the City of Waterloo's
// declaration adds the 2024 Code's clause).
export const HOMEOWNER_BASIS = "Homeowner: Building Code, Div. C 3.2.5.1.(3)(b)";
const DESIGN_WORK = "Drawings for an additional residential unit in the basement of my own house (sheets A0 to A7).";

const first = (v: FormValues) => v.owners[0]?.first ?? "";
const last = (v: FormValues) => v.owners[0]?.last ?? "";
const sqft = (v: FormValues) => (v.areaM2 ? String(Math.round(v.areaM2 * 10.7639)) : null);

// Field names read from each official PDF (checked 2026-10-29); see data/rules/SOURCES-permit.md.
export const FIELD_MAPS: Record<string, FieldMap> = {
  // City of Waterloo, Owner/Designer Declaration (one page, five fields).
  waterloo_owner_declaration: {
    Text1: (v) => v.ownerNames,
    Text2: (v) => v.date,
    Text3: (v) => `${v.street}, ${v.municipality}`,
    Text4: (v) => v.permitNumber,
  },
  // Schedule 1: Designer Information (the City of Waterloo's copy of the provincial form). The owner
  // fills it as an exempt designer: Section D, third choice.
  schedule_1: {
    "Project Building number street name for Designer Information": (v) => v.street,
    "Project Municipality for Designer Information": (v) => v.municipality,
    "Project Postal code for Designer Information": (v) => v.postalCode,
    "Project Plan number / other description for Designer Information": (v) => v.legal ?? v.pin,
    "Designer Name": (v) => v.ownerNames,
    "Designer Street address": (v) => v.mailing ?? v.street,
    "Designer Municipality": (v) => (v.mailing ? null : v.municipality),
    "Designer Postal code": (v) => (v.mailing ? null : v.postalCode),
    "Designer Province": () => "Ontario",
    "Designer Email": (v) => v.email,
    "Designer Telephone number": (v) => v.phone,
    "Design Activities: House": () => true,
    "Description of designers work": () => DESIGN_WORK,
    "For design work, Basis for exemption from registration and qualification": () => HOMEOWNER_BASIS,
    "Designer Name for Declaration": (v) => v.ownerNames,
    "Date Signed by Designer": (v) => v.date,
  },
  // The provincial Application for a Permit to Construct or Demolish (effective 2026-02-16), with its
  // Schedule 1. The owner is the applicant; Section D (owner, if different) stays empty; the boxes
  // for the City (application number, roll number) and the declarations they tick stay empty.
  on_application: {
    "Application submitted to ((Name of municipality, upper-tier municipality, board of health or conservation authority)": (v) => v.city,
    "Project building number street name": (v) => v.street,
    "Project Municipality": (v) => v.municipality,
    "Project postal code": (v) => v.postalCode,
    "Project plan number/other description": (v) => v.legal,
    "Project value estimated (in dollars)": (v) => (v.valueCAD ? String(Math.round(v.valueCAD)) : null),
    "Project area of work (in square metres)": (v) => (v.areaM2 ? v.areaM2.toFixed(1) : null),
    "Purpose of application": () => ({ pick: "Alteration/repair" }),
    "Current use of building": () => "Single dwelling (one unit)",
    "Proposed use of building": () => "Dwelling with an additional residential unit (two units)",
    "Description of proposed work": (v) => v.scope,
    "Applicant is": () => ({ pick: "Owner" }),
    "Applicant last name": last,
    "Applicant First name": first,
    "Applicant Street address": (v) => v.mailing ?? v.street,
    "Applicant Municipality": (v) => (v.mailing ? null : v.municipality),
    "Applicant Postal code": (v) => (v.mailing ? null : v.postalCode),
    "Applicant Province": () => "Ontario",
    "Applicant Email": (v) => v.email,
    "Applicant Telephone number": (v) => v.phone,
    "Builder Last name": (v) => (v.ownerBuilds ? last(v) : null),
    "Builder First name": (v) => (v.ownerBuilds ? first(v) : null),
    "Builder Street address": (v) => (v.ownerBuilds ? (v.mailing ?? v.street) : null),
    "Builder Municipality": (v) => (v.ownerBuilds && !v.mailing ? v.municipality : null),
    "Builder Postal code": (v) => (v.ownerBuilds && !v.mailing ? v.postalCode : null),
    "Builder Province": (v) => (v.ownerBuilds ? "Ontario" : null),
    "Builder Email": (v) => (v.ownerBuilds ? v.email : null),
    "Builder Telephone number": (v) => (v.ownerBuilds ? v.phone : null),
    "Name of Applicant for Declaration": (v) => v.ownerNames,
    "Date Applicant Signed Main Form": (v) => v.date,
    // The published form ships with "ADE" typed in these two boxes; clear them.
    "Owner Unit number": () => " ",
    "Owner Lot/Concession": () => " ",
    // Schedule 1, filled as the exempt owner-designer only where the city accepts owner-drawn plans;
    // otherwise only the project lines, and the designer fills in the rest.
    "Designer Name": (v) => (v.ownerDraws ? v.ownerNames : null),
    "Project Building number street name for Designer Information": (v) => v.street,
    "Project Municipality for Designer Information": (v) => v.municipality,
    "Project Postal code for Designer Information": (v) => v.postalCode,
    "Project Plan number / other description for Designer Information": (v) => v.legal,
    "Designer Street address": (v) => (v.ownerDraws ? v.mailing ?? v.street : null),
    "Designer Municipality": (v) => (v.ownerDraws ? (v.mailing ? null : v.municipality) : null),
    "Designer Postal code": (v) => (v.ownerDraws ? (v.mailing ? null : v.postalCode) : null),
    "Designer Province": (v) => (v.ownerDraws ? "Ontario" : null),
    "Designer Email": (v) => (v.ownerDraws ? v.email : null),
    "Designer Telephone number": (v) => (v.ownerDraws ? v.phone : null),
    "Design Activities": (v) => (v.ownerDraws ? true : null),
    "Description of designers work": (v) => (v.ownerDraws ? DESIGN_WORK : null),
    "Declaration of Designer": (v) => (v.ownerDraws ? ({ pick: "The design work is exempt" }) : null),
    "For design work, Basis for exemption from registration and qualification": (v) => (v.ownerDraws ? HOMEOWNER_BASIS : null),
    "Designer Name for Declaration": (v) => (v.ownerDraws ? v.ownerNames : null),
    "Date Signed by Designer": (v) => (v.ownerDraws ? v.date : null),
  },
  // City of Kitchener, Project Information: Residential, Section D (secondary suites). The form
  // carries each field twice (a print copy); both get the same answer.
  kitchener_project_info: Object.fromEntries(
    (
      [
        ["Existing  of units", () => "1"],
        ["New  of units", () => "2"],
        ["Secondary Suite  of bedrooms", (v: FormValues) => String(v.bedrooms)],
      ] as [string, (v: FormValues) => FieldValue][]
    ).flatMap(([name, get]) => [
      [name, get],
      [name.endsWith("units") ? `${name}_3` : `${name}_2`, get],
    ]),
  ),
};
FIELD_MAPS.kitchener_project_info["Basement area of alteration ft²"] = sqft;

export async function fetchOfficialPdf(url: string): Promise<Uint8Array | null> {
  const key = `forms/${createHash("sha1").update(url).digest("hex").slice(0, 16)}.pdf`;
  const hit = await storage.get(key);
  if (hit) {
    const parts: Buffer[] = [];
    for await (const chunk of hit) parts.push(chunk as Buffer);
    return new Uint8Array(Buffer.concat(parts));
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!Buffer.from(bytes.slice(0, 5)).toString().startsWith("%PDF")) return null;
    await storage.put(key, Buffer.from(bytes), "application/pdf");
    return bytes;
  } catch {
    return null;
  }
}

// Sets every mapped field the PDF has. Returns the filled PDF and which fields were set or missing.
// The fields stay fillable (and their values show through their appearances), so the owner can still
// edit and sign; copies placed in the package keep the same appearances.
export async function fillAcroForm(bytes: Uint8Array, map: FieldMap, v: FormValues) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const set: Record<string, string | boolean> = {};
  const missing: string[] = [];
  for (const [name, get] of Object.entries(map)) {
    const value = get(v);
    if (value === null || value === "") continue;
    const field = form.getFieldMaybe(name);
    if (!field) {
      missing.push(name);
      continue;
    }
    if (field instanceof PDFTextField && typeof value === "string") {
      field.setText(safe(value).slice(0, field.getMaxLength() ?? 500));
      set[name] = value;
    } else if (field instanceof PDFCheckBox && typeof value === "boolean") {
      if (value) field.check();
      else field.uncheck();
      set[name] = value;
    } else if (field instanceof PDFCheckBox && typeof value === "object") {
      // The provincial form's choices are one checkbox with a widget per option (radio-like, without
      // the radio flag): turn on the widget whose state matches and the field's value with it.
      const states = field.acroField.getWidgets().map((w) => w.dict.lookup(PDFName.of("AP"), PDFDict)?.lookup(PDFName.of("N"), PDFDict)?.keys().map((k) => k.decodeText()) ?? []);
      const option = states.flat().find((o) => o !== "Off" && o.trim().startsWith(value.pick));
      if (!option) {
        missing.push(name);
        continue;
      }
      field.acroField.getWidgets().forEach((w, i) => w.setAppearanceState(PDFName.of(states[i].includes(option) ? option : "Off")));
      field.acroField.dict.set(PDFName.of("V"), PDFName.of(option));
      set[name] = option.trim();
    } else if (field instanceof PDFRadioGroup && typeof value === "object") {
      const option = field.getOptions().find((o) => o.trim().startsWith(value.pick));
      if (!option) {
        missing.push(name);
        continue;
      }
      field.select(option);
      set[name] = option.trim();
    } else missing.push(name);
  }
  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  return { bytes: await doc.save(), set, missing };
}

// A letter-size page: the form's questions with our answers, and where to send it.
export async function summarySheet(doc: PDFDocument, form: Pick<CityForm, "title" | "url" | "who" | "when">, rows: [string, string | null][], intro: string) {
  const fonts = await embedFonts(doc);
  const s = new Sheet(doc.addPage(LETTER), fonts);
  let y = s.height - 54;
  s.text("FILLED FOR YOU", 48, y, { size: 8, color: MUTED, font: fonts.bold });
  y -= 22;
  y = s.wrap(form.title, 48, y, s.width - 96, { size: 16, font: fonts.bold, leading: 19 }) - 4;
  y = s.wrap(intro, 48, y, s.width - 96, { size: 9.5, color: MUTED }) - 10;
  for (const [label, value] of rows) {
    if (y < 90) break;
    s.line(48, y + 8, s.width - 48, y + 8, { width: 0.4, color: MUTED });
    s.text(label, 48, y - 4, { size: 8.5, font: fonts.bold });
    y = s.wrap(value ?? "Fill in yourself", 230, y - 4, s.width - 278, { size: 9, color: value ? INK : MUTED }) - 8;
  }
  s.wrap(`${form.who}. ${form.when}.${form.url ? ` Official form: ${form.url}` : ""}`, 48, 60, s.width - 96, { size: 8, color: MUTED });
  return s;
}

// The answers every permit form asks for, in the order the provincial application asks them.
export function permitRows(v: FormValues): [string, string | null][] {
  return [
    ["Project address", `${v.street}, ${v.municipality}, ON ${v.postalCode}`.trim()],
    ["Legal description", v.legal],
    ["PIN / roll number", [v.pin, v.roll].filter(Boolean).join(" / ") || null],
    ["Owner(s)", v.ownerNames],
    ["Owner's address", v.mailing ?? `${v.street}, ${v.municipality}, ON ${v.postalCode}`],
    ["Phone", v.phone],
    ["Email", v.email],
    ["Applicant", `${v.ownerNames} (owner)`],
    ["Builder", `${v.ownerNames} (owner), or the contractor you hire`],
    ["Project type", "Alteration: additional residential unit (second unit) in the basement of an existing house"],
    ["Description of work", v.scope],
    ["Existing use", "Single detached dwelling (1 unit)"],
    ["Proposed use", "Single detached dwelling with a second unit (2 units)"],
    ["Area of the new unit", v.areaM2 ? `${v.areaM2.toFixed(1)} m² (${Math.round(v.areaM2 * 10.7639)} sq ft)` : null],
    ["Bedrooms in the new unit", String(v.bedrooms)],
    ["Designer", v.ownerDraws ? `Homeowner (${v.ownerNames}), exempt under Div. C 3.2.5.1.(3)(b)` : "Your BCIN designer fills in Schedule 1"],
  ];
}
