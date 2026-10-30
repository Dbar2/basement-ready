import { describe, expect, it } from "vitest";
import { areaName, cleanIdeas, cleanRooms, cleanSpoken, mainRoom, roomName, roomRanges, withIdeas, withoutGuide, type Room } from "../../server/rooms";

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

  // David's second take: a stretched box with one real wall must not win by size, nor the stairs.
  const placed = (index: number, w: number, d: number, walls: number): Room => ({
    ...room(index, w * d, false),
    plan: {
      areaM2: w * d,
      widthM: w,
      depthM: d,
      trusted: false,
      stairs: [],
      sides: Object.fromEntries(["minX", "maxX", "minZ", "maxZ"].map((k, i) => [k, i < walls ? "wall" : "extent"])),
    } as unknown as Room["plan"],
  });

  it("prefers a room bounded by its own walls over a bigger box stretched past them", () => {
    expect(mainRoom([placed(0, 3.5, 0.83, 4), placed(1, 7.56, 3.72, 4), placed(2, 11.98, 9.58, 1)])?.index).toBe(1);
  });

  it("never makes the stairs or a hall the main room", () => {
    expect(mainRoom([placed(0, 3.5, 0.83, 4), placed(1, 6, 4, 1)])?.index).toBe(1);
  });
});

describe("areaName", () => {
  it("calls a narrow area the stairs or a hall, and numbers the rooms without it", () => {
    const named = new Set<string>();
    const narrow = (stairs: number) => ({ widthM: 3.5, depthM: 0.83, stairs: Array(stairs).fill({}) }) as never;
    expect(areaName(narrow(1), 1, 0, 100, [], named)).toBe("Stairs");
    expect(areaName(narrow(0), 1, 0, 100, [], named)).toBe("Hall");
    expect(areaName({ widthM: 7, depthM: 4, stairs: [] } as never, 1, 100, 200, [], named)).toBe("Room 1");
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

describe("the guide's voice and tapped ideas", () => {
  it("cuts speech that overlaps the guide talking", () => {
    const turns = [
      { startMs: 1000, endMs: 3500, transcript: "Hi! I'll guide you." },
      { startMs: 9000, endMs: 11000, transcript: "a bedroom for my mom here" },
    ];
    expect(withoutGuide(turns, [{ startMs: 900, endMs: 3600 }]).map((t) => t.transcript)).toEqual(["a bedroom for my mom here"]);
    expect(withoutGuide(turns, null)).toHaveLength(2);
  });

  it("keeps only well-formed ideas and spans", () => {
    expect(cleanIdeas(JSON.stringify([{ room: 1, idea: "Rental suite", sec: 40.2 }, { room: 99, idea: "x", sec: 1 }, { room: 0, idea: "", sec: 2 }]))).toEqual([
      { room: 1, idea: "Rental suite", sec: 40.2 },
    ]);
    expect(cleanSpoken([{ startMs: 5, endMs: 2 }, { startMs: 100, endMs: 900 }])).toEqual([{ startMs: 100, endMs: 900 }]);
    expect(cleanIdeas("nope")).toBeNull();
  });
});

describe("tapped ideas in what you want", () => {
  it("adds them to the room they were tapped in, skipping 'not sure' and repeats", () => {
    const v = withIdeas(
      { rooms: [{ room: "Kitchen", where: "by the stairs", atSeconds: 4, quote: "kitchen here" }], style: "", mustHaves: [], forWhom: "" },
      [
        { room: 1, idea: "Bedroom for a parent", sec: 30 },
        { room: 1, idea: "Not sure yet", sec: 40 },
        { room: 0, idea: "kitchen", sec: 5 },
      ],
      [{ index: 0, name: "Room 1" }, { index: 1, name: "Furnace room" }],
    );
    expect(v.rooms.map((r) => [r.room, r.where])).toEqual([
      ["Kitchen", "by the stairs"],
      ["Bedroom for a parent", "Furnace room"],
    ]);
  });
});
