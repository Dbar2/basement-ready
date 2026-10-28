import { describe, expect, it } from "vitest";
import { cleanRooms, mainRoom, roomName, roomRanges, type Room } from "../../server/rooms";

describe("cleanRooms", () => {
  it("reads the form field, sorts and starts at 0", () => {
    expect(cleanRooms(JSON.stringify([{ startS: 41.234 }, { startS: 0 }, { startS: 12 }]))).toEqual([{ startS: 0 }, { startS: 12 }, { startS: 41.2 }]);
  });

  it("adds the first room when the phone only sent the later ones", () => {
    expect(cleanRooms([{ startS: 30 }])).toEqual([{ startS: 0 }, { startS: 30 }]);
  });

  it("is null for one room, junk or out-of-range times", () => {
    expect(cleanRooms([{ startS: 0 }])).toBeNull();
    expect(cleanRooms("not json")).toBeNull();
    expect(cleanRooms({ startS: 4 })).toBeNull();
    expect(cleanRooms([{ startS: -3 }, { startS: 500 }, { startS: "x" }])).toBeNull();
  });

  it("drops repeats and caps the count", () => {
    expect(cleanRooms([{ startS: 10 }, { startS: 10 }])).toEqual([{ startS: 0 }, { startS: 10 }]);
    expect(cleanRooms(Array.from({ length: 20 }, (_, i) => ({ startS: i * 5 })))!.length).toBe(8);
  });
});

describe("roomRanges", () => {
  it("is the whole video without marks", () => {
    expect(roomRanges(null, 300, 5)).toEqual([{ index: 0, from: 0, to: 300 }]);
  });

  it("splits at each mark, in frames", () => {
    expect(roomRanges([{ startS: 0 }, { startS: 20 }, { startS: 45 }], 300, 5)).toEqual([
      { index: 0, from: 0, to: 100 },
      { index: 1, from: 100, to: 225 },
      { index: 2, from: 225, to: 300 },
    ]);
  });

  it("drops a room that starts after the video ends", () => {
    expect(roomRanges([{ startS: 0 }, { startS: 90 }], 300, 5)).toEqual([{ index: 0, from: 0, to: 300 }]);
  });
});

const room = (index: number, areaM2: number, trusted: boolean, has3d = true): Room => ({
  index,
  name: `Room ${index + 1}`,
  startS: 0,
  endS: 1,
  has3d,
  measurements: null,
  plan: has3d ? ({ areaM2, trusted } as Room["plan"]) : null,
});

describe("mainRoom", () => {
  it("prefers a trusted scan over a bigger rough one", () => {
    expect(mainRoom([room(0, 30, false), room(1, 12, true)])?.index).toBe(1);
  });

  it("takes the biggest floor among equals", () => {
    expect(mainRoom([room(0, 12, true), room(1, 24, true), room(2, 40, false)])?.index).toBe(1);
  });

  it("is null when no room was scanned", () => {
    expect(mainRoom([room(0, 0, false, false)])).toBeNull();
  });
});

describe("roomName", () => {
  it("names the room the furnace was seen in, once", () => {
    const named = new Set<string>();
    expect(roomName(0, 0, 100, [150], named)).toBe("Room 1");
    expect(roomName(1, 100, 200, [150, 160], named)).toBe("Furnace room");
    expect(roomName(2, 200, 300, [250], named)).toBe("Room 3");
  });
});
