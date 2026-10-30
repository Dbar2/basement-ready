import { describe, expect, it } from "vitest";
import {
  bounds,
  ceilingMissing,
  compassOffset,
  edges,
  lowCeiling,
  mapStatus,
  markerYaw,
  nextSide,
  quarterTurns,
  shownYaws,
  sidesFilmed,
  turnPoint,
  whereIs,
  type LiveMap,
  type MapPoint,
  type Side,
} from "../../src/capture/map";
import { sideLine } from "../../src/capture/reactions";

const at = (seq: number, x: number, z: number, yaw: number, heading: number | null = null): MapPoint => ({ seq, x, z, yaw, heading });

// A 4 m by 3 m box, the camera in the middle facing the top of the map unless a test says otherwise.
function room(sides: Partial<Record<Side, "wall" | "extent">> = {}, over: Partial<LiveMap> = {}): LiveMap {
  const newest = at(9, 0, 0, 0);
  return {
    box: { min: [-2, 0, -1.5], max: [2, 2.3, 1.5], sides: { minX: "wall", maxX: "wall", minZ: "wall", maxZ: "wall", ...sides } },
    walls: [],
    path: [at(0, 0, 1, 0), newest],
    newest,
    newestView: 1,
    ceiling: true,
    ...over,
  };
}

describe("keeping the map steady from one rebuild to the next", () => {
  it("turns the first rebuild so the first frame (the top of the stairs) faces up", () => {
    expect(quarterTurns([at(0, 0, 0, 10)], null)).toBe(0);
    expect(quarterTurns([at(0, 0, 0, 90)], null)).toBe(3);
    expect(quarterTurns([at(0, 0, 0, 200)], null)).toBe(2);
    expect(quarterTurns([at(0, 0, 0, 260)], null)).toBe(1);
  });

  it("undoes a rebuild that came back turned: the frames it shares with the last one face where they did", () => {
    const first = [at(0, 0, 0, 0), at(5, 1, 0, 90)];
    const shown = shownYaws(first, quarterTurns(first, null));
    // The service fitted the other wall as X this time: everything is a quarter turn round.
    const next = [at(0, 0, 0, 270), at(5, 0, 1, 0), at(8, 0, 2, 45)];
    const turns = quarterTurns(next, shown);
    expect(turns).toBe(1);
    expect(shownYaws(next, turns).get(0)).toBe(0);
    expect(shownYaws(next, turns).get(5)).toBe(90);
  });

  it("doesn't flip on a few degrees of wobble near a diagonal", () => {
    const first = [at(0, 0, 0, 40)];
    const shown = shownYaws(first, quarterTurns(first, null));
    expect(shown.get(0)).toBe(40);
    // From scratch, 50° would round the other way; next to the last rebuild it stays put.
    expect(quarterTurns([at(0, 0, 0, 50)], null)).toBe(3);
    expect(quarterTurns([at(0, 0, 0, 50)], shown)).toBe(0);
  });

  it("turns points clockwise a quarter at a time, and back", () => {
    expect(turnPoint(0, -1, 1)).toEqual([1, 0]); // up becomes right
    expect(turnPoint(1, 0, 1)).toEqual([-0, 1]); // right becomes down
    for (let k = 0; k < 4; k++) {
      const [x, z] = turnPoint(2, -3, k);
      const back = turnPoint(x, z, 4 - k);
      expect(back[0]).toBeCloseTo(2);
      expect(back[1]).toBeCloseTo(-3);
    }
  });

  it("frames the box as shown, whichever way it's turned", () => {
    const b0 = bounds(room(), 0);
    const b1 = bounds(room(), 1);
    expect(b0.size).toBe(4);
    expect(b1.size).toBe(4);
    expect(b1.cx).toBeCloseTo(0);
  });
});

describe("the compass on the map", () => {
  it("learns how the compass and the map line up from the frames that have both", () => {
    const path = [at(0, 0, 0, 0, 31), at(1, 0, 0, 90, 118), at(2, 0, 0, 180, 212), at(3, 0, 0, 270, 299)];
    expect(compassOffset(path)).toBeCloseTo(30, 0);
    // Across north: 350° and 10° average to 0°, not 180°.
    expect(compassOffset([at(0, 0, 0, 0, 350), at(1, 0, 0, 0, 10), at(2, 0, 0, 0, 0)])).toBeCloseTo(0, 5);
  });

  it("doesn't trust a compass the frames disagree about, too few frames, or one that isn't there", () => {
    expect(compassOffset([at(0, 0, 0, 0, 0), at(1, 0, 0, 0, 120), at(2, 0, 0, 0, 240)])).toBeNull();
    expect(compassOffset([at(0, 0, 0, 0, 0), at(1, 0, 0, 0, 70), at(2, 0, 0, 0, 140), at(3, 0, 0, 0, 20)])).toBeNull();
    expect(compassOffset([at(0, 0, 0, 0, 5), at(1, 0, 0, 0, 10)])).toBeNull();
    expect(compassOffset([at(0, 0, 0, 0)])).toBeNull();
  });

  it("turns the camera marker with the compass between rebuilds, or keeps the last frame's way without one", () => {
    const map = room({}, { path: [at(0, 0, 0, 0, 30), at(1, 0, 0, 45, 75), at(2, 0, 0, 90, 120)], newest: at(2, 0, 0, 90, 120) });
    expect(markerYaw(map, 130)).toBeCloseTo(100);
    expect(markerYaw(map, null)).toBe(90);
    expect(markerYaw({ ...map, path: [at(2, 0, 0, 90)] }, 130)).toBe(90);
  });
});

describe("what isn't filmed yet", () => {
  it("draws the four sides clockwise from the top, solid where a wall was seen", () => {
    const e = edges(room({ maxZ: "extent" }));
    expect(e.map((x) => x.side)).toEqual(["minZ", "maxX", "maxZ", "minX"]);
    expect(e.map((x) => x.filmed)).toEqual([true, true, false, true]);
    expect(e[0]).toMatchObject({ a: [-2, -1.5], b: [2, -1.5] });
  });

  it("says where each side is from where the camera stands and faces", () => {
    const e = Object.fromEntries(edges(room()).map((x) => [x.side, x]));
    expect(whereIs(e.minZ, 0, 0, 0).where).toBe("ahead");
    expect(whereIs(e.maxZ, 0, 0, 0).where).toBe("behind");
    expect(whereIs(e.minX, 0, 0, 0).where).toBe("left");
    expect(whereIs(e.maxX, 0, 0, 0).where).toBe("right");
    // Facing right, the top of the map is on their left.
    expect(whereIs(e.minZ, 0, 0, 90).where).toBe("left");
    expect(whereIs(e.maxZ, 0, 0, 90).where).toBe("right");
    expect(whereIs(e.maxZ, 0, 0, 0).distance).toBeCloseTo(1.5);
  });

  it("points at the open side furthest out of the picture, and says nothing when it's in front", () => {
    const behind = nextSide(room({ maxZ: "extent" }), 0);
    expect(behind).toMatchObject({ side: "maxZ", where: "behind" });
    expect(sideLine(behind)).toBe("turn_around");

    const left = nextSide(room({ minX: "extent" }), 0);
    expect(sideLine(left)).toBe("turn_left");
    expect(sideLine(nextSide(room({ maxX: "extent" }), 0))).toBe("turn_right");

    // Two open: the one behind wins over the one on the left.
    expect(nextSide(room({ minX: "extent", maxZ: "extent" }), 0)?.side).toBe("maxZ");
    // Facing it: nothing to say.
    expect(sideLine(nextSide(room({ maxZ: "extent" }), 180))).toBeNull();
    // All walls, or no camera yet: no gap.
    expect(nextSide(room(), 0)).toBeNull();
    expect(nextSide(room({ maxZ: "extent" }, { newest: null }), 0)).toBeNull();
    expect(nextSide(room({ maxZ: "extent" }), null)).toBeNull();
  });

  it("outlines the ceiling as a gap until the 3D finds it or the phone has pointed at enough of it", () => {
    expect(ceilingMissing(room({}, { ceiling: false }), 0.2)).toBe(true);
    expect(ceilingMissing(room({}, { ceiling: false }), 0.5)).toBe(false);
    expect(ceilingMissing(room({}, { ceiling: true }), 0)).toBe(false);
    expect(ceilingMissing(null, 0)).toBe(true);
  });

  it("counts filmed sides and says what's left in a few words", () => {
    expect(sidesFilmed(room({ maxZ: "extent", minX: "extent" }))).toBe(2);
    expect(mapStatus(room({ maxZ: "extent", minX: "extent" }), false)).toBe("2 sides not filmed yet");
    expect(mapStatus(room({ maxZ: "extent" }), true)).toBe("1 side not filmed yet · ceiling too");
    expect(mapStatus(room(), false)).toBe("All four sides filmed");
    expect(mapStatus(room(), true)).toBe("Ceiling not filmed yet");
    expect(mapStatus(null, true)).toBe("Ceiling not filmed yet");
    expect(mapStatus(null, false)).toBe("");
  });

  it("warns about a low ceiling only when the 3D found a ceiling plane, and it's clearly low", () => {
    expect(lowCeiling(1.75, room())).toBe(true);
    expect(lowCeiling(1.75, room({}, { ceiling: false }))).toBe(false);
    expect(lowCeiling(2.3, room())).toBe(false);
    expect(lowCeiling(null, room())).toBe(false);
  });
});
