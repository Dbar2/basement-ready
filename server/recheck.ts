// Answers in, verdict out. Each answered rule is decided in code against the rules pack;
// the scan's own reading is kept underneath, so clearing an answer puts it back.
import { verdictFrom } from "./assess";
import { evaluateMoney, type MoneyAnswers } from "./eligibility";
import type { Property } from "./property";
import { packFor, type Household, type Pack, type Rule } from "./rules";
import { planSteps } from "./steps";

// "unsure": the homeowner doesn't know. The designer checks it instead; it stops being a question.
// Money questions (server/eligibility.ts) share the same store, and rent can be "none" or "market".
export type AnswerValue = number | boolean | string;
export type Answers = Record<string, AnswerValue | null | undefined>;

type Check = Rule["check"];

export function evaluate(check: Check, value: AnswerValue): "pass" | "fail" | "unknown" {
  if (typeof value === "string") return "unknown";
  const target = check.value;
  switch (check.operator) {
    case "exists":
      return value === true ? "pass" : value === false ? "fail" : "unknown";
    case "==":
      if (typeof target === "boolean" && typeof value === "boolean") return value === target ? "pass" : "fail";
      if (typeof target === "number" && typeof value === "number") return value === target ? "pass" : "fail";
      return "unknown";
    case ">=":
      return typeof target === "number" && typeof value === "number" ? (value >= target ? "pass" : "fail") : "unknown";
    case "<=":
      return typeof target === "number" && typeof value === "number" ? (value <= target ? "pass" : "fail") : "unknown";
    default:
      return "unknown";
  }
}

const UNIT: Record<string, string> = { m: "m", mm: "mm", m2: "m²", units: "homes", spaces: "parking spaces", STC: "STC" };

function show(value: AnswerValue, unit: string | null) {
  if (typeof value === "string") return value === "unsure" ? "not sure" : value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  const n = unit === "m" ? value.toFixed(2) : String(Math.round(value * 100) / 100);
  return unit ? `${n} ${UNIT[unit] ?? unit}` : n;
}

// Plain words for what changed, naming the rule's limit.
export function explain(check: Check, value: AnswerValue, outcome: "pass" | "fail") {
  if (typeof value === "boolean") {
    return outcome === "pass" ? `You told us ${show(value, null)}, which is what the rule needs.` : `You told us ${show(value, null)}, so this needs work before it can pass.`;
  }
  const need = `${check.operator === ">=" ? "at least" : check.operator === "<=" ? "at most" : "exactly"} ${show(check.value as number, check.unit)}`;
  return `You told us ${show(value, check.unit)}; the rule needs ${need}.`;
}

type AnyFinding = Record<string, any> & { ruleId: string; status: string; check: Check; evidence: string[] };

type MoneyContext = {
  household?: Household;
  property?: Pick<Property, "unitsRegistered" | "building"> | null;
  plan?: { areaM2?: number | null } | null;
  city?: string;
  authority?: string; // who issues the permit: "City of Waterloo", "Township of Woolwich"
};

// The money they qualify for and the road to it, from who it's for, their answers and the plan.
export function moneyAndSteps(
  r: MoneyContext,
  verdict: Pick<ReturnType<typeof verdictFrom>, "fixGroups" | "standard" | "cost">,
  answers: Answers,
  pack: Pack,
) {
  const household = r.household ?? "unsure";
  const money = evaluateMoney(pack, { household, answers: answers as MoneyAnswers, property: r.property ?? null, costHigh: verdict.cost.high });
  // The floor being finished: the scan's plan, or failing that the house's footprint.
  const areaM2 = r.plan?.areaM2 ?? r.property?.building?.footprintM2 ?? null;
  const steps = planSteps({ city: r.city ?? "Ontario", authority: r.authority ?? (r.city && !["Ontario", "your city"].includes(r.city) ? `City of ${r.city}` : "your municipality"), household, programs: money.programs, ...verdict, areaM2 }, pack);
  return {
    grants: money.programs,
    money: { total: money.total, ifYes: money.ifYes },
    moneyQuestions: money.questions,
    moneyAnswered: money.answered,
    steps,
  };
}

export function recheck<R extends { municipality?: string; findings: AnyFinding[]; baseFindings?: AnyFinding[] }>(result: R, answers: Answers) {
  const { pack } = packFor(result.municipality ?? "waterloo-on");
  const rules = new Map(pack.rules.map((r) => [r.id, r]));
  // The scan's own reading, before any answers.
  const base = result.baseFindings ?? result.findings;

  const findings = base.map((f) => {
    const value = answers[f.ruleId];
    if (value === undefined || value === null) return { ...f, answer: null };
    const outcome = evaluate(f.check, value);
    if (value === "unsure") return { ...f, status: "designer_checks", question: null, answer: { value, outcome } };
    if (outcome === "unknown") return { ...f, answer: { value, outcome } };
    const rule = rules.get(f.ruleId);
    return {
      ...f,
      status: outcome === "pass" ? "likely_ok" : "likely_fix",
      why: explain(f.check, value, outcome),
      question: null,
      evidence: [...new Set([...(f.evidence ?? []), "homeowner"])],
      fix: outcome === "fail" ? (rule?.fix ?? f.fix ?? null) : null,
      answer: { value, outcome },
    };
  });

  const verdict = verdictFrom(findings as any);
  const money = moneyAndSteps(result as R & MoneyContext, verdict, answers, pack);
  return { ...result, baseFindings: base, findings, ...verdict, ...money, answeredCount: findings.filter((f) => f.answer).length };
}
