// Standalone worker process for production (`pnpm worker`). In development the API runs it inline.
import { migrateDb } from "./db";
import { startWorker } from "./jobs";
import { handlers } from "./scanJobs";

await migrateDb();
const worker = startWorker(handlers);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await worker.stop();
    process.exit(0);
  });
}
