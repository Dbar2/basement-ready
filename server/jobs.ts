// Durable job queue on Postgres. A job is claimed with FOR UPDATE SKIP LOCKED, so any number of
// workers can share the table; an expired lease puts a crashed job back in the queue. Each kind of job
// has its own slot in a worker, so the photos run while the scan that queued them is still going.
import { sql } from "drizzle-orm";
import { db, schema } from "./db";

export type JobRow = typeof schema.jobs.$inferSelect;

const LEASE_MINUTES = 10;

export async function enqueue(kind: string, payload: Record<string, unknown>, maxAttempts = 2) {
  const [row] = await db.insert(schema.jobs).values({ kind, payload, maxAttempts }).returning();
  return row;
}

function rows<T>(result: unknown): T[] {
  // postgres-js returns an array; PGlite returns { rows }.
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

// Queues a job for a scan unless one of this kind is already waiting, running or done since `since`.
export async function enqueueOnce(kind: string, payload: { scanId: string } & Record<string, unknown>, since: Date, maxAttempts = 2) {
  const found = rows<{ id: number }>(
    await db.execute(sql`
      SELECT id FROM jobs
       WHERE kind = ${kind} AND payload->>'scanId' = ${payload.scanId} AND status <> 'failed' AND created_at >= ${since.toISOString()}::timestamptz
       LIMIT 1`),
  );
  return found.length ? null : enqueue(kind, payload, maxAttempts);
}

export async function claimNext(workerId: string, kinds?: string[]): Promise<JobRow | null> {
  const only = kinds?.length ? sql`AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``;
  const result = await db.execute(sql`
    UPDATE jobs
       SET status = 'running', attempts = attempts + 1, locked_by = ${workerId},
           locked_until = now() + make_interval(mins => ${LEASE_MINUTES}), updated_at = now()
     WHERE id = (
       SELECT id FROM jobs
        WHERE status = 'queued' AND run_after <= now() ${only}
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
    RETURNING id, kind, payload, status, attempts, max_attempts AS "maxAttempts"`);
  return rows<JobRow>(result)[0] ?? null;
}

export async function complete(id: number) {
  await db.execute(sql`UPDATE jobs SET status = 'done', locked_by = NULL, locked_until = NULL, updated_at = now() WHERE id = ${id}`);
}

// Retries with backoff until maxAttempts, then marks the job failed for good.
export async function fail(id: number, error: string) {
  await db.execute(sql`
    UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
           run_after = now() + make_interval(secs => 15 * attempts),
           last_error = ${error.slice(0, 2000)}, locked_by = NULL, locked_until = NULL, updated_at = now()
     WHERE id = ${id}`);
  const result = await db.execute(sql`SELECT status FROM jobs WHERE id = ${id}`);
  return rows<{ status: string }>(result)[0]?.status === "failed";
}

// Jobs whose worker died mid-run go back in the queue.
export async function reclaimExpired() {
  await db.execute(sql`
    UPDATE jobs SET status = 'queued', locked_by = NULL, locked_until = NULL, updated_at = now()
     WHERE status = 'running' AND locked_until < now()`);
}

type Handler = (job: JobRow) => Promise<void>;

// One loop per kind of job (more with `slots`), so a long scan never holds up its own photos.
export function startWorker(handlers: Record<string, Handler>, opts: { id?: string; pollMs?: number; slots?: Record<string, number> } = {}) {
  const id = opts.id ?? `worker-${process.pid}`;
  const pollMs = opts.pollMs ?? 1000;
  let stopped = false;

  const loop = async (kind: string) => {
    while (!stopped) {
      try {
        await reclaimExpired();
        const job = await claimNext(id, [kind]);
        if (!job) {
          await new Promise((r) => setTimeout(r, pollMs));
          continue;
        }
        try {
          await handlers[kind](job);
          await complete(job.id);
        } catch (err) {
          const message = err instanceof Error ? err.stack ?? err.message : String(err);
          const final = await fail(job.id, message);
          console.error(`[worker] job ${job.id} (${job.kind}) attempt ${job.attempts}/${job.maxAttempts} failed${final ? " for good" : ", will retry"}: ${message}`);
        }
      } catch (err) {
        console.error("[worker] loop error", err);
        await new Promise((r) => setTimeout(r, pollMs * 3));
      }
    }
  };
  const running = Object.keys(handlers).flatMap((kind) => Array.from({ length: Math.max(1, opts.slots?.[kind] ?? 1) }, () => loop(kind)));
  console.log(`[worker] ${id} started`);
  return {
    stop: async () => {
      stopped = true;
      await Promise.all(running);
    },
  };
}
