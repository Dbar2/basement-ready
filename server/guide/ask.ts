// What they type to the guide. In order, cheapest first:
//   1. the guide's own buttons said in words ("A wall is off", "Show Studio", "Why that cost?"): scripted;
//   2. "what's a …?": the glossary, with the pack's sources;
//   3. the example: a polite line, never a model;
//   4. anything else on their own basement: Muse Spark, given the result, the model, the rules pack's
//      cited lines and the step they're on.
// Spark's reply is checked in code before it's said (guarded): no "qualify" or "approved", every dollar
// figure one the facts hold (costs in whole thousands), sources only from the pack, and a suggested
// action only if it fits this basement.
import { readReply, responses } from "../meta";
import { r2, wallLength } from "../model/geometry";
import type { Pack } from "../rules";
import { cite, entryFor, matchTerm, sourcesFor } from "./glossary";
import { chosenOf, explainReply, k, LOOK_KEYS, LOOK_NAMES, range, recommendedOf, withSources, type Ctx, type Reply } from "./script";
import type { Choice, GuideAction, StepId } from "../../src/guide/types";

export const SAMPLE_LINE = "On your own basement the guide answers anything. In the example, try a word I use, like “What's a fire separation?”";
const NO_KEY = "I can't answer typed questions right now. The buttons still work.";

type FullResult = NonNullable<Ctx["result"]> & {
  cost: { low: number; high: number; design?: string | null };
  money?: { total?: number | null; ifYes?: number | null; programs?: { id?: string; name?: string; qualify?: string; amount?: number | null; amountCAD?: number | null }[] } | null;
  findings?: { ruleId: string; status: string; answer?: { value: unknown } | null }[];
};
export type AskInput = { text: string; step: StepId; ctx: Ctx; pack: Pack | null; sample: boolean };

// ---- Scripted ------------------------------------------------------------------------------------

export function scripted(text: string, ctx: Ctx, pack: Pack | null): Reply | null {
  const t = text.trim().replace(/[.?!]+$/, "");
  if (/^(a )?wall('s| is) (off|wrong)$/i.test(t))
    return {
      text: "Tap the wall that's off on the plan, then type its length. Or tell me, like “The right wall is 5.5 metres”.",
      visual: { kind: "planEdit" },
      awaiting: "wall",
    };
  const show = /^show( me)?( the)? (.+)$/i.exec(t);
  const design = show && ctx.model?.designs.find((d) => d.name.toLowerCase() === show[3].toLowerCase());
  if (design && ctx.model) {
    const rec = recommendedOf(ctx.model);
    const why = (design as { why?: string }).why;
    const back = rec && rec.design.id !== design.id ? [{ label: `Show ${rec.design.name}`, action: { type: "ask", text: `Show ${rec.design.name}` } as GuideAction }] : [];
    return {
      text: `Here's ${design.name}${why ? `: ${why.charAt(0).toLowerCase()}${why.slice(1).replace(/\.$/, "")}` : ""}.`,
      choices: [...back, { label: `Use ${design.name} →`, action: { type: "chooseDesign", designId: design.id }, primary: true }],
      visual: { kind: "layouts", designId: design.id },
    };
  }
  if (/^why (that|this|the) (cost|price)|^how much (does|will|would|is) (it|this|that)( all)? (cost|be)$|^why so (much|expensive)/i.test(t) && ctx.result) return costReply(ctx.result as FullResult, ctx);
  return null;
}

// "Why that cost?": where each number comes from, from the result itself.
function costReply(r: FullResult, ctx: Ctx): Reply {
  const design = r.cost.design ?? (ctx.model ? chosenOf(ctx.model)?.name : null);
  const parts = [
    design
      ? `${range(r.cost.low, r.cost.high)} is what contractors would charge to build ${design} as drawn: the fixes, the walls, the floors, a kitchen and a bathroom, labour and materials.`
      : `${range(r.cost.low, r.cost.high)} is what contractors would charge for the fixes and the standard suite work, labour and materials.`,
  ];
  const sourced = r.fixGroups.find((g) => g.costLow != null && g.costHigh != null && g.costSource && typeof g.costSource === "object" && (g.costSource as { url?: string }).url);
  if (sourced) {
    const s = sourced.costSource as { url: string; publisher?: string; title?: string };
    parts.push(`The ${sourced.title.toLowerCase()} is ${range(sourced.costLow!, sourced.costHigh!)}, from [${s.publisher ?? s.title ?? "a published price"}](${s.url}).`);
  }
  parts.push("It's a rough range: doing parts yourself costs less, and a contractor's own quote is the real number.");
  return { text: parts.join(" "), visual: { kind: "money" } };
}

// ---- The glossary --------------------------------------------------------------------------------

export function fromGlossary(text: string, pack: Pack | null): Reply | null {
  const term = matchTerm(text);
  const e = term ? entryFor(term) : null;
  return e ? explainReply(e.term, sourcesFor(e, pack)) : null;
}

// ---- Muse Spark ----------------------------------------------------------------------------------

const INSTRUCTIONS = `You are the guide in Basement Ready. A homeowner in Ontario filmed their basement; you help them turn it into a legal second home (a secondary suite). They typed a question. Answer it from the facts you're given, in plain, warm, short words: at most three sentences, no lists, no headings.

Reply with JSON only:
{"text": "<your answer>", "rules": ["<ids of the rules you relied on, from facts.rules>"], "suggested": <one action, or null>}

Hard rules:
- Use only the facts. Never invent a rule, a price, a size or a program. If the facts don't say, say you don't know and who would (their designer, the City's building department, a contractor).
- Never say "qualify", "qualifies", "eligible", "approved" or "guaranteed". Say "may get", "fits", "the City checks".
- Costs are rough ranges in whole thousands, like "$3k–$6k". Money back is the program's own figure.
- Don't name the rule's section yourself: list its id in "rules" and its source is added for you.
- Questions about anything other than this basement, its rules, its costs, its design or its permit: one short honest sentence that you only help with their basement.
- If they want to change the design ("make the bedroom bigger"), suggest {"type":"describe","text":"<their change>"}.
- If they tell you a wall's real length, suggest {"type":"setWall","wallId":"<id from facts.walls>","lengthM":<metres>} only when it's clear which wall they mean; otherwise ask which one.
- If they pick a layout, suggest {"type":"chooseDesign","designId":"<id>"}. If they pick a look, {"type":"setLook","look":"light"|"warm"|"deep"|"plain"}.
- Otherwise "suggested" is null.`;

// The facts Spark answers from: the answer, the design, the plan's walls and the pack's cited lines.
export function facts(ctx: Ctx, pack: Pack | null, step: StepId) {
  const r = ctx.result as FullResult | null;
  const model = ctx.model;
  const chosen = model ? chosenOf(model) : null;
  return {
    step,
    answer: r && {
      headline: r.headline,
      fixes: r.fixGroups.map((g) => ({ title: g.title, rules: g.ruleIds ?? [], cost: g.costLow != null && g.costHigh != null ? range(g.costLow, g.costHigh) : "in the total", why: g.why ?? [] })),
      hiredOut: range(r.cost.low, r.cost.high),
      moneyBack: r.money?.total ? `up to $${Math.round(r.money.total)}` : null,
      moneyIfYes: r.money?.ifYes ? `up to $${Math.round(r.money.ifYes)} more, depending on answers` : null,
      programs: (r.money?.programs ?? []).map((p) => ({ name: p.name, fits: p.qualify, amount: p.amountCAD ?? p.amount ?? null })),
      openQuestions: (r.findings ?? []).filter((f) => f.status === "needs_answer" && !f.answer).map((f) => f.ruleId),
    },
    designs: model?.designs.map((d) => ({ id: d.id, name: d.name, chosen: d.id === chosen?.id, why: (d as { why?: string }).why ?? null })) ?? [],
    look: ctx.look,
    walls: model?.existing.walls.map((w) => ({ id: w.id, kind: w.kind, lengthM: r2(wallLength(w)), guess: Boolean(w.guess) })) ?? [],
    rules: (pack?.rules ?? []).map((x) => ({ id: x.id, title: x.title, plain: x.plain, fix: x.fix.description })),
  };
}

// ---- Guardrails ----------------------------------------------------------------------------------

const BANNED = /\b(qualif\w*|eligib\w*|approv\w*|guarantee\w*)\b/i;
// Split where a sentence ends and the next begins, so "7.2 metres" stays whole.
const sentences = (text: string) => text.split(/(?<=[.!?]["”)]?)\s+/).map((s) => s.trim()).filter(Boolean);
// "$3,000", "$3k", "$3.5k", "3,000 dollars".
const AMOUNT = /\$\s?(\d(?:[\d,]*\d)?(?:\.\d+)?)(?:\s?(k|K|thousand)\b)?|\b(\d(?:[\d,]*\d)?)\s?dollars\b/g;

// Every figure the facts hold: costs (compared in whole thousands) and money back (exact).
function allowed(ctx: Ctx, pack: Pack | null) {
  const r = ctx.result as FullResult | null;
  const costs = new Set<number>();
  const exact = new Set<number>();
  const cost = (n: number | null | undefined) => n != null && n > 0 && costs.add(Math.round(n / 1000));
  if (r) {
    cost(r.cost.low);
    cost(r.cost.high);
    for (const g of r.fixGroups) {
      cost(g.costLow);
      cost(g.costHigh);
    }
    for (const n of [r.money?.total, r.money?.ifYes, ...(r.money?.programs ?? []).flatMap((p) => [p.amount, p.amountCAD])]) if (n) exact.add(Math.round(n));
  }
  for (const x of pack?.rules ?? []) {
    cost(x.fix.costLowCAD);
    cost(x.fix.costHighCAD);
  }
  return { costs, exact };
}

// Keeps what's safe to say: drops a sentence with a banned word or a figure the facts don't hold, and
// says every cost in whole thousands.
export function guard(text: string, ctx: Ctx, pack: Pack | null): string {
  const { costs, exact } = allowed(ctx, pack);
  const kept: string[] = [];
  for (const s of sentences(text)) {
    if (BANNED.test(s)) continue;
    let ok = true;
    const out = s.replace(AMOUNT, (whole, n1: string | undefined, kSuffix: string | undefined, n2: string | undefined) => {
      const n = Number((n1 ?? n2 ?? "").replace(/,/g, "")) * (kSuffix ? 1000 : 1);
      if (!Number.isFinite(n)) return whole;
      if (exact.has(Math.round(n))) return `$${Math.round(n).toLocaleString("en-CA")}`;
      if (costs.has(Math.round(n / 1000))) return k(n);
      ok = false;
      return whole;
    });
    if (ok) kept.push(out);
  }
  return kept.join(" ").slice(0, 700);
}

// A suggested action only if it fits this basement; with the button that offers it.
export function suggestion(raw: unknown, ctx: Ctx): Choice | null {
  const a = raw as Partial<GuideAction> & Record<string, unknown>;
  if (!a || typeof a !== "object") return null;
  const model = ctx.model;
  switch (a.type) {
    case "setWall": {
      const wall = model?.existing.walls.find((w) => w.id === a.wallId);
      const m = Number(a.lengthM);
      if (!wall || !(m >= 0.5 && m <= 30)) return null;
      return { label: `Yes, make it ${r2(m)} m`, action: { type: "setWall", wallId: wall.id, lengthM: r2(m) }, primary: true };
    }
    case "chooseDesign": {
      const d = model?.designs.find((x) => x.id === a.designId);
      return d ? { label: `Use ${d.name} →`, action: { type: "chooseDesign", designId: d.id }, primary: true } : null;
    }
    case "setLook":
      return LOOK_KEYS.includes(a.look as never) ? { label: LOOK_NAMES[a.look as keyof typeof LOOK_NAMES], action: { type: "setLook", look: a.look as never }, primary: true } : null;
    case "describe": {
      const text = typeof a.text === "string" ? a.text.trim().slice(0, 400) : "";
      return text && model ? { label: "Yes, change it", action: { type: "describe", text }, primary: true } : null;
    }
    default:
      return null;
  }
}

type Spark = { text?: unknown; rules?: unknown; suggested?: unknown };

function parse(text: string): Spark {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("muse-spark did not return JSON");
  const json = JSON.parse(text.slice(start, end + 1));
  if (typeof json?.text !== "string") throw new Error("muse-spark's reply has no text");
  return json;
}

const FALLBACK = "I'm not sure about that one. Your designer or the City's building department can tell you for certain.";

export async function askSpark(input: AskInput, call: (body: unknown) => Promise<any> = responses): Promise<Reply> {
  const resp = await call({
    model: "muse-spark-1.3",
    input: [
      { role: "developer", content: INSTRUCTIONS },
      { role: "user", content: JSON.stringify({ facts: facts(input.ctx, input.pack, input.step), homeownerAsked: input.text.slice(0, 500) }) },
    ],
  });
  const json = readReply(resp, parse);
  const said = guard(String(json.text), input.ctx, input.pack) || FALLBACK;
  const cited = (Array.isArray(json.rules) ? json.rules : []).filter((id): id is string => typeof id === "string");
  const rules = (input.pack?.rules ?? []).filter((x) => cited.includes(x.id));
  const sources = cite(rules.map((x) => x.source));
  const offer = suggestion(json.suggested, input.ctx);
  return { text: withSources(said, sources), ...(offer ? { choices: [offer] } : {}) };
}

// ---- All of it -----------------------------------------------------------------------------------

export type Answered = Reply & { by: "script" | "glossary" | "sample" | "spark" | "unavailable" };

export async function answer(input: AskInput, opts: { spark: boolean; call?: (body: unknown) => Promise<any> }): Promise<Answered> {
  const s = scripted(input.text, input.ctx, input.pack);
  if (s) return { ...s, by: "script" };
  const g = fromGlossary(input.text, input.pack);
  if (g) return { ...g, by: "glossary" };
  if (input.sample) return { text: SAMPLE_LINE, by: "sample" };
  if (!opts.spark) return { text: NO_KEY, by: "unavailable" };
  return { ...(await askSpark(input, opts.call)), by: "spark" };
}
