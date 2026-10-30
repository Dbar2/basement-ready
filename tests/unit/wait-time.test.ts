import { describe, expect, it } from "vitest";
import { leftWords, secondsLeft } from "../../src/screens/waitTime";

const log = (at: number, text: string) => ({ at, type: "log", text });

describe("time left on the wait screen, from the scan's own progress", () => {
  it("times each area from the measuring logs and counts the areas left", () => {
    const events = [log(5, "Mapping your whole basement"), log(60, "Measuring area 1 of 3"), log(140, "Measuring area 2 of 3")];
    // 80 s an area; 10 s into area 2: 70 s left of it, one more area, then the rules.
    expect(secondsLeft(events, 150)).toBe(80 + 70 + 15);
  });

  it("follows a fast GPU as well as a slow Mac", () => {
    const fast = [log(5, "Mapping your whole basement"), log(20, "Measuring area 1 of 3"), log(35, "Measuring area 2 of 3")];
    expect(secondsLeft(fast, 40)).toBe(15 + 10 + 15);
  });

  it("never says it's nearly done while an area is taking longer than the others", () => {
    const events = [log(60, "Measuring area 1 of 2"), log(100, "Measuring area 2 of 2")];
    expect(secondsLeft(events, 200)).toBeGreaterThanOrEqual(15);
  });

  it("waits only on the finds and the rules check when there's no 3D", () => {
    expect(secondsLeft([log(5, "3D scan unavailable this time; checking from the video instead")], 30)).toBe(50);
    expect(secondsLeft([{ at: 90, type: "done", text: "" }], 90)).toBe(0);
  });

  it("says it in plain words", () => {
    expect(leftWords(200)).toBe("About 3 min left");
    expect(leftWords(60)).toBe("About a minute left");
    expect(leftWords(30)).toBe("Less than a minute left");
    expect(leftWords(8)).toBe("Almost there");
  });
});
