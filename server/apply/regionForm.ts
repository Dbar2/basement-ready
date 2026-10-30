// The Region of Waterloo's Ontario Renovates application (v11, 2026-05-22) has no form fields, so
// the answers are printed onto its blanks. Positions were read from the PDF's own text layout and
// checked on a rendered copy (2026-10-29). The owner still signs, dates and attaches the documents.
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { safe } from "../permit/pdf";

export const REGION_FORM_URL = "https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/55bf0zge/docs_admin-2295447-v11-ontario_renovates_secondary_suite_application-aoda.pdf";

export type RegionValues = {
  owners: { first: string; last: string }[];
  contactName: string;
  phone: string;
  email: string;
  street: string;
  cityProvince: string;
  postalCode: string;
  bedrooms: 0 | 1; // bachelor or one-bedroom
  areaText: string | null;
  livesThere: boolean | null;
  mailing: string | null;
  otherProperty: boolean | null;
  rent: number | null; // proposed monthly rent, utilities included
};

type Mark = { page: number; x: number; y: number; text: string; size?: number };

export function regionMarks(v: RegionValues): Mark[] {
  const m: Mark[] = [];
  const t = (page: number, x: number, y: number, text: string | null | undefined, size = 10) => {
    if (text) m.push({ page, x, y, text, size });
  };
  // Page 3: owners, main contact, the property.
  v.owners.slice(0, 2).forEach((o, i) => {
    const y = 574 - i * 31.8;
    t(3, 98, y, o.last);
    t(3, 368, y, o.first);
  });
  t(3, 75, 497, v.contactName);
  t(3, 428, 497, v.phone);
  t(3, 389, 465, v.email, 9);
  t(3, 190, 419.5, v.street);
  t(3, 116, 388, v.cityProvince);
  t(3, 485, 388, v.postalCode);
  t(3, v.bedrooms === 0 ? 238 : 330, 361, "X", 11);
  t(3, 503, 335.5, "X", 11); // a new suite, not one being legalized
  t(3, 232, 310, v.areaText);
  if (v.livesThere != null) t(3, v.livesThere ? 262 : 316, 284, "X", 11);
  if (v.mailing) t(3, 40, 219, v.mailing);
  // Page 5: other property.
  if (v.otherProperty != null) t(5, v.otherProperty ? 220 : 266, 421, "X", 11);
  // Page 6: proposed rent.
  if (v.rent != null) t(6, 125, 655, `$${v.rent.toLocaleString("en-CA")} a month, utilities included`);
  // Page 9: each owner's printed name (they sign and date it themselves).
  v.owners.slice(0, 3).forEach((o, i) => t(9, 172, 533 - i * 63.6, `${o.first} ${o.last}`.trim()));
  return m;
}

export async function fillRegionForm(bytes: Uint8Array, v: RegionValues) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const marks = regionMarks(v);
  for (const mk of marks) {
    const page = doc.getPage(mk.page - 1);
    page.drawText(safe(mk.text), { x: mk.x, y: mk.y, size: mk.size ?? 10, font, color: rgb(0.05, 0.12, 0.35) });
  }
  return { bytes: await doc.save(), marks };
}
