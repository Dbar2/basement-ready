// What a live-finds request may ask SAM for (server/live.ts): known keys, at most three. A furnace, a
// rough-in and a bulkhead are retired, since SAM never matched them by name and the scan finds them by
// pointing: an older app that still asks for them gets nothing back for them, and no error.
import { describe, expect, it } from "vitest";
import { LIVE_CONCEPTS, liveKeys, minConfidence, RETIRED } from "../../server/live";

describe("liveKeys", () => {
  it("keeps known keys, at most three, and drops retired and unknown ones", () => {
    expect(liveKeys(JSON.stringify(["door", "furnace", "window", "panel", "heater"]))).toEqual({ keys: ["door", "window", "panel"], retiredOnly: false });
    expect(liveKeys(JSON.stringify(["door", "sofa"]))).toEqual({ keys: ["door"], retiredOnly: false });
  });

  it("answers an older app that asks only for retired keys without an error", () => {
    expect(liveKeys(JSON.stringify(["furnace", "bulkhead"]))).toEqual({ keys: [], retiredOnly: true });
    expect(liveKeys(JSON.stringify(["sofa"]))).toEqual({ keys: [], retiredOnly: false });
    expect(liveKeys("not json")).toEqual({ keys: [], retiredOnly: false });
    expect(liveKeys(undefined)).toEqual({ keys: [], retiredOnly: false });
  });

  it("never asks SAM for a retired key", () => {
    for (const k of RETIRED) expect(k in LIVE_CONCEPTS).toBe(false);
    expect(minConfidence("water heater")).toBe(0.45);
    expect(minConfidence("ceiling duct")).toBe(0.55);
  });
});
