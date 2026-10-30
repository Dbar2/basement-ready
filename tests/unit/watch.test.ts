import { describe, expect, it } from "vitest";
import { readReply, tokenCost } from "../../server/meta";
import { cleanWatch, FALLBACK_MODEL, instructions, roomNames, WATCH_MODEL, watchedNames, watchVideo, watchWords, type Take, type Watch } from "../../server/watch";

const video: Take = { source: "video", durationS: 72, sound: true };
const room = (id: string, visits: number[][], extra: object = {}) => ({ id, name: `Room ${id}`, visits, ceiling: "drywall", ...extra });

describe("cleanWatch", () => {
  it("numbers rooms in the order first seen and keeps doors, notes and seenFrom pointing at them", () => {
    const w = cleanWatch(
      {
        heard: true,
        rooms: [
          room("b", [[35, 55]], { name: "Workshop" }),
          room("a", [[0, 33], [60, 62]], { name: "Rec room", spokenName: "the rec room" }),
          room("c", [[50, 52]], { name: "Closet", entered: false, seenFrom: "b", kind: "closet" }),
        ],
        doors: [
          { from: "a", to: "b", kind: "door", atS: 34 },
          { from: "b", to: "a", kind: "opening", atS: 34 }, // the same connection again
          { from: "a", to: "upstairs", kind: "stairs", atS: 2 },
          { from: "a", to: "zz", kind: "door" }, // a room that doesn't exist
          { from: "b", to: "b", kind: "door" },
          { from: "upstairs", to: "outside", kind: "door" },
        ],
        spoken: [{ atS: 40, quote: "this is Mom's room", room: "b" }, { atS: 41, quote: "" }],
        unsure: ["Couldn't see past the closed door.", 7],
      },
      video,
    );
    expect(w.rooms.map((r) => [r.id, r.name])).toEqual([["r1", "Rec room"], ["r2", "Workshop"], ["r3", "Closet"]]);
    expect(w.rooms[0].visits).toEqual([[0, 33], [60, 62]]);
    expect(w.rooms[2]).toMatchObject({ entered: false, seenFrom: "r2", kind: "closet" });
    expect(w.doors).toEqual([
      { from: "r1", to: "r2", kind: "door", atS: 34, note: "" },
      { from: "r1", to: "upstairs", kind: "stairs", atS: 2, note: "" },
    ]);
    expect(w.spoken).toEqual([{ atS: 40, quote: "this is Mom's room", room: "r2" }]);
    expect(w.unsure).toEqual(["Couldn't see past the closed door."]);
    expect(w.heard).toBe(true);
  });

  it("keeps times inside the take and drops what isn't well-formed", () => {
    const w = cleanWatch(
      {
        rooms: [
          {
            id: "r1",
            name: "Furnace room",
            visits: [[50, 90], [30, 10], ["x", 4], [-5, 2]],
            ceiling: "wood panels",
            low: [{ kind: "duct", atS: 55 }, { kind: "spaceship", atS: 500 }],
            windows: [{ atS: 60, sizeHintM: { w: 1, h: 0.6 } }, { atS: 61, sizeHintM: { w: 40, h: 1 } }],
            fixtures: [{ kind: "furnace", atS: 58 }, { kind: "hot tub", atS: 59 }],
            sizeHintM: { w: 3.48, d: "2.4" },
          },
          { id: "r2", name: "", visits: [[0, 5]] }, // no name
          { id: "r3", name: "Laundry", visits: [] }, // never on screen
        ],
      },
      video,
    );
    expect(w.rooms).toHaveLength(1);
    const r = w.rooms[0];
    expect(r.visits).toEqual([[50, 72]]); // a negative time is dropped, not moved
    expect(r.ceiling).toBe("unknown");
    expect(r.low).toEqual([{ kind: "duct", atS: 55, note: "" }, { kind: "other", atS: 72, note: "" }]);
    expect(r.windows.map((x) => x.sizeHintM)).toEqual([{ w: 1, h: 0.6 }, null]);
    expect(r.fixtures.map((f) => f.kind)).toEqual(["furnace"]);
    expect(r.sizeHintM).toEqual({ w: 3.5, d: 2.4 });
  });

  it("fails on an answer with no rooms, so the fallback gets its turn", () => {
    expect(() => cleanWatch({ rooms: [] }, video)).toThrow(/no rooms/);
    expect(() => cleanWatch(null, video)).toThrow(/no rooms/);
  });

  it("says nobody talked when the take has no sound, whatever the model claims", () => {
    const w = cleanWatch({ heard: true, rooms: [room("a", [[0, 10]])], spoken: [{ atS: 3, quote: "hello" }] }, { source: "video", durationS: 10, sound: false });
    expect(w.heard).toBe(false);
  });

  it("reads a photo take by photo number, with no times or speech", () => {
    const take: Take = { source: "photos", photos: 6, rooms: [{ name: "Room 1", from: 0, to: 3 }, { name: "Room 2", from: 3, to: 6 }] };
    const w = cleanWatch(
      {
        rooms: [
          { id: "x", name: "Laundry", photos: [5, 3, 3, 9], visits: [[0, 4]] },
          { id: "y", name: "Rec room", photos: [0, 1, 2], low: [{ kind: "beam", atS: 12 }] },
        ],
        spoken: [{ atS: 3, quote: "hello" }],
      },
      take,
    );
    expect(w.rooms.map((r) => [r.id, r.name, r.photos, r.visits])).toEqual([
      ["r1", "Rec room", [0, 1, 2], []],
      ["r2", "Laundry", [3, 5], []],
    ]);
    expect(w.rooms[0].low[0].atS).toBeNull();
    expect(w.spoken).toEqual([]);
    expect(w.heard).toBe(false);
  });
});

describe("watchWith: Wonder, then Spark", () => {
  const answer = (rooms: unknown[], usage = { input_tokens: 10_000, output_tokens: 1_000 }) => ({ output_text: JSON.stringify({ rooms }), usage });

  it("uses Wonder's answer and prices it at Wonder's rates", async () => {
    const asked: string[] = [];
    const w = await watchVideo("file-1", 72, true, {
      ask: async (body: any) => {
        asked.push(body.model);
        expect(body.input[1].content[1]).toEqual({ type: "input_video", file_id: "file-1" });
        expect(body.reasoning).toEqual({ effort: "medium" });
        return answer([room("a", [[0, 30]])]);
      },
    });
    expect(asked).toEqual([WATCH_MODEL]);
    expect(w.model).toBe(WATCH_MODEL);
    expect(w.costUsd).toBeCloseTo(10_000 * 4e-6 + 1_000 * 20e-6);
    expect(w.tokens).toEqual({ in: 10_000, out: 1_000 });
  });

  it("falls back to Spark when Wonder errors", async () => {
    const asked: string[] = [];
    const w = await watchVideo("file-1", 72, true, {
      ask: async (body: any) => {
        asked.push(body.model);
        if (body.model === WATCH_MODEL) throw new Error("Meta API 503: preview model unavailable");
        expect(body.reasoning).toBeUndefined();
        return answer([room("a", [[0, 30]])]);
      },
    });
    expect(asked).toEqual([WATCH_MODEL, FALLBACK_MODEL]);
    expect(w.model).toBe(FALLBACK_MODEL);
    expect(w.costUsd).toBeCloseTo(10_000 * 1.25e-6 + 1_000 * 4.25e-6);
  });

  it("falls back when Wonder answers with nothing usable, and counts both calls' cost", async () => {
    const w = await watchVideo("file-1", 72, true, {
      ask: async (body: any) => (body.model === WATCH_MODEL ? { output_text: "I watched it. Nice basement!", usage: { input_tokens: 1000, output_tokens: 0 } } : answer([room("a", [[0, 30]])])),
    });
    expect(w.model).toBe(FALLBACK_MODEL);
    expect(w.costUsd).toBeCloseTo(1000 * 4e-6 + 10_000 * 1.25e-6 + 1_000 * 4.25e-6);
  });

  it("throws when neither model gives an answer", async () => {
    await expect(watchVideo("file-1", 72, true, { ask: async () => Promise.reject(new Error("down")) })).rejects.toThrow("down");
  });
});

describe("the prompt", () => {
  it("never asks the model to judge escape windows or heights", () => {
    const p = instructions(video);
    expect(p).toMatch(/Never say whether a window is big enough to escape through/);
    expect(p).toMatch(/Never estimate how low it is/);
    expect(instructions({ source: "photos", photos: 8, rooms: [] })).toMatch(/8 still photos/);
  });
});

const watch = (rooms: Partial<Watch["rooms"][number]>[], source: Watch["source"] = "video"): Watch => ({
  model: WATCH_MODEL,
  source,
  heard: false,
  rooms: rooms.map((r, i) => ({ id: `r${i + 1}`, name: "", spokenName: null, kind: "room", visits: [], photos: [], entered: true, seenFrom: null, ceiling: "unknown", low: [], windows: [], fixtures: [], sizeHintM: null, ...r })),
  doors: [],
  spoken: [],
  unsure: [],
  costUsd: 0,
  tokens: { in: 0, out: 0 },
  ms: 0,
});

describe("watchedNames", () => {
  const fps = 5;
  it("names each area for the room it spent most of its time in", () => {
    const w = watch([
      { name: "the rec room", visits: [[0, 33]] },
      { name: "Mom's room", visits: [[33, 54]] },
      { name: "Closet", visits: [[50, 52]], entered: false },
      { name: "Furnace room", visits: [[54, 72]] },
    ]);
    const ranges = [{ from: 0, to: 170 }, { from: 170, to: 275 }, { from: 275, to: 360 }];
    expect(watchedNames(ranges, w, fps)).toEqual(["Rec room", "Mom's room", "Furnace room"]);
  });

  it("leaves an area unnamed when no room fills half of it, or its room was taken", () => {
    const w = watch([{ name: "Rec room", visits: [[0, 40]] }, { name: "Workshop", visits: [[40, 72]] }]);
    // Area 2 straddles both rooms evenly-ish; area 3 is all Workshop, which area 2 doesn't have most of.
    const ranges = [{ from: 0, to: 150 }, { from: 150, to: 250 }, { from: 250, to: 360 }];
    expect(watchedNames(ranges, w, fps)).toEqual(["Rec room", null, "Workshop"]);
    expect(watchedNames(ranges, null, fps)).toEqual([null, null, null]);
  });

  it("never gives two areas the same name", () => {
    const w = watch([{ name: "Storage", visits: [[0, 10]] }, { name: "Storage", visits: [[10, 20]] }]);
    expect(watchedNames([{ from: 0, to: 50 }, { from: 50, to: 100 }], w, fps)).toEqual(["Storage", "Storage 2"]);
  });

  it("hands each area its name by the area's own index, and names nothing when there's one area", () => {
    const w = watch([{ name: "Rec room", visits: [[0, 30]] }, { name: "Workshop", visits: [[30, 60]] }]);
    expect(roomNames([{ index: 1, from: 150, to: 300 }, { index: 0, from: 0, to: 150 }], w, fps)).toEqual(["Rec room", "Workshop"]);
    expect(roomNames([{ index: 0, from: 0, to: 300 }], w, fps)).toEqual([]);
  });

  it("matches a photo take's rooms by photo number", () => {
    const w = watch([{ name: "Laundry", photos: [3, 4, 5] }, { name: "Rec room", photos: [0, 1, 2] }], "photos");
    expect(watchedNames([{ from: 0, to: 3 }, { from: 3, to: 6 }], w, 1)).toEqual(["Rec room", "Laundry"]);
  });
});

describe("pricing", () => {
  it("prices Wonder and Spark by the token, and nothing else", () => {
    expect(tokenCost("muse-wonder-1.0", { input_tokens: 1e6, output_tokens: 1e6 })).toEqual({ kind: "wonder", usd: 24 });
    expect(tokenCost("muse-spark-1.3", { input_tokens: 1e6, output_tokens: 0 })).toEqual({ kind: "spark", usd: 1.25 });
    expect(tokenCost("sam-3.1", { input_tokens: 1e6 })).toBeNull();
  });

  it("says what was watched in a line for the wait screen", () => {
    expect(watchWords(watch([{ name: "Rec room" }, { name: "Workshop", spokenName: "Mom's room" }, { name: "Closet", entered: false }]))).toBe(
      "Muse Wonder watched the whole take: 3 rooms (Rec room, Mom's room, Closet), one seen only through a doorway",
    );
  });
});

describe("readReply", () => {
  const message = (text: string) => ({ type: "message", content: [{ type: "output_text", text }] });
  it("reads the whole message when a cut-off one came first", () => {
    const r = { output: [message('{"route":"second_unit","findings":[{"ruleId":"x"'), message('{"route":"second_unit","findings":[]}')] };
    expect(readReply(r, JSON.parse)).toEqual({ route: "second_unit", findings: [] });
  });
  it("still reads one answer split across messages, and throws when nothing parses", () => {
    expect(readReply({ output: [message('{"a":'), message("1}")] }, JSON.parse)).toEqual({ a: 1 });
    expect(readReply({ output_text: '{"b":2}' }, JSON.parse)).toEqual({ b: 2 });
    expect(() => readReply({ output: [message("not json")] }, JSON.parse)).toThrow();
  });
});
