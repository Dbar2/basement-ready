import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Layout, LayoutZone, Plan } from "../../src/api";
import { chosenDesign, layoutOf } from "../../server/model/legacy";
import { furnitureProblems } from "../../server/model/furniture";
import { seedModel } from "../../server/model/seed";
import { arrange, clash, doorClear, wayOut, type Rect } from "../../src/three/stagedLayout";

const plan = (over: Partial<Plan> = {}): Plan => ({
  version: 1,
  box: { minX: 0, maxX: 8, minZ: 0, maxZ: 5 },
  sides: { minX: "wall", maxX: "wall", minZ: "wall", maxZ: "wall" },
  widthM: 8,
  depthM: 5,
  areaM2: 40,
  ceilingHeightM: 2.3,
  openings: [],
  stairs: [],
  fixtures: [],
  scaleSource: "model",
  trusted: true,
  ...over,
});
const zone = (kind: LayoutZone["kind"], name: string, x0: number, z0: number, x1: number, z1: number): LayoutZone => ({ kind, name, x0, z0, x1, z1, areaM2: (x1 - x0) * (z1 - z0) });
const layout = (zones: LayoutZone[], walls: Layout["walls"] = [], doors: Layout["doors"] = []): Layout => ({ version: 1, kind: "one_bedroom", zones, walls, doors, window: null, checks: [] });
const rectOf = (z: LayoutZone): Rect => ({ x0: z.x0, x1: z.x1, z0: z.z0, z1: z.z1 });

// Every piece placed, with the zone it stands in.
function placed(p: Plan, l: Layout) {
  const a = arrange(p, l);
  return [...a.bedroom, ...a.living].flatMap(([z, s]) => s.pieces.map((x) => ({ z, ...x })));
}

// Inside its own room, clear of the other rooms, the stairs, each door's swing and every other piece,
// with a way from the exit to every door past it all (and the kitchen's counters).
function expectClear(p: Plan, l: Layout) {
  const pieces = placed(p, l);
  expect(pieces.length).toBeGreaterThan(0);
  const doors = doorClear(p, l);
  for (const x of pieces) {
    expect(x.rect.x0).toBeGreaterThanOrEqual(x.z.x0 - 0.02);
    expect(x.rect.x1).toBeLessThanOrEqual(x.z.x1 + 0.02);
    expect(x.rect.z0).toBeGreaterThanOrEqual(x.z.z0 - 0.02);
    expect(x.rect.z1).toBeLessThanOrEqual(x.z.z1 + 0.02);
    for (const o of l.zones.filter((o) => o !== x.z && o.kind !== x.z.kind)) expect(clash(x.rect, rectOf(o)), `${x.kind} in the ${o.name}`).toBe(false);
    for (const s of p.stairs) expect(clash(x.rect, s), `${x.kind} on the stairs`).toBe(false);
    for (const d of doors) expect(clash(x.rect, d), `${x.kind} in front of a door`).toBe(false);
  }
  pieces.forEach((a, i) => pieces.slice(i + 1).forEach((b) => expect(clash(a.rect, b.rect), `${a.kind} into the ${b.kind}`).toBe(false)));
  const kitchen = l.zones.filter((z) => z.kind === "kitchen").map(rectOf);
  expect(wayOut(p, l, [...pieces.map((x) => x.rect), ...kitchen])).toEqual({ ok: true, unreached: 0 });
  return pieces;
}

describe("the starting layout's furniture", () => {
  const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));

  it("keeps the example's furniture clear of its doors, the stairs and each other, as scanned and as designed", () => {
    // As the scan laid it out: the lounge chair used to stand in the dining set.
    const scanned = expectClear(sample.plan, sample.layout);
    const chair = scanned.find((x) => x.kind === "lounge_chair" || x.kind === "armchair");
    const dining = scanned.find((x) => x.kind === "dining");
    if (chair && dining) expect(clash(chair.rect, dining.rect, 0.5)).toBe(false);
    // As its chosen design: four doors round a narrow living space, and the sofa used to run past the
    // living space's end into the bedroom door. The stager furnishes a design only while it has no
    // furniture of its own (src/studio/DesignScene.tsx); a seeded one has, sofa and bed among it.
    const m = seedModel(sample, {}, "2026-10-30T00:00:00.000Z")!;
    const design = chosenDesign(m)!;
    const shapes = layoutOf(m.existing, design)!;
    const designed = expectClear(shapes.plan, shapes.layout);
    expect(designed.some((x) => x.kind === "bed")).toBe(true);
    expect(design.proposed.furniture.some((f) => f.kind === "sofa")).toBe(true);
    expect(furnitureProblems(design)).toEqual([]);
  });

  it("moves the sofa off a door in the wall behind it", () => {
    const p = plan({ openings: [{ kind: "door", side: "maxZ", atM: 4, widthM: 0.8, detectionId: "d1" }] });
    const l = layout([zone("living", "Living", 0, 0, 8, 5)]);
    const pieces = expectClear(p, l);
    const sofa = pieces.find((x) => x.kind === "sofa")!;
    expect(sofa.rect.x1 <= 3.5 || sofa.rect.x0 >= 4.5 || sofa.rect.z1 <= 4.1).toBe(true);
  });

  it("keeps both sides of a new wall's door clear, and the way through it", () => {
    // A bedroom across the end, its door in the middle of the new wall; the way out is a door at the far end.
    const p = plan({ openings: [{ kind: "door", side: "minX", atM: 2.5, widthM: 0.8, detectionId: "d1" }] });
    const l = layout([zone("bedroom", "Bedroom", 4.8, 0, 8, 5), zone("living", "Living", 0, 0, 4.8, 5)], [{ x0: 4.8, z0: 0, x1: 4.8, z1: 5 }], [{ x: 4.8, z: 2.5, along: "z", widthM: 0.8 }]);
    expectClear(p, l);
  });

  it("puts the bed somewhere else when a door opens where its head would go", () => {
    const p = plan({
      box: { minX: 0, maxX: 3.2, minZ: 0, maxZ: 3.4 },
      openings: [
        { kind: "window", side: "minZ", atM: 2.4, widthM: 0.6, detectionId: "w1" },
        { kind: "door", side: "minZ", atM: 1.6, widthM: 0.8, detectionId: "d1" },
      ],
    });
    const l = { ...layout([zone("bedroom", "Bedroom", 0, 0, 3.2, 3.4)]), window: { side: "minZ" as const, atM: 2.4, widthM: 0.6 } };
    const bed = expectClear(p, l).find((x) => x.kind === "bed")!;
    expect(clash(bed.rect, { x0: 1.1, x1: 2.1, z0: 0, z1: 0.9 })).toBe(false);
  });

  it("finds the way out blocked by a piece across the only way through", () => {
    // A corridor 1.2 m wide from the way out (a door at its end) to a new wall's door.
    const p = plan({ box: { minX: 0, maxX: 6, minZ: 0, maxZ: 3 }, openings: [{ kind: "door", side: "minX", atM: 0.6, widthM: 0.8, detectionId: "d1" }] });
    const l = layout([], [{ x0: 0, z0: 1.2, x1: 6, z1: 1.2 }], [{ x: 5, z: 1.2, along: "x", widthM: 0.8 }]);
    expect(wayOut(p, l, []).ok).toBe(true);
    expect(wayOut(p, l, [{ x0: 2, x1: 3, z0: 0, z1: 0.9 }])).toEqual({ ok: false, unreached: 1 });
  });

  it("works it out once for the same plan and layout", () => {
    expect(arrange(sample.plan, sample.layout)).toBe(arrange(sample.plan, sample.layout));
  });
});
