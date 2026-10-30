// Job handlers the worker knows how to run.
import type { JobRow } from "./jobs";
import { runScan } from "./pipeline";
import { runPhotos } from "./photos";

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
};
