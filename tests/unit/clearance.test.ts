import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildResult } from "../../server/assess";
import { clearanceRule, overheadFinds, sortClearances } from "../../server/clearance";
import { existingFromScan } from "../../server/model/seed";
import { packFor } from "../../server/rules";
import type { Measurements } from "../../server/scan3d";

const waterloo = packFor("waterloo-on");
const measured = (ceilingHeightM: number | null, clearances: [string, string, number][], extra: Partial<Measurements> = {}): Measurements => ({
  ceilingHeightM, widthM: 5, depthM: 4, scaleSource: "model", confidence: "low", expectedErrorPct: 20, pass: null, trusted: false, warnings: [],
  clearances: clearances.map(([detectionId, label, clearanceM]) => ({ detectionId, label, clearanceM })), ...extra,
});
const tape = { scaleSource: "arkit" as const, expectedErrorPct: 2, trusted: true };

// David's real take, as the scan measured it (Oct 30 replay): three rooms on the video's own scale.
const david = () => [
  { name: "Room 1", measurements: measured(2.203, [["duct-duct-1", "Duct", 1.72], ["beam-beam-1", "Beam", 1.8], ["duct-bulkhead-pt1", "Bulkhead", 1.42]]) },
  { name: "Rec room", measurements: measured(2.375, [["duct-duct-3", "Duct", 1.2], ["beam-beam-2", "Beam", 1.2], ["duct-bulkhead-pt1", "Bulkhead", 2.09]]) },
  { name: "Furnace room", measurements: measured(null, [["duct-duct-3", "Duct", 1.55], ["duct-duct-6", "Duct", 2.35], ["beam-beam-2", "Beam", 1.54], ["beam-beam-3", "Beam", 2.39]]) },
];

describe("sortClearances: readings that can't be headroom are set aside", () => {
  it("David's 1.20 m under a 2.38 m ceiling is set aside, and so is a find read differently from two rooms", () => {
    const rooms = sortClearances(david());
    const kept = (i: number) => rooms[i].measurements!.clearances.map((c) => c.detectionId);
    expect(kept(0)).toEqual(["duct-duct-1", "beam-beam-1"]);
    expect(kept(1)).toEqual([]);
    // The furnace room had no ceiling read: it's judged against the basement's, about 2.29 m.
    expect(kept(2)).toEqual(["duct-duct-6", "beam-beam-3"]);
    const rec = rooms[1].measurements!.doubtful!;
    expect(rec.map((d) => d.detectionId)).toEqual(["duct-duct-3", "beam-beam-2", "duct-bulkhead-pt1"]);
    expect(rec[0].why).toMatch(/1\.20 m under the duct in the Rec room is 1\.18 m below its 2\.38 m ceiling/);
    expect(rec[2].why).toMatch(/read 2\.09 m in the Rec room but 1\.42 m from another room/);
  });

  it("keeps real low headroom: a duct 25 cm under open joists", () => {
    const [r] = sortClearances([{ name: "Basement", measurements: measured(2.035, [["duct-duct-1", "Duct", 1.785], ["beam-beam-1", "Beam", 1.835]]) }]);
    expect(r.measurements!.clearances).toHaveLength(2);
    expect(r.measurements!.doubtful).toBeUndefined();
  });
});

describe("clearanceRule: the headroom decided from the lowest real reading", () => {
  it("a measured duct under the rule is a fix, even with the scan's margin (b1)", () => {
    const d = clearanceRule(sortClearances([{ name: "Basement", measurements: measured(2.035, [["duct-duct-1", "Duct", 1.785]], tape) }]), 1.85)!;
    expect(d.status).toBe("likely_fix");
    expect(d.why).toMatch(/about 1\.77 m under the duct in the Basement once finished/);
    expect(d.evidence).toEqual(["duct-duct-1", "scan3d"]);
    expect(d.measured).toMatchObject({ value: 1.77, limit: 1.85, source: "arkit" });
  });

  it("clears the rule when the worst case still clears it (b2)", () => {
    expect(clearanceRule([{ name: "Family room", measurements: measured(2.35, [["duct-bulkhead-1", "Bulkhead", 2.1]], tape) }], 1.85)!.status).toBe("likely_ok");
  });

  it("a reading on the video's own scale that could be either side is the designer's to confirm", () => {
    const d = clearanceRule(sortClearances(david()), 1.85)!;
    expect(d.status).toBe("designer_checks");
    expect(d.why).toMatch(/about 1\.70 m under the duct in Room 1 once finished \(±34 cm\)/);
    expect(d.why).toMatch(/6 readings were set aside as not headroom, the lowest: 1\.20 m under the duct in the Rec room is 1\.18 m below its 2\.38 m ceiling/);
  });

  it("is a fix on the video's scale too when even the best case is under the rule", () => {
    expect(clearanceRule([{ name: "Basement", measurements: measured(1.95, [["duct-duct-1", "Duct", 1.4]]) }], 1.85)!.status).toBe("likely_fix");
  });

  it("only set-aside readings: the designer measures; nothing overhead: no decision", () => {
    const only = sortClearances([{ name: "Rec room", measurements: measured(2.4, [["duct-duct-1", "Duct", 1.2]]) }]);
    expect(clearanceRule(only, 1.85)).toMatchObject({ status: "designer_checks", measured: null });
    expect(clearanceRule([{ name: "Rec room", measurements: measured(2.4, []) }], 1.85)).toBeNull();
  });
});

describe("buildResult: a failing clearance is a counted fix, the same on every take", () => {
  const ctx = (rooms: ReturnType<typeof david>) => ({ household: "renter" as const, municipality: "waterloo-on", rooms });
  const b1 = () => sortClearances([{ name: "Basement", measurements: measured(2.035, [["duct-duct-1", "Duct", 1.785]], tape) }]);
  const detections = [{ id: "duct-duct-1", label: "Duct" }];

  it("is in the fix list and the fix count, whatever Spark said about it", () => {
    const claimed = buildResult(ctx(b1()), waterloo, { findings: [{ ruleId: "clearance_beams_ducts_suite", status: "likely_ok", evidence: ["duct-duct-1"] }] }, detections);
    const silent = buildResult(ctx(b1()), waterloo, { findings: [] }, detections);
    for (const r of [claimed, silent]) {
      expect(r.findings.find((f) => f.ruleId === "clearance_beams_ducts_suite")!.status).toBe("likely_fix");
      expect(r.fixGroups.flatMap((g) => g.ruleIds)).toContain("clearance_beams_ducts_suite");
    }
    expect(claimed.headline).toBe(silent.headline);
    expect(claimed.cost).toEqual(silent.cost);
  });

  it("David's take: no fix from a reading that can't be right, and it says why", () => {
    const r = buildResult(ctx(sortClearances(david())), waterloo, { findings: [] }, detections);
    const f = r.findings.find((x) => x.ruleId === "clearance_beams_ducts_suite")!;
    expect(f.status).toBe("designer_checks");
    expect(f.why).toMatch(/1\.20 m under the duct in the Rec room/);
    expect(r.fixGroups.flatMap((g) => g.ruleIds)).not.toContain("clearance_beams_ducts_suite");
  });
});

describe("the plan keeps a set-aside find, with no height", () => {
  it("a duct whose reading was set aside is on the plan to tape, and never the lowest headroom", () => {
    const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
    const rooms = sortClearances(sample.rooms);
    const result = { ...sample, rooms, measurements: rooms[0].measurements };
    expect(overheadFinds(result.measurements).find((c) => c.detectionId === "beam-beam-1")?.clearanceM).toBeNull();
    const overhead = existingFromScan(result)!.fixtures.filter((f) => f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead");
    expect(overhead.find((f) => f.detectionId === "beam-beam-1")?.heightM ?? null).toBeNull();
    expect(Math.min(...overhead.flatMap((f) => (f.heightM != null ? [f.heightM] : [])))).toBe(1.64);
  });
});
