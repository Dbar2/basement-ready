import { describe, expect, it } from "vitest";
import { buildResult } from "../../server/assess";
import { coreRules, packFor } from "../../server/rules";

const waterloo = packFor("waterloo-on");
const rules = coreRules(waterloo.pack);
const ctx = { household: "relative" as const, municipality: "waterloo-on" };
const detections = [{ id: "window-window-1" }, { id: "duct-duct-1" }];

describe("buildResult: the trust rule", () => {
  it("holds back a claim with no SAM evidence", () => {
    const r = buildResult(ctx, waterloo, { findings: [{ ruleId: "egress_window_bedroom_area", status: "likely_fix", evidence: [] }] }, detections);
    const f = r.findings.find((x) => x.ruleId === "egress_window_bedroom_area")!;
    // Not a claim, and not a tape question either: the designer confirms the window.
    expect(f.status).toBe("designer_checks");
    expect(f.question).toBeNull();
    expect(r.heldBack).toBe(1);
    expect(r.fixGroups).toHaveLength(0);
  });

  it("drops evidence ids SAM never produced", () => {
    const r = buildResult(ctx, waterloo, { findings: [{ ruleId: "egress_window_bedroom_area", status: "likely_fix", evidence: ["window-made-up-9"] }] }, detections);
    expect(r.findings.find((x) => x.ruleId === "egress_window_bedroom_area")!.status).not.toBe("likely_fix");
  });

  it("keeps a supported claim and prices it", () => {
    const r = buildResult(ctx, waterloo, { findings: [{ ruleId: "egress_window_bedroom_area", status: "likely_fix", evidence: ["window-window-1"] }] }, detections);
    expect(r.verdict).toBe("fix");
    expect(r.headline).toBe("Yes, your basement can be a second home after 1 fix.");
    expect(r.cost.low).toBeGreaterThan(0);
  });

  it("counts related rules as one thing to fix and never double-counts cost", () => {
    const both = buildResult(ctx, waterloo, {
      findings: [
        { ruleId: "egress_window_bedroom_area", status: "likely_fix", evidence: ["window-window-1"] },
        { ruleId: "egress_window_min_dimension", status: "likely_fix", evidence: ["window-window-1"] },
      ],
    }, detections);
    const one = buildResult(ctx, waterloo, { findings: [{ ruleId: "egress_window_bedroom_area", status: "likely_fix", evidence: ["window-window-1"] }] }, detections);
    expect(both.fixGroups).toHaveLength(1);
    expect(both.cost).toEqual(one.cost);
  });

  it("asks only what a homeowner knows when Spark skipped everything", () => {
    const r = buildResult(ctx, waterloo, { findings: [] }, detections);
    expect(r.findings).toHaveLength(rules.length);
    const asked = r.findings.filter((f) => f.status === "needs_answer");
    expect(asked.map((f) => f.ruleId).sort()).toEqual(["exit_from_suite", "plumbing_fixtures_and_shutoff"]);
    expect(asked.every((f) => f.question && !/ESA|return-air|STC|gypsum/i.test(f.question))).toBe(true);
    // Fire separation, alarms and the rest are budgeted as standard suite work, not asked.
    expect(r.standard.map((s) => s.ruleId)).toContain("smoke_alarms_interconnected");
    expect(r.cost.standardLow).toBeGreaterThan(0);
    expect(r.verdict).toBe("yes");
  });
});

describe("money and coverage", () => {
  it("decides the money in code, and never says yes before the deciding question is answered", () => {
    const forMom = buildResult({ ...ctx, household: "relative" }, waterloo, { findings: [] }, []);
    const rental = buildResult({ ...ctx, household: "renter" }, waterloo, { findings: [] }, []);
    // Cancelled programs never reach the homeowner.
    expect(forMom.grants.some((g) => g.id === "canada_secondary_suite_loan_program")).toBe(false);
    // A suite for Mom: the tax credit waits on her age; the rental programs wait on the rent.
    expect(forMom.grants.find((g) => g.id === "federal_mhrtc")).toMatchObject({ qualify: "ask", question: "senior" });
    expect(forMom.grants.find((g) => g.id === "city_waterloo_aru_grant_interior")).toMatchObject({ qualify: "ask", question: "rent" });
    expect(rental.grants.find((g) => g.id === "federal_mhrtc")!.qualify).toBe("no");
    expect(forMom.money.total).toBe(0);
    expect(forMom.moneyQuestions.map((q) => q.id)).toEqual(expect.arrayContaining(["rent", "senior", "work_started"]));
  });

  it("falls back to provincial rules outside covered cities", () => {
    const other = packFor("other-on");
    expect(other.coverage).toBe("provincial");
    expect(other.pack.rules.some((r) => r.category === "zoning")).toBe(false);
    expect(other.pack.grants.every((g) => g.level === "federal" || g.level === "provincial")).toBe(true);
  });

  it("rejects odd municipality slugs", () => {
    expect(packFor("../../etc").coverage).toBe("provincial");
  });
});

import { cleanVision } from "../../server/assess";

describe("cleanVision", () => {
  it("keeps what the homeowner said, with the moment they said it", () => {
    const v = cleanVision({ rooms: [{ room: "kitchen", where: "by the stairs", atSeconds: 12.34, quote: "kitchen here" }], style: "bright", mustHaves: ["laundry"], forWhom: "my mom" });
    expect(v.rooms).toEqual([{ room: "kitchen", where: "by the stairs", atSeconds: 12.3, quote: "kitchen here" }]);
    expect(v).toMatchObject({ style: "bright", mustHaves: ["laundry"], forWhom: "my mom" });
  });
  it("drops junk instead of trusting it", () => {
    const v = cleanVision({ rooms: [{ room: "" }, { room: "bath", atSeconds: -4 }, "nonsense"], mustHaves: "laundry" });
    expect(v.rooms).toEqual([{ room: "bath", where: "", atSeconds: null, quote: "" }]);
    expect(v.mustHaves).toEqual([]);
  });
  it("is empty when nothing was said", () => {
    expect(cleanVision(undefined)).toEqual({ rooms: [], style: "", mustHaves: [], forWhom: "" });
  });
});
