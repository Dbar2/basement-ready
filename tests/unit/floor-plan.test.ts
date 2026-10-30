import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BasementPlan } from "../../src/api";
import type { BasementScan } from "../../server/basement";
import { meshFloor, mergeMesh } from "../../server/basement";
import { checkDesign } from "../../server/model/checks";
import { existingFromScan, seedModel } from "../../server/model/seed";
import { polygonArea } from "../../server/model/geometry";

const plans: BasementPlan[] = [];
vi.mock("../../server/scan3d", async (orig) => ({
  ...(await orig<typeof import("../../server/scan3d")>()),
  runFloorPlan: vi.fn(async (_scans: unknown, _cams: unknown, extras: { edits?: { n: number; op: string }[]; hints?: Record<string, unknown> }) => {
    const plan = structuredClone(plans[Math.min(plans.length - 1, extras.edits?.length ? 1 : 0)]);
    // The 3D service keeps a merge, refuses anything else.
    plan.edits = (extras.edits ?? []).map((e) => ({ ...e, ok: e.op === "merge", why: e.op === "merge" ? "open along 3.0 m" : "no wall in the points there" }));
    return { rotation: plan.rotation, floorY: 0, ceilingY: 2.3, footprintM2: plan.footprintM2, rooms: [], plan, renders: { topDown: "png", frames: ["jpg"] } };
  }),
}));
vi.mock("../../server/limits", () => ({ overSpend: vi.fn(async () => false) }));

const { readBasementPlan, toEdits, inside, applyWatch } = await import("../../server/floorplan");
const { runFloorPlan } = await import("../../server/scan3d");

// The main room 6 × 4 m, a 1.2 × 2.4 m low room beside it behind a 12 cm partition with a door, a stair
// along the main room's top wall, a furnace in the low room's corner.
function plan(): BasementPlan {
  return {
    version: 1,
    rotation: 0.1,
    floor: { y: -1.4, normal: [0, 1, 0], spreadM: 0.03, tiltDeg: 0.2 },
    ceilingM: 2.3,
    footprintM2: 26.9,
    rooms: [
      { id: "r1", polygon: [[0, 0], [6, 0], [6, 4], [0, 4]], areaM2: 24, ceilingM: 2.3, low: false, cameras: 40, kind: "other" },
      { id: "r2", polygon: [[6.12, 0], [7.32, 0], [7.32, 2.4], [6.12, 2.4]], areaM2: 2.9, ceilingM: 1.78, low: true, cameras: 6, kind: "other" },
    ],
    walls: [
      { id: "w1", a: [6.06, 0], b: [6.06, 2.4], thicknessM: 0.12, kind: "existing", rooms: ["r1", "r2"], seenShare: 0.9, check: { confidence: 0.9, agree: 300, contradict: 20, frames: 12 } },
      { id: "w2", a: [-0.1, -0.1], b: [7.42, -0.1], thicknessM: 0.2, kind: "foundation", rooms: ["r1", "r2"], seenShare: 0.8 },
      { id: "w3", a: [-0.1, 4.1], b: [6.1, 4.1], thicknessM: 0.2, kind: "foundation", rooms: ["r1"], seenShare: 0.8 },
      { id: "w4", a: [-0.1, -0.1], b: [-0.1, 4.1], thicknessM: 0.2, kind: "foundation", rooms: ["r1"], seenShare: 0.7 },
      { id: "w5", a: [6.1, 2.46], b: [7.42, 2.46], thicknessM: 0.12, kind: "existing", rooms: ["r2"], seenShare: 0.2, guess: true },
      { id: "w6", a: [7.42, -0.1], b: [7.42, 2.4], thicknessM: 0.2, kind: "foundation", rooms: ["r2"], seenShare: 0.6 },
      { id: "w7", a: [6.1, 2.4], b: [6.1, 4.1], thicknessM: 0.2, kind: "foundation", rooms: ["r1"], seenShare: 0.6 },
    ],
    openings: [
      { id: "d1", kind: "door", wallId: "w1", offsetM: 1.2, widthM: 0.8, heightM: 2.03, at: [6.06, 1.2], rooms: ["r1", "r2"], source: "walk+sam", detectionId: "exit-door-1" },
      { id: "win2", kind: "window", wallId: "w3", offsetM: 3, widthM: 0.9, heightM: 0.6, sillM: 1.2, at: [3, 4.1], rooms: ["r1"], source: "sam", detectionId: "window-1" },
    ],
    fixtures: [
      { id: "stairs1", kind: "stairs", at: [2, 3.5], sizeM: [3, 0.9], source: "walk" },
      { id: "furnace2", kind: "furnace", at: [7, 0.4], source: "sam", detectionId: "mechanical-furnace-1" },
      { id: "duct3", kind: "duct", at: [3, 2], sizeM: [5, 0.4], heightM: 2.05, source: "geometry" },
    ],
    edits: [],
  };
}

describe("the model's existing basement from the whole plan", () => {
  it("draws rooms as polygons, walls with their own thickness, doors on their walls", () => {
    const e = existingFromScan({ floorPlan: plan(), rooms: [] })!;
    expect(e.rooms.map((r) => r.name)).toEqual(["Main room", "Low room"]);
    expect(e.rooms[1].ceilingM).toBe(1.78);
    expect(polygonArea(e.rooms[0].polygon)).toBeCloseTo(24, 5);
    expect(e.walls.find((w) => w.id === "w1")!.thicknessM).toBe(0.12);
    expect(e.walls.find((w) => w.id === "w5")!.guess).toBe(true);
    const door = e.openings.find((o) => o.kind === "door")!;
    expect(door).toMatchObject({ wallId: "w1", offsetM: 1.2, widthM: 0.8, status: "existing", detectionId: "exit-door-1" });
    expect(e.openings.find((o) => o.kind === "window")!.sillM).toBe(1.2);
    expect(e.fixtures.map((f) => f.kind).sort()).toEqual(["duct", "furnace", "stairs"]);
    expect(e.fixtures.find((f) => f.kind === "duct")!.heightM).toBe(2.05);
    expect(e.scale.source).toBe("arkit");
    expect(e.ceilingM).toBe(2.3);
  });

  it("designs the suite in the main room, and the checks read the plan's walls", () => {
    const m = seedModel({ floorPlan: plan(), rooms: [] }, {}, "2026-10-30T12:00:00.000Z")!;
    expect(m.designs.length).toBeGreaterThan(0);
    const d = m.designs.find((x) => x.chosen)!;
    expect(d.proposed.walls.some((w) => w.id === "w1")).toBe(true);
    expect(checkDesign(d, m.existing).length).toBeGreaterThan(3);
  });

  it("keeps the box path for takes without a plan", () => {
    expect(existingFromScan({ floorPlan: null, rooms: [] })).toBeNull();
  });
});

describe("Spark's corrections, checked by the points", () => {
  it("turns room ids into points in the phone's world and lines in the plan frame", () => {
    const p = plan();
    const edits = toEdits(p, [
      { op: "merge", rooms: ["R1", "R2"], why: "one room" },
      { op: "split", room: "R1", axis: "u", at: 3.1 },
      { op: "kind", room: "r2", kind: "closet", name: "Closet" },
      { op: "no_door", door: "D1" },
      { op: "merge", rooms: ["R1", "R9"] }, // no R9: dropped
      { op: "teleport", room: "R1" }, // not an operation: dropped
    ]);
    expect(edits.map((e) => e.op)).toEqual(["merge", "split", "kind", "no_door"]);
    // R1's middle (3, 2) turned by the plan's rotation into the phone's world.
    const [a] = (edits[0].at as number[][]);
    expect(a[0]).toBeCloseTo(3 * Math.cos(0.1) - 2 * Math.sin(0.1), 2);
    expect(edits[1]).toMatchObject({ axis: "u", value: 3.1 });
  });

  it("finds a point inside an L-shaped room", () => {
    const L: [number, number][] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
    const p = inside(L);
    expect(p[0] < 1 || p[1] < 1).toBe(true);
  });

  beforeEach(() => {
    plans.length = 0;
  });

  it("keeps what the points agree with, marks doubted walls, and stops when nothing changes", async () => {
    const merged = plan();
    merged.rooms = [merged.rooms[0]];
    plans.push(plan(), merged);
    const asked: number[] = [];
    const ask = vi.fn(async (p: BasementPlan) => {
      asked.push(p.rooms.length);
      return asked.length === 1
        ? { corrections: [{ op: "merge", rooms: ["R1", "R2"] }, { op: "split", room: "R1", axis: "v", at: 2 }], unsure: ["W4"], note: "The low room looks open to the main room." }
        : { corrections: [], unsure: [], note: "" };
    });
    const b = { scans: [], tracked: { cameras: [[0, 1.4, 0]], plan: {} } } as unknown as BasementScan;
    const logs: string[] = [];
    const out = (await readBasementPlan("/nowhere", b, [], { ask, log: async (t) => void logs.push(t) }))!;
    expect(ask).toHaveBeenCalledTimes(2);
    expect(asked).toEqual([2, 1]); // the second look sees the merged plan
    expect(out.rooms).toHaveLength(1);
    expect(out.edits.map((e) => [e.op, e.ok])).toEqual([["merge", true], ["split", false]]);
    expect(out.walls.find((w) => w.id === "w4")!.guess).toBe(true);
    expect(out.review).toMatchObject({ rounds: 2, note: "The low room looks open to the main room." });
    expect(logs).toContain("Kept 1 of 2 corrections the 3D agreed with");
  });

  it("reads without Spark when asked not to review", async () => {
    plans.push(plan());
    const ask = vi.fn();
    const b = { scans: [], tracked: { cameras: [[0, 1.4, 0]], plan: {} } } as unknown as BasementScan;
    const out = (await readBasementPlan("/nowhere", b, [], { ask, review: false }))!;
    expect(ask).not.toHaveBeenCalled();
    expect(out.review).toBeNull();
  });
});

describe("the whole-take watch on the plan", () => {
  // The main room r1 (entered) and the low room r2, which the camera only looked into from r1's side.
  const looked = () => {
    const p = plan();
    Object.assign(p.rooms[0], { entered: true });
    Object.assign(p.rooms[1], { entered: false, seenFrom: "r1", cameras: 0 });
    return p;
  };
  // Cameras every 3rd frame at 5 fps, all in r1 (phone's world = plan frame turned by the plan's 0.1 rad).
  const frames = [0, 3, 6, 9, 12, 15];
  const at = (u: number, v: number) => [u * Math.cos(0.1) - v * Math.sin(0.1), 1.4, u * Math.sin(0.1) + v * Math.cos(0.1)];
  const cams = frames.map(() => at(3, 2));
  const watch = {
    rooms: [
      { id: "r1", name: "Rec room", spokenName: "the gym", kind: "room", visits: [[0, 4]] as [number, number][], entered: true, seenFrom: null },
      { id: "r2", name: "Closet", kind: "closet", visits: [], entered: false, seenFrom: "r1" },
      { id: "r3", name: "Furnace room", kind: "room", visits: [], entered: false, seenFrom: "r1" },
    ],
    doors: [{ from: "r1", to: "r2", kind: "door" }],
  };

  it("names the plan's rooms from the watch and finds the one seen from the door", () => {
    const p = looked();
    const missing = applyWatch(p, watch, cams, frames);
    expect(p.rooms[0].name).toBe("the gym");
    expect(p.rooms[1]).toMatchObject({ name: "Closet", kind: "closet" });
    expect(missing.map((r) => r.name)).toEqual(["Furnace room"]);
  });

  it("tells the planner to look for a room nobody went into, and says which it couldn't place", async () => {
    plans.length = 0;
    plans.push(looked());
    const b = { scans: [], tracked: { cameras: cams, frames, plan: {} }, watch: Promise.resolve(watch) } as unknown as BasementScan;
    const out = (await readBasementPlan("/nowhere", b, [], { review: false }))!;
    const extras = vi.mocked(runFloorPlan).mock.calls.at(-1)![2] as { hints: Record<string, unknown> };
    expect(extras.hints.peek).toBe(2);
    expect(out.review?.notPlaced).toEqual(["Furnace room"]);
    expect(out.rooms[1].name).toBe("Closet");
  });
});

describe("one floor for every area", () => {
  it("finds an area's floor in its solid surface", () => {
    // 400 floor vertices 3 cm below the area's own y = 0, and a wall's vertices spread up to 2.3 m.
    const floor = Array.from({ length: 400 }, (_, i) => [i % 20 * 100, -30, Math.floor(i / 20) * 100]);
    const wall = Array.from({ length: 230 }, (_, i) => [0, i * 10, 0]);
    const verts = [...floor, ...wall];
    const buf = new ArrayBuffer(12 + 12 + verts.length * 6 + verts.length * 3);
    const head = new DataView(buf);
    [..."BRM1"].forEach((ch, i) => head.setUint8(i, ch.charCodeAt(0)));
    head.setUint32(4, verts.length, true);
    head.setUint32(8, 1, true);
    new Int16Array(buf, 24, verts.length * 3).set(verts.flat());
    expect(meshFloor(buf)).toBeCloseTo(-0.025, 2);
  });

  it("lifts an area onto the basement's floor", () => {
    // One triangle on the area's own floor (y = 0 in its frame), placed with its floor 4 cm high.
    const buf = new ArrayBuffer(12 + 12 + 18 + 9);
    const head = new DataView(buf);
    [..."BRM1"].forEach((ch, i) => head.setUint8(i, ch.charCodeAt(0)));
    head.setUint32(4, 3, true);
    head.setUint32(8, 1, true);
    new Uint32Array(buf, 12, 3).set([0, 1, 2]);
    new Int16Array(buf, 24, 9).set([0, 0, 0, 100, 0, 0, 0, 0, 100]);
    const rect = { x0: -1, z0: -1, x1: 1, z1: 1 };
    const out = mergeMesh([{ mesh: buf, placement: { turn: 0, x: 0, z: 0, y: -0.04 }, rect }], [rect]);
    const pos = new Int16Array(out.buffer.slice(out.byteOffset + 24, out.byteOffset + 42));
    expect([pos[1], pos[4], pos[7]]).toEqual([-40, -40, -40]);
  });
});
