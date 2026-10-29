import { describe, expect, it } from "vitest";
import { conceptPrompt, keptInPlace, pickFrames, type FrameView } from "../../server/concepts";

const det = (kind: string, frame: number, framesSeen: number, w = 0.15) => ({
  kind,
  frame,
  framesSeen,
  box: { x: 0.1, y: 0.2, w, h: 0.1 },
  track: [[frame, 0.1, 0.2, w, 0.1]] as [number, number, number, number, number][],
});

describe("photos of what it could look like", () => {
  it("finishes the frame where they said what they wanted first", () => {
    const picks = pickFrames([det("window", 300, 20)], { rooms: [{ room: "kitchen", atSeconds: 12 }] }, "renter", 600);
    expect(picks[0]).toMatchObject({ frame: 60, title: "Kitchen" });
    expect(picks[1].frame).toBe(300); // then the window room as the bedroom
  });

  it("makes the window room a bedroom for a parent, and adds a wide view", () => {
    const picks = pickFrames([det("window", 200, 30), det("door", 400, 10), det("stairs", 400, 10)], null, "relative", 600);
    expect(picks.map((p) => p.title)).toEqual(["A bedroom for your parent", "Living and kitchen"]);
  });

  it("asks Muse Image to keep windows, doors and stairs in place", () => {
    expect(conceptPrompt("bedroom", "")).toMatch(/Do not add, remove or move any window, door or stair/);
  });

  it("only passes a picture where every window is still about where it was", () => {
    const window = { x: 0.1, y: 0.2, w: 0.2, h: 0.1 };
    expect(keptInPlace([window], [{ x: 0.12, y: 0.21, w: 0.19, h: 0.1 }])).toBe(true);
    expect(keptInPlace([window], [{ x: 0.6, y: 0.2, w: 0.2, h: 0.1 }])).toBe(false);
    expect(keptInPlace([window], [])).toBe(false);
  });

  it("never picks a close-up or the furnace corner as the wide view", () => {
    const close = { ...det("window", 100, 5, 0.6), box: { x: 0, y: 0, w: 0.6, h: 0.6 }, track: [[100, 0, 0, 0.6, 0.6]] as [number, number, number, number, number][] };
    const furnace = det("mechanical", 250, 9);
    const wide = det("door", 420, 4);
    const stairs = det("stairs", 420, 4);
    const picks = pickFrames([close, furnace, wide, stairs], null, "unsure", 600);
    expect(picks.find((p) => p.title === "Living and kitchen")!.frame).toBe(420);
  });

  it("with the 3D, shows each room from where the camera saw farthest, up to four photos", () => {
    // The window is tracked over frames 100-140; the whole window is in view at 100, 120 and 140.
    const window = {
      kind: "window",
      frame: 110,
      framesSeen: 30,
      box: { x: 0.3, y: 0.2, w: 0.3, h: 0.2 },
      track: [
        [100, 0.3, 0.2, 0.3, 0.2],
        [110, 0, 0.2, 0.5, 0.3],
        [120, 0.35, 0.25, 0.15, 0.1],
        [140, 0.3, 0.2, 0.2, 0.15],
      ] as [number, number, number, number, number][],
    };
    const furnace = det("mechanical", 400, 9);
    const views = new Map<number, FrameView>([
      [100, { depthM: 1.4, tilt: 0.1, area: 0 }],
      [120, { depthM: 3.9, tilt: 0.1, area: 0 }],
      [140, { depthM: 2.2, tilt: 0.1, area: 0 }],
      [200, { depthM: 5.1, tilt: 0.05, area: 0 }],
      [230, { depthM: 6.0, tilt: 0.7, area: 0 }], // looking at the ceiling: never a photo
      [400, { depthM: 4.8, tilt: 0.1, area: 1 }], // the furnace corner
      [450, { depthM: 3.5, tilt: 0.1, area: 1 }],
    ]);
    const picks = pickFrames([window, furnace], null, "unsure", 600, { startS: 0, endS: 60 }, views);
    expect(picks.map((p) => [p.title, p.frame])).toEqual([
      ["The bedroom", 120],
      ["Living and kitchen", 200],
      ["The other room", 450],
    ]);
  });
});
