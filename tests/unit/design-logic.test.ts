// How the seed decides, one rule at a time (server/model/seed.ts seedDesigns, server/model/entrance.ts):
// its own way in first; what's there stays (a bathroom, a kitchen, a laundry room); a bedroom on a window,
// away from the furnace and water heater; the kitchen by the pipes; a reason for every new wall; two or
// three designs that differ, each with a sentence on why. On made-up basements, nobody's home; and on a
// real one kept private (media/private/friend-take/result.json, never in the repo), when it's here.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verdictFrom } from "../../server/assess";
import { designPricing } from "../../server/priced";
import { checkDesign } from "../../server/model/checks";
import { currentModel } from "../../server/model/current";
import { entranceOf, ENTRANCE_MIN_M } from "../../server/model/entrance";
import { along, centroid, distToSegment, edges, inPolygon, overlapArea, polygonArea, rectPoly } from "../../server/model/geometry";
import { seedModel } from "../../server/model/seed";
import type { Design, Existing, Model, Room } from "../../server/model/types";
import { quote } from "../../server/quote/quote";

const NOW = "2026-10-31T00:00:00.000Z";
type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
const area = (index: number, name: string, box: Box, extra: Record<string, unknown> = {}) => ({
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
const REC: Box = { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };
const STAIRS = [{ x0: 2.6, z0: -3, x1: 3.6, z1: -1.2, detectionId: "s1" }];
const rec = (extra: Record<string, unknown> = {}) => area(0, "Rec room", REC, { stairs: STAIRS, ...extra });
const scan = (rooms: unknown[], more: Record<string, unknown> = {}) => ({ mainRoom: 0, rooms, detections: [], ...more });
const suite = (d: Design) => d.proposed.rooms.filter((r) => r.unit === 2);
const beds = (d: Design) => suite(d).filter((r) => r.kind === "bedroom");
const near = (r: Room, p: [number, number]) => (inPolygon(p, r.polygon) ? 0 : Math.min(...edges(r.polygon).map(([a, b]) => distToSegment(p, a, b))));
const grown = (r: Room, by: number) => {
  const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
  return rectPoly(Math.min(...xs) - by, Math.min(...zs) - by, Math.max(...xs) + by, Math.max(...zs) + by);
};
// What they told us: is there a door from the basement straight outside?
const told = (outside: boolean) => ({ findings: [{ ruleId: "exit_from_suite", status: outside ? "likely_ok" : "likely_fix" }] });

describe("its own way in, first", () => {
  const door = (widthM: number) => ({ walls: [{ id: "w1", a: [0, 0], b: [6, 0], thicknessM: 0.2, kind: "foundation", rating: null }], openings: [{ id: "d1", wallId: "w1", kind: "door", offsetM: 3, widthM, heightM: 2, status: "existing" }] }) as unknown as Existing;
  it("is its own door straight outside, their word over the scan's, and a new one where they say there's none", () => {
    expect(entranceOf(door(0.8), null).status).toBe("own");
    // Narrower than a door you walk through: something else the scan called a door.
    expect(entranceOf(door(ENTRANCE_MIN_M - 0.1), null).status).toBe("unknown");
    expect(entranceOf(door(0.8), false).status).toBe("needed");
    expect(entranceOf(door(0.3), true).status).toBe("own");
    expect(entranceOf(door(0.3), false).why).toMatch(/Table 11\.5\.1\.1\.-C, C139/);
  });

  it("where there's none, every design puts a new one into its living space, priced, and the answer says it first", () => {
    const m = seedModel(scan([rec({ openings: [{ kind: "window", side: "maxZ", atM: 2, widthM: 0.9, detectionId: "w1" }] })], told(true)) as never, {}, NOW)!;
    expect(m.existing.entrance?.status).toBe("own");
    const no = seedModel(scan([rec({ openings: [{ kind: "window", side: "maxZ", atM: 2, widthM: 0.9, detectionId: "w1" }] })], told(false)) as never, {}, NOW)!;
    expect(no.existing.entrance?.status).toBe("needed");
    for (const d of no.designs) {
      const added = d.proposed.openings.filter((o) => o.kind === "door" && o.status === "new" && d.proposed.walls.find((w) => w.id === o.wallId)?.kind === "foundation");
      expect(added, d.name).toHaveLength(1);
      const at = along(d.proposed.walls.find((w) => w.id === added[0].wallId)!, added[0].offsetM);
      expect(suite(d).filter((r) => r.kind === "living" || r.kind === "kitchen").some((r) => near(r, at) < 0.3), d.name).toBe(true);
      expect(checkDesign(d, no.existing).find((c) => c.id === "entrance")?.ok, d.name).toBe(true);
      const line = quote(no, d, { municipality: "waterloo-on" })!.byTrade.flatMap((t) => t.lines).find((l) => l.id.startsWith("entrance_"))!;
      expect([line.low, line.high], d.name).toEqual([12000, 30000]);
    }
    // The answer: its own way in before anything else, the entrance the first fix.
    const exit = { ruleId: "exit_from_suite", category: "exit", status: "likely_fix", title: "A safe way out of the suite", why: "You told us no.", evidence: [], source: {}, fix: { description: "Add a separate entrance", costLowCAD: 12000, costHighCAD: 30000 } };
    const other = { ...exit, ruleId: "egress_window_bedroom_area", category: "egress", title: "Bedroom escape window" };
    const v = verdictFrom([other, exit] as never, designPricing({ municipality: "waterloo-on" }, { ...no, designs: no.designs.map((d, i) => ({ ...d, chosen: i === 0 })) } as Model));
    expect(v.headline).toMatch(/^It needs its own way in first\. Yes, your basement can be a second home after \d+ fix(es)?\.$/);
    expect(v.fixGroups[0]).toMatchObject({ category: "exit", costLow: 12000, costHigh: 30000 });
    expect(v.entrance.status).toBe("needed");
  });
});

describe("what's there stays", () => {
  it("a laundry room is never a bedroom, and keeps its washer and dryer", () => {
    // A small rec room and, through a door, a laundry room with a window and the water heater.
    const laundry = area(1, "Laundry room", { minX: 4, maxX: 8, minZ: -3, maxZ: 1 }, {
      openings: [{ kind: "window", side: "maxZ", atM: 2, widthM: 0.9, detectionId: "w2" }],
      fixtures: [{ kind: "water_heater", x: 7.5, z: -2.5, detectionId: "h1" }],
    });
    const m = seedModel(scan([area(0, "Rec room", { minX: -2, maxX: 4, minZ: -3, maxZ: 2 }, { stairs: [{ x0: -2, z0: -3, x1: -1, z1: -1.2, detectionId: "s1" }], openings: [{ kind: "door", side: "maxX", atM: 2, widthM: 0.8, detectionId: "d1" }, { kind: "window", side: "maxZ", atM: 3, widthM: 0.9, detectionId: "w1" }] }), laundry]) as never, {}, NOW)!;
    const room = m.existing.rooms.find((r) => r.name === "Laundry room")!;
    for (const d of m.designs) {
      expect(beds(d).some((b) => overlapArea(b.polygon, room.polygon) > 0.5), d.name).toBe(false);
      expect(d.proposed.rooms.some((r) => r.kind === "laundry" && r.unit === 2 && r.kept), d.name).toBe(true);
    }
  });
});

describe("a bedroom on a window, away from the furnace and water heater", () => {
  // Windows on both long walls; the furnace and water heater by the north one.
  const m = seedModel(scan([rec({
    openings: [
      { kind: "window", side: "maxZ", atM: 1.5, widthM: 1.0, detectionId: "w-north" },
      { kind: "window", side: "minZ", atM: 3, widthM: 0.8, detectionId: "w-south" },
    ],
    fixtures: [{ kind: "furnace", x: -3.4, z: 2.4, detectionId: "f1" }, { kind: "water_heater", x: -2.6, z: 2.5, detectionId: "h1" }],
  })]) as never, {}, NOW)!;
  const mech = m.existing.fixtures.filter((f) => f.kind === "furnace" || f.kind === "water_heater");
  it("takes the window away from them, and never shares a wall with their room", () => {
    for (const d of m.designs.filter((x) => beds(x).length)) {
      for (const b of beds(d)) {
        for (const f of mech) expect(near(b, f.at), `${d.name} ${f.kind}`).toBeGreaterThanOrEqual(1.5);
        for (const s of d.proposed.rooms.filter((r) => r.kind === "mechanical")) expect(overlapArea(grown(s, 0.25), b.polygon), d.name).toBeLessThan(0.05);
      }
      // And its window can be an escape window: it's on a wall with one.
      expect(checkDesign(d, m.existing).filter((c) => c.id.startsWith("escape:")).every((c) => c.ok !== false), d.name).toBe(true);
    }
  });
});

describe("the kitchen by the pipes", () => {
  it("goes on the wall nearest a rough-in", () => {
    const m = seedModel(scan([rec({ openings: [{ kind: "window", side: "minX", atM: 3, widthM: 0.9, detectionId: "w1" }], fixtures: [{ kind: "plumbing", x: 3.6, z: 1.5, detectionId: "p1" }] })]) as never, {}, NOW)!;
    for (const d of m.designs) {
      const k = suite(d).find((r) => r.kind === "kitchen")!;
      expect(Math.hypot(centroid(k.polygon)[0] - 3.6, centroid(k.polygon)[1] - 1.5), d.name).toBeLessThan(3);
    }
  });
});

describe("every new wall has a reason, and every design a sentence", () => {
  const all: [string, Model][] = [
    ["the example", seedModel(JSON.parse(readFileSync("public/samples/sample/result.json", "utf8")), {}, NOW)!],
    ["b2", seedModel(JSON.parse(readFileSync("tests/fixtures/b2-family-result.json", "utf8")), {}, NOW)!],
  ];
  for (const [name, m] of all)
    it(name, () => {
      expect(m.designs.length).toBeGreaterThanOrEqual(1);
      expect(m.designs.length).toBeLessThanOrEqual(3);
      expect(new Set(m.designs.map((d) => d.id)).size).toBe(m.designs.length);
      for (const d of m.designs) {
        expect(d.why, d.name).toMatch(/^[A-Z].+\.$/);
        for (const w of d.proposed.walls.filter((x) => x.kind === "new")) expect(w.why, `${d.name} ${w.id}`).toBeTruthy();
      }
    });
  it("the example: a one-bedroom first, then a studio, each saying why", () => {
    const [, m] = all[0];
    expect(m.designs.map((d) => d.layout)).toEqual(["one_bedroom", "studio"]);
    expect(m.designs[0].why).toMatch(/bedroom on the window wall, away from the furnace and water heater/);
  });
});

// A real basement, kept private: only where its result is on this machine.
const FRIEND = "media/private/friend-take/result.json";
describe.skipIf(!existsSync(FRIEND))("the friend's take (private)", () => {
  const result = existsSync(FRIEND) ? JSON.parse(readFileSync(FRIEND, "utf8")) : null;
  const m = result && currentModel(result, {})!.model;
  it("keeps its bathroom, walls in its furnace, keeps beds off the furnace and water heater, and needs its own entrance", () => {
    const bath = m.existing.rooms.find((r: Room) => r.kind === "bathroom")!;
    const mech = m.existing.fixtures.filter((f: { kind: string }) => f.kind === "furnace" || f.kind === "water_heater");
    expect(m.existing.entrance.status).toBe("needed");
    expect(m.designs.length).toBeGreaterThanOrEqual(2);
    for (const d of m.designs as Design[]) {
      const checks = checkDesign(d, m.existing);
      expect(d.proposed.rooms.filter((r) => r.kind === "bathroom").map((r) => [r.id, r.unit, r.kept]), d.name).toEqual([[bath.id, 2, true]]);
      expect(checks.find((c) => c.id === "service-room")?.ok, d.name).toBe(true);
      expect(checks.find((c) => c.id === "entrance")?.ok, d.name).toBe(true);
      for (const b of beds(d)) for (const f of mech) expect(near(b, f.at), `${d.name} ${f.kind}`).toBeGreaterThanOrEqual(1.5);
      expect(d.why, d.name).toMatch(/keeps your bathroom/i);
    }
  });
});
