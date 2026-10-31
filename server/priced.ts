// The answer as every screen shows it, priced on the design the homeowner picked (server/model/current.ts):
// the design's quote, hired out, is the cost; the money (the tax credit) is worked from that cost; and
// a fix the design needs that the rules didn't name (a new escape window where the scan saw none)
// joins the fixes. The answer, the layouts, the brief, the money tab, the book and the PDFs all read
// a result priced here, so they show one quote and count one list of fixes.
import type { DesignPricing, FixGroup } from "./assess";
import { type Layout, rejudgeEscape } from "./layout";
import { checkDesign } from "./model/checks";
import { designFixes } from "./model/fixes";
import { currentModel } from "./model/current";
import { chosenDesign, layoutOf } from "./model/legacy";
import { suiteAreaM2 } from "./model/suite";
import type { Model } from "./model/types";
import { quote } from "./quote/quote";
import { recheck, type Answers } from "./recheck";
import { packFor } from "./rules";
import { loadWorkspace } from "./workspace";

type ResultLike = { municipality?: string; findings: any[]; baseFindings?: any[] };

export function designPricing(result: { municipality?: string }, model: Model | null): DesignPricing | null {
  const design = chosenDesign(model);
  if (!model || !design) return null;
  const municipality = result.municipality ?? "waterloo-on";
  const q = quote(model, design, { municipality });
  const lines = q.byTrade.flatMap((t) => t.lines);
  // A fix's cost is its own line in the quote, where it has one: the escape window's cut, well and window.
  const lineCost: DesignPricing["lineCost"] = {};
  const egress = lines.filter((l) => l.id.startsWith("egress_"));
  if (egress.length) lineCost.egress = { low: egress.reduce((s, l) => s + l.low, 0), high: egress.reduce((s, l) => s + l.high, 0) };
  // The design's own fixes (server/model/fixes.ts, which the layout cards and the studio count too): an
  // escape window it needs, whether or not the scan named it, and every check it still fails (the duct
  // under 1.85 m), each in the rules' words.
  const { pack } = packFor(municipality);
  const fixes: FixGroup[] = designFixes(design, model.existing).map((f) => {
    const rule = f.ruleId ? pack.rules.find((r) => r.id === f.ruleId) : undefined;
    return {
      category: rule?.category ?? f.category,
      title: rule?.title ?? f.title,
      description: rule?.fix?.description ?? "",
      ruleIds: f.ruleId ? [f.ruleId] : [],
      evidence: [],
      why: f.why,
      costLow: null,
      costHigh: null,
      costSource: null,
      sources: rule ? [rule.source] : [],
      priced: f.priced,
      fromDesign: true,
    };
  });
  return { name: design.name, cost: { low: q.totalLow, high: q.totalHigh }, fixes, lineCost, suiteAreaM2: suiteAreaM2(design) };
}

// A result, re-checked with its answers and priced on the model's chosen design (as it stands when
// there's no model: the rules' rough sum). `design`: that design as the answer's 3D draws it (its rooms
// as zones, src/components/StagedViews.tsx) with its bedroom and escape-window checks. (What the design
// itself still fails is the studio's "to fix", not a fix to the basement.)
export function priceResult<R extends ResultLike>(result: R, answers: Answers, model: Model | null) {
  const pricing = designPricing(result, model);
  const r = rejudged(recheck(result, answers, pricing));
  const design = chosenDesign(model);
  const shapes = model && design ? layoutOf(model.existing, design) : null;
  if (!pricing || !model || !design || !shapes) return r;
  const checks = checkDesign(design, model.existing)
    .filter((c) => /^(escape|bedroom-size):/.test(c.id))
    .map((c) => ({ label: c.label, ok: c.ok, detail: c.detail }));
  return { ...r, design: { id: design.id, name: design.name, plan: shapes.plan, layout: { ...shapes.layout, checks } } };
}

// A saved layout's escape check as the scan knows it now: no tick without a taped height.
function rejudged<T>(r: T): T {
  const layout = (r as { layout?: Layout | null }).layout;
  return layout?.checks ? { ...r, layout: rejudgeEscape(layout) } : r;
}

// A saved scan's: the model from its workspace (saved, or seeded from the scan).
export async function pricedForBasement<R extends ResultLike>(scanId: string, basementId: string, result: R, answers: Answers) {
  const w = await loadWorkspace(basementId);
  return priceResult(result, answers, currentModel(result, w.state, scanId)?.model ?? null);
}

// The answers a result was worked out with: its answered rules and money questions.
export function answersIn(result: { findings?: { ruleId: string; answer?: { value: unknown } | null }[]; moneyAnswered?: { id: string; answer?: unknown }[] }): Answers {
  return {
    ...Object.fromEntries((result.findings ?? []).filter((f) => f.answer && f.answer.value != null).map((f) => [f.ruleId, f.answer!.value])),
    ...Object.fromEntries((result.moneyAnswered ?? []).filter((q) => q.id !== "household" && q.answer != null).map((q) => [q.id, q.answer])),
  } as Answers;
}

// The example's: its model is the one the browser sent (the example keeps it there), else seeded; its
// answers are the ones it ships with, and any the browser sends.
export function pricedSample<R extends ResultLike>(result: R, state: { model?: unknown } | null | undefined, answers: Answers = {}) {
  return priceResult(result, { ...answersIn(result as never), ...answers }, currentModel(result, state ?? {}, "sample")?.model ?? null);
}
