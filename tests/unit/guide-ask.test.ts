import { describe, expect, it, vi } from "vitest";
import { answer, askSpark, facts, fromGlossary, guard, SAMPLE_LINE, scripted, suggestion } from "../../server/guide/ask";
import { cite, entryFor, GLOSSARY, matchTerm, sourcesFor } from "../../server/guide/glossary";
import type { Ctx } from "../../server/guide/script";
import { packFor } from "../../server/rules";

const pack = packFor("waterloo-on").pack;
const NOW = "2026-10-31T12:00:00.000Z";
const COMPENDIUM = "https://www.ontario.ca/document/2024-building-code-compendium/part-9-housing-and-small-buildings";

const result = {
  verdict: "fix" as const,
  headline: "Yes, your basement can be a second home after 1 fix.",
  fixGroups: [
    {
      category: "fire",
      title: "Fire/smoke separation between the two homes",
      ruleIds: ["fire_separation_between_units"],
      costLow: 3000,
      costHigh: 6000,
      costSource: { url: "https://renohouse.ca/blog/basement-apartment-conversion-toronto-cost", publisher: "RenoHouse" },
    },
  ],
  cost: { low: 49399, high: 84523, design: "One bedroom" },
  money: { total: 4620, ifYes: 0, programs: [{ name: "Waterloo ARU grant", qualify: "yes", amount: 4620 }] },
  findings: [{ ruleId: "exit_from_suite", status: "needs_answer", answer: null }],
};
const model = {
  version: 1,
  existing: { walls: [{ id: "w1", kind: "foundation", a: [0, 0], b: [5.2, 0], guess: true }], fixtures: [], openings: [], rooms: [], confirmedAt: null },
  designs: [
    { id: "one_bedroom", name: "One bedroom", layout: "one_bedroom", chosen: true, why: "The bedroom on the window wall." },
    { id: "studio", name: "Studio", layout: "studio", chosen: false, why: "Open, with the kitchen by the pipes." },
  ],
  mood: { liked: [], disliked: [], style: null, finishes: {} },
} as never;
const ctx: Ctx = { found: [], asks: [], result, model, look: "light", build: [], household: "relative", now: NOW };

// A Responses API reply with one message.
const reply = (json: unknown) => ({ output: [{ type: "message", content: [{ type: "output_text", text: typeof json === "string" ? json : JSON.stringify(json) }] }] });

describe("the glossary", () => {
  it("answers 'what's a …?' and a bare term, but not a question about doing it", () => {
    expect(matchTerm("What's a fire separation?")).toBe("fire_separation");
    expect(matchTerm("what is type x drywall")).toBe("fire_separation");
    expect(matchTerm("fire separation?")).toBe("fire_separation");
    expect(matchTerm("egress")).toBe("egress_window");
    expect(matchTerm("What does hired-out mean?")).toBe("hired_out");
    expect(matchTerm("tax credit")).toBe("tax_credit");
    expect(matchTerm("Can I do the fire separation myself?")).toBeNull();
    expect(matchTerm("How much is the fire separation?")).toBeNull();
    expect(matchTerm("What's a soffit?")).toBeNull();
    expect(matchTerm("")).toBeNull();
  });

  it("every term has a plain answer, and every rule it sums up is in the pack", () => {
    for (const e of GLOSSARY) {
      expect(e.text.length).toBeGreaterThan(40);
      expect(e.text).not.toMatch(/\b(qualif|approv|eligib)/i);
      for (const id of e.rules) expect(pack.rules.some((r) => r.id === id)).toBe(true);
    }
    expect(pack.grants.some((g) => g.id === entryFor("tax_credit")!.grant)).toBe(true);
  });

  it("says the pack's numbers: the fire separation is 45 minutes, the escape window 0.35 m²", () => {
    expect(pack.rules.find((r) => r.id === "fire_separation_between_units")!.plain).toMatch(/45-minute/);
    expect(entryFor("fire_separation")!.text).toMatch(/45 minutes/);
    expect(pack.rules.find((r) => r.id === "egress_window_bedroom_area")!.plain).toMatch(/0\.35 m²/);
    expect(entryFor("egress_window")!.text).toMatch(/0\.35 m²/);
  });

  it("cites the pack's sources, one link per document with its sections", () => {
    expect(sourcesFor(entryFor("fire_separation")!, pack)).toEqual([`[2024 Building Code Compendium (MMAH), Division B](${COMPENDIUM}), 9.10.9.16.(1), (4) and (5); 9.10.10.4.(1) and (2)(b)`]);
    expect(sourcesFor(entryFor("tax_credit")!, pack)[0]).toMatch(/^\[Multigenerational Home Renovation Tax Credit \(MHRTC\), line 45355\]\(https:\/\/www\.canada\.ca\//);
    expect(sourcesFor(entryFor("permit_set")!, pack)).toEqual([]);
    expect(sourcesFor(entryFor("fire_separation")!, null)).toEqual([]);
    expect(cite([{ title: "A", url: "u", section: "1" }, { title: "A", url: "u", section: "1" }])).toEqual(["[A](u), 1"]);
  });

  it("a glossary answer carries its drawing and its source", () => {
    const r = fromGlossary("What's an escape window?", pack)!;
    expect(r.visual).toEqual({ kind: "explain", term: "egress_window" });
    expect(r.text).toMatch(/Source: \[2024 Building Code Compendium/);
    expect(r.choices?.[0].label).toBe("Is my window big enough?");
  });
});

describe("the guide's own buttons, said in words", () => {
  it("'A wall is off' asks for the wall, on the plan editor", () => {
    expect(scripted("A wall is off", ctx, pack)).toMatchObject({ visual: { kind: "planEdit" }, awaiting: "wall" });
    expect(scripted("the wall's wrong.", ctx, pack)).toBeNull();
    expect(scripted("Wall is wrong", ctx, pack)?.awaiting).toBe("wall");
  });

  it("'Show Studio' shows that layout, with its reason and a way to use it", () => {
    const r = scripted("show me the studio", ctx, pack)!;
    expect(r.text).toBe("Here's Studio: open, with the kitchen by the pipes.");
    expect(r.visual).toEqual({ kind: "layouts", designId: "studio" });
    expect(r.choices?.map((c) => c.label)).toEqual(["Show One bedroom", "Use Studio"]);
    expect(scripted("Show the garage", ctx, pack)).toBeNull();
  });

  it("'Why that cost?' says where each number comes from, in thousands", () => {
    const r = scripted("Why that cost?", ctx, pack)!;
    expect(r.text).toBe(
      "$49k–$85k is what contractors would charge to build One bedroom as drawn: the fixes, the walls, the floors, a kitchen and a bathroom, labour and materials. The fire/smoke separation between the two homes is $3k–$6k, from [RenoHouse](https://renohouse.ca/blog/basement-apartment-conversion-toronto-cost). It's a rough range: doing parts yourself costs less, and a contractor's own quote is the real number.",
    );
    expect(r.visual).toEqual({ kind: "money" });
    expect(scripted("How much does it cost?", ctx, pack)?.visual).toEqual({ kind: "money" });
    expect(scripted("How much money could I get back?", ctx, pack)).toBeNull();
  });
});

describe("guardrails on what Muse Spark says", () => {
  it("drops a sentence that says qualify, eligible or approved", () => {
    expect(guard("You qualify for the grant. The City checks the plans.", ctx, pack)).toBe("The City checks the plans.");
    expect(guard("Once approved, you can build. Your designer checks the rest.", ctx, pack)).toBe("Your designer checks the rest.");
  });

  it("keeps money back exact, says costs in thousands, and drops a figure the facts don't hold", () => {
    expect(guard("You may get up to $4,620 back.", ctx, pack)).toBe("You may get up to $4,620 back.");
    expect(guard("The fix runs $3,000 to $6,000.", ctx, pack)).toBe("The fix runs $3k to $6k.");
    expect(guard("All in it's about $49,399.", ctx, pack)).toBe("All in it's about $49k.");
    expect(guard("A new entrance is $12k–$30k.", ctx, pack)).toBe("A new entrance is $12k–$30k.");
    expect(guard("Tiles cost $17,500. The fix is $3k.", ctx, pack)).toBe("The fix is $3k.");
    expect(guard("I can make that wall 7.2 metres. It was 6.8 m.", ctx, pack)).toBe("I can make that wall 7.2 metres. It was 6.8 m.");
  });

  it("offers a suggested action only if it fits this basement", () => {
    expect(suggestion({ type: "setWall", wallId: "w1", lengthM: 5.5 }, ctx)).toEqual({ label: "Yes, make it 5.5 m", action: { type: "setWall", wallId: "w1", lengthM: 5.5 }, primary: true });
    expect(suggestion({ type: "setWall", wallId: "nope", lengthM: 5.5 }, ctx)).toBeNull();
    expect(suggestion({ type: "setWall", wallId: "w1", lengthM: 90 }, ctx)).toBeNull();
    expect(suggestion({ type: "chooseDesign", designId: "studio" }, ctx)?.label).toBe("Use Studio");
    expect(suggestion({ type: "chooseDesign", designId: "loft" }, ctx)).toBeNull();
    expect(suggestion({ type: "setLook", look: "deep" }, ctx)?.label).toBe("Deep green");
    expect(suggestion({ type: "setLook", look: "neon" }, ctx)).toBeNull();
    expect(suggestion({ type: "describe", text: "Make the bedroom bigger" }, ctx)?.action).toEqual({ type: "describe", text: "Make the bedroom bigger" });
    expect(suggestion({ type: "go", to: "build" }, ctx)).toBeNull();
    expect(suggestion(null, ctx)).toBeNull();
  });

  it("gives Spark the answer, the designs, the walls and the pack's rules as facts", () => {
    const f = facts(ctx, pack, "answer");
    expect(f.answer?.hiredOut).toBe("$49k–$85k");
    expect(f.answer?.fixes[0]).toMatchObject({ cost: "$3k–$6k", rules: ["fire_separation_between_units"] });
    expect(f.answer?.openQuestions).toEqual(["exit_from_suite"]);
    expect(f.walls).toEqual([{ id: "w1", kind: "foundation", lengthM: 5.2, guess: true }]);
    expect(f.rules.find((r) => r.id === "fire_separation_between_units")?.plain).toMatch(/45-minute/);
  });

  it("cites only the pack's own sources, for the rules Spark relied on", async () => {
    const call = vi.fn(async (_body: unknown) => reply({ text: "The walls between the homes need Type X drywall. A drywaller does it.", rules: ["fire_separation_between_units", "made_up_rule"], suggested: null }));
    const r = await askSpark({ text: "Do I need special drywall?", step: "answer", ctx, pack, sample: false }, call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(r.text).toBe(`The walls between the homes need Type X drywall. A drywaller does it. Source: [2024 Building Code Compendium (MMAH), Division B](${COMPENDIUM}), 9.10.9.16.(1), (4) and (5).`);
    expect(r.choices).toBeUndefined();
    const body = call.mock.calls[0][0] as { model: string; input: { content: string }[] };
    expect(body.model).toBe("muse-spark-1.3");
    expect(JSON.parse(body.input[1].content).homeownerAsked).toBe("Do I need special drywall?");
  });

  it("turns a wall's length into a button, and falls back when nothing safe is left", async () => {
    const wall = await askSpark({ text: "The long wall is 5.5 metres", step: "design.plan", ctx, pack, sample: false }, async () => reply({ text: "Got it.", rules: [], suggested: { type: "setWall", wallId: "w1", lengthM: 5.5 } }));
    expect(wall.choices?.[0].action).toEqual({ type: "setWall", wallId: "w1", lengthM: 5.5 });
    const unsafe = await askSpark({ text: "Will I qualify?", step: "answer", ctx, pack, sample: false }, async () => reply({ text: "You qualify, and it's approved.", rules: [] }));
    expect(unsafe.text).toBe("I'm not sure about that one. Your designer or the City's building department can tell you for certain.");
  });

  it("reads the reply's last whole message when an earlier one was cut off", async () => {
    const r = await askSpark({ text: "Hi", step: "answer", ctx, pack, sample: false }, async () => ({
      output: [
        { type: "message", content: [{ type: "output_text", text: '{"text": "I only help with your basement.", "rules": []}' }] },
        { type: "message", content: [{ type: "output_text", text: '{"text": "cut' }] },
      ],
    }));
    expect(r.text).toBe("I only help with your basement.");
  });
});

describe("what they type, in order: the buttons, the glossary, the example, then Spark", () => {
  it("the example never calls a model", async () => {
    const call = vi.fn();
    const r = await answer({ text: "Can I rent it to students?", step: "answer", ctx, pack, sample: true }, { spark: true, call });
    expect(r).toEqual({ text: SAMPLE_LINE, by: "sample" });
    expect((await answer({ text: "What's a fire separation?", step: "answer", ctx, pack, sample: true }, { spark: true, call })).by).toBe("glossary");
    expect(call).not.toHaveBeenCalled();
  });

  it("the buttons and the glossary come before Spark on a real basement too", async () => {
    const call = vi.fn();
    expect((await answer({ text: "Why that cost?", step: "answer", ctx, pack, sample: false }, { spark: true, call })).by).toBe("script");
    expect((await answer({ text: "what's egress?", step: "answer", ctx, pack, sample: false }, { spark: true, call })).by).toBe("glossary");
    expect((await answer({ text: "Can I rent it out?", step: "answer", ctx, pack, sample: false }, { spark: false, call })).by).toBe("unavailable");
    expect(call).not.toHaveBeenCalled();
    const spark = async () => reply({ text: "Yes, a second home can be rented.", rules: [] });
    expect(await answer({ text: "Can I rent it out?", step: "answer", ctx, pack, sample: false }, { spark: true, call: spark })).toEqual({ text: "Yes, a second home can be rented.", by: "spark" });
  });
});
