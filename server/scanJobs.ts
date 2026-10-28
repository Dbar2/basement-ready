// Job handlers the worker knows how to run.
import type { JobRow } from "./jobs";
import { runScan } from "./pipeline";

export const handlers = {
  scan: async (job: JobRow) => {
    const { scanId } = job.payload as { scanId: string };
    await runScan(scanId, { lastAttempt: job.attempts >= job.maxAttempts });
  },
};
