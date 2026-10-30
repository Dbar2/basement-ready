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

describe("each thing once, on a video take", () => {
  const withFinds = (stairsId: string, extra: Partial<Plan>): Plan => ({ ...area(stairsId), ...extra });

  it("keeps one of each mechanical, but a rough-in and a floor drain are two things", async () => {
    const { oneOfEach } = await import("../../server/model/seed");
    const f = (id: string, kind: "panel" | "plumbing" | "water_heater", detectionId: string) => ({ id, kind, at: [0, 0] as [number, number], detectionId });
    const kept = oneOfEach(
      [f("a", "panel", "panel-1"), f("b", "panel", "panel-2"), f("c", "plumbing", "rough-1"), f("d", "plumbing", "drain-1"), f("e", "water_heater", "wh-1")],
      [
        { id: "panel-1", label: "Electrical panel", framesSeen: 3 },
        { id: "panel-2", label: "Electrical panel", framesSeen: 20 },
        { id: "rough-1", label: "Plumbing rough-in", framesSeen: 5 },
        { id: "drain-1", label: "Floor drain", framesSeen: 5 },
        { id: "wh-1", label: "Water heater", framesSeen: 9 },
      ],
    );
    expect(kept.map((x) => x.id).sort()).toEqual(["b", "c", "d", "e"]);
  });

  it("counts a beam seen twice at the same headroom once, but not two placed by the 3D", async () => {
    const { oneOfEach } = await import("../../server/model/seed");
    const beam = (id: string, heightM: number, guess: boolean) => ({ id, kind: "beam" as const, at: [0, 0] as [number, number], heightM, guess });
    expect(oneOfEach([beam("a", 1.8, true), beam("b", 1.79, true), beam("c", 2.2, true)]).map((x) => x.id)).toEqual(["b", "c"]);
    expect(oneOfEach([beam("a", 1.8, false), beam("b", 1.79, false)])).toHaveLength(2);
  });

  it("puts the same door seen from two areas in once, and a partly seen door's width is a guess", () => {
    const door = { kind: "door" as const, side: "maxX" as const, atM: 1.5, widthM: 0.76, detectionId: "door-1", guess: true };
    const e = existingFromScan({ rooms: [room(0, withFinds("s", { openings: [door] }), 0), room(1, withFinds("t", { openings: [{ ...door, side: "minX" }] }), 6.4)], mainRoom: 0 })!;
    const doors = e.openings.filter((o) => o.kind === "door");
    expect(doors).toHaveLength(1);
    expect(doors[0].guess).toBe(true);
  });

  it("draws a wall two areas share once, though each area's box is a little off", () => {
    // Room 1 runs to x = 3; room 2 starts 25 cm further on (its own box, placed by the rough pass).
    const e = existingFromScan({ rooms: [room(0, area("s"), 0), room(1, area("t"), 6.25)], mainRoom: 0 })!;
    const atThree = e.walls.filter((w) => Math.abs(w.a[0] - w.b[0]) < 1e-6 && w.a[0] > 2.5 && w.a[0] < 3.5);
    expect(atThree).toHaveLength(1);
  });

  it("puts a window the video showed, but SAM missed, on the room's outside wall as a guess", () => {
    const e = existingFromScan({ rooms: [room(0, area("s"), 0)], mainRoom: 0, watch: { rooms: [{ name: "Room 1", windows: [{ atS: 44, note: "high on the wall" }] }] } })!;
    const win = e.openings.find((o) => o.kind === "window")!;
    expect(win).toMatchObject({ guess: true, widthM: 0.8 });
    expect(e.walls.find((w) => w.id === win.wallId)!.kind).toBe("foundation");
    // Dragged into place, it's no longer a guess.
    expect(editExisting(e, { op: "move_opening", openingId: win.id, offsetM: win.offsetM + 0.5 }).openings.find((o) => o.id === win.id)!.guess).toBe(false);
  });
});
