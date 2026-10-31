import { describe, expect, it } from "vitest";
import { lookQuestion, type WaitAsk } from "../../server/eligibility";
import { act, k, milestoneOf, range, start, stepOf, sync, type BuildItem, type Ctx, type Thread } from "../../server/guide/script";
import type { GuideMessage } from "../../src/guide/types";

const NOW = "2026-10-31T12:00:00.000Z";

const exit: WaitAsk = {
  id: "exit_from_suite",
  kind: "rule",
  question: "Is there a door from the basement straight outside?",
  hint: "A side door or walk-out that opens to the yard.",
  options: [
    { label: "Yes", value: true },
    { label: "No", value: false },
    { label: "Not sure", value: "unsure" },
  ],
};
const rent: WaitAsk = { id: "rent", kind: "money", question: "What rent would you charge?", hint: "", options: [{ label: "Market", value: "market" }] };
const plans: WaitAsk = { id: "plans", kind: "plans", question: "What would you like it to be?", hint: "", options: [{ label: "A rec room", value: "rec_room" }] };
const look: WaitAsk = { kind: "look", ...lookQuestion() };

const result: NonNullable<Ctx["result"]> = {
  verdict: "fix",
  headline: "Yes, your basement can be a second home after 1 fix.",
  fixGroups: [{ category: "fire", title: "Fire/smoke separation between the two homes", costLow: 3000, costHigh: 6000 }],
  cost: { low: 49399, high: 84523 },
  money: { total: 4620, ifYes: 0 },
};

const wall = (id: string, guess = false) => ({ id, guess, kind: "foundation", a: [0, 0], b: [5, 0], thicknessM: 0.2, rating: null });
const design = (id: string, name: string, layout: string, chosen = false, why?: string) => ({ id, name, layout, chosen, why, proposed: {}, finishes: { style: "light", floor: "", walls: "" }, updatedAt: NOW });
function model(over: { guesses?: number; fixtureGuesses?: number; confirmed?: boolean; designs?: ReturnType<typeof design>[]; recommended?: { designId: string; reason: string } } = {}): Ctx["model"] {
  const guesses = over.guesses ?? 2;
  return {
    version: 1,
    existing: {
      walls: [wall("w1", guesses > 0), wall("w2", guesses > 1), wall("w3")],
      fixtures: [
        { id: "f1", kind: "stairs", guess: false },
        { id: "f2", kind: "furnace", guess: (over.fixtureGuesses ?? 0) > 0 },
      ],
      openings: [{ id: "o1", kind: "window" }],
      rooms: [],
      confirmedAt: over.confirmed ? NOW : null,
    },
    designs: over.designs ?? [design("one_bedroom", "One bedroom", "one_bedroom", true, "The bedroom on the window wall."), design("studio", "Studio", "studio")],
    mood: { liked: [], disliked: [], style: null, finishes: {} },
    ...(over.recommended ? { recommended: over.recommended } : {}),
  } as never;
}

// Track F's list (server/guide/build.ts), as it reads before anything is given: it opens with the permit
// set, a done item counts as given, and it always ends with "done".
const item = (step: string, section: BuildItem["section"], message: string, why: string, extra: Partial<BuildItem> = {}): BuildItem => ({
  step,
  section,
  message,
  why,
  visual: { kind: section === "money" ? "money" : "permit" },
  done: false,
  ...extra,
});
const items: BuildItem[] = [
  item("build.permit:tape", "permit", "I've drawn and filled your permit set. Measure one wall.", "the City checks sizes.", {
    card: { kind: "tape", id: "tape" },
    choices: [
      { label: "What's a permit set?", action: { type: "explain", term: "permit_set" } },
      { label: "Later", action: { type: "go", to: "home" } },
    ],
  }),
  item("build.permit:owner", "permit", "Who owns the house?", "the forms ask.", { card: { kind: "owner", id: "owner" } }),
  item("build.money:senior", "money", "Is someone moving in 65 or older?", "it decides the tax credit.", {
    choices: [{ label: "Yes", action: { type: "answer", questionId: "senior", value: true } }],
  }),
  item("build.submit", "permit", "Download the submit copy.", "", { card: { kind: "download", id: "submit" } }),
  item("done", "done", "That's everything I need from you.", "", {
    card: { kind: "download", id: "book" },
    choices: [{ label: "Back to your basement", action: { type: "go", to: "home" }, primary: true }],
  }),
];
// The list once these steps are given.
const given = (...steps: string[]) => items.map((i) => (steps.includes(i.step) ? { ...i, done: true } : i));

function ctx(over: Partial<Ctx> = {}): Ctx {
  return { found: [], asks: [], result, model: model(), look: "light", build: items, household: "relative", now: NOW, ...over };
}
const last = (t: Thread) => t.messages.at(-1)!;
const guideSaid = (ms: GuideMessage[]) => ms.filter((m) => m.from === "guide");
// A thread that has moved past these steps, saying where it is now.
const at = (passed: string[], c = ctx()) => sync({ step: "", milestone: "answer", done: { answer: false, design: false, build: false }, messages: [], visual: { kind: "video" }, passed }, c).thread;

describe("the guide's wait: one question at a time while it measures", () => {
  it("opens with what the scan found, then the first question, its why and its answers", () => {
    const t = start(ctx({ result: null, found: ["a window", "the stairs", "your furnace"], asks: [exit, look] }));
    expect(t.step).toBe("wait.q:exit_from_suite");
    expect(t.milestone).toBe("answer");
    expect(t.messages).toHaveLength(1);
    const m = last(t);
    expect(m.text).toBe("I found a window, the stairs and your furnace. While I measure: **Is there a door from the basement straight outside?** A side door or walk-out that opens to the yard.");
    expect(m.why).toBe("a separate way in is one of the rules for a second home.");
    expect(m.choices?.map((c) => c.label)).toEqual(["Yes", "No", "Not sure"]);
    expect(m.choices?.[1].action).toEqual({ type: "answer", questionId: "exit_from_suite", value: false });
    expect(m.choices?.some((c) => c.primary)).toBe(false);
    expect(m.visual).toEqual({ kind: "video" });
    expect(m).toMatchObject({ id: "m1", from: "guide", at: NOW });
  });

  it("says it's measuring when it found nothing yet", () => {
    const t = start(ctx({ result: null, asks: [plans] }));
    expect(last(t).text).toBe("While I measure, a few quick questions. **What would you like it to be?**");
    expect(last(t).why).toBe("the design and the pictures follow it.");
  });

  it("asks the look as four looks or none, each setting the look", () => {
    const t = start(ctx({ result: null, asks: [look] }));
    expect(t.step).toBe("wait.look");
    expect(last(t).choices?.map((c) => c.label)).toEqual(["Light oak", "Warm wood", "Deep green", "Plain", "None of these"]);
    expect(last(t).choices?.at(-1)?.action).toEqual({ type: "setLook", look: "none" });
    expect(last(t).why).toBe("I'll show your basement finished in it.");
  });

  it("an answer moves to the next question, with their answer as their bubble", () => {
    const c = ctx({ result: null, asks: [exit, rent] });
    const r = act(start(c), { type: "answer", questionId: "exit_from_suite", value: false }, { ...c, asks: [rent] });
    expect(r.messages.map((m) => [m.from, m.text])).toEqual([
      ["you", "No"],
      ["guide", "**What rent would you charge?**"],
    ]);
    expect(r.thread.step).toBe("wait.q:rent");
    expect(r.messages[1].why).toBe("it decides which money fits.");
  });

  it("a scan that stopped says what happened, offers to try again when that can help, and waits again once it does", () => {
    const busy = { text: "Our AI service is busy right now. Your video is saved: try again in a few minutes.", retry: true };
    const t = start(ctx({ result: null, failed: busy, asks: [exit] }));
    expect(t.step).toBe("failed");
    expect(last(t).text).toBe(busy.text);
    expect(last(t).choices).toEqual([{ label: "Try again", action: { type: "ask", text: "Try again" }, primary: true }]);
    expect(last(start(ctx({ result: null, failed: { text: "We couldn't read this video file.", retry: false } }))).choices).toBeUndefined();
    const again = act(t, { type: "ask", text: "Try again" }, ctx({ result: null, asks: [exit] }));
    expect(again.messages.map((m) => m.text)).toEqual(["Try again", "**Is there a door from the basement straight outside?** A side door or walk-out that opens to the yard."]);
    expect(again.thread.step).toBe("wait.q:exit_from_suite");
  });

  it("with every question answered, it's still measuring", () => {
    const t = start(ctx({ result: null, asks: [] }));
    expect(t.step).toBe("wait");
    expect(last(t).text).toMatch(/^Still measuring/);
    expect(last(t).choices).toBeUndefined();
  });

  it("moves to the answer once the result lands, and says nothing new while nothing changed", () => {
    const waiting = start(ctx({ result: null, asks: [] }));
    expect(sync(waiting, ctx({ result: null, asks: [] })).messages).toEqual([]);
    const landed = sync(waiting, ctx());
    expect(landed.thread.step).toBe("answer");
    expect(landed.messages).toHaveLength(1);
    expect(landed.messages[0].id).toBe("m2");
  });

  it("after the result, only what changes the verdict or its money comes first", () => {
    expect(stepOf(ctx({ asks: [plans, look, rent] }), { passed: [] })).toBe("answer");
    const t = start(ctx({ asks: [plans, exit] }));
    expect(t.step).toBe("wait.q:exit_from_suite");
    expect(last(t).text).toMatch(/^One thing before the answer: \*\*Is there a door/);
  });

  it("an aside during a question answers it, then asks the question again", () => {
    const c = ctx({ result: null, asks: [exit] });
    const r = act(start(c), { type: "explain", term: "egress_window" }, c);
    expect(r.thread.step).toBe("wait.q:exit_from_suite");
    expect(r.messages.map((m) => m.from)).toEqual(["you", "guide", "guide"]);
    expect(r.messages[0].text).toBe("What's an escape window?");
    expect(r.messages[1].visual).toEqual({ kind: "explain", term: "egress_window" });
    expect(r.messages[2].text).toMatch(/^Back to my question: \*\*Is there a door/);
    expect(r.messages[2].choices).toHaveLength(3);
  });
});

describe("the guide's answer", () => {
  it("leads with the verdict, then the fix, the rough cost and the money back", () => {
    const m = last(start(ctx()));
    expect(m.text).toBe(
      "**Yes, your basement can be a second home after 1 fix.** The fix: a fire separation between the two homes, $3k–$6k. All in, a contractor would charge roughly $49k–$85k, and you may get up to $4,620 back.",
    );
    expect(m.choices?.map((c) => [c.label, Boolean(c.primary)])).toEqual([
      ["What's a fire separation?", false],
      ["Why that cost?", false],
      ["Show me what it could be", true],
    ]);
    expect(m.choices?.[0].action).toEqual({ type: "explain", term: "fire_separation" });
    expect(m.visual).toEqual({ kind: "plan", mark: "fire" });
  });

  it("names the first of several fixes, leaves out a cost the quote holds, and says money that depends on answers", () => {
    const m = last(
      start(
        ctx({
          result: {
            ...result,
            headline: "Yes, your basement can be a second home after 2 fixes.",
            fixGroups: [{ category: "exit", title: "Separate entrance", costLow: null, costHigh: null }, result.fixGroups[0]],
            money: { total: 0, ifYes: 7000 },
          },
        }),
      ),
    );
    expect(m.text).toBe(
      "**Yes, your basement can be a second home after 2 fixes.** The first: its own way in. All in, a contractor would charge roughly $49k–$85k, and up to $7,000 could come back, depending on a few answers.",
    );
    expect(m.choices?.[0].label).toBe("What's a separate entrance?");
  });

  it("with no fixes and no money, it's the verdict and the cost", () => {
    const m = last(start(ctx({ result: { ...result, verdict: "yes", headline: "Yes, your basement can be a second home.", fixGroups: [], money: null } })));
    expect(m.text).toBe("**Yes, your basement can be a second home.** All in, a contractor would charge roughly $49k–$85k.");
    expect(m.choices?.map((c) => c.label)).toEqual(["Why that cost?", "Show me what it could be"]);
  });

  it("a no still shows the plan", () => {
    const m = last(start(ctx({ result: { ...result, verdict: "no", headline: "Not as a second unit here.", fixGroups: [] } })));
    expect(m.choices?.at(-1)?.label).toBe("Show me the plan anyway");
  });

  it("is done once it's been said, which opens the home base", () => {
    expect(start(ctx({ result: null, asks: [exit] })).done.answer).toBe(false);
    expect(start(ctx()).done).toEqual({ answer: true, design: false, build: false });
  });

  it("costs are whole thousands", () => {
    expect(k(49399)).toBe("$49k");
    expect(k(84523)).toBe("$85k");
    expect(k(400)).toBe("under $1k");
    expect(range(3000, 6000)).toBe("$3k–$6k");
    expect(range(3100, 3400)).toBe("about $3k");
  });

  it("explaining the fix keeps the way on one tap away", () => {
    const r = act(start(ctx()), { type: "explain", term: "fire_separation" }, ctx());
    expect(r.thread.step).toBe("answer");
    const reply = r.messages[1];
    expect(reply.text).toMatch(/^Walls and a ceiling that hold fire and smoke back from the other home for 45 minutes/);
    expect(reply.visual).toEqual({ kind: "explain", term: "fire_separation" });
    expect(reply.choices?.map((c) => c.label)).toEqual(["Can I do it myself?", "Got it, show me what it could be"]);
    expect(reply.choices?.filter((c) => c.primary)).toHaveLength(1);
  });
});

describe("the guide's design: the plan, the layouts, the look", () => {
  it("'Show me what it could be' goes to the plan: is this your basement?", () => {
    const r = act(start(ctx()), { type: "go", to: "design" }, ctx());
    expect(r.messages[0]).toMatchObject({ from: "you", text: "Show me what it could be" });
    expect(r.thread.step).toBe("design.plan");
    expect(r.thread.milestone).toBe("design");
    expect(r.thread.done).toEqual({ answer: true, design: false, build: false });
    const m = r.messages[1];
    expect(m.text).toBe("Before I design: **is this your basement?** Two walls are my guesses (dashed). Tap one to fix it, or tell me.");
    expect(m.why).toBe("every room and price is drawn on this plan.");
    expect(m.choices?.map((c) => c.label)).toEqual(["A wall is off", "Looks right"]);
    expect(m.visual).toEqual({ kind: "planEdit" });
  });

  it("counts what's guessed: one wall, or things other than walls, or nothing", () => {
    const say = (m: Ctx["model"]) => last(at(["answer"], ctx({ model: m }))).text;
    expect(say(model({ guesses: 1 }))).toMatch(/One wall is my guess \(dashed\)/);
    expect(say(model({ guesses: 0, fixtureGuesses: 1 }))).toMatch(/One thing is my guess \(dashed\)/);
    expect(say(model({ guesses: 0 }))).toMatch(/\*\*is this your basement\?\*\* Tap a wall that's off to fix it, or tell me\.$/);
  });

  it("a plan they already confirmed isn't asked again", () => {
    expect(stepOf(ctx({ model: model({ confirmed: true }) }), { passed: ["answer"] })).toBe("design.layouts");
  });

  it("'Looks right' goes to the layouts, recommending one with its reason", () => {
    const c = ctx({ model: model({ recommended: { designId: "one_bedroom", reason: "Keeps your bathroom; the bedroom on the window wall." } }) });
    const r = act(at(["answer"], c), { type: "confirmPlan" }, c);
    expect(r.messages[0].text).toBe("Looks right");
    expect(r.thread.step).toBe("design.layouts");
    const m = r.messages[1];
    expect(m.text).toBe("I drew two layouts that keep your stairs, furnace and window where they are. **For family, I'd start with One bedroom**: keeps your bathroom; the bedroom on the window wall.");
    expect(m.choices?.map((c) => c.label)).toEqual(["Bigger bedroom", "Show Studio", "Use One bedroom"]);
    expect(m.choices?.[0].action).toEqual({ type: "describe", text: "Make the bedroom bigger" });
    expect(m.choices?.at(-1)?.action).toEqual({ type: "chooseDesign", designId: "one_bedroom" });
    expect(m.visual).toEqual({ kind: "layouts", designId: "one_bedroom" });
  });

  it("recommends the first design without a recommendation, and offers no bigger bedroom for a studio", () => {
    const designs = [design("studio", "Studio", "studio", false, "Open and bright."), design("one_bedroom", "One bedroom", "one_bedroom")];
    const m = last(at(["answer"], ctx({ model: model({ confirmed: true, designs }), household: "renter" })));
    expect(m.text).toMatch(/\*\*For a rental, I'd start with Studio\*\*: open and bright\.$/);
    expect(m.choices?.map((x) => x.label)).toEqual(["Show One bedroom", "Use Studio"]);
  });

  it("with one layout, it says so", () => {
    const c = ctx({ model: model({ confirmed: true, designs: [design("studio", "Studio", "studio")] }) });
    expect(last(at(["answer"], c)).text).toBe("I drew a layout that keeps your stairs, furnace and window where they are: **Studio**.");
  });

  it("choosing a layout goes to its look: before and after, drag to compare", () => {
    const c = ctx({ model: model({ confirmed: true }) });
    const r = act(at(["answer"], c), { type: "chooseDesign", designId: "one_bedroom" }, c);
    expect(r.messages[0].text).toBe("Use One bedroom");
    expect(r.thread.step).toBe("design.look");
    const m = r.messages[1];
    expect(m.text).toBe("Here's your basement as you filmed it, and with One bedroom in Light oak. **Drag to compare.** Pick another look, or tell me what you'd like.");
    expect(m.visual).toEqual({ kind: "beforeAfter", designId: "one_bedroom", look: "light" });
    expect(m.choices?.map((x) => x.label)).toEqual(["None of these", "Looks good"]);
  });

  it("another look stays on the look and shows it", () => {
    const passed = ["answer", "design.plan", "design.layouts"];
    const r = act(at(passed), { type: "setLook", look: "warm" }, ctx({ look: "warm" }));
    expect(r.thread.step).toBe("design.look");
    expect(r.messages.map((m) => m.text)).toEqual(["Warm wood", expect.stringContaining("in Warm wood. **Drag to compare.**")]);
  });

  it("'None of these' asks for the look in their words; no look yet asks which", () => {
    const passed = ["answer", "design.plan", "design.layouts"];
    const none = last(at(passed, ctx({ look: "none" })));
    expect(none.text).toMatch(/^\*\*Tell me how you'd like it to look:\*\*/);
    expect(none.visual).toEqual({ kind: "beforeAfter", designId: "one_bedroom", look: "custom" });
    const unset = last(at(passed, ctx({ look: null })));
    expect(unset.text).toBe("Here's One bedroom. **Which look do you like for it?**");
    expect(unset.choices).toHaveLength(5);
  });
});

describe("the guide's build: track F's list, one item at a time", () => {
  const designed = ["answer", "design.plan", "design.layouts"];

  it("'Looks good' goes to the first thing the permit set needs, with its why and its card", () => {
    const r = act(at(designed), { type: "go", to: "build" }, ctx());
    expect(r.messages[0]).toMatchObject({ from: "you", text: "Looks good" });
    expect(r.thread.step).toBe("build.permit:tape");
    expect(r.thread.milestone).toBe("build");
    expect(r.thread.done).toEqual({ answer: true, design: true, build: false });
    expect(r.messages[1]).toMatchObject({ text: "I've drawn and filled your permit set. Measure one wall.", why: "the City checks sizes.", card: { kind: "tape", id: "tape" }, visual: { kind: "permit" } });
    expect(r.messages[1].choices?.map((c) => c.label)).toEqual(["What's a permit set?", "Later"]);
  });

  it("a card's words are their bubble; the item comes again until the list says it's given", () => {
    const passed = [...designed, "design.look"];
    const t = at(passed);
    expect(t.step).toBe("build.permit:tape");
    const saved = act(t, { type: "permitItem", itemId: "tape", value: { said: "Walls 7.56 m and 5.52 m, ceiling 2.08 m" } }, ctx({ build: given("build.permit:tape") }));
    expect(saved.messages.map((m) => [m.from, m.text])).toEqual([
      ["you", "Walls 7.56 m and 5.52 m, ceiling 2.08 m"],
      ["guide", "Who owns the house?"],
    ]);
    const notYet = act(saved.thread, { type: "permitItem", itemId: "owner", value: { said: "Sam" } }, ctx({ build: given("build.permit:tape") }));
    expect(notYet.thread.step).toBe("build.permit:owner");
    expect(notYet.messages.at(-1)!.text).toBe("Who owns the house?");
  });

  it("a money question is answered like any other, and a step that asks nothing has no why", () => {
    const t = at([...designed, "design.look"], ctx({ build: given("build.permit:tape", "build.permit:owner") }));
    expect(t.step).toBe("build.money:senior");
    const r = act(t, { type: "answer", questionId: "senior", value: true }, ctx({ build: given("build.permit:tape", "build.permit:owner", "build.money:senior") }));
    expect(r.messages[0]).toMatchObject({ from: "you", text: "Yes" });
    expect(r.thread.step).toBe("build.submit");
    expect(r.messages[1].why).toBeUndefined();
    expect(r.messages[1].card).toEqual({ kind: "download", id: "submit" });
  });

  it("ends on the list's own done: the book, and the way home", () => {
    const t = at([...designed, "design.look"], ctx({ build: given("build.permit:tape", "build.permit:owner", "build.money:senior", "build.submit") }));
    expect(t.step).toBe("done");
    expect(t.done).toEqual({ answer: true, design: true, build: true });
    expect(last(t)).toMatchObject({ text: "That's everything I need from you.", card: { kind: "download", id: "book" } });
    expect(last(t).why).toBeUndefined();
  });

  it("'Later' goes home and says nothing", () => {
    const t = at([...designed, "design.look"]);
    expect(act(t, { type: "go", to: "home" }, ctx())).toEqual({ thread: t, messages: [] });
  });

  it("with no list, done is its own line", () => {
    const t = at([...designed, "design.look"], ctx({ build: [] }));
    expect(t.step).toBe("done");
    expect(last(t).card).toEqual({ kind: "download", id: "book" });
  });

  it("a take with no plan goes from the answer straight to building", () => {
    const r = act(start(ctx({ model: null })), { type: "go", to: "design" }, ctx({ model: null }));
    expect(r.thread.step).toBe("build.permit:tape");
  });
});

describe("the thread", () => {
  it("every message has its own id, in order, and at most one way on", () => {
    let t = start(ctx({ result: null, asks: [exit] }));
    const c = ctx({ asks: [] });
    for (const a of [
      { type: "answer", questionId: "exit_from_suite", value: true },
      { type: "explain", term: "fire_separation" },
      { type: "go", to: "design" },
      { type: "confirmPlan" },
      { type: "chooseDesign", designId: "one_bedroom" },
      { type: "go", to: "build" },
      { type: "explain", term: "permit_set" },
    ] as const)
      t = act(t, a, c).thread;
    expect(t.step).toBe("build.permit:tape");
    expect(t.messages.map((m) => m.id)).toEqual(t.messages.map((_, i) => `m${i + 1}`));
    for (const m of guideSaid(t.messages)) expect(m.choices?.filter((x) => x.primary).length ?? 0).toBeLessThanOrEqual(1);
    for (const m of t.messages) expect(m.at).toBe(NOW);
    expect(t.visual).toEqual(last(t).visual);
  });

  it("each step belongs to its milestone", () => {
    expect(["wait", "wait.look", "wait.q:rent", "answer"].map(milestoneOf)).toEqual(["answer", "answer", "answer", "answer"]);
    expect(["design.plan", "design.layouts", "design.look"].map(milestoneOf)).toEqual(["design", "design", "design"]);
    expect(["build", "build.permit:tape", "build.money:rent", "build.builders", "done"].map(milestoneOf)).toEqual(["build", "build", "build", "build", "build"]);
  });
});
