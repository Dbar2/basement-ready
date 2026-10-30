import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import type { Existing } from "../../server/model/types";
import { alreadyKnown, checkInstructions, checkPlan, cleanCheck, roomList } from "../../server/planCheck";
import { drawPlan } from "../../server/planDraw";
import { FALLBACK_MODEL, WATCH_MODEL } from "../../server/watch";

// Two rooms side by side, a door between them and a window in the first.
const existing: Existing = {
  walls: [
    { id: "w1", a: [0, 0], b: [4, 0], thicknessM: 0.2, kind: "foundation", rating: null },
    { id: "w2", a: [4, 0], b: [4, 3], thicknessM: 0.12, kind: "existing", rating: null },
    { id: "w3", a: [0, 3], b: [7, 3], thicknessM: 0.2, kind: "foundation", rating: null },
    { id: "w4", a: [7, 0], b: [7, 3], thicknessM: 0.2, kind: "foundation", rating: null, guess: true },
  ],
  openings: [
    { id: "o1", wallId: "w2", kind: "door", offsetM: 1.5, widthM: 0.8, heightM: 2, status: "existing" },
    { id: "o2", wallId: "w1", kind: "window", offsetM: 2, widthM: 0.9, heightM: 0.5, status: "existing" },
  ],
  rooms: [
    { id: "room-0", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], kind: "other", name: "Rec room", unit: 2 },
    { id: "room-1", polygon: [[4, 0], [7, 0], [7, 3], [4, 3]], kind: "other", name: "Room 2", unit: 2 },
  ],
  fixtures: [{ id: "f1", kind: "furnace", at: [6, 1], sizeM: [0.6, 0.6] }],
  ceilingM: 2.1,
  scale: { source: "model" },
  confirmedAt: null,
};
const video = { video: { fileId: "file-1", durationS: 72 } };

describe("drawPlan", () => {
  it("writes a valid PNG of the plan", () => {
    const png = drawPlan(existing, 400);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    expect(w).toBe(400 + 80);
    expect(h).toBeGreaterThan(200);
    // The pixels inflate to one filter byte plus three bytes a pixel, row by row.
    const idat = png.indexOf("IDAT");
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    expect(raw.length).toBe((w * 3 + 1) * h);
    // Not all white: rooms, walls and numbers were drawn.
    expect(raw.some((b, i) => i % (w * 3 + 1) !== 0 && b < 200)).toBe(true);
  });
});

describe("roomList", () => {
  it("lists each room by its number in the drawing, with its name, windows, doors and fixtures", () => {
    const list = roomList(existing);
    expect(list).toContain('1 (blue), named "Rec room": 4.0 × 3.0 m (12 m²), 1 window, doors to 2.');
    expect(list).toContain('2 (green), named "Room 2": 3.0 × 3.0 m (9 m²), 0 windows, doors to 1; furnace.');
  });
});

describe("cleanCheck", () => {
  it("keeps up to four well-formed questions, with rooms by id and times inside the video", () => {
    const q = cleanCheck(
      {
        issues: [
          { kind: "missing_room", room: null, atS: 52, question: "Your video shows a third room behind the door at 0:52. Is there a room there the plan is missing?" },
          { kind: "name", room: 2, atS: 300, question: "Is the room named Room 2 the furnace room?", name: "Furnace room" },
          { kind: "window", room: 9, atS: -1, question: "Is there a window here?" },
          { kind: "spaceship", room: 1, question: "Something else?", name: "ignored" },
          { kind: "other", question: "" },
          { kind: "other", question: "Fifth?" },
          { kind: "other", question: "Sixth?" },
        ],
      },
      existing,
      video,
    );
    expect(q).toEqual([
      { kind: "missing_room", roomId: null, atS: 52, question: "Your video shows a third room behind the door at 0:52. Is there a room there the plan is missing?", name: null },
      { kind: "name", roomId: "room-1", atS: 72, question: "Is the room named Room 2 the furnace room?", name: "Furnace room" },
      { kind: "window", roomId: null, atS: null, question: "Is there a window here?", name: null },
      { kind: "other", roomId: "room-0", atS: null, question: "Something else?", name: null },
    ]);
  });

  it("has no times for a photo take, and fails on an answer that isn't a list", () => {
    expect(cleanCheck({ issues: [{ kind: "window", room: 1, atS: 12, question: "A window?" }] }, existing, { photos: [] })[0].atS).toBeNull();
    expect(() => cleanCheck({ ok: true }, existing, video)).toThrow();
  });

  it("is an empty list when the plan matches", () => {
    expect(cleanCheck({ issues: [] }, existing, video)).toEqual([]);
  });
});

describe("checkPlan", () => {
  it("shows Wonder the drawing, the room list and the video, and falls back to Spark", async () => {
    const seen: any[] = [];
    const check = await checkPlan(existing, video, {
      ask: async (body: any) => {
        seen.push(body);
        if (body.model === WATCH_MODEL) throw new Error("Meta API 500");
        return { output_text: '{"issues":[]}', usage: { input_tokens: 1000, output_tokens: 100 } };
      },
    });
    const content = seen[0].input[1].content;
    expect(content.map((c: any) => c.type)).toEqual(["input_text", "input_image", "input_text", "input_text", "input_video"]);
    expect(content[1].image_url).toMatch(/^data:image\/png;base64,/);
    expect(content[4]).toEqual({ type: "input_video", file_id: "file-1" });
    expect(seen.map((b) => b.model)).toEqual([WATCH_MODEL, FALLBACK_MODEL]);
    expect(check).toMatchObject({ model: FALLBACK_MODEL, questions: [] });
  });

  it("never asks about sizes, heights or escape windows", () => {
    expect(checkInstructions(video)).toMatch(/never question a size, a ceiling height, or whether a window is big enough/);
  });
});

describe("alreadyKnown", () => {
  it("passes on what the whole basement's plan already says, and nothing without it", () => {
    const floorPlan = { rooms: [{ name: "Rec room", entered: true }, { name: "Storage nook", entered: false }], review: { notPlaced: ["Mom's room"] } };
    expect(alreadyKnown({ floorPlan })).toEqual([
      'On the plan as seen only through a doorway, with its walls marked as a guess: "Storage nook".',
      'The plan screen already tells them it couldn\'t place: "Mom\'s room".',
    ]);
    expect(alreadyKnown({})).toEqual([]);
    expect(alreadyKnown({ floorPlan: { rooms: [], review: null } })).toEqual([]);
  });

  it("adds them to the request only when there are some", async () => {
    const asked: any[] = [];
    const ask = async (body: any) => (asked.push(body), { output_text: '{"issues":[]}', usage: {} });
    await checkPlan(existing, video, { ask });
    await checkPlan(existing, video, { ask, known: ["On the plan as seen only through a doorway: \"Closet\"."] });
    expect(asked[0].input[1].content).toHaveLength(5);
    expect(asked[1].input[1].content[3].text).toMatch(/^Already known, so don't ask about these again:\n/);
  });
});
