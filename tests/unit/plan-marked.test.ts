import { describe, expect, it } from "vitest";
import type { Check, Existing } from "../../server/model/types";
import type { ScanResult } from "../../src/api";
import { placeMark } from "../../src/guide/visuals/PlanMarked";

const existing = {
  fixtures: [
    { id: "st", kind: "stairs", at: [1, 1], sizeM: [1, 3] },
    { id: "du", kind: "duct", at: [4, 3], sizeM: [6, 0.4] },
  ],
} as unknown as Existing;
const check = (c: Partial<Check>) => ({ label: "A check", detail: "", ok: false, ...c }) as Check;
const result = (groups: { category: string; ruleIds: string[] }[]) => ({ fixGroups: groups.map((g) => ({ title: g.category, ...g })) }) as unknown as ScanResult;

describe("the answer's plan: where the one fix is marked", () => {
  it("marks a fix category on the find it's about, with plain words", () => {
    const fire = placeMark("fire", existing, [], result([{ category: "fire", ruleIds: ["fire_separation_between_units"] }]));
    expect(fire).toMatchObject({ at: [1, 1], words: "Fire separation", box: { minX: 0.5, maxX: 1.5, minZ: -0.5, maxZ: 2.5 } });
    expect(placeMark("height", existing, [], null)).toMatchObject({ at: [4, 3], words: "Headroom" });
  });

  it("takes the guide's glossary terms as marks too", () => {
    expect(placeMark("fire_separation", existing, [], null)?.words).toBe("Fire separation");
    expect(placeMark("ceiling_height", existing, [], null)).toMatchObject({ at: [4, 3], words: "Ceiling height" });
  });

  it("marks a failing check where it is, before the find", () => {
    const checks = [check({ id: "separation-ceiling", ruleId: "fire_separation_between_units", at: [2, 2] })];
    expect(placeMark("fire", existing, checks, null)).toMatchObject({ at: [2, 2], words: "Fire separation" });
  });

  it("marks its own way in where the new door goes", () => {
    const checks = [check({ id: "entrance", ruleId: "exit_from_suite", label: "It has its own way in", at: [7, 0] })];
    for (const mark of ["entrance", "exit", "exit_from_suite", "separate_entrance"]) expect(placeMark(mark, existing, checks, null)).toEqual({ at: [7, 0], box: null, words: "Its own way in" });
  });

  it("doesn't draw an alarms-only fire fix as the drywall around the stairs", () => {
    const alarms = result([{ category: "fire", ruleIds: ["smoke_alarms_interconnected", "co_alarms_interconnected"] }]);
    expect(placeMark("fire", existing, [], alarms)).toBeNull();
    const checks = [check({ id: "smoke-alarms", ruleId: "smoke_alarms_interconnected", at: [3, 3] })];
    expect(placeMark("fire", existing, checks, alarms)).toMatchObject({ at: [3, 3], words: "Alarms" });
  });

  it("leaves the plan unmarked for no mark, or one it can't place", () => {
    expect(placeMark(undefined, existing, [], null)).toBeNull();
    expect(placeMark("egress", existing, [], null)).toBeNull();
    expect(placeMark("nonsense", existing, [check({ id: "rooms", ok: true, at: [1, 1] })], null)).toBeNull();
  });
});
