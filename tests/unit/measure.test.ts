import { describe, expect, it } from "vitest";
import { buildResult, measuredCheck } from "../../server/assess";
import { packFor } from "../../server/rules";
import { doorScale, rescaleMeasurements, type Measurements } from "../../server/scan3d";
import { parseLength } from "../../src/units";

describe("parseLength", () => {
  it.each([
    ["2.1", 2.1],
    ["2.10 m", 2.1],
    ["210 cm", 2.1],
    ["210", 2.1],
    ["2100 mm", 2.1],
    ["6'11\"", 2.108],
    ["6' 11", 2.108],
    ["6 ft 11 in", 2.108],
    ["83 in", 2.108],
    ["7'", 2.134],
  ])("%s → %s m", (text, m) => expect(parseLength(text)).toBeCloseTo(m, 3));

  it.each(["", "tall", "12", "0.5", "6 feet tall"])("rejects %j", (text) => expect(parseLength(text)).toBeNull());
});

const pack = packFor("waterloo-on");
const ceilingRule = pack.pack.rules.find((r) => r.id === "ceiling_height_suite")!;
const base: Measurements = {
  ceilingHeightM: 2.1, widthM: 6.4, depthM: 4.1, scaleSource: "user_measurement", confidence: "high",
  expectedErrorPct: 3.5, pass: null, trusted: true, warnings: [], clearances: [],
};

describe("measuredCheck", () => {
  it("passes a ceiling clearly above the limit when the tape set the scale", () => {
    expect(measuredCheck(ceilingRule, base)?.status).toBe("likely_ok");
  });
  it("calls a near miss a close call instead of guessing", () => {
    expect(measuredCheck(ceilingRule, { ...base, ceilingHeightM: 1.98 })?.status).toBe("needs_measurement");
  });
  it("flags a ceiling clearly too low", () => {
    expect(measuredCheck(ceilingRule, { ...base, ceilingHeightM: 1.8 })?.status).toBe("likely_fix");
  });
  it("won't decide from an estimated scale unless it's far from the limit", () => {
    expect(measuredCheck(ceilingRule, { ...base, scaleSource: "model", expectedErrorPct: 20 })?.status).toBe("needs_measurement");
  });
  it("ignores a scan that failed its own quality checks", () => {
    expect(measuredCheck(ceilingRule, { ...base, trusted: false })).toBeNull();
  });
  it("uses the lowest duct or beam for clearance", () => {
    const clearance = pack.pack.rules.find((r) => r.id === "clearance_beams_ducts_suite")!;
    const m = { ...base, clearances: [{ detectionId: "duct-duct-1", label: "Duct", clearanceM: 1.7 }, { detectionId: "beam-beam-1", label: "Beam", clearanceM: 2.0 }] };
    expect(measuredCheck(clearance, m)?.status).toBe("likely_fix");
  });
  it("overrides Spark and cites the scan in the answer", () => {
    const r = buildResult({ household: "relative", municipality: "waterloo-on" }, pack, { findings: [] }, [], base);
    const f = r.findings.find((x) => x.ruleId === "ceiling_height_suite")!;
    expect(f.status).toBe("likely_ok");
    expect(f.evidence).toContain("scan3d");
    expect(f.measured?.value).toBeCloseTo(2.08, 2);
  });
});

describe("doors as a ruler", () => {
  it("uses two doors that agree, and only for a small correction", () => {
    // Two doors reading 1.98 and 2.01 scan units → scale about 1.02.
    const s = doorScale([1.98, 2.01, 1.2]);
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(1.01);
    expect(s!).toBeLessThan(1.03);
  });

  it("ignores one door, doors that disagree, and corrections too big to trust", () => {
    expect(doorScale([2.0])).toBeNull();
    expect(doorScale([1.5, 2.0])).toBeNull();
    // Your furnace room: four doors around 1.6 → a 23% correction, rejected.
    expect(doorScale([1.47, 1.65, 1.77, 1.6])).toBeNull();
  });

  it("rescales every length and marks the source", () => {
    const m = rescaleMeasurements(
      { ceilingHeightM: 2.2, widthM: 4, depthM: 3, scaleSource: "model", confidence: "low", expectedErrorPct: 20, pass: null, trusted: false, warnings: [], clearances: [{ detectionId: "d", label: "Duct", clearanceM: 1.9 }] },
      1.1,
    );
    expect(m.ceilingHeightM).toBe(2.42);
    expect(m.clearances[0].clearanceM).toBe(2.09);
    expect(m.scaleSource).toBe("door");
  });
});
