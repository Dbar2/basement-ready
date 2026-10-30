// The photos job. It's queued as soon as SAM's finds are in (about a minute into the scan), not after
// the answer, and runs beside the scan (server/jobs.ts gives each job kind its own slot): the frames
// come from the finds as they were streamed, the still wide shot, who it's for, what they said they
// want and, when the 3D already has it, how far each frame sees. Each photo is saved and streamed to
// the wait screen as a `photo` event the moment it lands: { n, url, title, kept, checked, frame }.
//
// The scan's answer and the photos finish in either order. When they're all done a `photos` event
// holds the final set, and whichever of the two finishes last writes it into the result
// (settlePhotos), so neither undoes the other.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { realWork, renderFrom, type Concept, type Concepts, type PhotoInputs, type PhotoWork } from "./concepts";
import { db, schema } from "./db";
import { enqueueOnce } from "./jobs";
import type { Detection } from "./pipeline";
import { plansHousehold, PLANS_ID } from "./plans";
import { MAX_ROOMS } from "./rooms";
import type { Household } from "./rules";

const PLANS_WAIT_MS = 10_000;

async function plansAnswer(basementId: string): Promise<string | null> {
  const [row] = await db.select().from(schema.answers).where(and(eq(schema.answers.basementId, basementId), eq(schema.answers.ruleId, PLANS_ID)));
  return typeof row?.value === "string" ? row.value : null;
}

export async function photoInputs(scanId: string): Promise<PhotoInputs | null> {
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId));
  if (!scan || scan.status === "error") return null;
  const [basement] = await db.select().from(schema.basements).where(eq(schema.basements.id, scan.basementId));
  const inputs = (scan.inputs ?? {}) as { wideAt?: number; photos?: unknown };
  const plans = await plansAnswer(scan.basementId);
  const r = scan.result as any;
  if (r) {
    return {
      detections: r.detections ?? [],
      vision: r.vision ?? null,
      household: r.household ?? "unsure",
      frameCount: r.frameCount ?? 0,
      rooms: r.rooms ?? [],
      mainRoom: (r.rooms ?? []).find((x: { index: number }) => x.index === r.mainRoom) ?? null,
      wideAt: r.capture?.wideAt ?? inputs.wideAt ?? null,
      plans: r.plans ?? plans,
      photoTake: Boolean(inputs.photos),
    };
  }
  const events = await db
    .select()
    .from(schema.scanEvents)
    .where(and(eq(schema.scanEvents.scanId, scanId), inArray(schema.scanEvents.type, ["find", "log"])))
    .orderBy(schema.scanEvents.id);
  const frameCount = events.map((e) => (e.data as { frameCount?: number } | null)?.frameCount).find((n) => typeof n === "number") ?? 0;
  return {
    detections: events.flatMap((e) => (e.type === "find" ? ((e.data as { detections?: Detection[] } | null)?.detections ?? []) : [])),
    vision: null,
    household: plansHousehold(plans, (basement?.household ?? "unsure") as Household),
    frameCount,
    // Any area whose 3D is already saved helps pick the widest frames; nothing waits for the rest.
    rooms: Array.from({ length: MAX_ROOMS }, (_, index) => ({ index, has3d: true })),
    mainRoom: null,
    wideAt: inputs.wideAt ?? null,
    plans,
    photoTake: Boolean(inputs.photos),
  };
}

async function event(scanId: string, startedAt: Date | null, type: "photo" | "photos", text: string, data: unknown) {
  await db.insert(schema.scanEvents).values({ scanId, at: startedAt ? (Date.now() - startedAt.getTime()) / 1000 : 0, type, text, data });
}

export async function photosSoFar(scanId: string): Promise<Concepts> {
  const rows = await db
    .select()
    .from(schema.scanEvents)
    .where(and(eq(schema.scanEvents.scanId, scanId), inArray(schema.scanEvents.type, ["photo", "photos"])))
    .orderBy(schema.scanEvents.id);
  const final = rows.filter((e) => e.type === "photos").at(-1);
  if (final) return final.data as Concepts;
  const items = rows.map((e) => e.data as Concept).map(({ n, frame, title, kept, checked }) => ({ n, frame, title, kept, checked }));
  return { status: "pending", items: items.sort((a, b) => a.n - b.n) };
}

// The final set into the result, once both are there.
export async function settlePhotos(scanId: string) {
  const c = await photosSoFar(scanId);
  if (c.status === "pending") return;
  await db
    .update(schema.scans)
    .set({ result: sql`jsonb_set(${schema.scans.result}, '{concepts}', ${JSON.stringify(c)}::jsonb)` })
    .where(and(eq(schema.scans.id, scanId), isNotNull(schema.scans.result)));
}

// Queued once per scan attempt.
export async function enqueuePhotos(scanId: string) {
  const [scan] = await db.select({ startedAt: schema.scans.startedAt }).from(schema.scans).where(eq(schema.scans.id, scanId));
  return enqueueOnce("concepts", { scanId }, scan?.startedAt ?? new Date(0));
}

export async function runPhotos(scanId: string, opts: { lastAttempt: boolean; work?: (landed: PhotoWork["landed"]) => PhotoWork; plansWaitMs?: number }) {
  let f = await photoInputs(scanId);
  if (!f) return;
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId));
  // What they'd like it to be is the wait screen's first question: give them a moment to answer it.
  const waitUntil = Date.now() + (opts.plansWaitMs ?? PLANS_WAIT_MS);
  while (!f.plans && !scan.result && Date.now() < waitUntil) {
    await new Promise((r) => setTimeout(r, 1000));
    const plans = await plansAnswer(scan.basementId);
    f = { ...f, plans, household: plansHousehold(plans, f.household) };
  }
  // A fresh set replaces any earlier one.
  await db.delete(schema.scanEvents).where(and(eq(schema.scanEvents.scanId, scanId), inArray(schema.scanEvents.type, ["photo", "photos"])));
  const landed = async (c: Concept) => event(scanId, scan.startedAt, "photo", c.title, { ...c, url: `/api/scans/${scanId}/concepts/${c.n}.jpg?v=${Date.now().toString(36)}` });
  let final: Concepts;
  try {
    final = { status: "done", items: await renderFrom(scanId, f, (opts.work ?? ((l) => realWork(scanId, l)))(landed)) };
  } catch (err) {
    console.error(`[photos] ${scanId}: ${err instanceof Error ? err.message : err}`);
    if (!opts.lastAttempt) throw err;
    final = { status: "failed", items: (await photosSoFar(scanId)).items };
  }
  await event(scanId, scan.startedAt, "photos", final.status === "done" ? `${final.items.length} photos ready` : "Photos failed", final);
  await settlePhotos(scanId);
}
