// The guide's script: what it says next, worked out from the scan, the answers and the thread so far,
// the same way every time. No model and no I/O here. server/guide/routes.ts applies each action through
// the existing code (answers, the model, the workspace), then asks this for the reply; the example
// (server/guide/sample.ts) runs it on its own data. Free text is answered in server/guide/ask.ts.
//
// The order: the wait questions while it measures (one at a time, the look among them), the answer,
// then design (the plan, the layouts, the look), then build (F's list, server/guide/build.ts), then done.
import type { WaitAsk } from "../eligibility";
import type { Model } from "../model/types";
import { entryFor, type Entry } from "./glossary";
import type { CardRef, Choice, GuideAction, GuideMessage, GuideState, LookKey, Milestone, StepId, VisualRef } from "../../src/guide/types";

// What the build needs, in order (server/guide/build.ts, track F, makes it). Each item is one step. Its
// card saves through the workspace, then sends {type: "permitItem", itemId: <its step>, value: {said}};
// the list is worked out again, and a done item (or one they put off) is passed.
export type BuildItem = {
  step: StepId; // "build.permit:<id>", "build.submit", "build.money:<question>", "build.builders"
  section?: "permit" | "money" | "builders";
  message: string;
  why: string;
  card?: CardRef;
  choices?: Choice[];
  visual: VisualRef;
  done?: boolean;
  minutes?: number;
};

type FixGroup = { category: string; title: string; ruleIds?: string[]; costLow?: number | null; costHigh?: number | null; costSource?: unknown; why?: string[] };
export type ResultLike = {
  verdict: "yes" | "fix" | "no";
  headline: string;
  fixGroups: FixGroup[];
  cost: { low: number; high: number };
  money?: { total?: number | null; ifYes?: number | null } | null;
  household?: string | null;
};

export type Ctx = {
  found: string[]; // what the scan has seen so far: "a window", "the stairs", "your furnace"
  asks: WaitAsk[]; // what's still unanswered, in order (server/eligibility.ts waitQuestions, with the look)
  result: ResultLike | null; // null while it measures
  model: (Model & { recommended?: { designId: string; reason: string } | null }) | null;
  look: LookKey | "none" | null; // the look they picked, or "none" for their own words
  build: BuildItem[];
  household?: string | null;
  failed?: { text: string; retry: boolean } | null; // the scan stopped: what happened, and whether trying again can help
  now: string;
};

// The thread as it's stored: the contract's state, plus the steps they've moved past and what the
// next words they type are for ("wall": a wall's length; "look": the look in their own words).
export type Thread = GuideState & { passed: string[]; awaiting?: "wall" | "look" | null };

// A reply to something they typed or asked to have explained (server/guide/ask.ts, the describe route).
export type Reply = { text: string; why?: string; choices?: Choice[]; visual?: VisualRef; card?: CardRef; awaiting?: Thread["awaiting"] };

export const LOOK_NAMES: Record<LookKey, string> = { light: "Light oak", warm: "Warm wood", deep: "Deep green", plain: "Plain" };
export const LOOK_KEYS = Object.keys(LOOK_NAMES) as LookKey[];

// ---- Where the guide is --------------------------------------------------------------------------

const askStep = (a: WaitAsk): StepId => (a.kind === "look" ? "wait.look" : `wait.q:${a.id}`);
// Once the answer is in, only these still come first: they change the verdict or the money it shows.
const beforeAnswer = (a: WaitAsk) => a.kind === "who" || a.kind === "rule";
const DESIGN_STEPS = ["design.plan", "design.layouts", "design.look"];

export function stepOf(ctx: Ctx, t: Pick<Thread, "passed">): StepId {
  const passed = new Set(t.passed);
  if (!ctx.result && ctx.failed) return "failed";
  if (!ctx.result) return ctx.asks[0] ? askStep(ctx.asks[0]) : "wait";
  if (!passed.has("answer")) {
    const first = ctx.asks.find(beforeAnswer);
    return first ? askStep(first) : "answer";
  }
  // A take with no measured plan has nothing to design on: it goes straight to building.
  if (ctx.model) {
    if (!passed.has("design.plan") && !ctx.model.existing.confirmedAt) return "design.plan";
    if (!passed.has("design.layouts")) return "design.layouts";
    if (!passed.has("design.look")) return "design.look";
  }
  if (!passed.has("build")) return "build";
  return ctx.build.find((b) => !b.done && !passed.has(b.step))?.step ?? "done";
}

export function milestoneOf(step: StepId): Milestone {
  if (step.startsWith("design.")) return "design";
  if (step.startsWith("build") || step === "done") return "build";
  return "answer";
}

// The answer is done once it's been said (the home base opens from then on), design once they're past
// the look, build once it's all given.
function doneOf(t: Pick<Thread, "passed">, step: StepId): Record<Milestone, boolean> {
  const m = milestoneOf(step);
  const answered = step === "answer" || t.passed.includes("answer") || m !== "answer";
  return { answer: answered, design: m === "build", build: step === "done" };
}

// ---- What it says --------------------------------------------------------------------------------

type Said = Omit<GuideMessage, "id" | "at" | "from">;

const WHY: Record<string, string> = {
  who: "who lives there and the rent decide which money fits.",
  plans: "the design and the pictures follow it.",
  look: "I'll show your basement finished in it.",
  exit_from_suite: "a separate way in is one of the rules for a second home.",
  plumbing_fixtures_and_shutoff: "pipes already there make a bathroom much cheaper.",
};
const whyFor = (a: WaitAsk) => WHY[a.id] ?? (a.kind === "money" ? "it decides which money fits." : "the video couldn't show it, and the rules ask for it.");

// "$49k–$85k": costs are rough, so whole thousands.
export function k(n: number) {
  const t = Math.round(n / 1000);
  return t < 1 ? "under $1k" : `$${t}k`;
}
export const range = (low: number, high: number) => (k(low) === k(high) ? `about ${k(low)}` : `${k(low)}–${k(high)}`);
// Money back is a program's own figure, so it's exact.
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const num = (n: number) => NUM[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// The fix in a few plain words, and the term that explains it.
const FIX: Record<string, { words: string; term?: string }> = {
  fire: { words: "a fire separation between the two homes", term: "fire_separation" },
  egress: { words: "an escape window for the bedroom", term: "egress_window" },
  exit: { words: "its own way in", term: "separate_entrance" },
  entrance: { words: "its own way in", term: "separate_entrance" },
  height: { words: "more headroom under the beams and ducts", term: "ceiling_height" },
  alarms: { words: "linked smoke and CO alarms", term: "smoke_co_alarms" },
};
const fixWords = (g: FixGroup) => FIX[g.category]?.words ?? low1(g.title);
const fixTerm = (g: FixGroup | undefined) => (g ? (FIX[g.category]?.term ?? null) : null);

function askSaid(a: WaitAsk, ctx: Ctx, first: boolean): Said {
  const q = `**${a.question}**`;
  const lead = !ctx.result
    ? first
      ? ctx.found.length
        ? `I found ${list(ctx.found)}. While I measure: ${q}`
        : `While I measure, a few quick questions. ${q}`
      : q
    : `One thing before the answer: ${q}`;
  const text = a.kind === "rule" && a.hint ? `${lead} ${a.hint}` : lead;
  const choices: Choice[] =
    a.kind === "look"
      ? a.options.map((o) => ({ label: o.label, action: { type: "setLook", look: o.value as LookKey | "none" } }))
      : a.options.map((o) => ({ label: o.label, action: { type: "answer", questionId: a.id, value: o.value } }));
  return { text, why: whyFor(a), choices, visual: { kind: "video" } };
}

function answerSaid(r: ResultLike): Said {
  const parts = [`**${r.headline}**`];
  const fixes = r.fixGroups;
  const priced = (g: FixGroup) => (g.costLow != null && g.costHigh != null ? `, ${range(g.costLow, g.costHigh)}` : "");
  if (fixes.length === 1) parts.push(`The fix: ${fixWords(fixes[0])}${priced(fixes[0])}.`);
  else if (fixes.length > 1) parts.push(`The first: ${fixWords(fixes[0])}${priced(fixes[0])}.`);
  const total = r.money?.total ?? 0;
  const ifYes = r.money?.ifYes ?? 0;
  const back = total > 0 ? `, and you may get up to ${dollars(total)} back` : ifYes > 0 ? `, and up to ${dollars(ifYes)} could come back, depending on a few answers` : "";
  if (r.cost.high > 0) parts.push(`All in, a contractor would charge roughly ${range(r.cost.low, r.cost.high)}${back}.`);
  const term = fixTerm(fixes[0]);
  const entry = term ? entryFor(term) : null;
  const choices: Choice[] = [
    ...(entry ? [{ label: `What's ${article(entry.name)}?`, action: { type: "explain", term: entry.term } as GuideAction }] : []),
    { label: "Why that cost?", action: { type: "ask", text: "Why that cost?" } },
    { label: r.verdict === "no" ? "Show me the plan anyway" : "Show me what it could be", action: { type: "go", to: "design" }, primary: true },
  ];
  return { text: parts.join(" "), choices, visual: { kind: "plan", ...(fixes[0] ? { mark: fixes[0].category } : {}) } };
}
const article = (name: string) => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`);

function planSaid(model: NonNullable<Ctx["model"]>): Said {
  const walls = model.existing.walls.filter((w) => w.guess).length;
  const things = walls + model.existing.fixtures.filter((f) => f.guess).length;
  const guesses = walls
    ? `${cap(num(walls))} ${walls === 1 ? "wall is my guess" : "walls are my guesses"} (dashed). Tap one to fix it, or tell me.`
    : things
      ? `${cap(num(things))} ${things === 1 ? "thing is my guess" : "things are my guesses"} (dashed). Tap one to fix it, or tell me.`
      : "Tap a wall that's off to fix it, or tell me.";
  return {
    text: `Before I design: **is this your basement?** ${guesses}`,
    why: "every room and price is drawn on this plan.",
    choices: [
      { label: "A wall is off", action: { type: "ask", text: "A wall is off" } },
      { label: "Looks right", action: { type: "confirmPlan" }, primary: true },
    ],
    visual: { kind: "planEdit" },
  };
}

export function recommendedOf(model: NonNullable<Ctx["model"]>) {
  const id = model.recommended?.designId;
  const design = model.designs.find((d) => d.id === id) ?? model.designs[0] ?? null;
  const reason = (id === design?.id && model.recommended?.reason) || (design as { why?: string } | null)?.why || "";
  return design && { design, reason };
}

// "your stairs, furnace and window": what the layouts keep where it is.
function kept(model: NonNullable<Ctx["model"]>) {
  const kinds = new Set(model.existing.fixtures.map((f) => f.kind));
  const out = [kinds.has("stairs") && "stairs", kinds.has("furnace") && "furnace", kinds.has("water_heater") && "water heater", model.existing.openings.some((o) => o.kind === "window") && "window"];
  const words = out.filter((x): x is string => Boolean(x));
  return words.length ? `your ${list(words)}` : "what's already there";
}

function layoutsSaid(ctx: Ctx): Said {
  const model = ctx.model!;
  const rec = recommendedOf(model);
  if (!rec) return { text: "I couldn't draw a layout on this plan.", choices: [{ label: "Go on to building", action: { type: "go", to: "build" }, primary: true }], visual: { kind: "plan" } };
  const n = model.designs.length;
  const forWhom = ctx.household === "relative" ? "For family, " : ctx.household === "renter" ? "For a rental, " : "";
  const reason = rec.reason ? `: ${low1(rec.reason.replace(/\.$/, ""))}` : "";
  const text =
    n > 1
      ? `I drew ${num(n)} layouts that keep ${kept(model)} where they are. **${forWhom}I'd start with ${rec.design.name}**${reason}.`
      : `I drew a layout that keeps ${kept(model)} where they are: **${rec.design.name}**${reason}.`;
  const others = model.designs.filter((d) => d.id !== rec.design.id);
  const bedroom = rec.design.layout === "one_bedroom" || rec.design.layout === "two_bedroom";
  return {
    text,
    why: n > 1 ? "it fits what you told me, and it keeps the fixes small." : undefined,
    choices: [
      ...(bedroom ? [{ label: "Bigger bedroom", action: { type: "describe", text: "Make the bedroom bigger" } as GuideAction }] : []),
      ...others.slice(0, 2).map((d) => ({ label: `Show ${d.name}`, action: { type: "ask", text: `Show ${d.name}` } as GuideAction })),
      { label: `Use ${rec.design.name}`, action: { type: "chooseDesign", designId: rec.design.id }, primary: true },
    ],
    visual: { kind: "layouts", designId: rec.design.id },
  };
}

export const chosenOf = (model: NonNullable<Ctx["model"]>) => model.designs.find((d) => d.chosen) ?? model.designs[0] ?? null;

const lookChoices = (except?: LookKey | null): Choice[] => LOOK_KEYS.filter((l) => l !== except).map((l) => ({ label: LOOK_NAMES[l], action: { type: "setLook", look: l } }));

function lookSaid(ctx: Ctx): Said {
  const design = chosenOf(ctx.model!);
  const designId = design?.id ?? "";
  if (ctx.look === "none")
    return {
      text: "**Tell me how you'd like it to look:** the floors, the walls, the kitchen. Or pick one of mine.",
      why: "I'll finish your basement that way in the pictures.",
      choices: lookChoices(),
      visual: { kind: "beforeAfter", designId, look: "custom" },
    };
  if (!ctx.look)
    return {
      text: `Here's ${design?.name ?? "your design"}. **Which look do you like for it?**`,
      why: WHY.look,
      choices: [...lookChoices(), { label: "None of these", action: { type: "setLook", look: "none" } }],
      visual: { kind: "layouts", designId },
    };
  return {
    text: `Here's your basement as you filmed it, and with ${design?.name ?? "your design"} in ${LOOK_NAMES[ctx.look]}. **Drag to compare.** Pick another look, or tell me what you'd like.`,
    choices: [
      { label: "None of these", action: { type: "setLook", look: "none" } },
      { label: "Looks good", action: { type: "go", to: "build" }, primary: true },
    ],
    visual: { kind: "beforeAfter", designId, look: ctx.look },
  };
}

function buildSaid(ctx: Ctx, t: Pick<Thread, "passed">): Said {
  // What only they can give for the permit set; money and builders come after it.
  const items = ctx.build.filter((b) => !b.done && !t.passed.includes(b.step) && (b.section ? b.section === "permit" : b.step.startsWith("build.permit:")));
  const n = items.length;
  const minutes = n && items.every((b) => b.minutes) ? items.reduce((s, b) => s + b.minutes!, 0) : 0;
  const need = n ? ` ${cap(num(n))} ${n === 1 ? "thing" : "things"} only you can give${minutes ? `, about ${minutes} minutes` : ""}. Ready?` : " Nothing's missing.";
  return {
    text: `To build it you need a permit. **I've drawn and filled your permit set** from the scan.${need}`,
    why: "the City needs the permit set before any work starts.",
    choices: [
      { label: "What's a permit set?", action: { type: "explain", term: "permit_set" } },
      { label: "Later", action: { type: "go", to: "home" } },
      { label: n ? "Start" : "See it", action: { type: "go", to: "build" }, primary: true },
    ],
    visual: { kind: "permit" },
  };
}

const doneSaid = (): Said => ({
  text: "That's everything I need. **Your permit set is ready to hand to the City**, and your book has the whole plan: the answer, the design, the money and who builds it.",
  card: { kind: "download", id: "book" },
  choices: [{ label: "Back to my basement", action: { type: "go", to: "home" } }],
  visual: { kind: "permit" },
});

// What the guide says at a step.
export function said(ctx: Ctx, t: Pick<Thread, "passed" | "messages">, step: StepId): Said {
  if (step === "failed")
    return {
      text: ctx.failed!.text,
      ...(ctx.failed!.retry ? { choices: [{ label: "Try again", action: { type: "ask", text: "Try again" }, primary: true }] } : {}),
      visual: { kind: "video" },
    };
  if (step === "wait") return { text: "Still measuring. I'll have your answer in a minute or two.", visual: { kind: "video" } };
  if (step.startsWith("wait.")) {
    const a = ctx.asks.find((x) => askStep(x) === step)!;
    return askSaid(a, ctx, !t.messages.some((m) => m.from === "guide"));
  }
  if (step === "answer") return answerSaid(ctx.result!);
  if (step === "design.plan") return planSaid(ctx.model!);
  if (step === "design.layouts") return layoutsSaid(ctx);
  if (step === "design.look") return lookSaid(ctx);
  if (step === "build") return buildSaid(ctx, t);
  if (step === "done") return doneSaid();
  const item = ctx.build.find((b) => b.step === step)!;
  return { text: item.message, why: item.why, card: item.card, choices: item.choices, visual: item.visual };
}

// ---- Moving on -----------------------------------------------------------------------------------

const message = (t: Pick<Thread, "messages">, extra: GuideMessage[], m: Omit<GuideMessage, "id">): GuideMessage => ({ ...m, id: `m${t.messages.length + extra.length + 1}` });

function withStep(t: Thread, ctx: Ctx, messages: GuideMessage[], awaiting: Thread["awaiting"]): Thread {
  const step = stepOf(ctx, t);
  const all = [...t.messages, ...messages];
  const visual = [...all].reverse().find((m) => m.visual)?.visual ?? { kind: "video" };
  return { ...t, step, milestone: milestoneOf(step), done: doneOf(t, step), messages: all, visual, awaiting };
}

// A fresh thread: the first thing the guide says.
export function start(ctx: Ctx): Thread {
  const t: Thread = { step: "", milestone: "answer", done: { answer: false, design: false, build: false }, messages: [], visual: { kind: "video" }, passed: [], awaiting: null };
  return sync(t, ctx).thread;
}

// The scan moved on without them (the result landed, an answer elsewhere settled a question): say the
// new step. Nothing new to say leaves the thread as it is.
export function sync(t: Thread, ctx: Ctx): { thread: Thread; messages: GuideMessage[] } {
  const step = stepOf(ctx, t);
  if (step === t.step && t.messages.length) return { thread: { ...t, done: doneOf(t, step) }, messages: [] };
  const m = message(t, [], { from: "guide", at: ctx.now, ...said(ctx, t, step) });
  const thread = withStep(t, ctx, [m], step === t.step ? t.awaiting : null);
  return { thread, messages: [m] };
}

// What they said, as their own bubble: the choice's label when they tapped one (the newest that
// offers it), else their words.
function youSaid(t: Thread, action: GuideAction, ctx: Ctx): string | null {
  const same = JSON.stringify(action);
  const tapped = [...t.messages].reverse().flatMap((m) => (m.from === "guide" ? (m.choices ?? []) : [])).find((c) => JSON.stringify(c.action) === same);
  if (tapped) return tapped.label.replace(/\s*→$/, "");
  switch (action.type) {
    case "chooseDesign":
      return `Use ${ctx.model?.designs.find((d) => d.id === action.designId)?.name ?? "this layout"}`;
    case "confirmPlan":
      return "Looks right";
    case "ask":
    case "describe":
      return action.text;
    case "setWall":
      return `That wall is ${action.lengthM} m.`;
    case "setLook":
      return action.look === "none" ? "None of these" : LOOK_NAMES[action.look];
    case "answer":
      return typeof action.value === "boolean" ? (action.value ? "Yes" : "No") : String(action.value ?? "");
    case "permitItem": {
      // A card says what it saved: "Walls 7.56 m and 5.52 m, ceiling 2.08 m".
      const s = (action.value as { said?: unknown } | null)?.said;
      return typeof s === "string" && s.trim() ? s.trim().slice(0, 200) : null;
    }
    case "explain":
      return `What's ${article(entryFor(action.term)?.name ?? action.term.replace(/_/g, " "))}?`;
    default:
      return null;
  }
}

// The steps an action moves them past.
function passing(t: Thread, action: GuideAction, ctx: Ctx): string[] {
  const at = stepOf(ctx, t);
  switch (action.type) {
    case "confirmPlan":
      return ["design.plan"];
    case "chooseDesign":
      return ["design.layouts"];
    case "permitItem":
      return ctx.build.filter((b) => b.step === action.itemId || b.step.endsWith(`:${action.itemId}`)).map((b) => b.step);
    case "go": {
      if (action.to === "home") return [];
      // Inside the milestone already: past its opening step ("Start" on the build intro).
      if (milestoneOf(at) === action.to) return at === "build" || at === "answer" ? [at] : [];
      const order: Milestone[] = ["answer", "design", "build"];
      const before = order.slice(0, order.indexOf(action.to));
      return [...(before.includes("answer") ? ["answer"] : []), ...(before.includes("design") ? DESIGN_STEPS : [])];
    }
    default:
      return [];
  }
}

const QUESTION = /^wait\./;

// An action, once routes.ts has applied it: their bubble, then the guide's reply. `reply` is what
// ask.ts, the glossary or the describe route said back, for an action that's an aside; anything else
// moves the script on and the guide says the next step.
export function act(t: Thread, action: GuideAction, ctx: Ctx, reply?: Reply): { thread: Thread; messages: GuideMessage[] } {
  if (action.type === "go" && action.to === "home") return { thread: t, messages: [] };
  const out: GuideMessage[] = [];
  const you = youSaid(t, action, ctx);
  if (you) out.push(message(t, out, { from: "you", text: you, at: ctx.now }));
  const before = stepOf(ctx, t);
  const moved: Thread = { ...t, passed: [...new Set([...t.passed, ...passing(t, action, ctx)])] };
  const step = stepOf(ctx, moved);
  const aside = reply ?? (action.type === "explain" ? explainReply(action.term) : null);
  if (aside && step === before) {
    const current = said(ctx, moved, step);
    if (QUESTION.test(step)) {
      // A question's still open: answer the aside, then ask it again.
      out.push(message(t, out, { from: "guide", at: ctx.now, ...replySaid(aside) }));
      // Without a visual of its own, so the aside's drawing stays in the pane.
      const { visual: _visual, ...again } = current;
      out.push(message(t, out, { from: "guide", at: ctx.now, ...again, text: `Back to my question: ${current.text.slice(current.text.indexOf("**"))}` }));
    } else {
      // Otherwise the way on stays one tap away, under the reply.
      const on = current.choices?.find((c) => c.primary);
      const gotIt = on && action.type === "explain" ? { ...on, label: `Got it, ${low1(on.label)}` } : on;
      const choices = [...(aside.choices ?? []), ...(gotIt && !aside.choices?.some((c) => c.primary) ? [gotIt] : [])];
      out.push(message(t, out, { from: "guide", at: ctx.now, ...replySaid({ ...aside, choices }) }));
    }
    return { thread: withStep(moved, ctx, out, aside.awaiting ?? null), messages: out };
  }
  if (aside) out.push(message(t, out, { from: "guide", at: ctx.now, ...replySaid(aside) }));
  out.push(message(t, out, { from: "guide", at: ctx.now, ...said(ctx, moved, step) }));
  return { thread: withStep(moved, ctx, out, null), messages: out };
}

const replySaid = (r: Reply): Said => ({ text: r.text, ...(r.why ? { why: r.why } : {}), ...(r.choices?.length ? { choices: r.choices } : {}), ...(r.visual ? { visual: r.visual } : {}), ...(r.card ? { card: r.card } : {}) });

// "What's a fire separation?": the glossary's plain answer, its drawing, and where the rule comes from
// (sources are added by the caller, which has the rules pack: see withSources).
export function explainReply(term: string, sources: string[] = []): Reply {
  const e: Entry | null = entryFor(term);
  if (!e) return { text: "I don't have a plain answer for that one yet. Ask me in your own words." };
  return { text: withSources(e.text, sources), choices: e.more, visual: { kind: "explain", term: e.term } };
}

export const withSources = (text: string, sources: string[]) => (sources.length ? `${text} Source: ${sources.join("; ")}.` : text);
