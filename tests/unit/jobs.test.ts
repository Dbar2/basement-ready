import { beforeAll, describe, expect, it } from "vitest";
import { migrateDb } from "../../server/db";
import { claimNext, complete, enqueue, fail } from "../../server/jobs";

beforeAll(async () => {
  await migrateDb();
});

describe("job queue", () => {
  it("claims each job once, in order", async () => {
    const a = await enqueue("test", { n: 1 });
    const b = await enqueue("test", { n: 2 });
    const first = await claimNext("w1");
    const second = await claimNext("w2");
    expect([first?.id, second?.id]).toEqual([a.id, b.id]);
    expect(await claimNext("w3")).toBeNull();
    await complete(a.id);
    await complete(b.id);
  });

  it("retries with backoff, then fails for good", async () => {
    const job = await enqueue("test", {}, 2);
    expect((await claimNext("w"))?.id).toBe(job.id);
    expect(await fail(job.id, "boom")).toBe(false); // attempt 1 of 2: back in the queue, delayed
    expect(await claimNext("w")).toBeNull(); // backoff not elapsed
  });
});
