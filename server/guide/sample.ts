// The example's whole thread, scripted: the same script as a real scan (server/guide/script.ts) on the
// example's own result and model, with its progress kept in the browser and sent back with each action.
// Typed questions get the glossary or a polite line (server/guide/ask.ts). It never calls a model.
import { readFileSync } from "node:fs";
import { LOOK_VALUES, waitQuestions } from "../eligibility";
import { currentModel } from "../model/current";
import type { Model } from "../model/types";
import { plansQuestion } from "../plans";
import { answersIn, pricedSample } from "../priced";
import { packFor, type Pack } from "../rules";
import { act, start, sync, type BuildItem, type Ctx, type Reply, type Thread } from "./script";
import type { GuideAction, GuideMessage, LookKey } from "../../src/guide/types";

// What the example remembers between actions: its answers, the layout and the look.
export type SampleProgress = { answers: Record<string, unknown>; chosen: string | null; look: LookKey | "none" | null; confirmed: boolean };
export type SampleThread = Thread & { sample: SampleProgress };

let raw: any = null;
const result = () => (raw ??= JSON.parse(readFileSync("public/samples/sample/result.json", "utf8")));
export const samplePack = (): Pack => packFor(result().municipality ?? "waterloo-on").pack;

// "a window, the stairs and your furnace": what the example's video shows, for the first question.
export function foundIn(model: Model | null): string[] {
  if (!model) return [];
  const kinds = new Set(model.existing.fixtures.map((f) => f.kind));
  return [
    model.existing.openings.some((o) => o.kind === "window") && "a window",
    kinds.has("stairs") && "the stairs",
    kinds.has("furnace") && "your furnace",
  ].filter((x): x is string => Boolean(x));
}

function sampleModel(p: SampleProgress): Ctx["model"] {
  const m = currentModel(result(), {}, "sample")?.model ?? null;
  if (!m) return null;
  const designs = p.chosen && m.designs.some((d) => d.id === p.chosen) ? m.designs.map((d) => ({ ...d, chosen: d.id === p.chosen })) : m.designs;
  return { ...m, designs, existing: { ...m.existing, confirmedAt: p.confirmed ? "2026-10-30T00:00:00.000Z" : null } };
}

// The example's build, in track F's order: one tape number, the submit copy, its money and who builds it.
function sampleBuild(money: number): BuildItem[] {
  return [
    {
      step: "build.permit:tape",
      section: "permit",
      message: "**Start with a tape measure.** Measure the long wall under the window, inside face to inside face, and every size on the permit set follows it.",
      why: "sizes from a video are close, and the City checks them.",
      card: { kind: "tape", id: "tape" },
      visual: { kind: "permit" },
      minutes: 2,
      choices: [{ label: "Done", action: { type: "permitItem", itemId: "build.permit:tape", value: { said: "Done" } }, primary: true }],
    },
    {
      step: "build.submit",
      section: "permit",
      message: "**Your permit set is ready.** Download the submit copy, read it through once, and hand it to the City.",
      why: "it's the set the City reviews for your permit.",
      card: { kind: "download", id: "submit" },
      visual: { kind: "permit" },
      minutes: 1,
      choices: [{ label: "Done", action: { type: "permitItem", itemId: "build.submit", value: { said: "Downloaded it" } }, primary: true }],
    },
    {
      step: "build.money:receipts",
      section: "money",
      message: money
        ? `**You may get up to $${money.toLocaleString("en-CA")} back.** Keep every receipt from the build: the claims ask for them.`
        : "**Keep every receipt from the build.** If a program fits later, its claim asks for them.",
      why: "money back is paid on what you spent, after the work.",
      visual: { kind: "money" },
      minutes: 1,
      choices: [
        { label: "What's the tax credit?", action: { type: "explain", term: "tax_credit" } },
        { label: "Got it", action: { type: "permitItem", itemId: "build.money:receipts", value: { said: "Got it" } }, primary: true },
      ],
    },
    {
      step: "build.builders",
      section: "builders",
      message: "**Who builds it?** A contractor for all of it, or you do some and hire the rest.",
      why: "the electrical and the plumbing need licensed trades either way.",
      card: { kind: "buildPath", id: "path" },
      visual: { kind: "builders" },
      minutes: 1,
      choices: [
        { label: "I'll do some", action: { type: "permitItem", itemId: "build.builders", value: { said: "I'll do some" } } },
        { label: "Hire it all", action: { type: "permitItem", itemId: "build.builders", value: { said: "Hire it all" } }, primary: true },
      ],
    },
  ];
}

export function sampleCtx(p: SampleProgress, now: string): Ctx {
  const r = result();
  const pack = samplePack();
  const answers = { ...answersIn(r), ...p.answers };
  const model = sampleModel(p);
  // The example's wait asks only what changes its answer, and the look.
  const asks = waitQuestions(pack, { household: "relative", answers: { ...answers, ...(p.look ? { look: p.look } : {}) }, findings: r.findings, ruleAsks: [], plans: plansQuestion("relative"), look: true }).filter(
    (a) => a.kind === "rule" || a.kind === "look",
  );
  const priced = asks.length ? null : (pricedSample(r, { model }, p.answers as never) as Ctx["result"] & { money?: { total?: number } });
  return { found: foundIn(model), asks, result: priced, model, look: p.look, build: sampleBuild(priced?.money?.total ?? 0), household: "relative", now };
}

const fresh = (): SampleProgress => ({ answers: {}, chosen: null, look: null, confirmed: false });

export function sampleStart(now: string): SampleThread {
  const p = fresh();
  return { ...start(sampleCtx(p, now)), sample: p };
}

// What the browser sent back, kept only as far as it makes sense: known answers, a real design, a look.
export function cleanSample(body: unknown, now: string): SampleThread {
  const t = body as Partial<SampleThread> | null;
  if (!t || typeof t !== "object" || !Array.isArray(t.messages) || !Array.isArray(t.passed)) return sampleStart(now);
  const s = (t.sample ?? {}) as Partial<SampleProgress>;
  const asked = new Set(result().findings.map((f: { ruleId: string }) => f.ruleId));
  const answers = Object.fromEntries(Object.entries(s.answers ?? {}).filter(([id, v]) => asked.has(id) && (typeof v === "boolean" || v === "unsure")));
  const ids = new Set(currentModel(result(), {}, "sample")?.model.designs.map((d) => d.id) ?? []);
  const p: SampleProgress = {
    answers,
    chosen: typeof s.chosen === "string" && ids.has(s.chosen) ? s.chosen : null,
    look: (LOOK_VALUES as readonly string[]).includes(s.look as string) ? (s.look as SampleProgress["look"]) : null,
    confirmed: s.confirmed === true,
  };
  const messages = (t.messages as GuideMessage[]).slice(-200).filter((m) => m && typeof m.id === "string" && typeof m.text === "string" && (m.from === "guide" || m.from === "you"));
  const thread: Thread = {
    step: typeof t.step === "string" ? t.step : "",
    milestone: t.milestone ?? "answer",
    done: t.done ?? { answer: false, design: false, build: false },
    messages,
    visual: t.visual ?? { kind: "video" },
    passed: t.passed.filter((x): x is string => typeof x === "string").slice(0, 60),
    awaiting: t.awaiting === "wall" || t.awaiting === "look" ? t.awaiting : null,
  };
  return { ...sync(thread, sampleCtx(p, now)).thread, sample: p };
}

// An action on the example: its progress first, then the script's reply. `reply` is the aside, worked
// out by the caller (the glossary, the scripted lines or the polite one).
export function sampleAct(t: SampleThread, action: GuideAction, now: string, reply?: Reply): { thread: SampleThread; messages: GuideMessage[] } {
  const p: SampleProgress = { ...t.sample, answers: { ...t.sample.answers } };
  if (action.type === "answer" && (typeof action.value === "boolean" || action.value === "unsure")) p.answers[action.questionId] = action.value;
  if (action.type === "setLook") p.look = action.look;
  if (action.type === "chooseDesign") p.chosen = action.designId;
  if (action.type === "confirmPlan") p.confirmed = true;
  const r = act(t, action, sampleCtx(p, now), reply);
  return { thread: { ...r.thread, sample: p }, messages: r.messages };
}

// Typed words on the example: describing a change or a wall can't be done without a model.
export const SAMPLE_DESCRIBE: Reply = { text: "In the example the layouts are fixed. On your own basement I'd redraw it the way you say." };
export const SAMPLE_WALL: Reply = { text: "In the example the plan is fixed. On your own basement, tap the wall and type its length." };
