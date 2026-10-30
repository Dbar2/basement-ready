import { describe, expect, it } from "vitest";
import { cleanMoneyAnswer, evaluateMoney, fromWho, lowestRentCap, waitQuestions, WHO_IDS, type Who } from "../../server/eligibility";
import { cleanPlans, photoSpaces, plansHousehold, plansOptions, plansQuestion } from "../../server/plans";
import { packFor, type Household } from "../../server/rules";
import { TRIAGE } from "../../server/triage";

const waterloo = packFor("waterloo-on").pack;
const cambridge = packFor("cambridge-on").pack;
const ontario = packFor("other-on").pack; // no city research: no rent caps

const RULE_ASKS = Object.entries(TRIAGE).flatMap(([ruleId, t]) => (t.who === "ask" && t.question ? [{ ruleId, question: t.question, hint: t.hint ?? "" }] : []));

// What the wait screen asks after the start sheet's answer was saved the way the upload saves it.
function afterStart(who: Who | null, extra: Record<string, unknown> = {}, pack = waterloo, findings: Parameters<typeof waitQuestions>[1]["findings"] = null) {
  const start = who ? fromWho(who, pack) : { household: "unsure" as Household, rent: null };
  const answers: Record<string, unknown> = { ...(who ? { who } : {}), ...(start.rent != null ? { rent: start.rent } : {}), ...extra };
  return waitQuestions(pack, { household: start.household, answers, property: { unitsRegistered: 1 }, findings, ruleAsks: RULE_ASKS, plans: plansQuestion(start.household) });
}

describe("the start sheet's one question: who it's for, with the rent folded in", () => {
  it("maps each option to the household and the rent answer the money reads", () => {
    expect(fromWho("family", waterloo)).toEqual({ household: "relative", rent: "none" });
    // About $1,200 or less: the strictest cap in town, so it fits the Region's loan and Waterloo's grant.
    expect(lowestRentCap(waterloo)).toBe(1198);
    expect(fromWho("rental_capped", waterloo)).toEqual({ household: "renter", rent: 1198 });
    expect(fromWho("rental_market", waterloo)).toEqual({ household: "renter", rent: "market" });
    expect(fromWho("unsure", waterloo)).toEqual({ household: "unsure", rent: "unsure" });
    expect(fromWho("rental_capped", cambridge)).toEqual({ household: "renter", rent: 1198 });
  });

  it("saves no rent where no program caps it", () => {
    expect(lowestRentCap(ontario)).toBeNull();
    expect(fromWho("rental_capped", ontario).rent).toBeNull();
    expect(fromWho("rental_market", ontario).rent).toBeNull();
  });

  it("only ever saves a rent the rent question offers", () => {
    for (const pack of [waterloo, cambridge, ontario]) {
      for (const who of WHO_IDS) {
        const { rent } = fromWho(who, pack);
        if (rent != null) expect(cleanMoneyAnswer("rent", rent, pack)).toBe(rent);
      }
    }
  });

  it("settles the rent condition the way the money expects", () => {
    const money = (who: Who) => {
      const { household, rent } = fromWho(who, waterloo);
      const r = evaluateMoney(waterloo, { household, answers: rent == null ? {} : { rent }, property: { unitsRegistered: 1 } });
      return Object.fromEntries(r.programs.map((p) => [p.id, p]));
    };
    const capped = money("rental_capped");
    expect(capped.city_waterloo_aru_grant_interior.question).not.toBe("rent");
    expect(capped.city_waterloo_aru_grant_interior.qualify).not.toBe("no");
    expect(capped.region_ontario_renovates_secondary_suites.qualify).not.toBe("no");
    expect(money("rental_market").region_ontario_renovates_secondary_suites.qualify).toBe("no");
    expect(money("family").federal_mhrtc.question).toBe("senior");
    expect(money("family").city_waterloo_aru_grant_interior.qualify).toBe("no");
  });
});

describe("ask once: the wait screen only asks what's open and still changes something", () => {
  it("never asks who it's for or the rent again after the start sheet", () => {
    for (const who of WHO_IDS) {
      const ids = afterStart(who).map((a) => a.id);
      expect(ids).not.toContain("who");
      expect(ids).not.toContain("household");
      expect(ids).not.toContain("rent");
    }
  });

  it("asks what they'd like it to be first, then the homeowner-only rule questions, then money still open", () => {
    const asks = afterStart("rental_capped");
    expect(asks[0]).toMatchObject({ id: "plans", kind: "plans", words: true });
    expect(asks.slice(1, 3).map((a) => a.id)).toEqual(["exit_from_suite", "plumbing_fixtures_and_shutoff"]);
    expect(asks.slice(3).every((a) => a.kind === "money")).toBe(true);
    expect(asks.map((a) => a.id)).toContain("lives_there");
  });

  it("drops a money question once nothing hangs on it", () => {
    // Market rent rules out the rent-capped programs, so their other conditions stop mattering.
    const ids = afterStart("rental_market").map((a) => a.id);
    expect(ids).not.toContain("other_home");
    expect(ids).not.toContain("house_value");
  });

  it("asks who it's for once, here, when the take came from somewhere that didn't ask", () => {
    const asks = afterStart(null);
    expect(asks[0]).toMatchObject({ id: "who", kind: "who" });
    expect(asks[0].options.map((o) => o.value)).toEqual(WHO_IDS);
    expect(afterStart(null, { who: "unsure" }).map((a) => a.id)).not.toContain("who");
  });

  it("counts Not sure as answered", () => {
    const ids = afterStart("family", { plans: "unsure", exit_from_suite: "unsure", senior: "unsure" }).map((a) => a.id);
    expect(ids).not.toContain("plans");
    expect(ids).not.toContain("exit_from_suite");
    expect(ids).not.toContain("senior");
  });

  it("asks each question at most once and nothing already answered, whatever has been answered", () => {
    const pool: [string, unknown][] = [
      ["plans", "rec_room"],
      ["exit_from_suite", true],
      ["plumbing_fixtures_and_shutoff", false],
      ["lives_there", true],
      ["other_home", "unsure"],
      ["house_value", false],
      ["senior", true],
      ["work_started", false],
    ];
    for (const who of [...WHO_IDS, null]) {
      for (let mask = 0; mask < 1 << pool.length; mask += 7) {
        const extra = Object.fromEntries(pool.filter((_, i) => mask & (1 << i)));
        const asks = afterStart(who, extra, cambridge);
        const ids = asks.map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id in extra || (who && (id === "who" || (id === "rent" && fromWho(who, cambridge).rent != null)))).toBeFalsy();
      }
    }
  });

  it("after the answer, asks only the rule questions the scan left open", () => {
    const findings = [
      { ruleId: "exit_from_suite", status: "likely_ok", question: null },
      { ruleId: "plumbing_fixtures_and_shutoff", status: "needs_answer", question: "Is there a bathroom?", check: { operator: "exists", value: true } },
      { ruleId: "ceiling_height_suite", status: "needs_answer", question: "How high?", check: { operator: ">=", value: 1.95 } }, // a number: the result asks it
      { ruleId: "egress_window_bedroom_area", status: "needs_answer", question: "A window?", check: { operator: "exists", value: true }, answer: { value: true } },
    ];
    const ids = afterStart("family", {}, waterloo, findings).map((a) => a.id);
    expect(ids.filter((id) => !["plans", "senior", "work_started"].includes(id))).toEqual(["plumbing_fixtures_and_shutoff"]);
  });
});

describe("what would you like it to be?", () => {
  it("says the start sheet's answer back instead of asking it again", () => {
    expect(plansOptions("relative").map((o) => o.label)).toEqual(["A suite for family", "A rec room", "Not sure yet"]);
    expect(plansOptions("renter").map((o) => o.label)).toEqual(["A rental suite", "A rec room", "Not sure yet"]);
    expect(plansOptions("unsure").map((o) => o.label)).toEqual(["A suite for a parent", "A rental", "A rec room", "Not sure yet"]);
  });

  it("settles a Not sure start, and never overrides a known one", () => {
    expect(plansHousehold("family_suite", "unsure")).toBe("relative");
    expect(plansHousehold("rental", "unsure")).toBe("renter");
    expect(plansHousehold("rental", "relative")).toBe("relative");
    expect(plansHousehold("rec_room", "unsure")).toBe("unsure");
  });

  it("takes their own words, trimmed, and refuses anything else", () => {
    expect(cleanPlans("rec_room")).toBe("rec_room");
    expect(cleanPlans("  a gym   and an office ")).toBe("a gym and an office");
    expect(cleanPlans("x".repeat(400))?.length).toBe(160);
    expect(cleanPlans(" ")).toBeNull();
    expect(cleanPlans(42)).toBeNull();
  });

  it("tells the photos what to show", () => {
    expect(photoSpaces("rec_room", "renter").living.title).toBe("The rec room");
    expect(photoSpaces("family_suite", "unsure").bedroom.title).toBe("A bedroom for your parent");
    expect(photoSpaces("a home gym", "renter").note).toBe("a home gym");
  });
});
