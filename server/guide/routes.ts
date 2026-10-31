// The guide's routes (mounted from server/index.ts):
//   GET  /api/scans/:id/guide            the thread as it stands, moved on if the scan has (the wait polls it)
//   POST /api/scans/:id/guide {action}   their tap or their words; returns the new messages and the thread
// Each action goes through the existing code first: answers through the answers route, plan edits
// through server/model/edit.ts, described changes through server/model/describe.ts, the model saved on
// the workspace. Then the script (server/guide/script.ts) says what's next. The thread is kept on the
// workspace (`state.guide`, written by the server only, like `looks`). The example keeps its thread in
// the browser, which sends it back with each action; it never calls a model.
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { db, schema } from "../db";
import { LOOK_ID, LOOK_VALUES, waitQuestions } from "../eligibility";
import { clientIp, metaKey, overSpend } from "../limits";
import { currentModel } from "../model/current";
import { describeChange } from "../model/describe";
import { applyEdits, withTape } from "../model/edit";
import { seedDesigns } from "../model/seed";
import type { Existing, Model } from "../model/types";
import { NOT_YOURS, ownerOf, saveAnswer, savedAnswers } from "../answers";
import { plansQuestion } from "../plans";
import type { Property } from "../property";
import { pricedForBasement } from "../priced";
import { packFor, type Household } from "../rules";
import { TRIAGE } from "../triage";
import { loadWorkspace, saveWorkspace, type StoredState } from "../workspace";
import { answer, askSpark, SAMPLE_LINE } from "./ask";
import { entryFor, sourcesFor } from "./glossary";
import { cleanSample, SAMPLE_DESCRIBE, SAMPLE_WALL, sampleAct, sampleCtx, samplePack, sampleStart } from "./sample";
import { act, chosenOf, explainReply, start, sync, type BuildItem, type Ctx, type Reply, type Thread } from "./script";
import type { GuideAction, LookKey } from "../../src/guide/types";

const ASK_PER_IP_PER_HOUR = Number(process.env.GUIDE_ASK_PER_IP_PER_HOUR ?? 30);
// The same rule questions the wait screen asks before there's a result (server/answers.ts).
const RULE_ASKS = Object.entries(TRIAGE).flatMap(([ruleId, t]) => (t.who === "ask" && t.question ? [{ ruleId, question: t.question, hint: t.hint ?? "" }] : []));

type GuideStored = StoredState & { guide?: Thread };

// ---- What an action may be -----------------------------------------------------------------------

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// The action as sent, kept only in a shape the script knows.
export function cleanAction(raw: unknown): GuideAction | null {
  const a = raw as Record<string, unknown> | null;
  if (!a || typeof a !== "object") return null;
  switch (a.type) {
    case "answer":
      return str(a.questionId, 80) ? { type: "answer", questionId: str(a.questionId, 80), value: a.value } : null;
    case "confirmPlan":
      return { type: "confirmPlan" };
    case "setWall": {
      const m = Number(a.lengthM);
      return str(a.wallId, 60) && m >= 0.5 && m <= 30 ? { type: "setWall", wallId: str(a.wallId, 60), lengthM: m } : null;
    }
    case "chooseDesign":
      return str(a.designId, 60) ? { type: "chooseDesign", designId: str(a.designId, 60) } : null;
    case "setLook":
      return (LOOK_VALUES as readonly string[]).includes(a.look as string) ? { type: "setLook", look: a.look as LookKey | "none" } : null;
    case "describe":
      return str(a.text, 400) ? { type: "describe", text: str(a.text, 400) } : null;
    case "permitItem":
      return str(a.itemId, 60) ? { type: "permitItem", itemId: str(a.itemId, 60), value: a.value } : null;
    case "explain":
      return entryFor(str(a.term, 40)) ? { type: "explain", term: str(a.term, 40) } : null;
    case "go":
      return ["answer", "design", "build", "home"].includes(a.to as string) ? { type: "go", to: a.to as "answer" } : null;
    case "ask":
      return str(a.text, 500) ? { type: "ask", text: str(a.text, 500) } : null;
    default:
      return null;
  }
}

// A stored thread, if it still has the shape the script writes.
const storedThread = (t: unknown): Thread | null => {
  const x = t as Thread | null;
  return x && typeof x === "object" && Array.isArray(x.messages) && Array.isArray(x.passed) && typeof x.step === "string" ? x : null;
};

// ---- A real scan's context -----------------------------------------------------------------------

// What the build still needs (server/guide/build.ts, track F). Until it lands the build is the permit
// set itself: the script goes from its intro to the download.
async function buildFor(_scanId: string, _basementId: string): Promise<BuildItem[]> {
  return [];
}

type Access = NonNullable<Awaited<ReturnType<typeof ownerOf>>>;

async function contextFor(a: Access, now: string) {
  const { basement, id } = a;
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, id));
  const answers = (await savedAnswers(basement.id)) as Record<string, unknown>;
  const household = (basement.household ?? "unsure") as Household;
  const raw = scan?.result as any;
  const result = raw?.findings ? await pricedForBasement(id, basement.id, { ...raw, household: basement.household ?? raw.household }, answers as never) : null;
  const municipality = result?.municipality ?? basement.municipality ?? "waterloo-on";
  const { pack } = packFor(municipality);
  const w = await loadWorkspace(basement.id);
  const model = result ? (currentModel(result, w.state, id)?.model ?? null) : null;
  const asks = waitQuestions(pack, {
    household,
    answers,
    property: (basement.property ?? null) as Property | null,
    findings: result?.findings ?? null,
    ruleAsks: RULE_ASKS,
    plans: plansQuestion(household),
    look: true,
  });
  const look = (LOOK_VALUES as readonly string[]).includes(answers[LOOK_ID] as string) ? (answers[LOOK_ID] as LookKey | "none") : null;
  const ctx: Ctx = { found: [], asks, result, model, look, build: await buildFor(id, basement.id), household, now };
  return { ctx, pack, state: w.state as GuideStored, municipality };
}

// ---- Applying an action --------------------------------------------------------------------------

const asks = new Map<string, number[]>();
function allowAsk(ip: string) {
  const now = Date.now();
  const recent = (asks.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= ASK_PER_IP_PER_HOUR) return false;
  asks.set(ip, [...recent, now]);
  if (asks.size > 5000) asks.clear();
  return true;
}

const saveModel = (basementId: string, model: Model) => saveWorkspace(basementId, { state: { model } });
const withChosen = (model: Model, designId: string): Model => ({ ...model, designs: model.designs.map((d) => ({ ...d, chosen: d.id === designId })) });

// "Looks right": the plan as it stands, every guess now theirs, and every design drawn again on it
// (as src/studio/PlanConfirm.tsx does), keeping the kind of design they had picked.
export function confirmed(model: Model, now: string): Model {
  const existing: Existing = {
    ...model.existing,
    walls: model.existing.walls.map((w) => ({ ...w, guess: false })),
    fixtures: model.existing.fixtures.map((f) => ({ ...f, guess: false })),
    confirmedAt: now,
  };
  const designs = seedDesigns(existing, { finishes: model.mood.finishes, colours: model.mood.colours, now });
  const was = model.designs.find((d) => d.chosen)?.id;
  const keep = designs.some((d) => d.id === was) ? was : designs[0]?.id;
  return { ...model, existing, designs: designs.map((d) => ({ ...d, chosen: d.id === keep })) };
}

// Their words, changed into the chosen design by Muse Spark (the studio's describe), applied.
async function described(basementId: string, model: Model, text: string): Promise<Reply> {
  const design = chosenOf(model);
  if (!design) return { text: "There's no design to change yet." };
  const p = await describeChange(design, model.existing, text);
  if (p.edits.length) {
    const next = applyEdits(design, p.edits);
    await saveModel(basementId, { ...model, designs: model.designs.map((d) => (d.id === design.id ? next : d)) });
  }
  return { text: p.edits.length ? p.summary : `${p.summary} Nothing changed.` };
}

type Applied = { reply?: Reply; error?: { text: string; status: 400 | 403 | 429 | 502 | 503 } };

// The rest of an answer's work (who it's for, the re-check) is the answers route's: it's called as is.
async function viaAnswersRoute(app: Hono, c: Context, questionId: string, value: unknown) {
  const res = await app.request(`/api/scans/${c.req.param("id")}/answers`, {
    method: "POST",
    headers: { "content-type": "application/json", ...pick(c, ["x-claims", "authorization", "cookie"]) },
    body: JSON.stringify({ ruleId: questionId, value }),
  });
  return res.ok ? null : ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "That answer didn't save.";
}
const pick = (c: Context, names: string[]) => Object.fromEntries(names.flatMap((n) => (c.req.header(n) ? [[n, c.req.header(n)!]] : [])));

type Before = Awaited<ReturnType<typeof contextFor>>;

async function apply(app: Hono, c: Context, a: Access, action: GuideAction, before: Before, thread: Thread): Promise<Applied> {
  const { ctx, pack, state } = before;
  const basementId = a.basement.id;
  const model = ctx.model;
  switch (action.type) {
    case "answer": {
      const failed = await viaAnswersRoute(app, c, action.questionId, action.value);
      return failed ? { error: { text: failed, status: 400 } } : {};
    }
    case "setLook": {
      await saveAnswer(basementId, LOOK_ID, action.look);
      // The finishes the other pages already read follow the look.
      if (action.look === "light" || action.look === "warm" || action.look === "deep") await saveWorkspace(basementId, { state: { ideas: { ...state.ideas, finish: action.look } } });
      return {};
    }
    case "confirmPlan":
      if (model) await saveModel(basementId, confirmed(model, ctx.now));
      return {};
    case "setWall": {
      if (!model?.existing.walls.some((w) => w.id === action.wallId)) return { error: { text: "That wall isn't on the plan.", status: 400 } };
      await saveModel(basementId, { ...model, existing: withTape(model.existing, action.wallId, action.lengthM) });
      return { reply: { text: `Got it: that wall is ${action.lengthM} m, and every size follows it.`, visual: { kind: "planEdit" } } };
    }
    case "chooseDesign":
      if (!model?.designs.some((d) => d.id === action.designId)) return { error: { text: "That layout isn't one of yours.", status: 400 } };
      await saveModel(basementId, withChosen(model, action.designId));
      return {};
    case "describe": {
      if (!model) return { reply: { text: "There's no design to change yet." } };
      const busy = await sparkBusy(c);
      if (busy) return { error: busy };
      try {
        return { reply: { ...(await described(basementId, model, action.text)), visual: { kind: "beforeAfter", designId: chosenOf(model)?.id ?? "", look: "custom" } } };
      } catch (err) {
        console.error(`[guide] describe failed: ${err instanceof Error ? err.message : err}`);
        return { error: { text: "muse-spark didn't answer. Try again.", status: 502 } };
      }
    }
    case "explain": {
      const e = entryFor(action.term);
      return { reply: explainReply(action.term, e ? sourcesFor(e, pack) : []) };
    }
    case "ask": {
      const input = { text: action.text, step: thread.step, ctx, pack, sample: false };
      const local = await answer(input, { spark: false });
      if (local.by !== "unavailable") return { reply: local };
      // After "None of these", what they type is the look in their own words.
      if (thread.awaiting === "look") return apply(app, c, a, { type: "describe", text: action.text }, before, thread);
      const busy = await sparkBusy(c);
      if (busy) return { error: busy };
      try {
        return { reply: await askSpark(input) };
      } catch (err) {
        console.error(`[guide] ask failed: ${err instanceof Error ? err.message : err}`);
        return { error: { text: "muse-spark didn't answer. Try again.", status: 502 } };
      }
    }
    default:
      return {};
  }
}

// Why Spark can't be asked right now, or null.
async function sparkBusy(c: Context): Promise<Applied["error"] | null> {
  if (!metaKey()) return { text: "Typed questions need the AI key on this server.", status: 503 };
  if (await overSpend()) return { text: "That's all the questions I can answer today. They come back at midnight, Eastern time.", status: 429 };
  if (!allowAsk(clientIp(c))) return { text: "That's a lot of questions for one hour. Try again later.", status: 429 };
  return null;
}

// ---- The example ---------------------------------------------------------------------------------

function sampleReply(action: GuideAction, thread: { awaiting?: Thread["awaiting"]; step: string }, ctx: Ctx): Promise<Reply | undefined> {
  const pack = samplePack();
  if (action.type === "explain") {
    const e = entryFor(action.term);
    return Promise.resolve(explainReply(action.term, e ? sourcesFor(e, pack) : []));
  }
  if (action.type === "describe") return Promise.resolve(SAMPLE_DESCRIBE);
  if (action.type === "setWall") return Promise.resolve(SAMPLE_WALL);
  if (action.type !== "ask") return Promise.resolve(undefined);
  // What they type after "A wall is off" or "None of these" is a wall or a look, which the example can't redraw.
  return answer({ text: action.text, step: thread.step, ctx, pack, sample: true }, { spark: false }).then((r) =>
    r.by !== "sample" ? r : thread.awaiting === "wall" ? SAMPLE_WALL : thread.awaiting === "look" ? SAMPLE_DESCRIBE : { text: SAMPLE_LINE },
  );
}

// ---- Mounting ------------------------------------------------------------------------------------

const NO_STORE = { "Cache-Control": "no-store" };

export function mountGuide(app: Hono, currentUser: (c: Context) => Promise<string | null> = async () => null) {
  app.get("/api/scans/:id/guide", async (c) => {
    if (c.req.param("id") === "sample") return c.json(sampleStart(new Date().toISOString()), 200, NO_STORE);
    const a = await ownerOf(c, currentUser);
    if (!a) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: NOT_YOURS }, 403);
    const { ctx, state } = await contextFor(a, new Date().toISOString());
    const was = storedThread(state.guide);
    const { thread, messages } = was ? sync(was, ctx) : { thread: start(ctx), messages: [] };
    if (!was || messages.length) await saveWorkspace(a.basement.id, { state: { guide: thread } as Partial<GuideStored> });
    return c.json(thread, 200, NO_STORE);
  });

  app.post("/api/scans/:id/guide", async (c) => {
    const body = await c.req.json().catch(() => null);
    const action = cleanAction(body?.action);
    if (!action) return c.json({ error: "I didn't understand that. Try again." }, 400);
    const now = new Date().toISOString();

    if (c.req.param("id") === "sample") {
      const thread = cleanSample(body?.state, now);
      const reply = await sampleReply(action, thread, sampleCtx(thread.sample, now));
      const r = sampleAct(thread, action, now, reply);
      return c.json({ messages: r.messages, state: r.thread }, 200, NO_STORE);
    }

    const a = await ownerOf(c, currentUser);
    if (!a) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: NOT_YOURS }, 403);
    const before = await contextFor(a, now);
    const thread = storedThread(before.state.guide) ?? start(before.ctx);
    const applied = await apply(app, c, a, action, before, thread);
    if (applied.error) return c.json({ error: applied.error.text }, applied.error.status);
    // The scan as it is now, after the action.
    const after = await contextFor(a, now);
    const r = act(thread, action, after.ctx, applied.reply);
    await saveWorkspace(a.basement.id, { state: { guide: r.thread } as Partial<GuideStored> });
    return c.json({ messages: r.messages, state: r.thread }, 200, NO_STORE);
  });
}
