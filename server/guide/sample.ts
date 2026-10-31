// The example's whole thread, scripted: the same script as a real scan (server/guide/script.ts) on the
// example's own result and model, with its progress kept in the browser and sent back with each action.
// Its build is track F's list (server/guide/build.ts) on the workspace the browser keeps for it, sent
// with each action too. Typed questions get the glossary or a polite line (server/guide/ask.ts). It
// never calls a model.
import { readFileSync } from "node:fs";
import { cleanMoneyAnswer, LOOK_VALUES, STORED_MONEY_QUESTIONS, waitQuestions } from "../eligibility";
import { currentModel } from "../model/current";
import type { Model } from "../model/types";
import { plansQuestion } from "../plans";
import { answersIn, pricedSample } from "../priced";
import { packFor, type Pack } from "../rules";
import { sampleBuildList } from "./build";
import { act, start, type Ctx, type Reply, type Thread } from "./script";
import type { GuideAction, GuideMessage, LookKey } from "../../src/guide/types";

// What the example remembers between actions: its answers (the rules' and the money's), the layout and
// the look. Its workspace (the tape, the owner, the sheets looked over) is the browser's, as the cards
// save it (src/workspaceApi.ts).
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

export type SampleWorkspace = { profile: unknown; state: unknown } | null | undefined;
const BLANK = { profile: null, state: {} };

// A rule's yes, no or not sure, or a money question's own option.
function sampleAnswer(id: string, v: unknown): unknown {
  if (STORED_MONEY_QUESTIONS.has(id)) return cleanMoneyAnswer(id, v, samplePack());
  const asked = result().findings.some((f: { ruleId: string }) => f.ruleId === id);
  return asked && (typeof v === "boolean" || v === "unsure") ? v : null;
}

export function sampleCtx(p: SampleProgress, now: string, ws?: SampleWorkspace): Ctx {
  const r = result();
  const pack = samplePack();
  const answers = { ...answersIn(r), ...p.answers };
  const model = sampleModel(p);
  // The example's wait asks only what changes its answer, and the look.
  const asks = waitQuestions(pack, { household: "relative", answers: { ...answers, ...(p.look ? { look: p.look } : {}) }, findings: r.findings, ruleAsks: [], plans: plansQuestion("relative"), look: true }).filter(
    (a) => a.kind === "rule" || a.kind === "look",
  );
  const priced = asks.length ? null : (pricedSample(r, { model }, p.answers as never) as Ctx["result"] & { money?: { total?: number } });
  // The money answers only: the example's permit routes draw the sheets with no rule answers (the cards
  // check them there), so the sheets looked over here have to be the same drawings.
  const money = Object.fromEntries(Object.entries(p.answers).filter(([id]) => STORED_MONEY_QUESTIONS.has(id)));
  // Drawing the permit set takes a second or two, so the list is worked out only once the build is reached.
  let build: Ctx["build"] | null = null;
  return {
    found: foundIn(model),
    asks,
    result: priced,
    model,
    look: p.look,
    get build() {
      return (build ??= priced ? buildFor(ws ?? BLANK, money) : []);
    },
    household: "relative",
    now,
  };
}

// The same workspace and answers give the same list: the last few are kept (one action asks for it more
// than once).
const lists = new Map<string, Ctx["build"]>();
function buildFor(ws: NonNullable<SampleWorkspace>, money: Record<string, unknown>): Ctx["build"] {
  const key = JSON.stringify([ws, money]);
  const kept = lists.get(key);
  if (kept) return kept;
  const items = sampleBuildList(ws, money).items;
  lists.set(key, items);
  if (lists.size > 20) lists.delete(lists.keys().next().value!);
  return items;
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
  const answers = Object.fromEntries(Object.entries(s.answers ?? {}).filter(([id, v]) => sampleAnswer(id, v) !== null));
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
  // Not moved on here: the action that comes with it says what's next, once (a card has just saved the
  // workspace it's sent with, so the list may already be past the step this thread is on).
  return { ...thread, sample: p };
}

// An action on the example: its progress first, then the script's reply. `reply` is the aside, worked
// out by the caller (the glossary, the scripted lines or the polite one).
export function sampleAct(t: SampleThread, action: GuideAction, now: string, reply?: Reply, ws?: SampleWorkspace): { thread: SampleThread; messages: GuideMessage[] } {
  const p: SampleProgress = { ...t.sample, answers: { ...t.sample.answers } };
  if (action.type === "answer") {
    const v = sampleAnswer(action.questionId, action.value);
    if (v !== null) p.answers[action.questionId] = v;
  }
  if (action.type === "setLook") p.look = action.look;
  if (action.type === "chooseDesign") p.chosen = action.designId;
  if (action.type === "confirmPlan") p.confirmed = true;
  const r = act(t, action, sampleCtx(p, now, ws), reply);
  return { thread: { ...r.thread, sample: p }, messages: r.messages };
}

// Typed words on the example: describing a change or a wall can't be done without a model.
export const SAMPLE_DESCRIBE: Reply = { text: "In the example the layouts are fixed. On your own basement I'd redraw it the way you say." };
export const SAMPLE_WALL: Reply = { text: "In the example the plan is fixed. On your own basement, tap the wall and type its length." };
