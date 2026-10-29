// Re-runs the saved sample result through today's rules triage, money and plan, without new model
// calls. Run after changing server/triage.ts, server/eligibility.ts, the plan steps or a pack.
// Usage: pnpm tsx scripts/retriage-sample.ts
import { readFileSync, writeFileSync } from "node:fs";
import { triage, verdictFrom } from "../server/assess";
import { moneyAndSteps } from "../server/recheck";
import { coreRules, packFor } from "../server/rules";

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
// The sample is a suite for the homeowner's mother: 65+, paying no rent, nothing started yet. Shown on
// the answer page as "What you told us", and replaced by anything a visitor answers.
const SAMPLE_MONEY = { senior: true, rent: "none", lives_there: true, work_started: false };
const next = {
  ...r,
  baseFindings: undefined,
  findings: base,
  ...verdict,
  ...moneyAndSteps({ ...r, city, household: r.household ?? "relative" }, verdict, SAMPLE_MONEY, pack),
  // Where to apply and who to hire come straight from the pack.
  process: pack.process,
  pros: pack.pros,
};
delete next.baseFindings;
writeFileSync(file, JSON.stringify(next));
console.log(next.headline, "| questions:", base.filter((f: any) => f.status === "needs_answer").length, "| standard:", verdict.standard.length, "| up to", next.money);
