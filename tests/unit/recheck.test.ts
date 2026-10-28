import { describe, expect, it } from "vitest";
import { buildResult } from "../../server/assess";
import { evaluate, recheck } from "../../server/recheck";
import { packFor } from "../../server/rules";

const pack = packFor("waterloo-on");
const ctx = { household: "relative" as const, municipality: "waterloo-on" };
// A scan that found a small window but couldn't see the ceiling height or the lot.
const scan = buildResult(ctx, pack, { findings: [{ ruleId: "egress_window_bedroom_area", status: "likely_fix", evidence: ["window-window-1"] }] }, [{ id: "window-window-1" }]);

describe("evaluate", () => {
  it("compares numbers and yes/no answers against the rule", () => {
    expect(evaluate({ metric: "h", operator: ">=", value: 1.95, unit: "m" }, 2.0)).toBe("pass");
    expect(evaluate({ metric: "h", operator: ">=", value: 1.95, unit: "m" }, 1.9)).toBe("fail");
    expect(evaluate({ metric: "u", operator: "<=", value: 4, unit: "units" }, 5)).toBe("fail");
    expect(evaluate({ metric: "s", operator: "==", value: true, unit: null }, true)).toBe("pass");
    expect(evaluate({ metric: "e", operator: "exists", value: true, unit: null }, false)).toBe("fail");
    expect(evaluate({ metric: "h", operator: ">=", value: 1.95, unit: "m" }, true)).toBe("unknown");
  });
});

describe("recheck", () => {
  it("a measured ceiling that passes leaves the question list and stays a pass", () => {
    const r = recheck(scan, { ceiling_height_suite: 2.05 });
    const f = r.findings.find((x) => x.ruleId === "ceiling_height_suite")!;
    expect(f.status).toBe("likely_ok");
    expect(f.why).toContain("2.05 m");
    expect(f.evidence).toContain("homeowner");
    expect(r.verdict).toBe("fix"); // the window is still a fix
  });

  it("a ceiling that's too low becomes a priced fix and changes the count", () => {
    const before = scan.fixGroups.length;
    const r = recheck(scan, { ceiling_height_suite: 1.8 });
    expect(r.findings.find((x) => x.ruleId === "ceiling_height_suite")!.status).toBe("likely_fix");
    expect(r.fixGroups.length).toBe(before + 1);
    expect(r.headline).toBe(`Yes, if you fix ${before + 1} things.`);
  });

  it("too many homes on the lot rules out a second unit", () => {
    const r = recheck(scan, { zoning_max_units: 5 });
    expect(r.verdict).toBe("no");
    expect(r.headline).toMatch(/Not as a second unit/);
    expect(r.fixGroups.some((g) => g.category === "zoning")).toBe(false);
  });

  it("clearing an answer puts back what the scan said", () => {
    const answered = recheck(scan, { ceiling_height_suite: 1.8 });
    const cleared = recheck(answered, { ceiling_height_suite: null });
    expect(cleared.findings.find((x) => x.ruleId === "ceiling_height_suite")!.status).toBe(
      scan.findings.find((x) => x.ruleId === "ceiling_height_suite")!.status,
    );
    expect(cleared.verdict).toBe(scan.verdict);
  });

  it("a wrong kind of answer changes nothing", () => {
    const r = recheck(scan, { ceiling_height_suite: true });
    expect(r.findings.find((x) => x.ruleId === "ceiling_height_suite")!.status).toBe("needs_measurement");
  });
});
