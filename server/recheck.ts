// Answers in, verdict out. Each answered rule is decided in code against the rules pack;
// the scan's own reading is kept underneath, so clearing an answer puts it back.
import { verdictFrom } from "./assess";
import { packFor, type Rule } from "./rules";

export type AnswerValue = number | boolean;
export type Answers = Record<string, AnswerValue | null | undefined>;

type Check = Rule["check"];

export function evaluate(check: Check, value: AnswerValue): "pass" | "fail" | "unknown" {
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

export function recheck<R extends { municipality?: string; findings: AnyFinding[]; baseFindings?: AnyFinding[] }>(result: R, answers: Answers) {
  const { pack } = packFor(result.municipality ?? "waterloo-on");
  const rules = new Map(pack.rules.map((r) => [r.id, r]));
  // The scan's own reading, before any answers.
  const base = result.baseFindings ?? result.findings;

  const findings = base.map((f) => {
    const value = answers[f.ruleId];
    if (value === undefined || value === null) return { ...f, answer: null };
    const outcome = evaluate(f.check, value);
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
  return { ...result, baseFindings: base, findings, ...verdict, answeredCount: findings.filter((f) => f.answer).length };
}
