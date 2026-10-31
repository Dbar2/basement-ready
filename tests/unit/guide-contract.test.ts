// The guide's contract (src/guide/types.ts) as the first server answers it: the example's thread, an action
// posted back, and the kinds every track draws.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountGuide } from "../../server/guide/routes";
import { CARD_KINDS, VISUAL_KINDS } from "../../src/guide/mount";
import type { GuideMessage, GuideState } from "../../src/guide/types";

const app = new Hono();
mountGuide(app);

describe("the guide's contract", () => {
  it("gives the example's thread, at its answer, with a visual in the pane", async () => {
    const res = await app.request("/api/scans/sample/guide");
    expect(res.status).toBe(200);
    const s: GuideState = await res.json();
    expect(s.milestone).toBe("answer");
    expect(VISUAL_KINDS).toContain(s.visual.kind);
    const last = s.messages.at(-1)!;
    expect(last.from).toBe("guide");
    expect(last.choices?.filter((c) => c.primary)).toHaveLength(1);
    for (const m of s.messages) if (m.visual) expect(VISUAL_KINDS).toContain(m.visual.kind);
  });

  it("answers a posted action with the new messages and the new state", async () => {
    const res = await app.request("/api/scans/sample/guide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: { type: "explain", term: "fire_separation" } }) });
    expect(res.status).toBe(200);
    const { messages, state }: { messages: GuideMessage[]; state: GuideState } = await res.json();
    expect(messages.length).toBeGreaterThan(0);
    expect(state.visual).toEqual({ kind: "explain", term: "fire_separation" });
  });

  it("turns away a post with no action, and an unknown scan", async () => {
    expect((await app.request("/api/scans/sample/guide", { method: "POST", body: "{}" })).status).toBe(400);
    expect((await app.request("/api/scans/not-a-scan/guide")).status).toBe(404);
  });

  it("names nine visual kinds and nine card kinds, as the spec does", () => {
    expect(new Set(VISUAL_KINDS).size).toBe(9);
    expect(new Set(CARD_KINDS).size).toBe(9);
  });
});
