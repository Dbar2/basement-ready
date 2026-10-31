import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

// The example must never reach a model: any call to Meta fails the test.
vi.mock("../../server/meta", async (orig) => {
  const real = await orig<typeof import("../../server/meta")>();
  const never = () => {
    throw new Error("The example called a model");
  };
  return { ...real, responses: vi.fn(never), samImage: vi.fn(never), samVideo: vi.fn(never), museEdit: vi.fn(never), transcribe: vi.fn(never) };
});

const { lookQuestion, waitQuestions } = await import("../../server/eligibility");
const { responses } = await import("../../server/meta");
const { plansQuestion } = await import("../../server/plans");
const { packFor } = await import("../../server/rules");
const { cleanSample, foundIn, sampleCtx, sampleStart } = await import("../../server/guide/sample");
const { cleanAction, confirmed, mountGuide } = await import("../../server/guide/routes");
const { currentModel } = await import("../../server/model/current");

const NOW = "2026-10-31T12:00:00.000Z";
const app = new Hono();
mountGuide(app, async () => null);

type Body = { messages: { from: string; text: string; choices?: { label: string; action: unknown; primary?: boolean }[]; card?: { kind: string } }[]; state: any };
async function post(state: unknown, action: unknown): Promise<Body> {
  const res = await app.request("/api/scans/sample/guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state, action }) });
  expect(res.status).toBe(200);
  return res.json();
}
// Taps the choice with this label on the guide's newest message that offers it.
async function tap(state: any, label: string): Promise<Body> {
  const choice = [...state.messages].reverse().flatMap((m: Body["messages"][number]) => m.choices ?? []).find((c: { label: string }) => c.label === label);
  expect(choice, `no "${label}" to tap at ${state.step}`).toBeTruthy();
  return post(state, choice.action);
}

describe("the look question on the wait screen", () => {
  const pack = packFor("waterloo-on").pack;
  const ask = (answers: Record<string, unknown>, look?: boolean) =>
    waitQuestions(pack, { household: "relative", answers, findings: null, ruleAsks: [], plans: plansQuestion("relative"), ...(look ? { look } : {}) }).map((a) => a.id);

  it("is asked only by the guide, once, as four looks or none", () => {
    expect(ask({})).not.toContain("look");
    expect(ask({}, true)).toContain("look");
    expect(ask({ look: "none" }, true)).not.toContain("look");
    expect(lookQuestion().options.map((o) => o.value)).toEqual(["light", "warm", "deep", "plain", "none"]);
  });
});

describe("the example, fully scripted", () => {
  it("starts on the wait, naming what its video shows", async () => {
    const res = await app.request("/api/scans/sample/guide");
    const t = await res.json();
    expect(t.step).toBe("wait.q:exit_from_suite");
    expect(t.messages[0].text).toMatch(/^I found a window, the stairs and your furnace\. While I measure: \*\*Is there a door from the basement straight outside\?\*\*/);
    expect(t.sample).toEqual({ answers: {}, chosen: null, look: null, confirmed: false });
    expect(foundIn(null)).toEqual([]);
  });

  it("runs end to end from its thread, every milestone, for $0", async () => {
    let r: Body = { messages: [], state: sampleStart(NOW) };
    const steps: string[] = [r.state.step];
    const go = async (label: string) => {
      r = await tap(r.state, label);
      steps.push(r.state.step);
    };
    await go("No");
    await go("Yes");
    await go("Light oak");
    expect(r.state.step).toBe("answer");
    expect(r.messages.at(-1)!.text).toMatch(/^\*\*Yes, your basement can be a second home after \d fix(es)?\.\*\* .*All in, a contractor would charge roughly \$\d+k–\$\d+k, and you may get up to \$7,000 back\.$/);
    await go("What's a fire separation?");
    expect(r.messages.at(-1)!.text).toMatch(/45 minutes.*Source: \[2024 Building Code Compendium/);
    r = await post(r.state, { type: "ask", text: "Can I rent it to students?" });
    expect(r.messages.at(-1)!.text).toMatch(/^On your own basement the guide answers anything/);
    await go("Got it, show me what it could be");
    expect(r.state.milestone).toBe("design");
    await go("A wall is off");
    expect(r.state.awaiting).toBe("wall");
    r = await post(r.state, { type: "ask", text: "The right wall is 5.5 metres" });
    expect(r.messages.at(-1)!.text).toMatch(/^In the example the plan is fixed/);
    await go("Looks right");
    expect(r.state.step).toBe("design.layouts");
    await go("Bigger bedroom");
    expect(r.messages.at(-1)!.text).toMatch(/^In the example the layouts are fixed/);
    await go("Show Studio");
    await go("Show One bedroom");
    await go("Use One bedroom");
    expect(r.state.step).toBe("design.look");
    expect(r.state.sample.chosen).toBe("one_bedroom");
    await go("None of these");
    expect(r.state.sample.look).toBe("none");
    await go("Warm wood");
    await go("Looks good");
    expect(r.state.step).toBe("build");
    await go("Start");
    await go("Done");
    await go("Got it");
    await go("Hire it all");
    expect(r.state.step).toBe("done");
    expect(r.state.done).toEqual({ answer: true, design: true, build: true });
    expect(r.messages.at(-1)!.card).toEqual({ kind: "download", id: "submit" });
    expect(new Set(steps)).toEqual(
      new Set([
        "wait.q:exit_from_suite",
        "wait.q:plumbing_fixtures_and_shutoff",
        "wait.look",
        "answer",
        "design.plan",
        "design.layouts",
        "design.look",
        "build",
        "build.permit:tape",
        "build.money:receipts",
        "build.builders",
        "done",
      ]),
    );
    expect(responses).not.toHaveBeenCalled();
    // The whole thread fits easily in the browser's storage.
    expect(JSON.stringify(r.state).length).toBeLessThan(60_000);
  });

  it("keeps only what makes sense from what the browser sends back", () => {
    const t = cleanSample(
      {
        ...sampleStart(NOW),
        passed: ["answer", 7],
        awaiting: "rocket",
        sample: { answers: { exit_from_suite: false, made_up: true, plumbing_fixtures_and_shutoff: "lots" }, chosen: "penthouse", look: "neon", confirmed: "yes" },
      },
      NOW,
    );
    expect(t.sample).toEqual({ answers: { exit_from_suite: false }, chosen: null, look: null, confirmed: false });
    expect(t.passed).toEqual(["answer"]);
    expect(t.awaiting).toBeNull();
    expect(cleanSample("nonsense", NOW).step).toBe("wait.q:exit_from_suite");
  });

  it("asks only what changes the example's answer, and the look", () => {
    const c = sampleCtx({ answers: {}, chosen: null, look: null, confirmed: false }, NOW);
    expect(c.asks.map((a) => a.id)).toEqual(["exit_from_suite", "plumbing_fixtures_and_shutoff", "look"]);
    expect(c.result).toBeNull();
    const answered = sampleCtx({ answers: { exit_from_suite: true, plumbing_fixtures_and_shutoff: true }, chosen: null, look: "deep", confirmed: false }, NOW);
    expect(answered.asks).toEqual([]);
    expect(answered.result?.verdict).toBeTruthy();
    expect(answered.build.map((b) => b.id)).toEqual(["tape", "receipts", "builders"]);
  });
});

describe("the guide's routes", () => {
  it("refuses an action it doesn't know, and a scan that isn't there", async () => {
    const bad = await app.request("/api/scans/sample/guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: { type: "launch" } }) });
    expect(bad.status).toBe(400);
    expect((await app.request("/api/scans/not-a-scan/guide")).status).toBe(404);
    const missing = await app.request("/api/scans/not-a-scan/guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: { type: "confirmPlan" } }) });
    expect(missing.status).toBe(404);
  });

  it("keeps an action only in a shape the script knows", () => {
    expect(cleanAction({ type: "setLook", look: "warm" })).toEqual({ type: "setLook", look: "warm" });
    expect(cleanAction({ type: "setLook", look: "neon" })).toBeNull();
    expect(cleanAction({ type: "setWall", wallId: "w1", lengthM: "5.5" })).toEqual({ type: "setWall", wallId: "w1", lengthM: 5.5 });
    expect(cleanAction({ type: "setWall", wallId: "w1", lengthM: 0.1 })).toBeNull();
    expect(cleanAction({ type: "explain", term: "fire_separation" })).toEqual({ type: "explain", term: "fire_separation" });
    expect(cleanAction({ type: "explain", term: "warp_drive" })).toBeNull();
    expect(cleanAction({ type: "go", to: "build" })).toEqual({ type: "go", to: "build" });
    expect(cleanAction({ type: "go", to: "mars" })).toBeNull();
    expect(cleanAction({ type: "ask", text: "  " })).toBeNull();
    expect((cleanAction({ type: "ask", text: "x".repeat(900) }) as { text: string }).text).toHaveLength(500);
    expect(cleanAction({ type: "describe", text: "Darker floors" })).toEqual({ type: "describe", text: "Darker floors" });
    expect(cleanAction({ type: "chooseDesign", designId: "studio" })).toEqual({ type: "chooseDesign", designId: "studio" });
    expect(cleanAction({ type: "answer", questionId: "exit_from_suite", value: true })).toEqual({ type: "answer", questionId: "exit_from_suite", value: true });
    expect(cleanAction(null)).toBeNull();
  });

  it("'Looks right' makes every guess theirs and draws the designs again, keeping their pick", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const m = currentModel(JSON.parse(readFileSync("public/samples/sample/result.json", "utf8")), {}, "sample")!.model;
    const picked = { ...m, designs: m.designs.map((d) => ({ ...d, chosen: d.id === "studio" })) };
    const c = confirmed(picked, NOW);
    expect(c.existing.confirmedAt).toBe(NOW);
    expect(c.existing.walls.some((w) => w.guess)).toBe(false);
    expect(c.existing.fixtures.some((f) => f.guess)).toBe(false);
    expect(c.designs.length).toBeGreaterThan(0);
    expect(c.designs.find((d) => d.chosen)?.id).toBe("studio");
  });
});
