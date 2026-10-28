// Loads the compiled rules pack and does everything that must be exact in code:
// rule checks on measured numbers, costs, and which grants fit the household.
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

// Municipalities with a researched pack. Anywhere else in Ontario gets provincial and federal rules only.
export const MUNICIPALITIES: Record<string, string> = {
  "waterloo-on": "Waterloo",
  "kitchener-on": "Kitchener",
  "cambridge-on": "Cambridge",
};

const cache = new Map<string, Pack>();
function load(slug: string): Pack | null {
  if (!/^[a-z-]+$/.test(slug)) return null;
  if (cache.has(slug)) return cache.get(slug)!;
  const file = new URL(`../data/rules/${slug}.json`, import.meta.url);
  if (!existsSync(file)) return null;
  const pack = JSON.parse(readFileSync(file, "utf8")) as Pack;
  cache.set(slug, pack);
  return pack;
}

export type Coverage = { pack: Pack; city: string; coverage: "full" | "provincial" };

export function packFor(slug: string): Coverage {
  const own = load(slug);
  if (own) return { pack: own, city: own.jurisdiction.city, coverage: "full" };
  // No local research yet: keep the building code and federal money, drop city zoning, grants and process.
  const base = load("waterloo-on")!;
  return {
    city: "your city",
    coverage: "provincial",
    pack: {
      ...base,
      rules: base.rules.filter((r) => r.category !== "zoning"),
      grants: base.grants.filter((g) => g.level === "federal" || g.level === "provincial"),
      process: [],
    },
  };
}

export const coreRules = (pack: Pack) => pack.rules.filter((r) => r.priority === "core" && r.route.includes("second_unit"));

export type Household = "relative" | "renter" | "unsure";

// Grants are matched in code from the pack's own "fitsPlans" labels, never by the model.
export function grantsFor(pack: Pack, household: Household) {
  const plan = household === "relative" ? "family_suite" : household === "renter" ? "rental" : null;
  return pack.grants.map((g) => ({
    id: g.id,
    name: g.name,
    level: g.level,
    status: g.status,
    amount: g.amount,
    fit: g.status === "cancelled" ? "cancelled" : plan ? (g.fitsPlans?.[plan] ?? "depends") : "depends",
    fitNote: g.fitsPlansNote ?? null,
    nextStep: g.nextStep ?? null,
    source: g.source,
    verified: g.verified,
  }));
}

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
