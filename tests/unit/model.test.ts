import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { suggestLayout } from "../../server/layout";
import { placeAlarms as permitAlarms } from "../../server/permit/plans";
import { placeAlarms } from "../../server/model/alarms";
import { checkDesign, tally } from "../../server/model/checks";
import { applyEdit, applyEdits, editExisting, withTape } from "../../server/model/edit";
import { along, bounds, dist, inPolygon, polygonArea, wallLength } from "../../server/model/geometry";
import { ModelSchema, validateEdits } from "../../server/model/schema";
import { mainRoom, planOf, seedModel } from "../../server/model/seed";
import type { Check, Design, Edit, Existing, Model } from "../../server/model/types";
import { StateSchema } from "../../server/workspace";

const NOW = "2026-10-30T12:00:00.000Z";
const sampleResult = () => JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));

// An 8 × 6 m basement: a window on the bottom wall, stairs in the top-right corner, a gas furnace in
// the top-left, a duct the scan measured at 1.9 m.
function house(over: Record<string, unknown> = {}) {
  return {
    plan: {
      version: 1,
      box: { minX: -4, maxX: 4, minZ: -3, maxZ: 3 },
      sides: { minX: "wall", maxX: "wall", minZ: "wall", maxZ: "wall" },
      widthM: 8,
      depthM: 6,
      areaM2: 48,
      ceilingHeightM: 2.3,
      openings: [{ kind: "window", side: "maxZ", atM: 2, widthM: 0.9, detectionId: "w1" }],
      stairs: [{ x0: 2.6, z0: -3, x1: 3.6, z1: -1.2, detectionId: "s1" }],
      fixtures: [{ kind: "furnace", x: -3.5, z: -2.5, detectionId: "f1" }],
      scaleSource: "model",
      trusted: false,
      ...over,
    },
    measurements: { ceilingHeightM: 2.3, clearances: [{ detectionId: "d1", label: "Duct", clearanceM: 1.9 }] },
  };
}

const model = (over?: Record<string, unknown>) => seedModel(house(over) as never, {}, NOW)!;
const chosen = (m: Model) => m.designs.find((d) => d.chosen)!;
const check = (d: Design, e: Existing, id: string): Check => {
  const c = checkDesign(d, e).find((x) => x.id === id || x.id.startsWith(`${id}:`));
  if (!c) throw new Error(`no check ${id}`);
  return c;
};
const fixWith = (d: Design, e: Existing, id: string) => applyEdits(d, check(d, e, id).fix!.edits, NOW);
const room = (d: Design, kind: string) => d.proposed.rooms.find((r) => r.kind === kind)!;

describe("seeding the example basement", () => {
  const m = seedModel(sampleResult(), {}, NOW)!;

  it("draws the basement as it is from the scan", () => {
    const e = m.existing;
    expect(e.walls).toHaveLength(4);
    expect(e.walls.every((w) => w.kind === "foundation")).toBe(true);
    // Two sides the camera never saw are guesses until confirmed.
    expect(e.walls.filter((w) => w.guess)).toHaveLength(2);
    expect(e.openings.map((o) => o.kind).sort()).toEqual(["door", "window"]);
    expect(e.fixtures.find((f) => f.kind === "stairs")?.sizeM).toEqual([1.75, 0.88]);
    // The 0.6 m "beam" was a shelf; the 1.64 m duct is real, placed for them to drag.
    const duct = e.fixtures.find((f) => f.kind === "duct")!;
    expect(duct.heightM).toBe(1.64);
    expect(duct.guess).toBe(true);
    expect(e.fixtures.some((f) => f.kind === "beam")).toBe(false);
    expect(e.ceilingM).toBe(2.085);
    expect(e.confirmedAt).toBeNull();
  });

  it("offers a one-bedroom and a studio, the one-bedroom chosen", () => {
    expect(m.designs.map((d) => d.id)).toEqual(["one_bedroom", "studio"]);
    expect(m.designs.filter((d) => d.chosen).map((d) => d.id)).toEqual(["one_bedroom"]);
  });

  it("is permit-ready from the start: only the low duct is left to fix", () => {
    for (const d of m.designs) {
      const failing = checkDesign(d, m.existing).filter((c) => c.ok === false).map((c) => c.id);
      expect(failing, d.id).toEqual(["headroom"]);
    }
  });

  it("walls the stair in at 30 minutes with a 20-minute door into the suite", () => {
    const d = chosen(m);
    const stairs = room(d, "stairs");
    expect(stairs.unit).toBe("shared");
    const enclosure = d.proposed.walls.filter((w) => w.rating === "30min");
    expect(enclosure.length).toBeGreaterThanOrEqual(2);
    const door = d.proposed.openings.find((o) => o.rating === "20min")!;
    expect(enclosure.map((w) => w.id)).toContain(door.wallId);
    expect(door.widthM).toBeGreaterThanOrEqual(0.81);
  });

  it("puts the bedroom on the window, alarms in it and outside it", () => {
    const d = chosen(m);
    const bed = room(d, "bedroom");
    const win = d.proposed.openings.find((o) => o.kind === "window")!;
    const w = d.proposed.walls.find((x) => x.id === win.wallId)!;
    const c = along(w, win.offsetM);
    const b = bounds(bed.polygon);
    expect(c[0]).toBeGreaterThan(b.minX);
    expect(c[0]).toBeLessThan(b.maxX);
    expect(d.proposed.alarms.filter((a) => inPolygon(a.at, bed.polygon))).toHaveLength(1);
    expect(d.proposed.alarms).toHaveLength(2);
  });

  it("places alarms where the permit sheets do", () => {
    const main = mainRoom(m.existing)!;
    const layout = suggestLayout(planOf(m.existing, main), { kind: "one_bedroom" });
    const theirs = permitAlarms(layout as never, null, false);
    const ours = chosen(m).proposed.alarms;
    expect(ours.map((a) => a.kind)).toEqual(theirs.map((a) => a.kind));
    ours.forEach((a, i) => expect(dist(a.at, [theirs[i].x, theirs[i].z])).toBeLessThan(0.02));
  });

  it("saves through the workspace schema", () => {
    expect(ModelSchema.safeParse(m).success).toBe(true);
    expect(StateSchema.safeParse({ model: m }).success).toBe(true);
  });
});

describe("designs for a bigger basement", () => {
  const m = model();
  it("adds the bedroom on another wall and keeps CO alarms for the gas furnace", () => {
    expect(m.designs.map((d) => d.id)).toContain("one_bedroom");
    const d = chosen(m);
    const failing = checkDesign(d, m.existing).filter((c) => c.ok === false);
    expect(failing).toEqual([]);
    expect(room(d, "mechanical").unit).toBe("shared");
    expect(d.proposed.alarms.some((a) => a.kind === "co" || a.kind === "combo")).toBe(true);
    expect(check(d, m.existing, "co-alarms").ok).toBe(true);
  });

  it("offers two bedrooms when they fit with enough living space", () => {
    const big = model({ box: { minX: -5.5, maxX: 5.5, minZ: -3.5, maxZ: 3.5 }, widthM: 11, depthM: 7, areaM2: 77 });
    const two = big.designs.find((d) => d.layout === "two_bedroom");
    expect(two).toBeTruthy();
    expect(two!.proposed.rooms.filter((r) => r.kind === "bedroom")).toHaveLength(2);
    expect(check(two!, big.existing, "living-space").ok).toBe(true);
  });
});

describe("the checks, one by one", () => {
  const m = model();
  const e = m.existing;
  const d = chosen(m);
  const bedWall = () => {
    const bed = room(d, "bedroom");
    const b = bounds(bed.polygon);
    // The bedroom's inner wall: a new wall along its top edge.
    return d.proposed.walls.find((w) => w.kind === "new" && Math.abs(w.a[1] - b.minZ) < 0.01 && Math.abs(w.b[1] - b.minZ) < 0.01)!;
  };

  it("bedroom size, with a fix that slides the wall out", () => {
    const w = bedWall();
    const small = applyEdit(d, { op: "move_wall", wallId: w.id, a: [w.a[0], w.a[1] + 1.4], b: [w.b[0], w.b[1] + 1.4] }, NOW);
    expect(check(small, e, "bedroom-size").ok).toBe(false);
    const fixed = fixWith(small, e, "bedroom-size");
    expect(check(fixed, e, "bedroom-size").ok).toBe(true);
    expect(polygonArea(room(fixed, "bedroom").polygon)).toBeGreaterThanOrEqual(7);
  });

  it("escape window: a fix adds one, a window of unknown height asks to be measured", () => {
    const win = d.proposed.openings.find((o) => o.kind === "window")!;
    expect(check(d, e, "escape").ok).toBeNull();
    expect(check(d, e, "escape").detail).toMatch(/measure it/);
    const measured = applyEdit(d, { op: "set_opening", openingId: win.id, heightM: 0.6 }, NOW);
    expect(check(measured, e, "escape").ok).toBe(true);
    const none = applyEdit(d, { op: "remove_opening", openingId: win.id }, NOW);
    expect(check(none, e, "escape").ok).toBe(false);
    expect(check(fixWith(none, e, "escape"), e, "escape").ok).toBe(true);
    const tiny = applyEdit(d, { op: "set_opening", openingId: win.id, widthM: 0.3 }, NOW);
    expect(check(tiny, e, "escape").ok).toBe(false);
  });

  it("living space", () => {
    expect(check(d, e, "living-space").ok).toBe(true);
    const tiny = seedModel(house({ box: { minX: -2.6, maxX: 2.6, minZ: -2.2, maxZ: 2.2 }, widthM: 5.2, depthM: 4.4, areaM2: 22.9, stairs: [] }) as never, {}, NOW)!;
    const one = tiny.designs.find((x) => x.id === "one_bedroom")!;
    expect(check(one, tiny.existing, "living-space").ok).toBe(false);
  });

  it("kitchen, bathroom and a place to sleep", () => {
    expect(check(d, e, "rooms").ok).toBe(true);
    const noBath = applyEdit(d, { op: "remove_room", roomId: room(d, "bathroom").id }, NOW);
    expect(check(noBath, e, "rooms")).toMatchObject({ ok: false, detail: "It still needs a bathroom." });
  });

  it("ceiling height", () => {
    expect(check(d, e, "ceiling").ok).toBe(true);
    const low = { ...e, ceilingM: 1.9 };
    const lowDesign = { ...d, proposed: { ...d.proposed, rooms: d.proposed.rooms.map((r) => ({ ...r, ceilingM: null })) } };
    expect(check(lowDesign, low, "ceiling").ok).toBe(false);
    expect(check(lowDesign, { ...e, ceilingM: null }, "ceiling").ok).toBeNull();
  });

  it("headroom under beams and ducts", () => {
    expect(check(d, e, "headroom").ok).toBe(true);
    const duct = d.proposed.fixtures.find((f) => f.kind === "duct")!;
    const low = applyEdit(d, { op: "set_fixture", fixtureId: duct.id, heightM: 1.7 }, NOW);
    expect(check(low, e, "headroom").ok).toBe(false);
  });

  it("door widths, widened in one tap", () => {
    expect(check(d, e, "doors").ok).toBe(true);
    const bedDoor = d.proposed.openings.find((o) => o.wallId === bedWall().id && o.kind === "door")!;
    const narrow = applyEdit(d, { op: "set_opening", openingId: bedDoor.id, widthM: 0.7 }, NOW);
    expect(check(narrow, e, "doors").ok).toBe(false);
    expect(check(fixWith(narrow, e, "doors"), e, "doors").ok).toBe(true);
  });

  it("a clear way out, and a door added when a room is shut in", () => {
    expect(check(d, e, "way-out").ok).toBe(true);
    const bedDoor = d.proposed.openings.find((o) => o.wallId === bedWall().id && o.kind === "door")!;
    const shut = applyEdit(d, { op: "remove_opening", openingId: bedDoor.id }, NOW);
    const c = check(shut, e, "way-out");
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/bedroom/);
    expect(check(fixWith(shut, e, "way-out"), e, "way-out").ok).toBe(true);
  });

  it("halls at least 86 cm", () => {
    expect(check(d, e, "halls").ok).toBe(true);
    // A 6 × 3 m room: the stair walled off at one end, a wall across the middle that leaves a 70 cm gap.
    const ex: Existing = {
      walls: [], openings: [], fixtures: [], ceilingM: 2.3, scale: { source: "model", factor: 1 }, confirmedAt: null,
      rooms: [{ id: "r", polygon: [[0, 0], [6, 0], [6, 3], [0, 3]], kind: "other", name: "Basement", unit: 1 }],
    };
    const wall = (id: string, a: [number, number], b: [number, number], kind: "foundation" | "new" = "foundation", rating: "30min" | null = null) => ({ id, a, b, thicknessM: 0.12, kind, rating });
    const narrow: Design = {
      id: "t", name: "t", layout: "one_bedroom", chosen: true, updatedAt: NOW, finishes: { style: "light", floor: "", walls: "" },
      proposed: {
        walls: [wall("n", [0, 0], [6, 0]), wall("e", [6, 0], [6, 3]), wall("s", [0, 3], [6, 3]), wall("w", [0, 0], [0, 3]), wall("st", [1, 0], [1, 3], "new", "30min"), wall("p", [3.5, 0], [3.5, 2.3], "new")],
        openings: [{ id: "d", wallId: "st", kind: "door", offsetM: 1.5, widthM: 0.81, heightM: 2.03, status: "new", rating: "20min" }],
        rooms: [
          { id: "stairs", polygon: [[0, 0], [1, 0], [1, 3], [0, 3]], kind: "stairs", name: "Stairs", unit: "shared" },
          { id: "living", polygon: [[1, 0], [3.5, 0], [3.5, 3], [1, 3]], kind: "living", name: "Living", unit: 2, ceilingRating: "15min" },
          { id: "bed", polygon: [[3.5, 0], [6, 0], [6, 3], [3.5, 3]], kind: "bedroom", name: "Bedroom", unit: 2, ceilingRating: "15min" },
        ],
        fixtures: [],
        alarms: [],
      },
    };
    expect(check(narrow, ex, "way-out").ok).toBe(true);
    expect(check(narrow, ex, "halls")).toMatchObject({ ok: false, detail: expect.stringMatching(/bedroom/) });
  });

  it("smoke and CO alarms", () => {
    expect(check(d, e, "smoke-alarms").ok).toBe(true);
    const bare = { ...d, proposed: { ...d.proposed, alarms: [] } };
    expect(check(bare, e, "smoke-alarms").ok).toBe(false);
    expect(check(bare, e, "co-alarms").ok).toBe(false);
    expect(check(bare, e, "alarms-linked").ok).toBe(false);
    // Nothing that burns fuel: the CO check asks.
    const sample = seedModel(sampleResult(), {}, NOW)!;
    expect(check(chosen(sample), sample.existing, "co-alarms").ok).toBeNull();
  });

  it("rated walls between the homes", () => {
    const rated = d.proposed.walls.find((w) => w.rating === "30min")!;
    const plain = applyEdit(d, { op: "set_wall", wallId: rated.id, rating: null }, NOW);
    expect(check(plain, e, "separation-walls").ok).toBe(false);
    expect(check(fixWith(plain, e, "separation-walls"), e, "separation-walls").ok).toBe(true);
  });

  it("no gaps in the separation around the stair", () => {
    const stairs = room(d, "stairs");
    const door = d.proposed.openings.find((o) => o.rating === "20min" && inPolygon(along(d.proposed.walls.find((w) => w.id === o.wallId)!, o.offsetM), grow(stairs.polygon)))!;
    const wall = d.proposed.walls.find((w) => w.id === door.wallId)!;
    const open = applyEdit(d, { op: "remove_wall", wallId: wall.id }, NOW);
    expect(check(open, e, "separation-closed").ok).toBe(false);
    expect(check(fixWith(open, e, "separation-closed"), e, "separation-closed").ok).toBe(true);
  });

  it("a 15-minute ceiling over the suite", () => {
    const bed = room(d, "bedroom");
    const open = applyEdit(d, { op: "set_room", roomId: bed.id, ceilingRating: null }, NOW);
    expect(check(open, e, "separation-ceiling").ok).toBe(false);
    expect(check(fixWith(open, e, "separation-ceiling"), e, "separation-ceiling").ok).toBe(true);
  });

  it("20-minute doors in the separation", () => {
    const door = d.proposed.openings.find((o) => o.rating === "20min")!;
    const plain = applyEdit(d, { op: "set_opening", openingId: door.id, rating: null }, NOW);
    expect(check(plain, e, "separation-doors").ok).toBe(false);
    expect(check(fixWith(plain, e, "separation-doors"), e, "separation-doors").ok).toBe(true);
  });

  it("stair width: measured narrow fails, a narrow guess asks", () => {
    const stair = d.proposed.fixtures.find((f) => f.kind === "stairs")!;
    expect(check(d, e, "stairs").ok).toBe(true);
    const narrow = applyEdit(d, { op: "set_fixture", fixtureId: stair.id, sizeM: [0.8, 1.8] }, NOW);
    expect(check(narrow, e, "stairs").ok).toBeNull();
    expect(check(narrow, { ...e, scale: { source: "tape", factor: 1 } }, "stairs").ok).toBe(false);
  });

  it("laundry, services and the confirmed plan are for a person to confirm", () => {
    expect(check(d, e, "laundry").ok).toBeNull();
    expect(check(d, e, "services").ok).toBeNull();
    expect(check(d, e, "plan-confirmed").ok).toBeNull();
    expect(check(d, { ...e, confirmedAt: NOW, scale: { source: "tape", factor: 1 } }, "plan-confirmed").ok).toBe(true);
    const withLaundry = applyEdit(d, { op: "add_room", room: { id: "", polygon: [[-4, 0], [-3, 0], [-3, 1], [-4, 1]], kind: "laundry", name: "Laundry", unit: "shared" } }, NOW);
    expect(check(withLaundry, e, "laundry").ok).toBe(true);
  });

  it("counts what's met, what to fix and what to confirm", () => {
    const t = tally(checkDesign(d, e));
    expect(t.fix).toBe(0);
    expect(t.ok).toBeGreaterThanOrEqual(14);
    expect(t.ok + t.fix + t.confirm).toBe(checkDesign(d, e).length);
  });
});

describe("applyEdit", () => {
  const m = model();
  const d = chosen(m);
  const bed = room(d, "bedroom");
  const b = bounds(bed.polygon);
  const inner = d.proposed.walls.find((w) => w.kind === "new" && Math.abs(w.a[1] - b.minZ) < 0.01 && Math.abs(w.b[1] - b.minZ) < 0.01)!;

  it("slides a wall and the rooms and walls joined to it follow", () => {
    const moved = applyEdit(d, { op: "move_wall", wallId: inner.id, a: [inner.a[0], inner.a[1] - 0.5], b: [inner.b[0], inner.b[1] - 0.5] }, NOW);
    const nb = bounds(room(moved, "bedroom").polygon);
    expect(nb.minZ).toBeCloseTo(b.minZ - 0.5, 3);
    expect(nb.maxZ).toBeCloseTo(b.maxZ, 3);
    // The living space gave up that strip: it steps around the bigger bedroom, no overlap.
    const living = room(moved, "living").polygon;
    expect(inPolygon([(nb.minX + nb.maxX) / 2, nb.minZ + 0.1], living)).toBe(false);
    expect(polygonArea(living)).toBeCloseTo(polygonArea(room(d, "living").polygon) - 0.5 * wallLength(inner), 2);
    // The bedroom's side wall stretched to meet it.
    const side = d.proposed.walls.find((w) => w.kind === "new" && w.id !== inner.id && Math.abs(w.a[0] - w.b[0]) < 0.01 && Math.abs(Math.min(w.a[1], w.b[1]) - b.minZ) < 0.01);
    if (side) expect(wallLength(moved.proposed.walls.find((w) => w.id === side.id)!)).toBeCloseTo(wallLength(side) + 0.5, 3);
    // The alarm in the bedroom moved with the bedroom.
    expect(moved.proposed.alarms.some((a) => inPolygon(a.at, room(moved, "bedroom").polygon))).toBe(true);
    // The original is untouched, for undo.
    expect(bounds(room(d, "bedroom").polygon)).toEqual(b);
    expect(moved.updatedAt).toBe(NOW);
  });

  it("keeps doors on a stretched wall where they are in the room", () => {
    const side = d.proposed.walls.find((w) => d.proposed.openings.some((o) => o.wallId === w.id && o.kind === "door") && w.kind === "new" && w.id !== inner.id);
    if (!side) return;
    const o = d.proposed.openings.find((x) => x.wallId === side.id)!;
    const before = along(side, o.offsetM);
    const touching = [side.a, side.b].some((p) => Math.abs(p[1] - inner.a[1]) < 0.06 && Math.abs(p[0] - inner.a[0]) < 10);
    const moved = applyEdit(d, { op: "move_wall", wallId: inner.id, a: [inner.a[0], inner.a[1] - 0.3], b: [inner.b[0], inner.b[1] - 0.3] }, NOW);
    const ns = moved.proposed.walls.find((w) => w.id === side.id)!;
    const no = moved.proposed.openings.find((x) => x.id === o.id)!;
    if (touching) expect(dist(along(ns, no.offsetM), before)).toBeLessThan(0.01);
  });

  it("removes a wall with its doors, and gives new things unique ids", () => {
    const door = d.proposed.openings.find((o) => o.wallId === inner.id)!;
    const gone = applyEdit(d, { op: "remove_wall", wallId: inner.id }, NOW);
    expect(gone.proposed.walls.some((w) => w.id === inner.id)).toBe(false);
    expect(gone.proposed.openings.some((o) => o.id === door.id)).toBe(false);
    const twice = applyEdits(d, [
      { op: "add_opening", opening: { ...door, id: door.id } },
      { op: "add_opening", opening: { ...door, id: "" } },
    ], NOW);
    const ids = twice.proposed.openings.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps an opening inside its wall", () => {
    const door = d.proposed.openings.find((o) => o.wallId === inner.id)!;
    const far = applyEdit(d, { op: "move_opening", openingId: door.id, offsetM: 99 }, NOW);
    const o = far.proposed.openings.find((x) => x.id === door.id)!;
    expect(o.offsetM + o.widthM / 2).toBeLessThanOrEqual(wallLength(inner) + 1e-6);
  });

  it("changes finishes without touching the plan", () => {
    const f = applyEdit(d, { op: "set_finishes", finishes: { style: "warm" } }, NOW);
    expect(f.finishes.style).toBe("warm");
    expect(f.proposed).toBe(d.proposed);
  });

  it("places alarms again from the rooms", () => {
    expect(placeAlarms(d, true).length).toBeGreaterThan(placeAlarms(d, false).length);
  });
});

describe("the plan they confirm", () => {
  it("rescales everything from one tape number", () => {
    const m = seedModel(sampleResult(), {}, NOW)!;
    const e = m.existing;
    const wall = e.walls.find((w) => w.id === "room-0-maxZ")!;
    const measured = wallLength(wall);
    const out = withTape(e, wall.id, 7.3);
    const k = 7.3 / measured;
    expect(wallLength(out.walls.find((w) => w.id === wall.id)!)).toBeCloseTo(7.3, 2);
    expect(out.scale).toMatchObject({ source: "tape", tapeM: [{ wallId: wall.id, lengthM: 7.3 }] });
    expect(out.scale.factor).toBeCloseTo(k, 3);
    expect(out.ceilingM!).toBeCloseTo(e.ceilingM! * k, 2);
    const win = e.openings.find((o) => o.kind === "window")!;
    expect(out.openings.find((o) => o.id === win.id)!.widthM).toBeCloseTo(win.widthM * k, 3);
    expect(polygonArea(out.rooms[0].polygon)).toBeCloseTo(polygonArea(e.rooms[0].polygon) * k * k, 1);
    const duct = e.fixtures.find((f) => f.kind === "duct")!;
    expect(out.fixtures.find((f) => f.id === duct.id)!.heightM!).toBeCloseTo(duct.heightM! * k, 2);
    // A second tape number averages with the first.
    const side = out.walls.find((w) => w.id === "room-0-minX")!;
    const two = withTape(out, side.id, wallLength(side) * 1.1);
    expect(two.scale.factor!).toBeCloseTo(k * 1.05, 2);
  });

  it("moves a wall they drag, and re-tags a room", () => {
    const m = seedModel(sampleResult(), {}, NOW)!;
    const e = m.existing;
    const w = e.walls.find((x) => x.id === "room-0-maxX")!;
    const moved = editExisting(e, { op: "move_wall", wallId: w.id, a: [w.a[0] - 0.4, w.a[1]], b: [w.b[0] - 0.4, w.b[1]] });
    expect(bounds(moved.rooms[0].polygon).maxX).toBeCloseTo(w.a[0] - 0.4, 3);
    // The walls that meet it got shorter.
    expect(wallLength(moved.walls.find((x) => x.id === "room-0-minZ")!)).toBeCloseTo(wallLength(e.walls.find((x) => x.id === "room-0-minZ")!) - 0.4, 3);
    const tagged = editExisting(moved, { op: "set_room", roomId: "room-0", kind: "living", name: "Rec room" });
    expect(tagged.rooms[0]).toMatchObject({ kind: "living", name: "Rec room" });
  });
});

describe("validating proposed edits", () => {
  const m = model();
  const d = chosen(m);
  const foundation = d.proposed.walls.find((w) => w.kind === "foundation")!;
  const fresh = d.proposed.walls.find((w) => w.kind === "new" && !w.rating)!;
  it("keeps edits that make sense and says why the rest were dropped", () => {
    const raw: unknown[] = [
      { op: "move_wall", wallId: fresh.id, a: [fresh.a[0], fresh.a[1] - 0.2], b: [fresh.b[0], fresh.b[1] - 0.2] },
      { op: "move_wall", wallId: foundation.id, a: foundation.a, b: foundation.b },
      { op: "remove_wall", wallId: "nope" },
      { op: "add_opening", opening: { wallId: fresh.id, kind: "door", offsetM: 1, widthM: 0.4, heightM: 2, status: "new" } },
      { op: "fly_to_the_moon" },
      { op: "set_finishes", finishes: { style: "warm" } },
    ];
    const { edits, dropped } = validateEdits(d, m.existing, raw);
    expect(edits.map((e: Edit) => e.op)).toEqual(["move_wall", "set_finishes"]);
    expect(dropped).toHaveLength(4);
    expect(dropped.join(" ")).toMatch(/house's own walls/);
  });
});

// A polygon grown by 20 cm, to catch doors on its edge.
function grow(poly: [number, number][]): [number, number][] {
  const b = bounds(poly);
  return [
    [b.minX - 0.2, b.minZ - 0.2],
    [b.maxX + 0.2, b.minZ - 0.2],
    [b.maxX + 0.2, b.maxZ + 0.2],
    [b.minX - 0.2, b.maxZ + 0.2],
  ];
}

describe("walking the design", () => {
  it("stops at a wall, slides along it, and goes through a door", async () => {
    const { walkStep } = await import("../../src/studio/stage");
    const { solidPieces } = await import("../../server/model/geometry");
    const wall = { id: "w", a: [0, 0] as [number, number], b: [4, 0] as [number, number], thicknessM: 0.12, kind: "new" as const, rating: null };
    const door = { id: "d", wallId: "w", kind: "door" as const, offsetM: 2, widthM: 0.81, heightM: 2.03, status: "new" as const };
    const solid = solidPieces(wall, []);
    // Straight at the wall: blocked.
    expect(walkStep([1, 0.3], [0, -0.1], solid)).toBeNull();
    // At an angle: slides along it.
    expect(walkStep([1, 0.3], [0.1, -0.1], solid)).toEqual([1.1, 0.3]);
    // With a door cut in it: through the doorway.
    const withDoor = solidPieces(wall, [door]);
    let p: [number, number] = [2, 0.6];
    for (let i = 0; i < 12; i++) p = walkStep(p, [0, -0.1], withDoor) ?? p;
    expect(p[1]).toBeLessThan(-0.5);
  });
});

describe("the chosen design in the older layout shape", () => {
  it("gives the permit sheets, materials list and 3D stager zones, new walls and doors", async () => {
    const { chosenDesign, layoutOf } = await import("../../server/model/legacy");
    const m = seedModel(sampleResult(), {}, NOW)!;
    const d = chosenDesign(m)!;
    const out = layoutOf(m.existing, d)!;
    expect(out.layout.zones.map((z) => z.kind).sort()).toEqual(["bathroom", "bedroom", "kitchen", "living"]);
    expect(out.layout.walls).toHaveLength(d.proposed.walls.filter((w) => w.kind === "new").length);
    expect(out.layout.doors.length).toBeGreaterThanOrEqual(3);
    expect(out.layout.window?.side).toBe("maxZ");
    // The living space is furnished clear of the stair and its landing.
    const living = out.layout.zones.find((z) => z.kind === "living")!;
    const stairs = bounds(room(d, "stairs").polygon);
    expect(living.x0 >= stairs.maxX - 0.01 || living.z0 >= stairs.maxZ - 0.01 || living.x1 <= stairs.minX + 0.01).toBe(true);
  });
});
