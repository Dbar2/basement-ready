// The privacy promise on the FAQ and Privacy pages: raw videos are deleted 30 days after upload. Once a
// day the worker deletes each older scan's `input.*` and forgets its key. The frames, the 3D and the
// answer stay, so the plan still opens; only "Try again" needs the raw video.
import { and, isNotNull, lt, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { storage } from "./storage";

export const KEEP_VIDEO_DAYS = 30;

export async function sweepOldVideos(now = new Date(), days = KEEP_VIDEO_DAYS): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const old = await db
    .select({ id: schema.scans.id, videoKey: schema.scans.videoKey })
    .from(schema.scans)
    .where(and(isNotNull(schema.scans.videoKey), lt(schema.scans.createdAt, cutoff)));
  let removed = 0;
  for (const s of old) {
    if (!s.videoKey || !/\/input\.[a-z0-9]+$/.test(s.videoKey)) continue;
    try {
      // The key is a single file; removing it as a prefix deletes just that object.
      await storage.removePrefix(s.videoKey);
      await db.update(schema.scans).set({ videoKey: null }).where(eq(schema.scans.id, s.id));
      removed++;
    } catch (err) {
      console.error(`[sweep] ${s.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return removed;
}

// A minute after start-up, then every day.
export function startSweeps() {
  const run = () =>
    void sweepOldVideos()
      .then((n) => n && console.log(`[sweep] deleted ${n} raw video${n === 1 ? "" : "s"} older than ${KEEP_VIDEO_DAYS} days`))
      .catch((err) => console.error(`[sweep] ${err instanceof Error ? err.message : err}`));
  setTimeout(run, 60_000).unref();
  setInterval(run, 24 * 3600 * 1000).unref();
}
