// Every design the seed shows is a home: a kitchen at least a galley, a three-piece bathroom and somewhere
// to sleep, each sized by rule, and enough living space. On the example, and on the rendered basement b2
// (tests/fixtures/b2-family-result.json: its scan result as replayed, the fields the seed reads), whose
// rec room is too small to hold it all, so the suite takes in the laundry room next door.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BATH_MIN_M2, GALLEY_MIN_M2 } from "../../server/layout";
import { checkDesign } from "../../server/model/checks";
import { centroid, inPolygon, overlapArea, polygonArea } from "../../server/model/geometry";
import { seedModel } from "../../server/model/seed";
import { quote } from "../../server/quote/quote";
import type { Design, Model } from "../../server/model/types";

const NOW = "2026-10-31T00:00:00.000Z";
const load = (f: string) => seedModel(JSON.parse(readFileSync(f, "utf8")), {}, NOW)!;
const takes: [string, Model][] = [
  ["the example", load("public/samples/sample/result.json")],
  ["b2", load("tests/fixtures/b2-family-result.json")],
];
const suite = (d: Design) => d.proposed.rooms.filter((r) => r.unit === 2);
// Floor two rooms share, past what rounding leaves (a few centimetres along an edge).
const overlap = (a: Design["proposed"]["rooms"][number], b: Design["proposed"]["rooms"][number]) => {
  const shared = overlapArea(a.polygon, b.polygon);
  return shared > 0.1 ? shared : 0;
};

describe("every seeded design is a home", () => {
  for (const [name, model] of takes) {
    it(`${name}: a one-bedroom and a studio, each passing its own kitchen, bathroom and sleep check`, () => {
      expect(model.designs.map((d) => d.layout)).toEqual(expect.arrayContaining(["one_bedroom", "studio"]));
      for (const d of model.designs) {
        const checks = checkDesign(d, model.existing);
        expect(checks.find((c) => c.id === "rooms"), `${d.name}: ${checks.find((c) => c.id === "rooms")?.detail}`).toMatchObject({ ok: true });
        expect(checks.find((c) => c.id === "living-space")?.ok, `${d.name} living space`).toBe(true);
        // Sized by rule: the kitchen at least a galley (a 2.4 m run and a 1 m aisle), the bathroom 3.5 to 5 m².
        const kitchen = suite(d).find((r) => r.kind === "kitchen")!;
        expect(polygonArea(kitchen.polygon), `${d.name} kitchen`).toBeGreaterThanOrEqual(GALLEY_MIN_M2 - 0.01);
        const bath = suite(d).find((r) => r.kind === "bathroom")!;
        expect(polygonArea(bath.polygon), `${d.name} bathroom`).toBeGreaterThanOrEqual(BATH_MIN_M2 - 0.01);
        expect(polygonArea(bath.polygon), `${d.name} bathroom`).toBeLessThanOrEqual(5.01);
        // No room drawn over another: the living space is drawn round the kitchen, not under it.
        const rooms = d.proposed.rooms.filter((r) => r.unit === 2 || r.unit === "shared");
        for (const [i, a] of rooms.entries()) for (const b of rooms.slice(i + 1)) expect(overlap(a, b), `${d.name}: ${a.name} over ${b.name}`).toBe(0);
        // Nothing fails that a designer can't see coming: a way out, alarms, the service room.
        for (const id of ["way-out", "smoke-alarms", "service-room"]) expect(checks.find((c) => c.id === id)?.ok, `${d.name} ${id}`).not.toBe(false);
      }
    });
  }

  it("b2: the laundry room joins the suite, its water heater walled off in a service room", () => {
    const [, model] = takes[1];
    const laundry = model.existing.rooms.find((r) => r.kind === "laundry")!;
    const heater = model.existing.fixtures.find((f) => f.kind === "water_heater")!;
    expect(inPolygon(heater.at, laundry.polygon)).toBe(true);
    for (const d of model.designs) {
      // Not the house's any more: the room by that id is the suite's.
      expect(d.proposed.rooms.find((r) => r.id === laundry.id)?.unit, d.name).toBe(2);
      const service = d.proposed.rooms.find((r) => r.kind === "mechanical" && inPolygon(heater.at, r.polygon))!;
      expect(service, d.name).toMatchObject({ unit: "shared", name: "Water heater room" });
    }
    // The one-bedroom sleeps there, by its window; the studio washes there, the rest still its laundry.
    const one = model.designs.find((d) => d.layout === "one_bedroom")!;
    expect(one.proposed.rooms.find((r) => r.id === laundry.id)).toMatchObject({ kind: "bedroom", name: "Bedroom" });
    const studio = model.designs.find((d) => d.layout === "studio")!;
    expect(studio.proposed.rooms.find((r) => r.id === laundry.id)).toMatchObject({ kind: "laundry", name: "Laundry room" });
    expect(studio.proposed.rooms.some((r) => r.kind === "bathroom" && inPolygon(centroid(r.polygon), laundry.polygon))).toBe(true);
  });

  it("the example keeps its furnace room, and its rooms where they were", () => {
    const [, model] = takes[0];
    for (const d of model.designs) {
      expect(d.proposed.rooms.filter((r) => r.kind === "mechanical").map((r) => [r.name, r.unit]), d.name).toEqual([["Furnace room", "shared"]]);
      expect(checkDesign(d, model.existing).find((c) => c.id === "service-room")?.ok, d.name).toBe(true);
    }
  });
});

// A made-up basement, nobody's home: a rec room with the stairs and a window, and through one door in its
// west wall a finished bathroom (2 × 2 m) the watch named.
const area = (index: number, name: string, box: { minX: number; maxX: number; minZ: number; maxZ: number }, extra: Record<string, unknown> = {}) => ({
  index,
  name,
  has3d: true,
  placement: { turn: 0, x: 0, z: 0 },
  plan: {
    version: 1,
    box,
    sides: { minX: "wall", maxX: "wall", minZ: "wall", maxZ: "wall" },
    widthM: box.maxX - box.minX,
    depthM: box.maxZ - box.minZ,
    areaM2: (box.maxX - box.minX) * (box.maxZ - box.minZ),
    ceilingHeightM: 2.3,
    openings: [],
    stairs: [],
    fixtures: [],
    scaleSource: "model",
    trusted: false,
    ...extra,
  },
});
const withBath = (bathDoors: { side: string; atM: number }[] = []) => ({
  mainRoom: 0,
  rooms: [
    area(0, "Rec room", { minX: -4, maxX: 4, minZ: -3, maxZ: 3 }, {
      openings: [
        { kind: "window", side: "maxZ", atM: 2, widthM: 0.9, detectionId: "w1" },
        { kind: "door", side: "minX", atM: 4, widthM: 0.8, detectionId: "d-bath" },
      ],
      stairs: [{ x0: 2.6, z0: -3, x1: 3.6, z1: -1.2, detectionId: "s1" }],
    }),
    area(1, "Bathroom", { minX: -6, maxX: -4, minZ: 0, maxZ: 2 }, { openings: bathDoors.map((d, i) => ({ kind: "door", ...d, widthM: 0.8, detectionId: `d-bath-${i}` })) }),
  ],
  detections: [],
});

describe("a bathroom the scan already has", () => {
  it("is the suite's, kept as it is: no second bathroom built, and priced as there, not new", () => {
    const m = seedModel(withBath() as never, {}, NOW)!;
    const bath = m.existing.rooms.find((r) => r.name === "Bathroom")!;
    for (const d of m.designs) {
      const baths = d.proposed.rooms.filter((r) => r.kind === "bathroom");
      expect(baths.map((r) => [r.id, r.unit, r.kept]), d.name).toEqual([[bath.id, 2, true]]);
      expect(checkDesign(d, m.existing).find((c) => c.id === "rooms")?.ok, d.name).toBe(true);
      expect(checkDesign(d, m.existing).find((c) => c.id === "way-out")?.ok, d.name).not.toBe(false);
      // No drains, fixtures or fan for it, and no new floor in it; its ceiling is still the suite's rated one.
      const q = quote(m, d, { municipality: "waterloo-on" })!;
      const lines = q.byTrade.flatMap((t) => t.lines);
      expect(lines.some((l) => l.id === `bath_${bath.id}` || l.id === `rough_${bath.id}`), d.name).toBe(false);
      expect(lines.find((l) => l.id === "bath_fans")?.qty ?? 0, d.name).toBe(0);
      expect(q.assumptions.join(" ")).toMatch(/Bathroom is kept as it is/);
    }
  });

  it("isn't kept when it's a passage (a second door through it): the suite builds its own", () => {
    const m = seedModel(withBath([{ side: "minZ", atM: 1 }]) as never, {}, NOW)!;
    for (const d of m.designs) {
      expect(d.proposed.rooms.some((r) => r.kept), d.name).toBe(false);
      expect(d.proposed.rooms.find((r) => r.kind === "bathroom" && r.unit === 2), d.name).toBeTruthy();
    }
  });
});

describe("a furnace closet the plan left out", () => {
  // A made-up plan: one room (6 × 5 m) with a 1.4 × 1.6 m pocket cut out of its corner, walled on its open
  // sides, and the furnace found in the pocket, outside the room.
  const wall = (id: string, a: [number, number], b: [number, number], kind: "foundation" | "existing" = "existing") => ({ id, a, b, thicknessM: 0.15, kind, rooms: ["r1"], seenShare: 1 });
  const floorPlan = {
    version: 1,
    rotation: 0,
    floor: null,
    ceilingM: 2.3,
    footprintM2: 30,
    rooms: [{ id: "r1", polygon: [[0, 0], [6, 0], [6, 5], [1.4, 5], [1.4, 3.4], [0, 3.4]], areaM2: 27.8, ceilingM: 2.3, low: false, cameras: 10, kind: "other", name: "Rec room" }],
    walls: [
      wall("w1", [0, 0], [6, 0], "foundation"),
      wall("w2", [6, 0], [6, 5], "foundation"),
      wall("w3", [6, 5], [0, 5], "foundation"),
      wall("w4", [0, 5], [0, 0], "foundation"),
      wall("w5", [0, 3.4], [1.4, 3.4]),
      wall("w6", [1.4, 3.4], [1.4, 5]),
    ],
    openings: [{ id: "win1", kind: "window", wallId: "w1", offsetM: 3, widthM: 0.9, heightM: null, at: [3, 0], rooms: ["r1"], source: "sam" }],
    fixtures: [{ id: "furnace1", kind: "furnace", at: [0.7, 4.2], source: "sam" }],
    edits: [],
  };
  it("is a room of its own, the service room every design keeps: rated walls and a 20-minute door", () => {
    const m = seedModel({ floorPlan, rooms: [], detections: [] } as never, {}, NOW)!;
    const closet = m.existing.rooms.find((r) => r.kind === "mechanical")!;
    expect(closet).toMatchObject({ name: "Furnace room" });
    expect(polygonArea(closet.polygon)).toBeCloseTo(1.4 * 1.6, 1);
    for (const d of m.designs) {
      expect(d.proposed.rooms.find((r) => r.id === closet.id)?.unit, d.name).toBe("shared");
      expect(d.proposed.rooms.filter((r) => r.kind === "mechanical"), d.name).toHaveLength(1);
      expect(checkDesign(d, m.existing).find((c) => c.id === "service-room"), d.name).toMatchObject({ ok: true });
      const doors = d.proposed.openings.filter((o) => o.kind === "door" && o.rating === "20min" && ["w5", "w6"].includes(o.wallId));
      expect(doors, d.name).toHaveLength(1);
    }
  });
});
