import { describe, expect, it } from "vitest";
import { buildResult } from "../../server/assess";
import { cleanMoneyAnswer, evaluateMoney, type MoneyAnswers } from "../../server/eligibility";
import { recheck } from "../../server/recheck";
import { packFor, type Household } from "../../server/rules";
import { permitFee, planSteps } from "../../server/steps";

const waterloo = packFor("waterloo-on").pack;
const kitchener = packFor("kitchener-on").pack;
const cambridge = packFor("cambridge-on").pack;

// A suite costing well over the caps, so amounts are the programs' own maximums.
const COST = 120000;
const run = (pack: typeof waterloo, household: Household, answers: MoneyAnswers = {}, extra: { units?: number; cost?: number | null } = {}) =>
  evaluateMoney(pack, { household, answers, property: { unitsRegistered: extra.units ?? 0 }, costHigh: extra.cost === undefined ? COST : extra.cost });
const q = (r: ReturnType<typeof run>, id: string) => r.programs.find((p) => p.id === id)!;

// Everything the Region's loan asks for, answered the way that qualifies.
const REGION_OK: MoneyAnswers = { rent: 1198, lives_there: true, other_home: false, house_value: true, work_started: false };

describe("eligibility: City of Waterloo", () => {
  it("decides nothing it can't: with no answers, money waits on one question per program", () => {
    const r = run(waterloo, "relative");
    expect(q(r, "federal_mhrtc")).toMatchObject({ qualify: "ask", question: "senior" });
    expect(q(r, "city_waterloo_aru_grant_interior")).toMatchObject({ qualify: "ask", question: "rent" });
    expect(q(r, "region_ontario_renovates_secondary_suites")).toMatchObject({ qualify: "ask", question: "rent" });
    // A relative lives there, so CMHC only needs to know the work hasn't started.
    expect(q(r, "cmhc_refinance_secondary_suite")).toMatchObject({ qualify: "ask", question: "work_started" });
    expect(q(r, "dc_exemption_aru").qualify).toBe("yes");
    expect(r.total).toBe(0);
    expect(r.ifYes).toBe(7000 + 20000 + 25000);
  });

  it("a parent who is 65+, living free: the tax credit only, never the rental money", () => {
    const r = run(waterloo, "relative", { senior: true, rent: "none", work_started: false });
    expect(q(r, "federal_mhrtc")).toMatchObject({ qualify: "yes", amountCAD: 7000 });
    expect(q(r, "city_waterloo_aru_grant_interior").qualify).toBe("no");
    expect(q(r, "city_waterloo_aru_grant_interior").reason).toMatch(/lease/);
    expect(q(r, "region_ontario_renovates_secondary_suites").qualify).toBe("no");
    expect(q(r, "cmhc_refinance_secondary_suite").qualify).toBe("yes");
    expect(r.total).toBe(7000);
    expect(r.questions).toEqual([]);
  });

  it("the old bug: a relative who isn't 65+ or on the disability credit gets no tax credit", () => {
    const r = run(waterloo, "relative", { senior: false });
    expect(q(r, "federal_mhrtc").qualify).toBe("no");
    expect(q(r, "federal_mhrtc").reason).toMatch(/65/);
  });

  it("family paying an affordable rent can stack the City grant, the Region loan and the tax credit", () => {
    const r = run(waterloo, "relative", { ...REGION_OK, senior: true });
    expect(q(r, "city_waterloo_aru_grant_interior")).toMatchObject({ qualify: "yes", amountCAD: 20000 });
    expect(q(r, "region_ontario_renovates_secondary_suites")).toMatchObject({ qualify: "yes", amountCAD: 25000 });
    // 14% of up to $50,000, after the $45,000 the grant and loan paid for: still the full $7,000.
    expect(q(r, "federal_mhrtc")).toMatchObject({ qualify: "yes", amountCAD: 7000 });
    expect(r.total).toBe(52000);
  });

  it("an affordable rental qualifies for both rental programs; the tax credit is for family", () => {
    const r = run(waterloo, "renter", REGION_OK);
    expect(q(r, "city_waterloo_aru_grant_interior").qualify).toBe("yes");
    expect(q(r, "region_ontario_renovates_secondary_suites").qualify).toBe("yes");
    expect(q(r, "federal_mhrtc").qualify).toBe("no");
    expect(r.total).toBe(45000);
  });

  it("a rent between the Region's cap and the City's keeps only the City grant", () => {
    const r = run(waterloo, "renter", { ...REGION_OK, rent: 1236 });
    expect(q(r, "city_waterloo_aru_grant_interior").qualify).toBe("yes");
    expect(q(r, "region_ontario_renovates_secondary_suites").qualify).toBe("no");
    expect(r.total).toBe(20000);
  });

  it("market rent rules out both rental programs: the market_rental case", () => {
    const r = run(waterloo, "renter", { rent: "market", lives_there: true, work_started: false });
    expect(q(r, "city_waterloo_aru_grant_interior").qualify).toBe("no");
    expect(q(r, "region_ontario_renovates_secondary_suites").qualify).toBe("no");
    expect(q(r, "cmhc_refinance_secondary_suite").qualify).toBe("yes");
    expect(r.total).toBe(0);
  });

  it("each Region condition fails on its own, with its own reason", () => {
    const cases: [MoneyAnswers, RegExp][] = [
      [{ lives_there: false }, /live in the house/],
      [{ other_home: true }, /one home/],
      [{ house_value: false }, /505,469/],
      [{ work_started: true }, /already started/],
      [{ rent: "none" }, /lease/],
    ];
    for (const [change, reason] of cases) {
      const p = q(run(waterloo, "renter", { ...REGION_OK, ...change }), "region_ontario_renovates_secondary_suites");
      expect(p.qualify, JSON.stringify(change)).toBe("no");
      expect(p.reason).toMatch(reason);
    }
  });

  it("names the Region's two published house-value limits and decides with the lower", () => {
    const p = q(run(waterloo, "renter", REGION_OK), "region_ontario_renovates_secondary_suites");
    expect(p.note).toMatch(/505,469/);
    expect(p.note).toMatch(/600,000/);
  });

  it("work already started closes every program that has to come first", () => {
    const r = run(waterloo, "renter", { ...REGION_OK, work_started: true });
    for (const id of ["city_waterloo_aru_grant_interior", "region_ontario_renovates_secondary_suites", "cmhc_refinance_secondary_suite"]) expect(q(r, id).qualify).toBe("no");
    expect(q(r, "dc_exemption_aru").qualify).toBe("yes");
  });

  it("an owner who doesn't live there can't use CMHC for a rental, but can with family moving in", () => {
    expect(q(run(waterloo, "renter", { lives_there: false, work_started: false }), "cmhc_refinance_secondary_suite").qualify).toBe("no");
    expect(q(run(waterloo, "relative", { lives_there: false, work_started: false }), "cmhc_refinance_secondary_suite").qualify).toBe("yes");
  });

  it("asks who it's for before deciding the tax credit", () => {
    const r = run(waterloo, "unsure", { senior: true });
    expect(q(r, "federal_mhrtc")).toMatchObject({ qualify: "ask", question: "household" });
    expect(r.questions.map((x) => x.id)).toContain("household");
  });

  it("'Not sure' keeps a program one answer away, with the answer shown", () => {
    const r = run(waterloo, "relative", { senior: "unsure" });
    expect(q(r, "federal_mhrtc")).toMatchObject({ qualify: "ask", question: "senior" });
    expect(r.questions.find((x) => x.id === "senior")!.answer).toBe("unsure");
  });

  it("the City grant pays half the cost, up to its maximum", () => {
    const r = run(waterloo, "renter", REGION_OK, { cost: 30000 });
    expect(q(r, "city_waterloo_aru_grant_interior").amountCAD).toBe(15000);
    // The Region's loan covers the other half, not more.
    expect(q(r, "region_ontario_renovates_secondary_suites").amountCAD).toBe(15000);
  });

  it("the tax credit leaves out costs a grant or loan already paid for", () => {
    // $60,000 of work, $45,000 from the City grant and Region loan: 14% of the $15,000 left.
    const r = run(waterloo, "relative", { ...REGION_OK, senior: true }, { cost: 60000 });
    expect(q(r, "city_waterloo_aru_grant_interior").amountCAD).toBe(20000);
    expect(q(r, "federal_mhrtc").amountCAD).toBe(Math.round(0.14 * (60000 - 20000 - 25000)));
  });

  it("never adds up to more than the work costs", () => {
    // $33,000 of work: half from the City, the Region loan covers the rest, nothing left to claim.
    const r = run(waterloo, "relative", { ...REGION_OK, senior: true }, { cost: 33000 });
    expect(q(r, "city_waterloo_aru_grant_interior").amountCAD).toBe(16500);
    expect(q(r, "region_ontario_renovates_secondary_suites").amountCAD).toBe(16500);
    expect(q(r, "federal_mhrtc")).toMatchObject({ qualify: "yes", amountCAD: 0 });
    expect(q(r, "federal_mhrtc").reason).toMatch(/nothing is left/);
    expect(r.total).toBe(33000);
  });

  it("a program one answer away shows what it would add on its own", () => {
    // $39,000 of work, nothing decided: each could add its own share, and together no more than the cost.
    const r = run(waterloo, "relative", {}, { cost: 39000 });
    expect(q(r, "city_waterloo_aru_grant_interior").amountCAD).toBe(19500);
    expect(q(r, "region_ontario_renovates_secondary_suites").amountCAD).toBe(25000);
    expect(q(r, "federal_mhrtc").amountCAD).toBe(Math.round(0.14 * 39000));
    expect(r.ifYes).toBe(39000);
  });

  it("without a cost estimate, shows each program's own maximum", () => {
    expect(run(waterloo, "renter", REGION_OK, { cost: null }).total).toBe(45000);
  });

  it("uses public records for how many homes the lot would have", () => {
    expect(q(run(waterloo, "renter", {}, { units: 2 }), "dc_exemption_aru").qualify).toBe("yes"); // 3rd home
    expect(q(run(waterloo, "renter", {}, { units: 3 }), "dc_exemption_aru").qualify).toBe("no"); // 4th home
    expect(q(run(waterloo, "renter", { lives_there: true, work_started: false }, { units: 3 }), "cmhc_refinance_secondary_suite").qualify).toBe("yes");
    expect(q(run(waterloo, "renter", { lives_there: true, work_started: false }, { units: 4 }), "cmhc_refinance_secondary_suite").qualify).toBe("no");
  });

  it("never counts savings or financing as money you get", () => {
    const r = run(waterloo, "relative", { senior: true, rent: "none", work_started: false });
    expect(q(r, "dc_exemption_aru")).toMatchObject({ value: "savings", amountCAD: null });
    expect(q(r, "cmhc_refinance_secondary_suite")).toMatchObject({ value: "financing", amountCAD: null });
  });

  it("lists yes first, then one answer away, then no", () => {
    const r = run(waterloo, "relative", { senior: true });
    const order = r.programs.map((p) => p.qualify);
    expect([...order].sort((a, b) => ["yes", "ask", "no"].indexOf(a) - ["yes", "ask", "no"].indexOf(b))).toEqual(order);
  });
});

describe("eligibility: which questions are asked", () => {
  it("never asks a renter about age or disability, and offers no 'No rent' option", () => {
    const r = run(waterloo, "renter");
    const ids = r.questions.map((x) => x.id);
    expect(ids).not.toContain("senior");
    expect(r.questions.find((x) => x.id === "rent")!.options.map((o) => o.value)).toEqual([1198, 1236, "market", "unsure"]);
  });

  it("asks only what still changes a program, one answer at a time", () => {
    // Market rent ends both rental programs, so the Region's own questions are never asked.
    const r = run(waterloo, "renter", { rent: "market" });
    expect(r.questions.map((x) => x.id)).toEqual(["lives_there"]); // CMHC's first open condition
    expect(run(waterloo, "renter", { rent: "market", lives_there: true }).questions.map((x) => x.id)).toEqual(["work_started"]);
    expect(run(waterloo, "renter", { rent: "market", lives_there: false }).questions).toEqual([]);
  });

  it("asks at most five questions once who it's for is known", () => {
    for (const household of ["relative", "renter"] as const) {
      const seen = new Set<string>();
      let answers: MoneyAnswers = {};
      // Answer each question the way that keeps every program alive, and collect what's asked.
      for (let i = 0; i < 10; i++) {
        const r = run(waterloo, household, answers);
        const next = r.questions.find((x) => x.answer === null);
        if (!next) break;
        seen.add(next.id);
        answers = { ...answers, [next.id]: ({ rent: 1198, lives_there: true, other_home: false, house_value: true, senior: true, work_started: false } as Record<string, unknown>)[next.id] as never };
      }
      expect(seen.size, household).toBeLessThanOrEqual(household === "relative" ? 6 : 5);
      expect(run(waterloo, household, answers).questions).toEqual([]);
    }
  });

  it("says which programs each question decides", () => {
    const r = run(waterloo, "renter");
    expect(r.questions.find((x) => x.id === "rent")!.decides).toEqual(expect.arrayContaining(["City of Waterloo ARU grant", "Region of Waterloo forgivable loan"]));
  });

  it("keeps only answers a question offers", () => {
    expect(cleanMoneyAnswer("rent", 1198, waterloo)).toBe(1198);
    expect(cleanMoneyAnswer("rent", 1500, waterloo)).toBeNull();
    expect(cleanMoneyAnswer("rent", "none", waterloo)).toBe("none");
    expect(cleanMoneyAnswer("lives_there", "maybe", waterloo)).toBeNull();
    expect(cleanMoneyAnswer("household", "relative", waterloo)).toBeNull(); // its own route
    expect(cleanMoneyAnswer("exit_from_suite", true, waterloo)).toBeNull();
  });
});

describe("eligibility: Kitchener", () => {
  it("has the Region loan and the federal money but no Waterloo grant", () => {
    const r = run(kitchener, "renter", REGION_OK);
    expect(r.programs.some((p) => p.id === "city_waterloo_aru_grant_interior")).toBe(false);
    expect(q(r, "region_ontario_renovates_secondary_suites").qualify).toBe("yes");
    expect(r.total).toBe(25000);
  });

  it("the City's ADU grant only refunds school-board charges: shown, never counted", () => {
    for (const household of ["relative", "renter", "unsure"] as const) {
      const p = q(run(kitchener, household, { rent: "market" }), "city_kitchener_adu_grant");
      expect(p).toMatchObject({ qualify: "yes", value: "savings", amountCAD: null });
    }
  });

  it("only one rent cap, so the rent question has one affordable option", () => {
    const r = run(kitchener, "renter");
    expect(r.questions.find((x) => x.id === "rent")!.options.map((o) => o.value)).toEqual([1198, "market", "unsure"]);
  });

  it("a parent 65+ living free gets the tax credit", () => {
    expect(run(kitchener, "relative", { senior: true, rent: "none", work_started: false }).total).toBe(7000);
  });
});

describe("eligibility: Cambridge", () => {
  it("the City grant fits any occupant at any rent, while work hasn't started", () => {
    for (const household of ["relative", "renter"] as const) {
      const r = run(cambridge, household, { rent: "market", work_started: false });
      expect(q(r, "city_cambridge_aru_grant")).toMatchObject({ qualify: "yes", amountCAD: 10000 });
    }
    expect(q(run(cambridge, "renter", { work_started: true }), "city_cambridge_aru_grant").qualify).toBe("no");
    expect(q(run(cambridge, "renter"), "city_cambridge_aru_grant")).toMatchObject({ qualify: "ask", question: "work_started" });
  });

  it("stacks the City grant, the Region loan and the tax credit for family at an affordable rent", () => {
    const r = run(cambridge, "relative", { ...REGION_OK, senior: true });
    expect(r.total).toBe(10000 + 25000 + 7000);
  });

  it("says how much of the City's budget was left", () => {
    expect(q(run(cambridge, "renter"), "city_cambridge_aru_grant").note).toMatch(/880,000/);
  });
});

describe("eligibility: elsewhere in Ontario", () => {
  it("only federal and provincial money, decided the same way", () => {
    const other = packFor("ontario").pack;
    const r = evaluateMoney(other, { household: "relative", answers: { senior: true, work_started: false }, costHigh: COST });
    expect(r.programs.map((p) => p.id).sort()).toEqual(["cmhc_refinance_secondary_suite", "dc_exemption_aru", "federal_mhrtc"]);
    expect(r.total).toBe(7000);
    expect(r.questions).toEqual([]);
  });
});

describe("recheck: answers change the money", () => {
  const scan = buildResult({ household: "relative", municipality: "waterloo-on" }, packFor("waterloo-on"), { findings: [] }, []);
  // The scan's own estimate: the work every suite needs, priced from the pack.
  const high = scan.cost.high;

  it("each money answer recomputes the headline and the steps", () => {
    const before = recheck({ ...scan, household: "relative" }, {});
    expect(before.money.total).toBe(0);
    const after = recheck({ ...scan, household: "relative" }, { senior: true, rent: "none", work_started: false });
    expect(after.money.total).toBe(Math.min(7000, Math.round(0.14 * Math.min(50000, high))));
    expect(after.steps.map((s) => s.id)).toContain("tax");
  });

  it("changing who it's for re-decides the money with the same answers", () => {
    const answers = { ...REGION_OK, senior: true };
    const relative = recheck({ ...scan, household: "relative" }, answers).grants;
    const renter = recheck({ ...scan, household: "renter" }, answers).grants;
    expect(relative.find((g) => g.id === "federal_mhrtc")!.qualify).toBe("yes");
    expect(renter.find((g) => g.id === "federal_mhrtc")!.qualify).toBe("no");
  });

  it("money answers never touch the building rules", () => {
    const r = recheck({ ...scan, household: "relative" }, { senior: true, rent: 1198 });
    expect(r.findings.every((f) => f.answer === null)).toBe(true);
    expect(r.answeredCount).toBe(0);
  });
});

describe("How to apply", () => {
  const steps = (pack: typeof waterloo, household: Household, answers: MoneyAnswers, areaM2: number | null = 42) => {
    const programs = run(pack, household, answers).programs;
    return planSteps({ city: "Waterloo", household, programs, fixGroups: [], standard: [], cost: { low: 80000, high: COST }, areaM2 }, pack);
  };

  it("runs in the order it happens", () => {
    const s = steps(waterloo, "relative", { ...REGION_OK, senior: true });
    expect(s.map((x) => x.id)).toEqual(["before", "drawings", "permit", "build", "after", "tax"]);
  });

  it("puts each program where it happens: apply before work, get paid after occupancy, the credit at tax time", () => {
    const s = steps(waterloo, "relative", { ...REGION_OK, senior: true });
    const at = (id: string) => s.find((x) => x.id === id)!.tasks.filter((t) => t.program).map((t) => t.program!.id);
    expect(at("before")).toEqual(expect.arrayContaining(["city_waterloo_aru_grant_interior", "region_ontario_renovates_secondary_suites", "cmhc_refinance_secondary_suite"]));
    expect(at("before")).not.toContain("federal_mhrtc");
    expect(at("permit")).toContain("region_ontario_renovates_secondary_suites"); // the permit and 3 quotes
    expect(at("after")).toEqual(expect.arrayContaining(["city_waterloo_aru_grant_interior", "region_ontario_renovates_secondary_suites"]));
    expect(at("tax")).toEqual(["federal_mhrtc"]);
  });

  it("Cambridge's grant is applied for after occupancy, never before work", () => {
    const s = steps(cambridge, "renter", { rent: "market", lives_there: true, work_started: false });
    const before = s.find((x) => x.id === "before")!.tasks.map((t) => t.program?.id);
    const after = s.find((x) => x.id === "after")!.tasks.map((t) => t.program?.id);
    expect(before).not.toContain("city_cambridge_aru_grant");
    expect(after).toContain("city_cambridge_aru_grant");
  });

  it("leaves out programs they don't qualify for, and the tax step when there's no credit", () => {
    const s = steps(waterloo, "renter", { rent: "market", lives_there: false, work_started: false });
    expect(s.flatMap((x) => x.tasks).some((t) => t.program)).toBe(false);
    expect(s.map((x) => x.id)).not.toContain("tax");
  });

  it("gives every task somewhere to go", () => {
    for (const pack of [waterloo, kitchener, cambridge]) {
      const s = steps(pack, "relative", { ...REGION_OK, senior: true });
      for (const t of s.flatMap((x) => x.tasks)) {
        expect(t.links.length, `${pack.jurisdiction.city}: ${t.title}`).toBeGreaterThan(0);
        for (const l of t.links) expect(l.url, t.title).toMatch(/^(https:\/\/|mailto:|tel:)/);
      }
    }
  });

  it("Waterloo's grant sets the permit window", () => {
    const s = steps(waterloo, "renter", REGION_OK);
    expect(s.find((x) => x.id === "permit")!.when).toMatch(/120 days/);
    expect(steps(waterloo, "renter", { rent: "market" }).find((x) => x.id === "permit")!.when).not.toMatch(/120 days/);
  });

  it("offers drawing your own plans as well as a registered designer", () => {
    for (const pack of [waterloo, kitchener, cambridge]) {
      const d = steps(pack, "renter", {}).find((x) => x.id === "drawings")!;
      expect(d.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(["Draw them yourself", "Or hire a registered (BCIN) designer"]));
      expect(d.costLow).toBeGreaterThan(0);
    }
  });
});

describe("permit fee from the floor area", () => {
  const sqft = (m2: number) => Math.round(m2 * 10.7639);

  it("Waterloo: per new home plus per square foot", () => {
    expect(permitFee(waterloo, 42.1)!.amount).toBe(Math.round(392 + 0.62 * sqft(42.1)));
  });

  it("Kitchener: per square foot, with the refundable deposit named but not counted", () => {
    const f = permitFee(kitchener, 42.1)!;
    expect(f.amount).toBe(Math.round(0.37 * sqft(42.1)));
    expect(f.note).toMatch(/\$250/);
  });

  it("Cambridge: an estimate from the interior-finish rate, with its minimum", () => {
    const f = permitFee(cambridge, 42.1)!;
    expect(f.amount).toBe(Math.round(0.5 * sqft(42.1) + 25));
    expect(f.estimate).toBe(true);
    expect(permitFee(cambridge, 5)!.amount).toBe(143);
  });

  it("without an area, gives the rate instead of a made-up number", () => {
    const f = permitFee(waterloo, null)!;
    expect(f.amount).toBeNull();
    expect(f.note).toMatch(/\$0.62 per sq ft/);
  });
});
