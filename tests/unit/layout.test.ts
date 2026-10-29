import { describe, expect, it } from "vitest";
import { suggestLayout } from "../../server/layout";
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
    expect(l.checks.find((c) => c.label.startsWith("The bedroom has"))!.ok).toBe(true);
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

  it("makes a studio in a small room", () => {
    const l = suggestLayout(plan({ box: { minX: -2.5, maxX: 2.5, minZ: -2.5, maxZ: 2.5 }, widthM: 5, depthM: 5, areaM2: 25, openings: [] }));
    expect(l.kind).toBe("studio");
    expect(l.checks.find((c) => c.label.startsWith("The bedroom has"))!.ok).toBe(false);
    // Too narrow for a bathroom beside the bed: said plainly, not hidden.
    expect(l.zones.some((z) => z.kind === "bathroom")).toBe(false);
    expect(l.checks.find((c) => c.label.includes("bathroom"))!.ok).toBe(false);
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
