// Re-runs the saved sample result through today's rules triage, grants and plan, without new model
// calls. Run after changing server/triage.ts, the grants or the plan steps.
// Usage: pnpm tsx scripts/retriage-sample.ts
import { readFileSync, writeFileSync } from "node:fs";
import { triage, verdictFrom } from "../server/assess";
import { coreRules, grantsFor, moneyFor, packFor, type Household } from "../server/rules";
import { planSteps } from "../server/steps";

const file = "public/samples/sample/result.json";
const r = JSON.parse(readFileSync(file, "utf8"));
const { pack, city } = packFor(r.municipality ?? "waterloo-on");
const rules = coreRules(pack);
const base = (r.baseFindings ?? r.findings).map((f: any) => {
  const rule = rules.find((x) => x.id === f.ruleId)!;
  // Back to what the scan itself said, then triage it the way a new scan would be.
  const fresh = { ...f, answer: null, question: f.question ?? null, fix: f.status === "likely_fix" ? rule.fix : null };
  return triage(fresh, rule, r.property ?? null);
});
const verdict = verdictFrom(base);
const grants = grantsFor(pack, (r.household ?? "relative") as Household);
const next = {
  ...r,
  baseFindings: undefined,
  findings: base,
  ...verdict,
  grants,
  money: moneyFor(grants),
  steps: planSteps({ city, ...verdict, grants, plan: r.plan ?? null }, pack),
};
delete next.baseFindings;
writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
console.log(next.headline, "| questions:", base.filter((f: any) => f.status === "needs_answer").length, "| standard:", verdict.standard.length, "| up to", next.money);
