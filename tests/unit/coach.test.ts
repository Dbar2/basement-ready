import { describe, expect, it } from "vitest";
import { coachLine } from "../../src/capture/live";

const base = {
  issue: null,
  minLeft: null,
  room: 0,
  roomSec: 30,
  holdLeft: null,
  ceilingDone: true,
  tilt: { sawUp: true, sensed: true },
  coverage: { percent: 20, supported: true },
  mapped: false,
  sheet: false,
  next: "every window",
};

describe("coachLine", () => {
  it("puts problems before guidance", () => {
    expect(coachLine({ ...base, roomSec: 2, issue: { id: "dark", text: "Turn on more lights" } })?.id).toBe("dark");
    expect(coachLine({ ...base, minLeft: 12, issue: { id: "dark", text: "Turn on more lights" } })?.text).toBe("Keep filming · 12 s to go");
  });

  it("opens each room with how to film it", () => {
    expect(coachLine({ ...base, roomSec: 2 })?.text).toBe("Walk along the walls. Stay 2 m back.");
    expect(coachLine({ ...base, room: 1, roomSec: 2 })?.text).toBe("New room. Walk along its walls.");
  });

  it("asks for the ceiling in a room where the phone never tilted up", () => {
    expect(coachLine({ ...base, tilt: { sawUp: false, sensed: true } })?.id).toBe("tilt");
    // No tilt sensor: never nag about it.
    expect(coachLine({ ...base, tilt: { sawUp: false, sensed: false } })?.id).toBe("next");
  });

  it("points at the gap only while the room isn't mapped", () => {
    expect(coachLine({ ...base, coverage: { percent: 60, supported: true } })?.id).toBe("gap");
    expect(coachLine({ ...base, coverage: { percent: 100, supported: true }, mapped: true })?.id).toBe("next");
    expect(coachLine({ ...base, mapped: true, sheet: true })).toBeNull();
  });
});
