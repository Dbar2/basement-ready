import { describe, expect, it } from "vitest";
import { currentTask, turnToward, type GuideState } from "../../src/capture/script";

const state = (over: Partial<GuideState> = {}, room: Partial<GuideState["room"]> = {}): GuideState => ({
  sec: 20,
  done: new Set(["stairs"]),
  tiltSensor: true,
  compass: true,
  ...over,
  room: { index: 0, name: null, sec: 10, coverage: 30, walls: false, sawUp: false, windowSeen: false, plans: false, ...room },
});

describe("the one task on screen", () => {
  it("starts with the stairs", () => {
    expect(currentTask(state({ sec: 2, done: new Set() })).id).toBe("stairs");
  });

  it("walks a room in order: walls, ceiling, windows, plans, then on", () => {
    expect(currentTask(state()).id).toBe("walls");
    expect(currentTask(state({}, { walls: true })).id).toBe("ceiling");
    expect(currentTask(state({}, { walls: true, sawUp: true })).id).toBe("windows");
    expect(currentTask(state({}, { walls: true, sawUp: true, windowSeen: true })).id).toBe("plans");
    expect(currentTask(state({}, { walls: true, sawUp: true, windowSeen: true, plans: true })).id).toBe("next");
  });

  it("skips what the phone can't sense, and moves on when a step drags", () => {
    expect(currentTask(state({ tiltSensor: false }, { walls: true })).id).toBe("windows");
    expect(currentTask(state({ compass: false }, { sec: 30 })).id).not.toBe("walls");
  });

  it("asks for the furnace in the furnace room", () => {
    expect(currentTask(state({}, { name: "Furnace room" })).id).toBe("furnace");
  });
});

describe("which way to turn", () => {
  const bins = (covered: number[]) => Array.from({ length: 36 }, (_, i) => covered.includes(i));
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

  it("points at the biggest stretch not filmed yet", () => {
    // Filmed 0°–180°, facing 90°: the gap is behind-left... centred on 270°, so turn around.
    expect(turnToward(bins(range(0, 18)), 90)).toBe("around");
    // Filmed 0°–270°, facing 200°: the gap (270°–360°) is to the right.
    expect(turnToward(bins(range(0, 27)), 230)).toBe("right");
    // Facing 250° with the gap at 270°–360° minus a bit: still to the right.
    expect(turnToward(bins(range(0, 27)), 340)).toBeNull(); // already facing it
  });

  it("stays quiet for small gaps, a full room, or no compass", () => {
    expect(turnToward(bins(range(0, 34)), 10)).toBeNull();
    expect(turnToward(bins(range(0, 36)), 10)).toBeNull();
    expect(turnToward(bins(range(0, 18)), null)).toBeNull();
  });
});
