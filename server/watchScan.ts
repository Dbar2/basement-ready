// The watch pass and the plan check as a scan runs them (server/pipeline.ts): the watch starts beside SAM
// and the 3D, the plan check after the answer is written. Both are skipped once today's spend is used
// up, and neither ever holds up or fails the answer.
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { join } from "node:path";
import { db, schema } from "./db";
import { overSpend } from "./limits";
import { dataUrl, uploadFile } from "./meta";
import { existingFromScan } from "./model/seed";
import type { PhotoTake } from "./photoInput";
import { alreadyKnown, checkPlan } from "./planCheck";
import { watchPhotos, watchVideo, watchVideoFile, watchWords, type TakeView, type Watch } from "./watch";

type Emit = (type: "log", text: string, data?: unknown) => Promise<void>;
type VideoTake = { work: string; analysis: string; wav: string | null; frameCount: number; fps: number };
type PhotosTake = { work: string; framePath: (n: number) => string; photos: PhotoTake };

// A take being watched: Muse Wonder's answer when it lands, and how the plan check will see the take.
export type Watching = { watch: Promise<Watch | null>; view: () => TakeView | null };

export function startWatch(scanId: string, emit: Emit, take: VideoTake | PhotosTake): Watching {
  let view: TakeView | null = null;
  const watch = (async () => {
    if (await overSpend()) return null;
    let w: Watch;
    if ("analysis" in take) {
      const file = await watchVideoFile(take.analysis, take.wav, join(take.work, "watch.mp4"));
      const video = { fileId: await uploadFile(file, "video/mp4", "walkthrough.mp4"), durationS: take.frameCount / take.fps };
      w = await watchVideo(video.fileId, video.durationS, Boolean(take.wav));
      view = { video };
    } else {
      w = await watchPhotos(take.framePath, take.photos, take.work);
      view = { photos: Array.from({ length: take.photos.count }, (_, n) => dataUrl(join(take.work, `watch-${n}.jpg`), "image/jpeg")) };
    }
    await emit("log", watchWords(w), { watch: w });
    return w;
  })().catch((err) => {
    console.error(`[watch] ${scanId}: ${err instanceof Error ? err.message : err}`);
    return null;
  });
  return { watch, view: () => view };
}

// After the answer: Wonder compares the plan we drew with the take, and its questions land on the result.
// A failed or skipped check is written as null, so the plan screen stops waiting for it. Nothing watched,
// nothing to check against.
export async function checkPlanLater(scanId: string, result: Parameters<typeof existingFromScan>[0] & { floorPlan?: unknown }, watching: Watching) {
  const view = watching.view();
  if (!view) return;
  let check = null;
  try {
    const existing = existingFromScan(result);
    if (existing && !(await overSpend())) check = await checkPlan(existing, view, { known: alreadyKnown(result) });
  } catch (err) {
    console.error(`[plan check] ${scanId}: ${err instanceof Error ? err.message : err}`);
  }
  await db
    .update(schema.scans)
    .set({ result: sql`jsonb_set(${schema.scans.result}, '{planCheck}', ${JSON.stringify(check)}::jsonb)` })
    .where(and(eq(schema.scans.id, scanId), isNotNull(schema.scans.result)))
    .catch((err) => console.error(`[plan check] ${scanId}: ${err instanceof Error ? err.message : err}`));
}
