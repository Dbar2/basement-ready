// Answers: the homeowner confirms what the video couldn't show, and the verdict re-checks. Only the
// owner writes them: the browser (or iPhone) that filmed it, with its claim token, or the signed-in
// owner. A shared link reads the plan but can't change it. Mounted from server/index.ts.
import { and, eq, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { db, schema } from "./db";
import { fromWho, STORED_MONEY_QUESTIONS, cleanMoneyAnswer, waitQuestions, WHO_ID, WHO_IDS, type Who } from "./eligibility";
import { cleanPlans, plansHousehold, plansQuestion, plansWords, PLANS_ID } from "./plans";
import type { Property } from "./property";
import { pricedForBasement } from "./priced";
import type { Answers, AnswerValue } from "./recheck";
import { packFor, type Household } from "./rules";
import { TRIAGE } from "./triage";
import { basementFor, parseClaims } from "./workspace";

const UUID = /^[0-9a-f-]{36}$/;
export const NOT_YOURS = "Only the person who filmed this can change its answers. Open it on that device, or sign in.";

function cleanAnswer(v: unknown): number | boolean | "unsure" | null {
  if (typeof v === "boolean" || v === "unsure") return v;
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e6) return v;
  return null;
}

// A rule answer (yes/no, a number, or "unsure"), a money question's own option, who it's for, or what
// they'd like it to be.
export function answerFor(ruleId: string, v: unknown, pack: ReturnType<typeof packFor>["pack"]) {
  if (ruleId === WHO_ID) return WHO_IDS.includes(v as Who) ? (v as Who) : null;
  if (ruleId === PLANS_ID) return cleanPlans(v);
  return STORED_MONEY_QUESTIONS.has(ruleId) ? cleanMoneyAnswer(ruleId, v, pack) : cleanAnswer(v);
}

export async function savedAnswers(basementId: string): Promise<Answers> {
  const rows = await db.select().from(schema.answers).where(eq(schema.answers.basementId, basementId));
  return Object.fromEntries(rows.map((r) => [r.ruleId, r.value as AnswerValue]));
}

// null clears it.
export async function saveAnswer(basementId: string, ruleId: string, value: AnswerValue | null) {
  if (value === null) {
    await db.delete(schema.answers).where(and(eq(schema.answers.basementId, basementId), eq(schema.answers.ruleId, ruleId)));
    return;
  }
  await db
    .insert(schema.answers)
    .values({ basementId, ruleId, value })
    .onConflictDoUpdate({ target: [schema.answers.basementId, schema.answers.ruleId], set: { value, updatedAt: new Date() } });
}

// A re-checked result, written without undoing photos that landed meanwhile (server/photos.ts writes
// those on its own).
export async function saveResult(id: string, result: unknown) {
  const json = JSON.stringify(result);
  const current = sql`${schema.scans.result} -> 'concepts'`;
  await db
    .update(schema.scans)
    .set({ result: sql`CASE WHEN ${current} IS NOT NULL THEN ${json}::jsonb || jsonb_build_object('concepts', ${current}) ELSE ${json}::jsonb END` })
    .where(eq(schema.scans.id, id));
}

const RULE_ASKS = Object.entries(TRIAGE).flatMap(([ruleId, t]) => (t.who === "ask" && t.question ? [{ ruleId, question: t.question, hint: t.hint ?? "" }] : []));

// What the wait screen still asks, each question once (server/eligibility.ts waitQuestions).
export function asksFor(municipality: string | undefined, household: Household, answers: Record<string, unknown>, property: Property | null, result: any) {
  const { pack } = packFor(municipality ?? "waterloo-on");
  return waitQuestions(pack, { household, answers, property, findings: result?.findings ?? null, ruleAsks: RULE_ASKS, plans: plansQuestion(household) });
}

// The scan's basement, and whether this caller owns it.
export async function ownerOf(c: Context, currentUser: (c: Context) => Promise<string | null>) {
  const id = c.req.param("id") ?? "";
  if (!UUID.test(id)) return null;
  const a = await basementFor(id, { userId: await currentUser(c), claims: parseClaims(c.req.header("x-claims")) });
  return a.basement ? { ...a, id } : null;
}

export function mountAnswers(app: Hono, currentUser: (c: Context) => Promise<string | null>) {
  app.post("/api/scans/:id/answers", async (c) => {
    const a = await ownerOf(c, currentUser);
    if (!a) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: NOT_YOURS }, 403);
    const { id, basement } = a;
    const result = a.result as any;
    const body = await c.req.json().catch(() => ({}));
    const ruleId = String(body.ruleId ?? "");
    const { pack } = packFor(result?.municipality ?? basement.municipality ?? "waterloo-on");
    const value = answerFor(ruleId, body.value, pack);
    const known =
      ruleId === WHO_ID || ruleId === PLANS_ID || STORED_MONEY_QUESTIONS.has(ruleId) || (result ? result.findings?.some((f: any) => f.ruleId === ruleId) : ruleId in TRIAGE);
    if (!known) return c.json({ error: "Unknown question." }, 400);
    // null clears an answer; anything else the question doesn't offer is refused, never taken as a clear.
    if (value === null && body.value !== null) return c.json({ error: "Unknown answer." }, 400);
    await saveAnswer(basement.id, ruleId, value);
    // Who it's for brings its rent; a suite for family or a rental settles a "Not sure".
    let household = (basement.household ?? "unsure") as Household;
    if (ruleId === WHO_ID && value !== null) {
      const w = fromWho(value as Who, pack);
      household = w.household;
      await saveAnswer(basement.id, "rent", w.rent);
    }
    if (ruleId === PLANS_ID) household = plansHousehold(value as string | null, household);
    if (household !== basement.household) await db.update(schema.basements).set({ household }).where(eq(schema.basements.id, basement.id));
    const answers = await savedAnswers(basement.id);
    const property = (basement.property ?? null) as Property | null;
    // Answered while the scan runs: kept, and the scan applies them when it finishes.
    if (!result) return c.json({ saved: true, asks: asksFor(basement.municipality, household, answers, property, null) });
    // What they'd like it to be is the wish, unless the video already said one.
    const plans =
      ruleId === PLANS_ID ? { plans: value, wants: result.wants && result.wants !== plansWords(result.plans) ? result.wants : plansWords(value as string | null) } : {};
    // Priced on the design they picked, as every screen shows it (server/priced.ts).
    const updated = await pricedForBasement(id, basement.id, { ...result, household, ...plans }, answers);
    await saveResult(id, updated);
    return c.json({ result: updated, asks: asksFor(updated.municipality, household, answers, property, updated) });
  });

  // Who the suite is for, answered while the scan runs or afterwards. It changes which money fits.
  app.post("/api/scans/:id/household", async (c) => {
    const a = await ownerOf(c, currentUser);
    if (!a) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: NOT_YOURS }, 403);
    const body = await c.req.json().catch(() => ({}));
    const household = String(body.household ?? "");
    if (!["relative", "renter", "unsure"].includes(household)) return c.json({ error: "Pick who it's for." }, 400);
    await db.update(schema.basements).set({ household }).where(eq(schema.basements.id, a.basement.id));
    const result = a.result as any;
    if (!result) return c.json({ saved: true });
    // Re-check with the saved answers: the money and the plan's steps follow who it's for.
    const updated = await pricedForBasement(a.id, a.basement.id, { ...result, household }, await savedAnswers(a.basement.id));
    await saveResult(a.id, updated);
    return c.json({ result: updated });
  });
}
