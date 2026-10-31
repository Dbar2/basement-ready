// The facts behind the permit package and the do-it-yourself path, from the rules packs: Ontario-wide
// rules in data/rules/ontario-diy.json (who may do which work, what needs a pro, standard drawing
// notes, alarm placement) and each city's own `permitPackage` (who signs, forms, portal, inspections).
// Every fact carries its source and the date it was checked; nothing here is made up at run time.
import { readFileSync } from "node:fs";
import { cleanMunicipality, packFor } from "../rules";

// What the papers say instead of an address for the labelled demo house (a Waterloo house, no address).
export const DEMO_ADDRESS = "Demo house (not a real address)";

export type Cite = { title: string; url: string; section?: string | null; retrieved: string };
export type Link = { label: string; url: string };

export type Note = { id: string; title: string; text: string; source: Cite; verified: boolean; when?: "fuel_burning" | "egress_new" | "always" };
// What one city adds to an Ontario-wide item: a sentence or two, the page that says it, a caveat. Keyed
// by the city's pack slug ("kitchener-on"); a house elsewhere gets the Ontario wording alone.
export type CityAddition = { detail: string; source?: Cite; notes?: string };
export type ProItem = {
  id: string;
  title: string;
  who: string;
  when: "egress_cut" | "separate_heating" | "gas_work" | "beam_change" | "always";
  detail: string;
  registry?: Link | null;
  source: Cite;
  verified: boolean;
  notes?: string;
  cities?: Record<string, CityAddition>;
};
export type Trade = {
  id: "design" | "building" | "electrical" | "plumbing" | "gas" | "structural" | "hvac";
  title: string;
  owner: "yes" | "with_permit" | "ask" | "no";
  detail: string;
  permit: string | null;
  registry?: Link | null;
  source: Cite;
  verified: boolean;
  notes?: string;
  cities?: Record<string, CityAddition>;
};
export type OntarioDiy = {
  compiledAt: string;
  notes: Note[];
  needsPro: ProItem[];
  trades: Trade[];
  electrical: {
    receptacleSpacingM: number;
    counterSpacingM: number;
    text: string;
    source: Cite;
    verified: boolean;
    notes?: string;
    esaHomeownerFees: { bands: { upTo: number | null; CAD: number }[]; text: string; source: Cite; verified: boolean; notes?: string };
  };
  alarms: { text: string; source: Cite; verified: boolean; notes?: string }[];
};

export type CityForm = {
  id: string;
  title: string;
  url: string | null;
  fill: "acroform" | "summary";
  who: string;
  when: string;
  required: "always" | "owner_designer" | "designer" | "owner_builder" | "if_asked";
  source: Cite;
  verified: boolean;
  notes?: string;
};
export type Inspection = { id: string; title: string; when: string; who: "building" | "esa" | "plumbing" | "hvac" | "zoning" };
export type CityPermit = {
  signer: "owner" | "brief";
  signerNote: string;
  signerSource: Cite;
  signerVerified: boolean;
  drawings: string[];
  drawingsSource: Cite;
  scaleRule: string | null;
  forms: CityForm[];
  portal: Link;
  upload: { what: string; where: string }[];
  ownerBuilder: { allowed: boolean; detail: string; source: Cite; verified: boolean };
  inspections: Inspection[];
  inspectionsSource: Cite;
  plumbing: { separatePermit: boolean; detail: string; perFixtureCAD: number | null; minimumCAD: number | null; source: Cite; verified: boolean } | null;
};

let ontario: OntarioDiy | null = null;
// An Ontario-wide item as the house's own city has it: the province's wording, then that city's
// sentence and its page. Never another city's: a Waterloo house doesn't read Kitchener's rules.
export function forCity<T extends { detail: string; notes?: string; cities?: Record<string, CityAddition> }>(item: T, municipality: string): Omit<T, "cities"> & { citySource: Cite | null } {
  const { cities, ...base } = item;
  const own = cities?.[cleanMunicipality(municipality)];
  return { ...base, detail: own?.detail ? `${base.detail} ${own.detail}` : base.detail, notes: own?.notes ?? base.notes, citySource: own?.source ?? null };
}

export function ontarioDiy(): OntarioDiy {
  ontario ??= JSON.parse(readFileSync(new URL("../../data/rules/ontario-diy.json", import.meta.url), "utf8")) as OntarioDiy;
  return ontario;
}

// The permit facts for this municipality: its own pack's, or Ontario's (the provincial application,
// the Code's inspection stages, a design brief for a designer to sign) anywhere without one.
export function cityPermit(municipality: string): { city: string; authority: string; permit: CityPermit | null } {
  const { pack, city, authority } = packFor(municipality);
  return { city, authority, permit: ((pack as any).permitPackage as CityPermit | undefined) ?? null };
}
