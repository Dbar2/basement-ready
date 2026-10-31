// End-to-end runs only (REPLAY_MISS_LOG set): which journey a request, and the jobs it queues, belong to.
// A missing saved answer then fails that journey and not the ones running beside it. The browser sends
// it as x-e2e-test (tests/e2e/support/fixtures.ts); a queued job carries it in its payload.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string>();

export const testTag = () => store.getStore() ?? null;

export const withTestTag = <T>(tag: unknown, fn: () => T): T => (typeof tag === "string" && tag && process.env.REPLAY_MISS_LOG ? store.run(tag, fn) : fn());
