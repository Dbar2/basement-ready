import { describe, expect, it } from "vitest";
import type { Plan, RoomResult } from "../../src/api";
import { placeTags, textBox } from "../../src/studio/labels";
import { editExisting } from "../../server/model/edit";
import { existingFromScan } from "../../server/model/seed";

// One area's plan: a 6 x 4 m room with the stairs in it, seen by SAM as `stairsId`.
const area = (stairsId: string, sides: Plan["sides"] = { minX: "wall", maxX: "wall", minZ: "wall", maxZ: "wall" }): Plan => ({
  version: 1,
  box: { minX: -3, maxX: 3, minZ: -2, maxZ: 2 },
  sides,
  widthM: 6,
  depthM: 4,
  areaM2: 24,
  ceilingHeightM: 2.3,
  openings: [],
  stairs: [{ x0: 2, z0: -2, x1: 3, z1: 0, detectionId: stairsId }],
  fixtures: [],
  scaleSource: "model",
  trusted: false,
});
const room = (index: number, plan: Plan, x: number): RoomResult => ({ index, name: `Room ${index + 1}`, startS: index * 30, endS: index * 30 + 30, has3d: true, plan, measurements: null, placement: { turn: 0, x, z: 0 } });

describe("one staircase", () => {
  it("keeps the stairs SAM followed longest when two areas each place them", () => {
    // Filmed going down at the start (60 frames) and glimpsed again near the end (12): two areas, placed
    // 7 m apart, each put its own stairs in.
    const e = existingFromScan({ rooms: [room(0, area("stairs-1"), 0), room(1, area("stairs-2"), 7)], mainRoom: 0, detections: [{ id: "stairs-1", framesSeen: 60 }, { id: "stairs-2", framesSeen: 12 }] })!;
    const stairs = e.fixtures.filter((f) => f.kind === "stairs");
    expect(stairs).toHaveLength(1);
    expect(stairs[0].detectionId).toBe("stairs-1");
  });
});

describe("a guessed wall", () => {
  const e = existingFromScan({ rooms: [room(0, area("s", { minX: "wall", maxX: "extent", minZ: "wall", maxZ: "wall" }), 0)], mainRoom: 0 })!;
  const guess = e.walls.find((w) => w.guess)!;

  it("stays a guess until they say it's right, or put it where it is", () => {
    expect(guess).toBeTruthy();
    expect(editExisting(e, { op: "set_wall", wallId: guess.id, guess: false }).walls.find((w) => w.id === guess.id)!.guess).toBe(false);
    const moved = editExisting(e, { op: "move_wall", wallId: guess.id, a: [guess.a[0] + 0.3, guess.a[1]], b: [guess.b[0] + 0.3, guess.b[1]] });
    expect(moved.walls.find((w) => w.id === guess.id)!.guess).toBe(false);
    // The scanned walls aren't touched.
    expect(moved.walls.filter((w) => w.id !== guess.id).every((w) => !w.guess)).toBe(true);
  });
});

describe("plan labels", () => {
  it("moves a find's label off a room name, along its line first", () => {
    const name = textBox(500, 400, "Room 2 14.2 m²", 26, 0.56);
    const out = placeTags([name], [{ id: "beam", text: "BEAM · 2.20 M CLEAR · DRAG TO PLACE", short: "BEAM · 2.20 M CLEAR", size: 16, spots: [[500, 400], [200, 400], [800, 400], [500, 370]] }]);
    const p = out.get("beam")!;
    expect(p.x).not.toBe(500);
    const b = textBox(p.x, p.y, p.text, 16);
    expect(b.x1 < name.x0 || b.x0 > name.x1 || b.y1 < name.y0 || b.y0 > name.y1).toBe(true);
  });

  it("drops the hint before giving up, and never stacks two labels", () => {
    const blocked = [textBox(500, 400, "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", 26, 0.56)];
    const out = placeTags(blocked, [
      { id: "a", text: "BEAM · 2.20 M CLEAR · DRAG TO PLACE", short: "BEAM · 2.20 M CLEAR", size: 16, spots: [[500, 400], [500, 440]] },
      { id: "b", text: "DUCT · 2.10 M CLEAR", size: 16, spots: [[500, 440], [500, 480]] },
    ]);
    expect(out.get("a")).toEqual({ x: 500, y: 440, text: "BEAM · 2.20 M CLEAR · DRAG TO PLACE" });
    expect(out.get("b")!.y).toBe(480);
  });
});
