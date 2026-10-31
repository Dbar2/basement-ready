import { describe, expect, it } from "vitest";
import { buildResult, fireRules, instructions } from "../../server/assess";
import { packFor } from "../../server/rules";
import type { Watch } from "../../server/watch";

const waterloo = packFor("waterloo-on");
type Room = Watch["rooms"][number];
const room = (id: string, name: string, extra: Partial<Room> = {}): Room => ({
  id, name, spokenName: null, kind: "room", visits: [[0, 10]], photos: [], entered: true, seenFrom: null,
  ceiling: "drywall", low: [], windows: [], fixtures: [], sizeHintM: null, ...extra,
});
const furnace = [{ kind: "furnace" as const, atS: 5, note: "" }];

// The rendered basements' layouts (scripts/eval/README.md).
const b1: Pick<Watch, "rooms" | "doors"> = { rooms: [room("r1", "Basement", { ceiling: "exposed_joists", fixtures: furnace })], doors: [{ from: "r1", to: "upstairs", kind: "stairs", atS: 1, note: "" }] };
const b2: Pick<Watch, "rooms" | "doors"> = {
  rooms: [room("r1", "Family room", { low: [{ kind: "bulkhead", atS: 20, note: "" }] }), room("r2", "Utility room", { fixtures: furnace })],
  doors: [{ from: "r1", to: "r2", kind: "door", atS: 30, note: "" }],
};
const b3: Pick<Watch, "rooms" | "doors"> = {
  rooms: [room("r1", "Rec room", { low: [{ kind: "bulkhead", atS: 19, note: "" }] }), room("r2", "Workshop"), room("r3", "Furnace room", { ceiling: "exposed_joists", fixtures: furnace, low: [{ kind: "duct", atS: 55, note: "" }] })],
  doors: [{ from: "r1", to: "r2", kind: "door", atS: 34, note: "" }, { from: "r2", to: "r3", kind: "door", atS: 44, note: "" }],
};

const ctx = (watch: Pick<Watch, "rooms" | "doors"> | null) => ({ household: "renter" as const, municipality: "waterloo-on", watch });
const status = (r: ReturnType<typeof buildResult>, id: string) => r.findings.find((f) => f.ruleId === id)!.status;

describe("fireRules: the fire rules come from what the scan found", () => {
  it("open joists and a furnace with no door are both fixes (b1)", () => {
    const d = fireRules(b1, []);
    expect(d.fire_separation_between_units).toMatchObject({ status: "likely_fix", evidence: ["watch"] });
    expect(d.fire_separation_between_units.why).toMatch(/Open joists over the Basement/);
    expect(d.service_room_separation.status).toBe("likely_fix");
  });

  it("a finished drywall ceiling and a furnace room with a door are the designer's to confirm (b2)", () => {
    const d = fireRules(b2, []);
    expect(d.fire_separation_between_units.status).toBe("designer_checks");
    expect(d.fire_separation_between_units.why).toMatch(/finished drywall/);
    expect(d.service_room_separation.status).toBe("designer_checks");
  });

  it("open joists in just the furnace room still make the ceiling a fix (b3)", () => {
    const d = fireRules(b3, []);
    expect(d.fire_separation_between_units.status).toBe("likely_fix");
    expect(d.fire_separation_between_units.why).toMatch(/Furnace room/);
    expect(d.service_room_separation.status).toBe("designer_checks");
  });

  it("an exposed duct under a drywall ceiling is a fix; a boxed bulkhead isn't", () => {
    const ducted = { ...b2, rooms: [room("r1", "Family room", { low: [{ kind: "duct", atS: 20, note: "" }] }), b2.rooms[1]] };
    expect(fireRules(ducted, []).fire_separation_between_units.status).toBe("likely_fix");
    expect(fireRules(b2, []).fire_separation_between_units.status).toBe("designer_checks");
  });

  it("a room only seen through a doorway doesn't set the suite's ceiling", () => {
    const peek = { ...b2, rooms: [...b2.rooms, room("r3", "Storage", { entered: false, seenFrom: "r1", ceiling: "exposed_joists" })] };
    expect(fireRules(peek, []).fire_separation_between_units.status).toBe("designer_checks");
  });

  it("without the watch, SAM's finds decide: an exposed duct is a fix, a furnace is the designer's", () => {
    const d = fireRules(null, [{ id: "duct-duct-1", label: "Duct" }, { id: "mechanical-furnace-1", label: "Furnace" }]);
    expect(d.fire_separation_between_units).toMatchObject({ status: "likely_fix", evidence: ["duct-duct-1"] });
    expect(d.service_room_separation.status).toBe("designer_checks");
    const none = fireRules(null, [{ id: "window-window-1", label: "Window" }]);
    expect(none.fire_separation_between_units.status).toBe("designer_checks");
    expect(none.service_room_separation.status).toBe("standard");
  });
});

describe("buildResult: the same basement gets the same fixes on every take", () => {
  const detections = [{ id: "beam-beam-1", label: "Beam" }, { id: "window-window-1", label: "Window" }];
  // Two takes of one basement: on one Spark was handed a frame of the ceiling and claimed the fix, on the other it wasn't.
  const cited = { findings: [{ ruleId: "fire_separation_between_units", status: "likely_fix" as const, evidence: ["beam-beam-1"] }, { ruleId: "service_room_separation", status: "likely_fix" as const, evidence: ["beam-beam-1"] }] };
  const hedged = { findings: [{ ruleId: "fire_separation_between_units", status: "needs_answer" as const, evidence: [] }, { ruleId: "service_room_separation", status: "needs_answer" as const, evidence: [] }] };

  for (const [name, watch] of [["b1", b1], ["b2", b2], ["b3", b3]] as const) {
    it(`${name}: Spark citing a frame or not changes nothing`, () => {
      const a = buildResult(ctx(watch), waterloo, cited, detections);
      const b = buildResult(ctx(watch), waterloo, hedged, detections);
      expect(a.fixGroups.map((g) => g.ruleIds)).toEqual(b.fixGroups.map((g) => g.ruleIds));
      expect(a.headline).toBe(b.headline);
      expect(a.cost).toEqual(b.cost);
    });
  }

  it("b1 and b3 carry the fire fix; b2 leaves it to the designer and can still be a yes", () => {
    expect(status(buildResult(ctx(b1), waterloo, hedged, detections), "fire_separation_between_units")).toBe("likely_fix");
    expect(status(buildResult(ctx(b1), waterloo, hedged, detections), "service_room_separation")).toBe("likely_fix");
    expect(status(buildResult(ctx(b3), waterloo, hedged, detections), "fire_separation_between_units")).toBe("likely_fix");
    const two = buildResult(ctx(b2), waterloo, cited, detections);
    expect(status(two, "fire_separation_between_units")).toBe("designer_checks");
    expect(two.fixGroups.some((g) => g.category === "fire")).toBe(false);
  });
});

describe("the verdict agent's instructions", () => {
  it("never invite an escape-window claim by eye", () => {
    const p = instructions(waterloo);
    expect(p).not.toMatch(/small high basement window/);
    expect(p).toMatch(/Never judge by eye whether a window is big enough to escape through/);
  });
});
