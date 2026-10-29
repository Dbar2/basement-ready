import { describe, expect, it } from "vitest";
import type { Plan } from "../../src/api";
import { basementRooms, placePlan } from "../../src/components/basementPlan";

const plan: Plan = {
  version: 1,
  box: { minX: -3, maxX: 3, minZ: -2, maxZ: 2 },
  sides: { minX: "wall", maxX: "extent", minZ: "wall", maxZ: "wall" },
  widthM: 6,
  depthM: 4,
  areaM2: 24,
  ceilingHeightM: 2.3,
  // A window 1 m along the maxZ wall (x = -2), a door 3 m up the minX wall (z = 1).
  openings: [
    { kind: "window", side: "maxZ", atM: 1, widthM: 0.8, detectionId: "w" },
    { kind: "door", side: "minX", atM: 3, widthM: 0.86, detectionId: "d" },
  ],
  stairs: [{ x0: 2, z0: -2, x1: 3, z1: 0, detectionId: "s" }],
  fixtures: [{ kind: "furnace", x: -2.5, z: -1.5, detectionId: "f" }],
  scaleSource: "model",
  trusted: false,
};

describe("a room's plan in the basement frame", () => {
  it("only shifts when the room isn't turned", () => {
    const p = placePlan(plan, { turn: 0, x: 10, z: 5 });
    expect(p.box).toEqual({ minX: 7, maxX: 13, minZ: 3, maxZ: 7 });
    expect(p.openings).toEqual(plan.openings);
    expect(p.fixtures[0]).toMatchObject({ x: 7.5, z: 3.5 });
  });

  it("turns a quarter turn: sizes swap and every wall, opening and fixture moves with the room", () => {
    // x' = -z, z' = x (c = 0, s = 1)
    const p = placePlan(plan, { turn: 1, x: 0, z: 0 });
    expect(p.box).toEqual({ minX: -2, maxX: 2, minZ: -3, maxZ: 3 });
    expect([p.widthM, p.depthM]).toEqual([4, 6]);
    // The old minX wall faced -x; turned, it faces -z.
    expect(p.sides.minZ).toBe("wall");
    expect(p.sides.maxZ).toBe("extent");
    const window = p.openings.find((o) => o.kind === "window")!;
    const door = p.openings.find((o) => o.kind === "door")!;
    // Window at (-2, 2) -> (-2, -2): on the new minX wall, 1 m from minZ = -3.
    expect(window.side).toBe("minX");
    expect(window.atM).toBeCloseTo(1, 9);
    // Door at (-3, 1) -> (-1, -3): on the new minZ wall, 1 m from minX = -2.
    expect(door.side).toBe("minZ");
    expect(door.atM).toBeCloseTo(1, 9);
    expect(p.stairs[0]).toMatchObject({ x0: 0, z0: 2, x1: 2, z1: 3 });
    expect(p.fixtures[0]).toMatchObject({ x: 1.5, z: -2.5 });
  });

  it("is null for older scans whose rooms were never placed", () => {
    expect(basementRooms([{ index: 0, name: "Room 1", startS: 0, endS: 30, has3d: true, plan, measurements: null }])).toBeNull();
  });
});
