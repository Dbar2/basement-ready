// The guide's routes on a real scan, on the in-memory database: the thread from its first question to
// the build, each action through the existing code (the answers route, the model on the workspace, the
// look as an answer), the build from track F's list as the cards save it, and the thread kept on the
// workspace. No model is called.
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/meta", async (orig) => {
  const real = await orig<typeof import("../../server/meta")>();
  const never = () => {
    throw new Error("The guide called a model");
  };
  return { ...real, responses: vi.fn(never) };
});

const { db, migrateDb, schema } = await import("../../server/db");
const { mountAnswers, savedAnswers } = await import("../../server/answers");
const { mountGuide } = await import("../../server/guide/routes");
const { cleanPatch, loadWorkspace, saveWorkspace } = await import("../../server/workspace");
const { permitStatus } = await import("../../server/permit/package");
const { responses } = await import("../../server/meta");

type Body = { messages: { from: string; text: string; why?: string; card?: unknown; choices?: { label: string; action: unknown }[] }[]; state: any };

const result = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const app = new Hono();
mountAnswers(app, async () => null);
mountGuide(app, async () => null);

async function scan(status: "done" | "error", error: string | null = null) {
  await migrateDb();
  const claimToken = `claim-guide-${Math.random().toString(36).slice(2)}`;
  const [b] = await db.insert(schema.basements).values({ claimToken, household: "relative", municipality: "waterloo-on" }).returning();
  const [s] = await db.insert(schema.scans).values({ basementId: b.id, status, result: status === "done" ? result : null, error }).returning();
  const claims = encodeURIComponent(JSON.stringify([{ basementId: b.id, claimToken }]));
  const call = async (method: "GET" | "POST", action?: unknown, as = claims) => {
    const res = await app.request(`/api/scans/${s.id}/guide`, { method, headers: { "content-type": "application/json", "x-claims": as }, ...(action ? { body: JSON.stringify({ action }) } : {}) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { basementId: b.id, scanId: s.id, call };
}

describe("a real scan's guide", () => {
  it("goes from its open questions to the build, through the existing code, and keeps the thread", async () => {
    const { basementId, call } = await scan("done");
    const opened = await call("GET");
    expect(opened.status).toBe(200);
    expect(opened.body.step).toBe("wait.q:exit_from_suite");
    expect(opened.body.messages[0].text).toMatch(/^One thing before the answer: \*\*Is there a door from the basement straight outside\?\*\*/);
    // Opened again: the same thread, nothing said twice.
    expect((await call("GET")).body.messages).toHaveLength(1);

    const post = async (action: unknown) => {
      const r = await call("POST", action);
      expect(r.status).toBe(200);
      return r.body as Body;
    };
    await post({ type: "answer", questionId: "exit_from_suite", value: true });
    const answered = await post({ type: "answer", questionId: "plumbing_fixtures_and_shutoff", value: true });
    // Saved through the answers route.
    expect(await savedAnswers(basementId)).toMatchObject({ exit_from_suite: true, plumbing_fixtures_and_shutoff: true });
    expect(answered.state.step).toBe("answer");
    expect(answered.state.done.answer).toBe(true);
    expect(answered.messages.at(-1)!.text).toMatch(/^\*\*Yes, your basement can be a second home after \d fix(es)?\.\*\*/);

    expect((await post({ type: "explain", term: "fire_separation" })).messages.at(-1)!.text).toMatch(/45 minutes/);
    expect((await post({ type: "go", to: "design" })).state.step).toBe("design.plan");
    const layouts = await post({ type: "confirmPlan" });
    expect(layouts.state.step).toBe("design.layouts");
    // "Looks right" saved the plan as theirs, with its designs drawn again.
    const ws = await loadWorkspace(basementId);
    const model = ws.state.model as { existing: { confirmedAt: string | null }; designs: { id: string }[] };
    expect(model.existing.confirmedAt).toBeTruthy();
    const designId = model.designs[0].id;

    const looks = await post({ type: "chooseDesign", designId });
    expect(looks.state.step).toBe("design.look");
    expect(looks.messages.at(-1)!.text).toMatch(/\*\*Which look do you like for it\?\*\*/);
    const warm = await post({ type: "setLook", look: "warm" });
    expect(warm.messages.at(-1)!.text).toMatch(/in Warm wood\. \*\*Drag to compare\.\*\*/);
    expect((await savedAnswers(basementId)).look).toBe("warm");
    expect((await loadWorkspace(basementId)).state.ideas?.finish).toBe("warm");

    expect((await post({ type: "go", to: "build" })).state.step).toBe("build");
    const build = await post({ type: "go", to: "build" });
    expect(build.state.step).toBe("build.permit:tape");
    expect(build.messages.at(-1)!.card).toEqual({ kind: "tape", id: "tape" });

    // The tape card saves the workspace the way PUT /workspace does, then tells the guide.
    const w = await loadWorkspace(basementId);
    const st = permitStatus({ result, municipality: "waterloo-on", state: w.state, profile: w.profile });
    const patch = cleanPatch({
      state: {
        tape: { ceilingMm: 2100, beamMm: 1900 },
        permit: {
          walls: st.model!.mainWalls.map((x) => ({ id: x.id, mm: Math.round(x.scanM * 1000) })),
          windows: st.model!.windows.filter((x) => x.change !== "new").map((x) => ({ id: x.id, widthMm: 700, heightMm: 1000, sillMm: 900 })),
        },
      },
    });
    if ("error" in patch) throw new Error(patch.error);
    await saveWorkspace(basementId, { state: { ...w.state, ...patch.state } });
    const taped = await post({ type: "permitItem", itemId: "tape", value: { said: "Walls taped, ceiling 2.10 m" } });
    expect(taped.messages[0]).toMatchObject({ from: "you", text: "Walls taped, ceiling 2.10 m" });
    expect(taped.state.step).toBe("build.permit:owner");

    // The whole thread is on the workspace, server-side: what GET gives back.
    const kept = (await call("GET")).body;
    expect(kept.step).toBe("build.permit:owner");
    expect(kept.messages.length).toBe(taped.state.messages.length);
    expect(responses).not.toHaveBeenCalled();
  });

  it("answers typed words from the glossary, and says when Spark can't be asked", async () => {
    const { call } = await scan("done");
    await call("GET");
    const glossary = await call("POST", { type: "ask", text: "What's a fire separation?" });
    expect(glossary.status).toBe(200);
    expect(glossary.body.messages.at(1).text).toMatch(/Source: \[2024 Building Code Compendium/);
    // No AI key in the tests: an open question can't go to Muse Spark.
    const open = await call("POST", { type: "ask", text: "Can I rent it to students?" });
    expect(open.status).toBe(503);
    expect(responses).not.toHaveBeenCalled();
  });

  it("a scan that stopped says what happened", async () => {
    const { call } = await scan("error", "busy: Meta API 429");
    const r = await call("GET");
    expect(r.body.step).toBe("failed");
    expect(r.body.messages[0].text).toBe("Our AI service is busy right now. Your video is saved: try again in a few minutes.");
    expect(r.body.messages[0].choices.map((c: { label: string }) => c.label)).toEqual(["Try again"]);
  });

  it("is only the owner's", async () => {
    const { call } = await scan("done");
    const stranger = encodeURIComponent(JSON.stringify([]));
    expect((await call("GET", undefined, stranger)).status).toBe(403);
    expect((await call("POST", { type: "confirmPlan" }, stranger)).status).toBe(403);
  });
});
