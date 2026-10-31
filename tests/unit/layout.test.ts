import { describe, expect, it } from "vitest";
import { GALLEY_MIN_M2, suggestLayout } from "../../server/layout";
import type { Plan } from "../../server/plan";

const plan = (over: Partial<Plan> = {}): Plan => ({
  version: 1,
  box: { minX: -4, maxX: 4, minZ: -3, maxZ: 3 },
  sides: { minX: "wall", maxX: "wall", minZ: "wall", maxZ: "wall" },
  widthM: 8,
  depthM: 6,
  areaM2: 48,
  ceilingHeightM: 2.3,
  openings: [{ kind: "window", side: "maxZ", atM: 2, widthM: 0.8, detectionId: "w1" }],
  stairs: [],
  fixtures: [],
  scaleSource: "model",
  trusted: false,
  ...over,
});

const inside = (z: { x0: number; x1: number; z0: number; z1: number }, p: Plan["box"]) =>
  z.x0 >= p.minX - 1e-6 && z.x1 <= p.maxX + 1e-6 && z.z0 >= p.minZ - 1e-6 && z.z1 <= p.maxZ + 1e-6;

describe("suggested layout", () => {
  it("puts the bedroom on the wall with the escape window", () => {
    const l = suggestLayout(plan());
    const bed = l.zones.find((z) => z.kind === "bedroom")!;
    expect(l.kind).toBe("one_bedroom");
    expect(bed.z1).toBe(3); // against the maxZ wall
    // The window (2 m along from minX = x of -2) is inside the bedroom's span.
    expect(bed.x0).toBeLessThanOrEqual(-2);
    expect(bed.x1).toBeGreaterThanOrEqual(-2);
    // On the window's wall, but the scan has no height: an escape window once a tape says so.
    const escape = l.checks.find((c) => c.label.startsWith("The bedroom has"))!;
    expect(escape.ok).toBeNull();
    expect(escape.detail).toContain("80 cm wide");
    expect(escape.detail).toContain("at least 44 cm tall");
  });

  it("keeps every zone inside the room, with a bathroom, kitchen and living space", () => {
    const l = suggestLayout(plan());
    for (const z of l.zones) expect(inside(z, plan().box)).toBe(true);
    expect(l.zones.map((z) => z.kind).sort()).toEqual(["bathroom", "bedroom", "kitchen", "living"]);
    // Bedroom: inner wall and the wall it shares with the bathroom. Bathroom: inner wall and its far side.
    expect(l.walls.length).toBe(4);
    expect(l.doors.length).toBe(2);
  });

  it("walls the bathroom in, in a studio too", () => {
    const l = suggestLayout(plan({ box: { minX: -3.5, maxX: 3.5, minZ: -2.5, maxZ: 2.5 }, widthM: 7, depthM: 5, areaM2: 35 }));
    const bath = l.zones.find((z) => z.kind === "bathroom")!;
    expect(l.kind).toBe("studio");
    // A door sits on the bathroom's inner edge, inside its span.
    expect(l.doors.some((d) => d.x > bath.x0 && d.x < bath.x1 && (Math.abs(d.z - bath.z0) < 0.01 || Math.abs(d.z - bath.z1) < 0.01))).toBe(true);
    expect(l.walls.length).toBeGreaterThanOrEqual(2);
  });

  it("makes a studio in a small room, its bathroom on another wall when there's no room beside the bed", () => {
    const l = suggestLayout(plan({ box: { minX: -2.5, maxX: 2.5, minZ: -2.5, maxZ: 2.5 }, widthM: 5, depthM: 5, areaM2: 25, openings: [] }));
    expect(l.kind).toBe("studio");
    expect(l.checks.find((c) => c.label.startsWith("The bedroom has"))!.ok).toBe(false);
    const bath = l.zones.find((z) => z.kind === "bathroom")!;
    expect(bath.areaM2).toBeGreaterThanOrEqual(3.5);
    expect(bath.areaM2).toBeLessThanOrEqual(5);
    expect(l.checks.some((c) => c.label === "There's room for a bathroom")).toBe(false);
    // And a galley kitchen: a counter run and the aisle to work in, clear of the bathroom and the bed.
    const kitchen = l.zones.find((z) => z.kind === "kitchen")!;
    expect(kitchen.areaM2).toBeGreaterThanOrEqual(GALLEY_MIN_M2);
    for (const z of l.zones.filter((x) => x.kind === "bathroom" || x.kind === "bedroom")) expect(z.x0 < kitchen.x1 - 0.05 && z.x1 > kitchen.x0 + 0.05 && z.z0 < kitchen.z1 - 0.05 && z.z1 > kitchen.z0 + 0.05, z.name).toBe(false);
  });

  it("keeps the stairs and furnace as they are", () => {
    const l = suggestLayout(plan({ stairs: [{ x0: 2, z0: -3, x1: 3, z1: -1, detectionId: "s" }], fixtures: [{ kind: "furnace", x: -3.5, z: -2.5, detectionId: "f" }] }));
    expect(l.zones.some((z) => z.kind === "stairs")).toBe(true);
    const furnace = l.zones.find((z) => z.kind === "mechanical")!;
    expect(inside(furnace, plan().box)).toBe(true);
  });

  it("never puts the bedroom, bathroom or kitchen on the stairs", () => {
    // The stairs sit right where the window wall's bedroom would go.
    const stairs = { x0: -3.2, z0: 1.4, x1: -1.6, z1: 3, detectionId: "s" };
    const l = suggestLayout(plan({ stairs: [stairs] }));
    for (const z of l.zones.filter((x) => ["bedroom", "bathroom", "kitchen"].includes(x.kind))) {
      const overlap = z.x0 < stairs.x1 && z.x1 > stairs.x0 && z.z0 < stairs.z1 && z.z1 > stairs.z0;
      expect(overlap, `${z.name} overlaps the stairs`).toBe(false);
    }
  });
});

describe("the bathroom goes where the plumbing comes up", () => {
  const overlap = (a: { x0: number; x1: number; z0: number; z1: number }, b: typeof a) =>
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.05 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.05;
  const rough = (x: number, z: number) => ({ kind: "plumbing" as const, x, z, detectionId: "p1" });
  const covers = (z: { x0: number; x1: number; z0: number; z1: number }, x: number, zz: number) => x >= z.x0 && x <= z.x1 && zz >= z.z0 && zz <= z.z1;

  it("on the far wall: over the pipes, clear of the other rooms, and the living space makes room", () => {
    const p = plan({ fixtures: [rough(2, -2.8)] });
    const l = suggestLayout(p);
    const bath = l.zones.find((z) => z.kind === "bathroom")!;
    expect(covers(bath, 2, -2.8)).toBe(true);
    expect(bath.z0).toBe(-3); // against the minZ wall, across from the window wall
    for (const z of l.zones) {
      expect(inside(z, p.box)).toBe(true);
      if (z !== bath && z.kind !== "stairs") expect(overlap(z, bath)).toBe(false);
    }
    expect(l.checks.find((c) => c.label.includes("plumbing rough-in"))!.ok).toBe(true);
    // The bedroom still has the window (its height still to be taped).
    expect(l.checks.find((c) => c.label.startsWith("The bedroom has"))!.ok).toBeNull();
  });

  it("on the window wall: beside the bedroom, over the pipes", () => {
    const l = suggestLayout(plan({ fixtures: [rough(2.5, 2.8)] }));
    const bath = l.zones.find((z) => z.kind === "bathroom")!;
    const bed = l.zones.find((z) => z.kind === "bedroom")!;
    expect(covers(bath, 2.5, 2.8)).toBe(true);
    expect(overlap(bath, bed)).toBe(false);
  });

  it("on a side wall: the living space gives up that end", () => {
    const p = plan({ fixtures: [rough(-3.8, 0)] });
    const l = suggestLayout(p);
    const bath = l.zones.find((z) => z.kind === "bathroom")!;
    expect(covers(bath, -3.8, 0)).toBe(true);
    expect(bath.x0).toBe(-4);
    const living = l.zones.find((z) => z.kind === "living")!;
    expect(overlap(living, bath)).toBe(false);
  });

  it("in the middle of the room: the usual spot, and a note for the designer", () => {
    const l = suggestLayout(plan({ fixtures: [rough(0, 0)] }));
    expect(l.zones.some((z) => z.kind === "bathroom")).toBe(true);
    expect(l.checks.find((c) => c.label.includes("plumbing rough-in"))!.ok).toBeNull();
  });

  it("reads SAM's labels into fixtures", async () => {
    const { fixtureKind } = await import("../../server/plan");
    expect(["Plumbing rough-in", "Floor drain", "Water heater", "Electrical panel", "Furnace"].map(fixtureKind)).toEqual([
      "plumbing",
      "plumbing",
      "water_heater",
      "panel",
      "furnace",
    ]);
  });

  it("a water heater alone gets the mechanical corner", () => {
    const l = suggestLayout(plan({ fixtures: [{ kind: "water_heater", x: -3.5, z: -2.5, detectionId: "h1" }] }));
    expect(l.zones.find((z) => z.kind === "mechanical")?.name).toBe("Water heater room");
  });

  it("the furnace and water heater share one service room: back to their wall, room in front, the corner taken in", () => {
    // Found where the camera saw their faces: a furnace 1.2 m off the west wall, a water heater against it.
    const l = suggestLayout(plan({ fixtures: [{ kind: "furnace", x: -2.8, z: -0.7, detectionId: "f1" }, { kind: "water_heater", x: -3.5, z: 1.2, detectionId: "h1" }] }));
    const room = l.zones.find((z) => z.kind === "mechanical")!;
    expect(room.name).toBe("Furnace room");
    expect(room.x0).toBe(-4); // back to the west wall
    expect(room.x1).toBeCloseTo(-2.2, 2); // 0.6 m in front of the furnace's face
    expect(room.z0).toBeCloseTo(-1.15, 2); // past the furnace's side
    expect(room.z1).toBe(3); // the 1.35 m left past the water heater is too narrow to use: it's in the room
    // Nothing else stands in it.
    for (const z of l.zones.filter((x) => x.kind !== "mechanical" && x.kind !== "living")) expect(z.x0 >= room.x1 - 0.05 || z.x1 <= room.x0 + 0.05 || z.z0 >= room.z1 - 0.05 || z.z1 <= room.z0 + 0.05).toBe(true);
  });

  it("a service room meets the stairs when the gap between them is too narrow to walk", () => {
    const l = suggestLayout(plan({ stairs: [{ x0: -3, z0: -3, x1: -0.5, z1: -2.1, detectionId: "s1", bottom: [-0.5, -2.55] }], fixtures: [{ kind: "furnace", x: -2.9, z: -0.9, detectionId: "f1" }] }));
    expect(l.zones.find((z) => z.kind === "mechanical")!.z0).toBe(-2.1);
  });

  it("keeps the landing at the foot of the stairs clear: the kitchen moves off it", () => {
    const stairs = [{ x0: -3, z0: -3, x1: -0.5, z1: -2.1, detectionId: "s1", bottom: [-0.5, -2.55] as [number, number] }];
    const l = suggestLayout(plan({ stairs }));
    const kitchen = l.zones.find((z) => z.kind === "kitchen")!;
    expect(kitchen.x0).toBeGreaterThanOrEqual(0.5 - 0.05); // past the 1 m landing at x -0.5..0.5
    // Without a known foot, nothing is held for a landing.
    const plain = suggestLayout(plan({ stairs: [{ ...stairs[0], bottom: undefined }] }));
    expect(plain.zones.find((z) => z.kind === "kitchen")!.x0).toBeLessThan(0.45);
  });

  it("slides the bedroom along its window wall to make room for a bathroom", () => {
    // A service room where the bathroom would go beside a bedroom centred on the window.
    const l = suggestLayout(plan({ openings: [{ kind: "window", side: "maxZ", atM: 5.5, widthM: 0.8, detectionId: "w1" }], fixtures: [{ kind: "furnace", x: -2.6, z: 1.6, detectionId: "f1" }] }), { kind: "one_bedroom" });
    const bed = l.zones.find((z) => z.kind === "bedroom")!;
    expect(bed.x0).toBeGreaterThan(-0.1 + 0.05); // moved off the window's middle (centred, it'd start at -0.1)
    expect(l.zones.some((z) => z.kind === "bathroom")).toBe(true);
    expect(bed.x0).toBeLessThanOrEqual(1.5 - 0.3 + 0.01); // still takes in the window, at x 1.5
    expect(bed.x1).toBeGreaterThanOrEqual(1.5 + 0.3 - 0.01);
    expect(l.checks.find((c) => /room for a bathroom/.test(c.label))).toBeUndefined();
  });
});
