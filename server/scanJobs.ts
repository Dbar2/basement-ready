// Job handlers the worker knows how to run.
import type { JobRow } from "./jobs";
import { runScan } from "./pipeline";
import { runPhotos } from "./photos";
import { runCards } from "./ideas/cards";

export const handlers = {
  scan: async (job: JobRow) => {
    const { scanId } = job.payload as { scanId: string };
    await runScan(scanId, { lastAttempt: job.attempts >= job.maxAttempts });
  },
  // The photos of what it could look like, queued as soon as the scan's finds are in.
  concepts: async (job: JobRow) => {
    const { scanId } = job.payload as { scanId: string };
    await runPhotos(scanId, { lastAttempt: job.attempts >= job.maxAttempts });
  },
  // The swipe deck's cards, queued when the deck first opens (server/ideas/cards.ts).
  cards: async (job: JobRow) => {
    const { scanId } = job.payload as { scanId: string };
    await runCards(scanId, { lastAttempt: job.attempts >= job.maxAttempts });
  },
};
