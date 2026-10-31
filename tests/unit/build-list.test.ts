// The Build milestone's list (server/guide/build.ts), walked on the example basement from a blank
// workspace to the submit copy: one thing at a time, in order, each saved the way its card saves it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildList, sampleBuildList, type BuildList } from "../../server/guide/build";
import { permitStatus } from "../../server/permit/package";
import { pricedSample } from "../../server/priced";
import type { Profile, StoredState } from "../../server/workspace";

const OWNER: Profile = { owners: [{ first: "Sam", last: "Example" }], phone: "519-555-0100", email: "sam@example.com", postalCode: "N2L 3G1" };
const steps = (l: BuildList) => l.items.map((i) => i.step);
const sampleResult = (state: StoredState) => pricedSample(JSON.parse(readFileSync("public/samples/sample/result.json", "utf8")), state);

// Everything the tape card and the window card save, at sizes that meet the rules.
function taped(state: StoredState): StoredState {
  const st = permitStatus({ result: sampleResult(state), municipality: "waterloo-on", state, profile: null });
  const m = st.model!;
  return {
    ...state,
    tape: { ...state.tape, ceilingMm: 2100, beamMm: 1900 },
    permit: {
      ...state.permit,
      walls: m.mainWalls.map((w) => ({ id: w.id, mm: Math.round(w.scanM * 1000) })),
      windows: m.windows.filter((w) => w.change !== "new").map((w) => ({ id: w.id, widthMm: 700, heightMm: 1000, sillMm: 900 })),
    },
  };
}

// The review card: every sheet marked as looked over, against what the drawings show now.
function reviewed(state: StoredState, profile: Profile | null): StoredState {
  const st = permitStatus({ result: sampleResult(state), municipality: "waterloo-on", state, profile });
  return { ...state, permit: { ...state.permit, reviewed: st.sheets.map((s) => ({ sheet: s.number, key: st.reviewKey })) } };
}

describe("the Build milestone's list", () => {
  it("starts at the tape, says what the set is and how much is left, and ends at the book", () => {
    const l = sampleBuildList({ profile: null, state: {} });
    expect(l.next.step).toBe("build.permit:tape");
    // The script's build intro says what the set is; the item just asks.
    expect(l.next.message).toMatch(/^Grab a tape measure: /);
    expect(l.items.filter((i) => i.section === "permit").every((i) => typeof i.minutes === "number")).toBe(true);
    expect(l.next.card).toEqual({ kind: "tape", id: "tape" });
    expect(l.next.why).toBeTruthy();
    expect(l.items.at(-1)!.why).toBe("");
    expect(steps(l)).toEqual(["build.permit:tape", expect.stringMatching(/^build\.permit:window:/), "build.permit:owner", "build.permit:upstairs", "build.permit:review", "build.money:apply", "build.builders", "build.submit", "done"]);
    expect(l.permit).toMatchObject({ ready: 0, canSubmit: false, city: "Waterloo", authority: "City of Waterloo" });
    expect(l.permit.total).toBeGreaterThan(5);
    expect(l.items.at(-1)!.card).toEqual({ kind: "download", id: "book" });
    // Only the last step's card is the submit copy, and only once it can be submitted.
    expect(l.items.find((i) => i.step === "build.submit")!.card).toBeUndefined();
  });

  it("asks one thing at a time, in order, until the submit copy", () => {
    let profile: Profile | null = null;
    let state: StoredState = {};
    const next = () => sampleBuildList({ profile, state }).next;

    state = taped(state);
    expect(next().step).toBe("build.permit:owner");


    profile = OWNER;
    expect(next().step).toBe("build.permit:upstairs");
    state = { ...state, permit: { ...state.permit, upstairs: { bedrooms: [], none: true } } };
    expect(next().step).toBe("build.permit:review");
    expect(next().card).toEqual({ kind: "download", id: "review" });

    state = reviewed(state, profile);
    const ready = sampleBuildList({ profile, state });
    expect(ready.permit.canSubmit).toBe(true);
    expect(ready.permit.ready).toBe(ready.permit.total);

    // The money: the example's family may claim the tax credit, and the lender's loan is applied for first.
    expect(ready.next.step).toBe("build.money:apply");
    expect(ready.next.message).toMatch(/^You may be eligible for up to \$7,000 \(Multigenerational home tax credit\)\. Apply before any work starts: CMHC refinance, a loan rather than a grant\./);
    state = { ...state, apply: { cmhc_refinance_secondary_suite: { sentAt: null } } };
    const afterApply = sampleBuildList({ profile, state }).next;
    expect(afterApply.step).toBe("build.builders");

    state = { ...state, build: { path: "hire" } };
    const submit = sampleBuildList({ profile, state }).next;
    expect(submit.step).toBe("build.submit");
    expect(submit.card).toEqual({ kind: "download", id: "submit" });
    expect(submit.message).toBe("Everything's ready. Download the submit copy, with no draft marks and every form filled, and hand it in on the City of Waterloo building permit portal.");

    state = { ...state, permit: { ...state.permit, submittedAt: "2026-11-01" } };
    expect(next().step).toBe("done");
  });

  it("puts a design that breaks a rule first, with the way back to the design", () => {
    // A ceiling taped too low (with every wall taped, so the sizes are measured) fails the design's height check.
    const state: StoredState = { ...taped({}), tape: { ceilingMm: 1800, beamMm: 1700 } };
    const l = sampleBuildList({ profile: null, state });
    const design = l.items.filter((i) => i.step.startsWith("build.permit:design:"));
    expect(design.length).toBeGreaterThan(0);
    expect(l.next.step).toBe(design[0].step);
    expect(l.next.choices).toContainEqual({ label: "Fix it in the design", action: { type: "go", to: "design" }, primary: true });
    expect(l.next.message).not.toMatch(/Design:/);
  });

  it("asks each open money question with its options, and moves on after 'Not sure'", () => {
    const base = sampleResult({});
    const question = { id: "lives_there", question: "Do you live in this house?", hint: "As your main home.", options: [{ label: "Yes", value: true }, { label: "No", value: false }, { label: "Not sure", value: "unsure" }], decides: ["Region of Waterloo forgivable loan"], answer: null };
    const result = { ...base, money: { total: 7000, ifYes: 25000 }, moneyQuestions: [question] };
    const l = buildList({ result, municipality: "waterloo-on", state: {}, profile: null });
    const item = l.items.find((i) => i.step === "build.money:lives_there")!;
    expect(item.card).toEqual({ kind: "moneyQuestion", id: "lives_there" });
    expect(item.choices?.map((c) => c.action)).toEqual([
      { type: "answer", questionId: "lives_there", value: true },
      { type: "answer", questionId: "lives_there", value: false },
      { type: "answer", questionId: "lives_there", value: "unsure" },
    ]);
    expect(item.why).toBe("As your main home. It decides Region of Waterloo forgivable loan.");
    // The first money item says the total.
    expect(item.message).toMatch(/^You may be eligible for up to \$7,000/);
    const unsure = buildList({ result: { ...result, moneyQuestions: [{ ...question, answer: "unsure" }] }, municipality: "waterloo-on", state: {}, profile: null });
    expect(unsure.items.find((i) => i.step === "build.money:lives_there")!.done).toBe(true);
  });

  it("never says qualify or approved, and every item says why", () => {
    const l = sampleBuildList({ profile: null, state: taped({}) });
    for (const i of l.items) {
      expect(`${i.message} ${i.why}`).not.toMatch(/qualif|approved/i);
      // Every question says why; the submit copy and the last step ask nothing.
      if (i.step !== "done" && i.step !== "build.submit") expect(i.why.length).toBeGreaterThan(10);
    }
  });
});

// A real scan: the example's answer stored as a scan, its workspace saved the way the cards save it
// (PUT /api/scans/:id/workspace: cleanPatch, then saveWorkspace), and its permit status read the way
// GET /permit/status reads it (the stored result).
describe("a real scan's list, from the database", () => {
  it("gets from the answer to the submit copy, and the submit copy builds", async () => {
    const { db, migrateDb, schema } = await import("../../server/db");
    const { buildListFor } = await import("../../server/guide/build");
    const { cleanPatch, loadWorkspace, saveWorkspace } = await import("../../server/workspace");
    const { buildPermitPackage } = await import("../../server/permit/package");
    await migrateDb();
    const result = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
    const [b] = await db.insert(schema.basements).values({ claimToken: "claim-token-build-f", household: "relative", municipality: "waterloo-on" }).returning();
    const [s] = await db.insert(schema.scans).values({ basementId: b.id, status: "done", result }).returning();
    const put = async (body: unknown) => {
      const patch = cleanPatch(body);
      if ("error" in patch) throw new Error(patch.error);
      const now = await loadWorkspace(b.id);
      await saveWorkspace(b.id, { ...patch, state: patch.state ? { ...now.state, ...patch.state } : undefined });
    };
    const status = async () => {
      const w = await loadWorkspace(b.id);
      return permitStatus({ result, municipality: "waterloo-on", state: w.state, profile: w.profile });
    };

    expect((await buildListFor(s.id))!.next.step).toBe("build.permit:tape");
    await put({ state: taped({}) });
    await put({ profile: OWNER });
    const w = await loadWorkspace(b.id);
    await put({ state: { permit: { ...w.state.permit, upstairs: { bedrooms: [], none: true } } } });
    expect((await buildListFor(s.id))!.next.step).toBe("build.permit:review");
    // "Every sheet matches my basement", with the key the status route gives the card.
    const st = await status();
    const w2 = await loadWorkspace(b.id);
    await put({ state: { permit: { ...w2.state.permit, reviewed: st.sheets.map((x) => ({ sheet: x.number, key: st.reviewKey })) } } });

    let list = (await buildListFor(s.id))!;
    expect(list.permit.canSubmit).toBe(true);
    // The money questions: each answered with its first choice, through the answers code the guide's
    // { type: "answer" } goes through. Then the applications and who builds it, as their cards save them.
    const { saveAnswer, savedAnswers } = await import("../../server/answers");
    const { pricedForBasement } = await import("../../server/priced");
    for (let guard = 0; guard < 12 && list.next.step !== "build.submit"; guard++) {
      const item = list.next;
      if (item.step === "build.money:apply") {
        // "Not for me" on each program that applies before work, as the apply card saves it.
        const priced = (await pricedForBasement(s.id, b.id, { ...result, household: "relative" }, await savedAnswers(b.id))) as { grants: { id: string; qualify: string; apply: { when: string } | null }[] };
        const first = priced.grants.filter((g) => g.qualify === "yes" && g.apply && (g.apply.when === "before_work" || g.apply.when === "at_permit"));
        await put({ state: { apply: Object.fromEntries(first.map((g) => [g.id, { sentAt: null }])) } });
      } else if (item.step.startsWith("build.money:")) {
        const choice = item.choices![0].action as { questionId: string; value: unknown };
        await saveAnswer(b.id, choice.questionId, choice.value as never);
      } else if (item.step === "build.builders") await put({ state: { build: { path: "diy" } } });
      else throw new Error(`Stuck at ${item.step}`);
      list = (await buildListFor(s.id))!;
    }
    expect(list.next.step).toBe("build.submit");
    expect(list.next.card).toEqual({ kind: "download", id: "submit" });

    const final = await loadWorkspace(b.id);
    const out = await buildPermitPackage({ result, municipality: "waterloo-on", address: "1 Example St", profile: final.profile, state: final.state, site: null, aerialJpeg: null, favourites: [], copy: "submit" });
    expect(out.bytes.byteLength).toBeGreaterThan(10_000);
  });
});

describe("the money, from the answers the script loads", () => {
  it("works the questions out from the household and answers, and drops one once it's answered", () => {
    const result = { ...sampleResult({}), household: "renter" };
    const open = buildList({ result, municipality: "waterloo-on", state: {}, profile: null, household: "renter", answers: {}, property: null });
    const money = open.items.filter((i) => i.section === "money" && i.step !== "build.money:apply");
    expect(money.length).toBeGreaterThan(0);
    const q = money[0].step.replace("build.money:", "");
    const value = (money[0].choices![0].action as { value: unknown }).value;
    const after = buildList({ result, municipality: "waterloo-on", state: {}, profile: null, household: "renter", answers: { [q]: value }, property: null });
    expect(after.items.some((i) => i.step === money[0].step && !i.done)).toBe(false);
  });
});
