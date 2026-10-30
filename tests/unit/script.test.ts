import { describe, expect, it } from "vitest";
import { currentTask, LINE_KIND, LINES, WIDE_BY, type GuideState, type Need } from "../../src/capture/script";
import { MAX_SEC } from "../../src/capture/checklist";

const state = (over: Partial<GuideState> = {}): GuideState => ({
  sec: 20,
  done: new Set<Need>(["stairs"]),
  skipped: new Set<Need>(),
  since: {},
  tiltSensor: true,
  compass: true,
  ...over,
});
const doneWith = (...ids: Need[]) => new Set<Need>(ids);

describe("one task at a time, for the whole basement", () => {
  it("starts with the stairs", () => {
    expect(currentTask(state({ sec: 2, done: new Set() })).id).toBe("stairs");
  });

  it("walks the basement in order: walls, ceiling, floor, windows, furnace, then a wide shot", () => {
    const order: Need[] = ["stairs", "walls", "ceiling", "floor", "windows", "furnace", "wide"];
    for (let i = 1; i < order.length; i++) expect(currentTask(state({ done: doneWith(...order.slice(0, i)) })).id).toBe(order[i]);
    expect(currentTask(state({ done: doneWith(...order) })).id).toBe("finish");
  });

  it("never mentions rooms", () => {
    for (const text of Object.values(LINES).flat()) expect(text.toLowerCase()).not.toMatch(/\broom\b|next room|new room/);
  });

  it("never asks anything that needs an answer on screen", () => {
    for (const text of Object.values(LINES).flat()) expect(text.toLowerCase()).not.toMatch(/\btap an idea\b|what would you like|just tell me|tap (yes|no)/);
    expect(Object.keys(LINES)).not.toContain("plans");
  });

  it("skips what the phone can't sense, and moves on when a step drags", () => {
    expect(currentTask(state({ tiltSensor: false, done: doneWith("stairs", "walls") })).id).toBe("windows");
    expect(currentTask(state({ compass: false, sec: 40, since: { walls: 10 } })).id).not.toBe("walls");
    expect(currentTask(state({ sec: 69, since: { walls: 10 } })).id).toBe("walls");
    expect(currentTask(state({ sec: 70, since: { walls: 10 } })).id).toBe("ceiling");
  });

  it("gives each step its own time, so a furnace that never shows can't eat the wide shot", () => {
    const before = doneWith("stairs", "walls", "ceiling", "floor", "windows");
    expect(currentTask(state({ sec: 70, done: before, since: { furnace: 60 } })).id).toBe("furnace");
    expect(currentTask(state({ sec: 75, done: before, since: { furnace: 60 } })).id).toBe("wide");
  });

  it("lets a skipped step go: no window here, or no furnace in sight", () => {
    expect(currentTask(state({ done: doneWith("stairs", "walls", "ceiling", "floor"), skipped: doneWith("windows") })).id).toBe("furnace");
  });

  it("always reaches the wide shot a little past halfway through a 5-minute take, and lets it go after a while", () => {
    expect(MAX_SEC).toBe(300);
    expect(WIDE_BY).toBeGreaterThan(MAX_SEC / 2);
    expect(WIDE_BY).toBeLessThan(MAX_SEC - 90);
    expect(currentTask(state({ sec: WIDE_BY - 1, done: doneWith("stairs", "walls"), since: { ceiling: WIDE_BY - 2 } })).id).toBe("ceiling");
    expect(currentTask(state({ sec: WIDE_BY + 1, done: doneWith("stairs", "walls"), since: { ceiling: WIDE_BY - 2 } })).id).toBe("wide");
    expect(currentTask(state({ sec: WIDE_BY + 13, done: doneWith("stairs", "walls"), since: { ceiling: WIDE_BY + 1, wide: WIDE_BY + 1 } })).id).toBe("ceiling");
  });

  it("gives every line a priority", () => {
    for (const id of Object.keys(LINES)) expect(LINE_KIND[id as keyof typeof LINES]).toBeDefined();
  });
});
