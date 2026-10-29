// Job handlers the worker knows how to run.
import { eq } from "drizzle-orm";
import { renderConcepts } from "./concepts";
import { db, schema } from "./db";
import type { JobRow } from "./jobs";
import { runScan } from "./pipeline";

export const handlers = {
  scan: async (job: JobRow) => {
    const { scanId } = job.payload as { scanId: string };
    await runScan(scanId, { lastAttempt: job.attempts >= job.maxAttempts });
  },
  // The photos of what it could look like, after the answer is out.
  concepts: async (job: JobRow) => {
    const { scanId } = job.payload as { scanId: string };
    const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId));
    if (!scan?.result) return;
    let items: Awaited<ReturnType<typeof renderConcepts>> = [];
    let status: "done" | "failed" = "done";
    try {
      items = await renderConcepts(scanId, scan.result);
    } catch (err) {
      console.error(`[concepts] ${scanId}: ${err instanceof Error ? err.message : err}`);
      if (job.attempts < job.maxAttempts) throw err;
      status = "failed";
    }
    // Read again: answers may have changed the result while the pictures were made.
    const [latest] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId));
    await db
      .update(schema.scans)
      .set({ result: { ...(latest!.result as object), concepts: { status, items } } })
      .where(eq(schema.scans.id, scanId));
  },
};
