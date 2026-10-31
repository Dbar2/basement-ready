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
