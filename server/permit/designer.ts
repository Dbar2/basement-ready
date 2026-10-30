// When the owner can't draw it themselves, and how they find someone who can: the City asks for a
// designer, it's a third unit (a Small Buildings BCIN), or the work changes the structure. The
// province's QuARTS registry lists every qualified designer; it has no links into a search, so we
// say which filters to pick. The brief email carries the package link.
import { areaText } from "../model/suite";

export const QUARTS = "https://www.search.quarts.mah.gov.on.ca/en";

export type DesignerNeed = { needed: boolean; reasons: string[]; category: "House" | "Small Buildings" };

export function designerNeed(o: { municipality: string; citySigner: "owner" | "brief" | null; unitsNow: number; structural: boolean }): DesignerNeed {
  const reasons: string[] = [];
  const units = o.unitsNow + 1;
  if (units >= 3) reasons.push(o.municipality.startsWith("kitchener") ? "Kitchener needs a designer's drawings for 3 or more units." : "A third unit needs a designer with a Small Buildings BCIN.");
  if (o.structural) reasons.push("A new or bigger opening in the foundation wall changes the structure.");
  if (o.citySigner === "brief") reasons.push("This city asks for drawings by a qualified designer.");
  return { needed: reasons.length > 0, reasons, category: units >= 3 ? "Small Buildings" : "House" };
}

// What to pick on QuARTS, in order.
export function quartsFilters(need: DesignerNeed, city: string) {
  return [
    { label: "Registration", value: "Designer (individual BCIN) or a registered firm" },
    { label: "Category", value: need.category },
    { label: "Near", value: city },
  ];
}

export function briefEmail(o: { address: string; city: string; packageUrl: string; reasons: string[]; units: number; areaM2: number | null; bedrooms: number }) {
  const subject = `Drawings for a basement second unit at ${o.address}`;
  const body = [
    "Hello,",
    "",
    `I'm adding a second unit (an additional residential unit) in the basement of my house at ${o.address}, ${o.city}, and I'm looking for a BCIN designer to check, finish and sign the permit drawings.`,
    "",
    `The unit: ${o.areaM2 ? areaText(o.areaM2) : "its area to be measured"}, ${o.bedrooms === 0 ? "a studio" : `${o.bedrooms} bedroom${o.bedrooms === 1 ? "" : "s"}`}, ${o.units} units in the house after the work.`,
    o.reasons.length ? `Why I need a designer: ${o.reasons.join(" ")}` : "",
    "",
    "The draft set (site plan, basement plan, unit 1 plan, ceiling plan, elevations, details and the Code notes) is here:",
    o.packageUrl,
    "",
    "Could you tell me your fee and when you could start? I can send tape measurements and photos.",
    "",
    "Thank you",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  return { subject, body };
}
