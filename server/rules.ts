// Loads the compiled rules pack and does everything that must be exact in code: rule checks on
// measured numbers and costs. Which money fits the household is decided in server/eligibility.ts.
import { existsSync, readFileSync } from "node:fs";

export type Rule = {
  id: string;
  route: string[];
  category: string;
  priority?: string;
  severity?: string;
  title: string;
  plain: string;
  check: { metric: string; operator: string; value: unknown; unit: string | null };
  existingBuildingAlternative: any;
  evidence: { type: "video_object" | "scan_measurement" | "ask_user"; samConcept: string | null; question?: string };
  fix: { description: string; costLowCAD: number | null; costHighCAD: number | null; costSource: any };
  source: { title: string; url: string; section?: string; retrieved: string };
  verified: boolean;
  notes?: string;
};

export type Pack = {
  jurisdiction: { city: string; province: string };
  compiledAt: string;
  disclaimer?: string;
  routes: any[];
  rules: Rule[];
  grants: any[];
  process: any[];
  pros: any;
  costs: any[];
};

// Municipalities with a researched pack. Anywhere else in Ontario gets Ontario's own pack
// (data/rules/ontario-on.json): the province-wide rules, under the municipality's real name.
export const MUNICIPALITIES: Record<string, string> = {
  "waterloo-on": "Waterloo",
  "kitchener-on": "Kitchener",
  "cambridge-on": "Cambridge",
};

const cache = new Map<string, any>();
function load(name: string): any {
  if (cache.has(name)) return cache.get(name);
  const file = new URL(`../data/rules/${name}.json`, import.meta.url);
  const json = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  cache.set(name, json);
  return json;
}

// ---- Where the house is ----------------------------------------------------------------------
// A municipality without its own pack travels as "on:<its legal name>", e.g. "on:City of Toronto"
// or "on:Township of Woolwich", so the rules, the permit forms and the model all name it.

export type Place = { name: string; authority: string };

const KINDS = "city|town|township|municipality|village|county|united townships|united counties|separated town|regional municipality";
const KIND = new RegExp(`^(the )?(corporation of the )?(${KINDS}) of `, "i");
const SMALL = new Set(["of", "on", "the", "and", "in", "upon", "de", "la", "le", "du", "des"]);

// "City Of Greater Sudbury" → "City of Greater Sudbury"; "Town Of Niagara-On-The-Lake" → "Town of
// Niagara-on-the-Lake". Letters, spaces, hyphens, periods and apostrophes only; null if nothing's left.
export function cleanAuthority(text: unknown): string | null {
  const raw = String(text ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\s.'’-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (raw.length < 2) return null;
  const word = (w: string, first: boolean) => {
    const lower = w.toLowerCase();
    if (!first && SMALL.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  return raw
    .split(" ")
    .map((w, i) => w.split("-").map((part, j) => word(part, i === 0 && j === 0)).join("-"))
    .join(" ")
    .replace(/\bMc(\p{L})/gu, (_m, c: string) => `Mc${c.toUpperCase()}`);
}

// The name people use: "City of Greater Sudbury" → "Greater Sudbury".
export function shortName(authority: string) {
  return authority.replace(KIND, "").trim() || authority;
}

export const placeSlug = (authority: string) => `on:${authority}`;

export function placeOf(slug: string): Place | null {
  if (!slug.startsWith("on:")) return null;
  const authority = cleanAuthority(slug.slice(3));
  return authority ? { name: shortName(authority), authority } : null;
}

// What the server stores for a scan's municipality: a researched pack's slug, an Ontario place, or
// "ontario" when we don't know where it is.
export function cleanMunicipality(v: unknown): string {
  const s = String(v ?? "").slice(0, 100);
  if (MUNICIPALITIES[s]) return s;
  const place = placeOf(s);
  return place ? placeSlug(place.authority) : "ontario";
}

// ---- Which pack ------------------------------------------------------------------------------

export type Coverage = {
  pack: Pack;
  city: string; // the name people use: "Waterloo", "Toronto", "Ontario" when we don't know
  authority: string; // who issues the permit: "City of Waterloo", "Township of Woolwich", "your municipality"
  coverage: "full" | "provincial";
  note: string | null; // what this answer covers, when it's Ontario's rules only
};

type Townships = {
  townships: Record<string, string>;
  grants: any[];
  tenantIncomeLimitByTownship: Record<string, unknown>;
  trades: any[];
};

const QUARTS = "https://www.search.quarts.mah.gov.on.ca/en";
const quarts = (type: 3 | 4, near: string) => `${QUARTS}?mf=${encodeURIComponent(`3=${type}&4=*House*&6=*${near}*`)}`;

// Ontario's pack under this municipality's name: designer and gas-fitter searches near it, and in
// Waterloo Region's townships the Region's own loan.
function ontarioPack(place: Place | null): Pack {
  const base = load("ontario-on") as Pack;
  const pack: Pack = structuredClone(base);
  if (place) {
    const near = place.name.replace(/[^\p{L}\s.'-]/gu, "");
    pack.pros.registry.searchLinks = [
      { label: `Independent designers near ${place.name}`, url: quarts(4, near) },
      { label: `Design firms near ${place.name}`, url: quarts(3, near) },
    ];
    pack.pros.registry.howToSearch = `Opens Ontario's public registry filtered to designers registered for houses near ${place.name}. Check that their classes include “House”, not only HVAC or plumbing.`;
    for (const step of pack.process) if (step.task) step.task = step.task.replace("your municipality", `the ${place.authority}`);
    for (const t of pack.pros.trades) {
      if (t.title === "Gas fitter") {
        t.label = `TSSA gas contractors near ${place.name}`;
        t.url = `https://www.tssa.org/fuels-contractor?address_combine=${encodeURIComponent(near)}&field_fuel_type_natural_gas_value=Yes`;
      }
    }
  }
  const townships = load("region-townships-on") as Townships;
  if (place && townships.townships[place.name] === place.authority) {
    const limit = townships.tenantIncomeLimitByTownship[place.name];
    const grants = structuredClone(townships.grants).map((g) => (limit ? { ...g, conditions: { ...g.conditions, tenantIncomeLimit: limit } } : g));
    pack.grants = [...grants, ...pack.grants];
    pack.pros.trades = [...pack.pros.trades, ...structuredClone(townships.trades)];
  }
  return pack;
}

function provincialNote(place: Place | null, township: boolean) {
  if (!place) return "These are Ontario's rules, which apply across the province. Your municipality's own zoning, fees and grants aren't included, so ask it to confirm zoning.";
  if (township) return `Ontario's rules, plus the Region of Waterloo's own programs. The ${place.authority}'s zoning isn't in Basement Ready yet, so ask the Township to confirm it.`;
  return `${place.name}'s own zoning, fees and grants aren't in Basement Ready yet, so this uses Ontario's rules, which apply everywhere in the province. Ask the ${place.authority} to confirm zoning.`;
}

const packs = new Map<string, Coverage>();

export function packFor(slug: string): Coverage {
  const key = cleanMunicipality(slug);
  const hit = packs.get(key);
  if (hit) return hit;
  let coverage: Coverage;
  if (MUNICIPALITIES[key]) {
    const own = load(key) as Pack;
    coverage = { pack: own, city: own.jurisdiction.city, authority: `City of ${own.jurisdiction.city}`, coverage: "full", note: null };
  } else {
    const place = placeOf(key);
    const township = Boolean(place && (load("region-townships-on") as Townships).townships[place.name] === place.authority);
    coverage = {
      pack: ontarioPack(place),
      city: place?.name ?? "Ontario",
      authority: place?.authority ?? "your municipality",
      coverage: "provincial",
      note: provincialNote(place, township),
    };
  }
  if (packs.size > 500) packs.clear();
  packs.set(key, coverage);
  return coverage;
}

export const coreRules = (pack: Pack) => pack.rules.filter((r) => r.priority === "core" && r.route.includes("second_unit"));

export type Household = "relative" | "renter" | "unsure";

// Compact rule text for the model: enough to reason, small enough to be cheap.
export function rulesForModel(rules: Rule[]) {
  return rules.map((r) => ({
    id: r.id,
    title: r.title,
    plain: r.plain,
    check: r.check,
    evidence: r.evidence,
    existingHouseAlternative: r.existingBuildingAlternative ? JSON.stringify(r.existingBuildingAlternative).slice(0, 300) : null,
  }));
}
