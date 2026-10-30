import { describe, expect, it } from "vitest";
import { cheerDue, CHEER_EVERY_MS, CHEER_QUIET_MS, findLine, OncePerSpace, timeLine } from "../../src/capture/reactions";
import { LINES } from "../../src/capture/script";

describe("what the guide says about a find", () => {
  it("talks about the furnace and the water heater together, whichever shows first", () => {
    expect(findLine("furnace", [])).toBe("furnace_found");
    expect(LINES.furnace_found[0]).toMatch(/water heater/);
    expect(findLine("heater", ["furnace"])).toBe("heater_too");
    expect(findLine("heater", [])).toBe("heater_found");
    expect(findLine("furnace", ["door", "heater"])).toBe("furnace_too");
  });

  it("points out plumbing as where a bathroom goes, once, from either a drain or a rough-in", () => {
    expect(findLine("roughin", [])).toBe("plumbing_found");
    expect(findLine("drain", [])).toBe("plumbing_found");
    expect(findLine("drain", ["roughin"])).toBeNull();
    expect(LINES.plumbing_found[0]).toMatch(/bathroom/);
  });

  it("greets each new window, and everything else once", () => {
    expect(findLine("window", [])).toBe("window_found");
    expect(findLine("window", ["window"])).toBe("window_more");
    expect(findLine("panel", [])).toBe("panel_found");
    expect(findLine("panel", ["panel"])).toBeNull();
    expect(findLine("door", ["door"])).toBeNull();
    expect(findLine("bulkhead", [])).toBe("low_ceiling");
    // The stairs step has its own praise; beams aren't asked for live.
    expect(findLine("stairs", [])).toBeNull();
    expect(findLine("beam", [])).toBeNull();
  });
});

describe("the clock, paced to the take", () => {
  it("says halfway, a minute left and thirty seconds left on a 5-minute take", () => {
    expect(timeLine(100, 300, false)).toBeNull();
    expect(timeLine(150, 300, false)).toBe("time_half");
    expect(timeLine(239, 300, false)).toBe("time_half");
    expect(timeLine(240, 300, false)).toBe("time_minute");
    expect(timeLine(270, 300, false)).toBe("time_end");
  });

  it("skips halfway once everything's filmed, and on a short take", () => {
    expect(timeLine(160, 300, true)).toBeNull();
    expect(timeLine(250, 300, true)).toBe("time_minute");
    expect(timeLine(100, 180, false)).toBeNull();
    expect(timeLine(121, 180, false)).toBe("time_minute");
  });
});

describe("encouragement", () => {
  const base = { lastSpoke: 0, lastCheer: -Infinity, grewAt: 20_000, trouble: false };

  it("only while the map is growing, after a quiet stretch, and not often", () => {
    expect(cheerDue(CHEER_QUIET_MS - 1, { ...base, grewAt: CHEER_QUIET_MS - 1 })).toBe(false);
    expect(cheerDue(25_000, base)).toBe(true);
    // Not growing lately: nothing to cheer about.
    expect(cheerDue(60_000, base)).toBe(false);
    // Just cheered.
    expect(cheerDue(25_000, { ...base, lastCheer: 25_000 - CHEER_EVERY_MS + 1 })).toBe(false);
  });

  it("never while there's a problem to fix", () => {
    expect(cheerDue(25_000, { ...base, trouble: true })).toBe(false);
  });
});

describe("once per space", () => {
  it("says a thing once, and again after the phone notices another part of the basement", () => {
    const once = new OncePerSpace();
    expect(once.take("walls_all")).toBe(true);
    expect(once.take("walls_all")).toBe(false);
    expect(once.take("low_ceiling")).toBe(true);
    once.newSpace();
    expect(once.take("walls_all")).toBe(true);
  });
});
