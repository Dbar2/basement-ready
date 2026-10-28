// Loads the compiled rules pack and does everything that must be exact in code:
// rule checks on measured numbers, costs, and which grants fit the household.
import { readFileSync } from "node:fs";

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

export const pack: Pack = JSON.parse(readFileSync(new URL("../data/rules/waterloo-on.json", import.meta.url), "utf8"));

export const coreRules = () => pack.rules.filter((r) => r.priority === "core" && r.route.includes("second_unit"));

export type Household = "relative" | "renter" | "unsure";

// Grants are matched in code from the pack's own "fitsPlans" labels, never by the model.
export function grantsFor(household: Household) {
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
