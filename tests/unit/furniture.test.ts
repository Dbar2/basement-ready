import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { suggestLayout } from "../../server/layout";
import {
  corners,
  designHash,
  doorZones,
  editFurniture,
  facing,
  furnishDesign,
  furnitureProblems,
  insideRoom,
  lookOf,
  nudgeFurniture,
  overlaps,
  pathOut,
  swapFurniture,
} from "../../server/model/furniture";
import type { Design, Furniture } from "../../server/model/types";
import type { Plan } from "../../server/plan";
import { seedModel } from "../../server/model/seed";

const plan = (over: Partial<Plan> = {}): Plan => ({
  version: 1,
  box: { minX: -4, maxX: 4, minZ: -3, maxZ: 3 },
  sides: { minX: "wall", maxX: "wall", minZ: "wall", maxZ: "wall" },
  widthM: 8,
  depthM: 6,
  areaM2: 48,
  ceilingHeightM: 2.3,
  openings: [
    { kind: "window", side: "maxZ", atM: 2, widthM: 0.8, detectionId: "w1" },
    { kind: "door", side: "minZ", atM: 1, widthM: 0.8, detectionId: "d1" },
  ],
  stairs: [],
  fixtures: [],
  scaleSource: "model",
  trusted: false,
  ...over,
});

// The model's own designs, seeded and furnished as every page sees them (server/model/seed.ts).
const seeded = (result: unknown, layout: Design["layout"] = "one_bedroom") => {
  const m = seedModel(result as never, {}, "2026-10-30T00:00:00.000Z")!;
  return m.designs.find((d) => d.layout === layout) ?? m.designs[0];
};
const oneBedroom = () => seeded({ mainRoom: 0, plan: plan() });
const sample = () => seeded(JSON.parse(readFileSync("public/samples/sample/result.json", "utf8")));
const studio = () => {
  const p = plan({ box: { minX: -3.78, maxX: 3.78, minZ: -1.86, maxZ: 1.86 }, widthM: 7.56, depthM: 3.72, areaM2: 28.1, openings: [{ kind: "door", side: "minZ", atM: 0.35, widthM: 0.7, detectionId: "d1" }] });
  return seeded({ mainRoom: 0, plan: p }, "studio");
};
const of = (d: Design, look: string) => d.proposed.furniture.filter((f) => lookOf(f) === look);

describe("furniture in the model", () => {
  for (const [name, make] of [["one-bedroom", oneBedroom], ["studio", studio], ["example", sample]] as const) {
    it(`furnishes the ${name} with nothing overlapping, inside its rooms, clear of doors and the way out`, () => {
      const d = make();
      expect(d.proposed.furniture.length).toBeGreaterThan(2);
      expect(furnitureProblems(d)).toEqual([]);
      const zones = doorZones(d);
      for (const f of d.proposed.furniture) {
        const room = d.proposed.rooms.find((r) => r.id === f.roomId)!;
        expect(insideRoom(corners(f), room.polygon)).toBe(true);
        if (lookOf(f) === "rug") continue;
        expect(zones.some((z) => overlaps(corners(f), z))).toBe(false);
        for (const o of d.proposed.furniture) if (o !== f && lookOf(o) !== "rug") expect(overlaps(corners(f), corners(o))).toBe(false);
      }
      expect(pathOut(d).ok).toBe(true);
    });
  }

  it("gives each room what it's for", () => {
    const d = oneBedroom();
    expect(of(d, "bed")).toHaveLength(1);
    expect(of(d, "sofa")).toHaveLength(1);
    expect(of(d, "kitchen")).toHaveLength(1);
    expect(of(d, "toilet")).toHaveLength(1);
    expect(of(d, "shower")).toHaveLength(1);
    const ex = sample();
    expect(of(ex, "bed")).toHaveLength(1);
    expect(of(ex, "nightstand").length).toBeGreaterThanOrEqual(1);
    expect(of(ex, "dining")).toHaveLength(1);
  });

  it("backs the bed onto the bedroom's window wall", () => {
    const d = oneBedroom();
    const bed = of(d, "bed")[0];
    const window = d.proposed.openings.find((o) => o.kind === "window")!;
    const wall = d.proposed.walls.find((w) => w.id === window.wallId)!;
    // The bed's back edge (opposite where it faces) lies on the window's wall line.
    const z = facing(bed.rotDeg);
    const back = [bed.at[0] - (z[0] * bed.sizeM[1]) / 2, bed.at[1] - (z[1] * bed.sizeM[1]) / 2];
    const d1 = [wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]];
    const off = Math.abs(d1[0] * (back[1] - wall.a[1]) - d1[1] * (back[0] - wall.a[0])) / Math.hypot(d1[0], d1[1]);
    expect(off).toBeLessThan(0.05);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(oneBedroom())).toBe(JSON.stringify(oneBedroom()));
    expect(designHash(oneBedroom())).toBe(designHash(oneBedroom()));
  });

  it("refuses a piece that blocks the only way to a door", () => {
    const d = studio();
    // A wall of shelving straight across the room cuts the kitchen off from the door.
    const wall: Furniture = { id: "x", kind: "shelf", at: [0, 0], rotDeg: 90, sizeM: [3.72, 0.4], roomId: "living-1" };
    expect(pathOut(d, [...d.proposed.furniture, wall]).ok).toBe(false);
  });
});

describe("changing a piece", () => {
  it("swaps the sofa for a desk in the same spot, back on the same wall", () => {
    const d = oneBedroom();
    const sofa = of(d, "sofa")[0];
    const edits = swapFurniture(d, sofa.id, "desk")!;
    expect(edits).toHaveLength(1);
    const next = edits.reduce(editFurniture, d);
    const desk = next.proposed.furniture.find((f) => f.id === sofa.id)!;
    expect(desk.kind).toBe("desk");
    expect(desk.sizeM).toEqual([1.2, 0.6]);
    const backOf = (f: Furniture) => {
      const z = facing(f.rotDeg);
      return [f.at[0] - (z[0] * f.sizeM[1]) / 2, f.at[1] - (z[1] * f.sizeM[1]) / 2];
    };
    expect(backOf(desk)[0]).toBeCloseTo(backOf(sofa)[0], 2);
    expect(backOf(desk)[1]).toBeCloseTo(backOf(sofa)[1], 2);
    expect(furnitureProblems(next)).toEqual([]);
  });

  it("colours, slides and removes through edits", () => {
    const d = oneBedroom();
    const bed = of(d, "bed")[0];
    const coloured = editFurniture(d, { op: "set_furniture", furnitureId: bed.id, colour: "sage" });
    expect(coloured.proposed.furniture.find((f) => f.id === bed.id)!.colour).toBe("sage");
    expect(designHash(coloured)).not.toBe(designHash(d));
    const sofa = of(d, "sofa")[0];
    const slide = nudgeFurniture(d, sofa.id, 0.5) ?? nudgeFurniture(d, sofa.id, -0.5);
    expect(slide).not.toBeNull();
    const slid = slide!.reduce(editFurniture, d);
    expect(slid.proposed.furniture.find((f) => f.id === sofa.id)!.at).not.toEqual(sofa.at);
    expect(furnitureProblems(slid)).toEqual([]);
    const gone = editFurniture(d, { op: "remove_furniture", furnitureId: bed.id });
    expect(gone.proposed.furniture.some((f) => f.id === bed.id)).toBe(false);
    const back = editFurniture(gone, { op: "add_furniture", furniture: bed });
    expect(back.proposed.furniture.some((f) => f.id === bed.id)).toBe(true);
  });

  it("says no to a swap that fits nowhere", () => {
    const d = studio();
    const bed = of(d, "bed")[0];
    // A dining table in the narrow sleeping corner, with the bed's spot taken by a wall-long shelf.
    const crowded = editFurniture(d, { op: "add_furniture", furniture: { id: "block", kind: "shelf", at: [0, -1.5], rotDeg: 0, sizeM: [3.2, 0.7], roomId: bed.roomId } });
    expect(swapFurniture(crowded, bed.id, "dining")).toBeNull();
  });
});
