import { describe, expect, it } from "vitest";
import { asBuiltKey, buildAsBuilt, paintJob, pointAt, type AsBuilt, type Block, type Surface } from "../../src/three/AsBuiltModel";
import type { Design, Existing, Wall } from "../../server/model/types";

// Two rooms side by side: a living area 5 × 4 m at 2.3 m, and a low furnace room 3 × 4 m at 2.0 m.
// A window on the living area's far wall, a door between the two, stairs along the near wall.
function basement(over: Partial<Existing> = {}): Existing {
  const wall = (id: string, a: [number, number], b: [number, number], kind: Wall["kind"] = "foundation", t = 0.2): Wall => ({ id, a, b, thicknessM: t, kind, rating: null });
  return {
    walls: [
      wall("south", [0, 0], [8, 0]),
      wall("east", [8, 0], [8, 4]),
      wall("north", [8, 4], [0, 4]),
      wall("west", [0, 4], [0, 0]),
      wall("mid", [5, 0], [5, 4], "existing", 0.12),
    ],
    openings: [
      { id: "window1", wallId: "north", kind: "window", offsetM: 6, widthM: 0.8, heightM: 0.4, sillM: 1.5, status: "existing" },
      { id: "door1", wallId: "mid", kind: "door", offsetM: 2, widthM: 0.8, heightM: null, status: "existing" },
    ],
    rooms: [
      { id: "living", polygon: [[0, 0], [5, 0], [5, 4], [0, 4]], kind: "living", name: "Living", unit: 1, ceilingM: 2.3 },
      { id: "furnace", polygon: [[5, 0], [8, 0], [8, 4], [5, 4]], kind: "mechanical", name: "Furnace room", unit: 1, ceilingM: 2.0 },
    ],
    fixtures: [
      { id: "stairs1", kind: "stairs", at: [2, 0.5], sizeM: [2.6, 0.9] },
      { id: "furnace1", kind: "furnace", at: [7, 3], sizeM: [0.6, 0.7] },
      { id: "duct1", kind: "duct", at: [2.5, 2], sizeM: [5, 0.35], heightM: 1.9 },
    ],
    ceilingM: 2.3,
    scale: { source: "model", factor: 1 },
    confirmedAt: null,
    ...over,
  };
}

const face = (ab: AsBuilt, id: string) => ab.surfaces.find((s) => s.id === id);
const bottom = (b: Block) => b.center[1] - b.size[1] / 2;
// Where a surface's (s, t) corner lands on the floor, as (x, z).
const xz = (s: Surface, a: number, b: number) => {
  const p = pointAt(s, a, b);
  return [Math.round(p[0] * 1000) / 1000, Math.round(p[2] * 1000) / 1000];
};

describe("the as-built model from the plan", () => {
  it("stands on the plan's floor", () => {
    for (const floorY of [0, 0.04]) {
      const ab = buildAsBuilt(basement(), { floorY });
      for (const s of ab.surfaces.filter((x) => x.kind === "floor")) expect(s.origin[1]).toBe(floorY);
      for (const s of ab.surfaces.filter((x) => x.kind === "wall" || x.kind === "side" || x.kind === "stairs")) expect(s.origin[1]).toBe(floorY);
      for (const b of ab.blocks.filter((x) => x.kind === "core")) expect(bottom(b)).toBeGreaterThanOrEqual(floorY - 1e-6);
      // Full-height pieces of every wall start on the floor.
      expect(ab.blocks.filter((x) => x.kind === "core" && Math.abs(bottom(x) - floorY) < 1e-6).length).toBeGreaterThan(5);
      // Each room's ceiling at its own height above that floor.
      expect(face(ab, "ceiling:living")!.origin[1]).toBeCloseTo(floorY + 2.3);
      expect(face(ab, "ceiling:furnace")!.origin[1]).toBeCloseTo(floorY + 2.0);
    }
  });

  it("puts a foundation wall's face on the plan's line, and the slab outside it", () => {
    const ab = buildAsBuilt(basement());
    const south = ab.surfaces.filter((s) => s.id.startsWith("wall:south"));
    // Only the side facing a room is painted.
    expect(south).toHaveLength(1);
    expect(south[0].origin[2]).toBeCloseTo(0);
    expect(south[0].n).toEqual([0, 0, 1]);
    // The slab is all on the outside (z < 0).
    for (const b of ab.blocks.filter((x) => x.id.startsWith("south:"))) expect(b.center[2]).toBeCloseTo(-0.1);
  });

  it("paints both sides of a wall between rooms, each as high as its own room", () => {
    const ab = buildAsBuilt(basement());
    const sides = ab.surfaces.filter((s) => s.id.startsWith("wall:mid"));
    expect(sides).toHaveLength(2);
    const living = sides.find((s) => s.roomId === "living")!, furnace = sides.find((s) => s.roomId === "furnace")!;
    expect(living.origin[0]).toBeCloseTo(4.94);
    expect(furnace.origin[0]).toBeCloseTo(5.06);
    expect(living.size[1]).toBeCloseTo(2.3);
    expect(furnace.size[1]).toBeCloseTo(2.0);
  });

  it("cuts the window and the door through their walls", () => {
    const ab = buildAsBuilt(basement());
    const north = face(ab, "wall:north:L")!;
    expect(north.holes).toHaveLength(1);
    const [[s0, t0], , [s1, t1]] = north.holes![0];
    // The window is 6 m from the wall's start, 0.8 m wide, sill 1.5 m, 0.4 m tall.
    expect(s1 - s0).toBeCloseTo(0.8);
    expect([t0, t1]).toEqual([1.5, 1.9]);
    expect(xz(north, (s0 + s1) / 2, 0)).toEqual([2, 4]);
    // Nothing solid in the window: the core is cut there, with a sill below and a lintel above.
    const inWindow = ab.blocks.filter((b) => b.id.startsWith("north:") && Math.abs(b.center[0] - 2) < 0.3 && bottom(b) < 1.7 && bottom(b) + b.size[1] > 1.7);
    expect(inWindow).toHaveLength(0);
    // The glass the camera saw sits at the outside of the wall.
    const pane = face(ab, "pane:window1")!;
    expect(pane.size).toEqual([0.8, 0.4]);
    expect(pane.origin[2]).toBeCloseTo(4.18);
    // The door goes down to the floor and is open: it joins two rooms, so there's no leaf.
    for (const side of ["wall:mid:L", "wall:mid:R"]) {
      const h = face(ab, side)!.holes!;
      expect(h).toHaveLength(1);
      expect(h[0][0][1]).toBe(0);
      expect(h[0][2][1]).toBeCloseTo(1.95); // under the furnace room's 2.0 m ceiling
    }
    expect(face(ab, "pane:door1")).toBeUndefined();
    const inDoor = ab.blocks.filter((b) => b.id.startsWith("mid:") && Math.abs(b.center[2] - 2) < 0.3 && bottom(b) < 1);
    expect(inDoor).toHaveLength(0);
  });

  it("shows a door to somewhere the plan doesn't reach as the door itself", () => {
    const e = basement();
    e.openings.push({ id: "door2", wallId: "south", kind: "door", offsetM: 1, widthM: 0.8, heightM: 2.03, status: "existing" });
    const pane = face(buildAsBuilt(e), "pane:door2")!;
    expect(pane.kind).toBe("pane");
    expect(pane.origin[1]).toBe(0);
    expect(pane.size[1]).toBeCloseTo(2.03);
    // In the middle of the slab.
    expect(pane.origin[2]).toBeCloseTo(-0.1);
  });

  it("keeps a surface's key when an opening moves, and changes it when the wall moves", () => {
    const a = buildAsBuilt(basement());
    const moved = basement();
    moved.openings[0] = { ...moved.openings[0], offsetM: 5 };
    moved.openings[1] = { ...moved.openings[1], offsetM: 3 };
    const b = buildAsBuilt(moved);
    expect(face(b, "wall:north:L")!.key).toBe(face(a, "wall:north:L")!.key);
    expect(face(b, "wall:north:L")!.holes).not.toEqual(face(a, "wall:north:L")!.holes);
    expect(face(b, "wall:mid:R")!.key).toBe(face(a, "wall:mid:R")!.key);
    // The window's glass moved with it, so that one is painted again.
    expect(face(b, "pane:window1")!.key).not.toBe(face(a, "pane:window1")!.key);
    const doorOnly = basement();
    doorOnly.openings[1] = { ...doorOnly.openings[1], offsetM: 3 };
    const shifted = basement();
    shifted.walls[4] = { ...shifted.walls[4], a: [5.2, 0], b: [5.2, 4] };
    shifted.rooms[0] = { ...shifted.rooms[0], polygon: [[0, 0], [5.2, 0], [5.2, 4], [0, 4]] };
    shifted.rooms[1] = { ...shifted.rooms[1], polygon: [[5.2, 0], [8, 0], [8, 4], [5.2, 4]] };
    const c = buildAsBuilt(shifted);
    expect(face(c, "wall:mid:L")!.key).not.toBe(face(a, "wall:mid:L")!.key);
    expect(asBuiltKey(c)).not.toBe(asBuiltKey(a));
    expect(asBuiltKey(buildAsBuilt(doorOnly))).toBe(asBuiltKey(a));
  });

  it("builds the stairs as a flight from the floor to the ceiling, its top where filming started", () => {
    const ab = buildAsBuilt(basement(), { stairTop: [0.2, 0.5] });
    const st = face(ab, "stairs:stairs1")!;
    expect(st.steps!.count).toBe(12);
    // The foot is at x = 3.3, the top at x = 0.7, 2.3 m up.
    const foot = pointAt(st, 0.45, 0), top = pointAt(st, 0.45, st.size[1]);
    expect(foot[0]).toBeCloseTo(3.3);
    expect(foot[1]).toBe(0);
    expect(top[0]).toBeCloseTo(0.7);
    expect(top[1]).toBeCloseTo(2.3);
    // The side against the south wall is hidden; the open side is painted.
    expect(ab.surfaces.filter((s) => s.id.startsWith("side:stairs1"))).toHaveLength(1);
    // The living room's ceiling is open over the flight.
    expect(face(ab, "ceiling:living")!.holes).toHaveLength(1);
    const other = face(buildAsBuilt(basement(), { stairTop: [4, 0.5] }), "stairs:stairs1")!;
    expect(pointAt(other, 0.45, other.size[1])[0]).toBeCloseTo(3.3);
    // Filming that started across the room says nothing about the stairs: the top is at the wall end.
    const far = face(buildAsBuilt(basement(), { stairTop: [7.5, 3.5] }), "stairs:stairs1")!;
    expect(pointAt(far, 0.45, far.size[1])[0]).toBeCloseTo(0.7);
  });

  it("hangs the duct at its height and stands the furnace on the floor", () => {
    const ab = buildAsBuilt(basement());
    const duct = ab.blocks.find((b) => b.id === "duct1")!;
    expect(bottom(duct)).toBeCloseTo(1.9);
    expect(bottom(duct) + duct.size[1]).toBeCloseTo(2.3);
    const furnace = ab.blocks.find((b) => b.id === "furnace1")!;
    expect(bottom(furnace)).toBe(0);
    // Both can hide a wall from a camera.
    expect(paintJob(ab).occluders.length).toBeGreaterThanOrEqual(2);
    // A duct placed by guess hides nothing.
    const e = basement();
    e.fixtures[2] = { ...e.fixtures[2], guess: true };
    expect(paintJob(buildAsBuilt(e)).occluders.length).toBe(paintJob(ab).occluders.length - 1);
  });

  it("draws a design on it: removed walls go, new walls stand with their doorways cut", () => {
    const e = basement();
    const design = {
      id: "d",
      name: "D",
      layout: "custom",
      proposed: {
        walls: [...e.walls.filter((w) => w.id !== "mid"), { id: "new1", a: [0, 2.5], b: [3, 2.5], thicknessM: 0.12, kind: "new", rating: null }],
        openings: [...e.openings.filter((o) => o.wallId !== "mid"), { id: "door9", wallId: "new1", kind: "door", offsetM: 1.5, widthM: 0.81, heightM: 2.03, status: "new" }],
        rooms: e.rooms,
        fixtures: e.fixtures,
        alarms: [],
        furniture: [],
      },
      finishes: { style: "light", floor: "oak", walls: "white" },
      chosen: true,
      updatedAt: "",
    } as Design;
    const ab = buildAsBuilt(e, { design });
    expect(ab.surfaces.some((s) => s.id.startsWith("wall:mid"))).toBe(false);
    const fresh = ab.blocks.filter((b) => b.kind === "new");
    expect(fresh.length).toBeGreaterThanOrEqual(3); // left of the door, the lintel, right of the door
    expect(fresh.some((b) => Math.abs(b.center[0] - 1.5) < 0.2 && bottom(b) < 1)).toBe(false);
    // Painted plain, never photographed.
    expect(ab.surfaces.some((s) => s.id.startsWith("wall:new1"))).toBe(false);
  });
});

describe("the painter's cameras (server/asBuilt.ts paintRequest)", () => {
  it("turns each area's cameras into the plan's frame, with the frame's own lens and thinned depth", async () => {
    const { paintRequest } = await import("../../server/asBuilt");
    const existing = basement();
    // One area, a quarter turn and a shift into the basement: a camera at (1, 1.4, 0) in its own frame,
    // looking down its +z.
    const pose = [[1, 0, 0, 1], [0, 1, 0, 1.4], [0, 0, 1, 0], [0, 0, 0, 1]];
    const frame = { sourceIndex: 0, width: 1280, height: 720, sharpness: 50, pose, intrinsics: [[300, 0, 259], [0, 300, 146], [0, 0, 1]], model: { resizedWidth: 518, resizedHeight: 291, cropLeft: 0, cropTop: 0 } };
    const depth = Buffer.alloc(1 * 292 * 518 * 2);
    const area = { room: { index: 0, name: "", startS: 0, endS: 1, has3d: true, plan: null, measurements: null }, placement: { turn: 1 as const, x: 4, z: 2, y: 0.12 }, scan: { frames: [frame], sentFrames: [7], files: { depth: { shape: [1, 292, 518] } } }, depth, areaScale: 1 };
    const model = buildAsBuilt(existing);
    const asked: number[] = [];
    const { job, frames, depths } = await paintRequest({ model, existing, areas: [area] }, async (n) => (asked.push(n), Buffer.from("jpg")));
    expect(asked).toEqual([7]);
    expect(frames.map((f) => f.name)).toEqual(["0007.jpg"]);
    const cam = job.cameras[0] as { K: number[][]; pose: number[][]; depth: { K: number[][]; map: number } };
    // A quarter turn: x' = −z, z' = x, then the shift. The lens points along the area's +z: now −x.
    expect(cam.pose[0][3]).toBeCloseTo(4);
    expect(cam.pose[2][3]).toBeCloseTo(3);
    // Lifted with its area, so its floor is the plan's.
    expect(cam.pose[1][3]).toBeCloseTo(1.52);
    expect([cam.pose[0][2], cam.pose[2][2]].map((v) => Math.round(v))).toEqual([-1, 0]);
    // Model pixels (518 wide) -> the frame's (1280 wide).
    const r = 518 / 1280;
    expect(cam.K[0][0]).toBeCloseTo(300 / r);
    expect(cam.K[0][2]).toBeCloseTo((259 + 0.5) / r - 0.5);
    // Depth every other pixel: half the lens, half the size.
    expect(depths[0].shape).toEqual([1, 146, 259]);
    expect(cam.depth.K[0][0]).toBeCloseTo(150);
    expect(job.surfaces.length).toBe(model.surfaces.length);
    // Importing the server starts its in-memory database: slow on a busy machine.
  }, 60_000);
});

describe("the studio's overhead labels", () => {
  it("say each kind once, at the lowest one", async () => {
    const { overheadTags } = await import("../../src/studio/stage");
    const beam = (id: string, heightM: number, x: number) => ({ id, kind: "beam" as const, at: [x, 1] as [number, number], heightM });
    const tags = overheadTags([beam("b1", 2.5, 0), beam("b2", 1.43, 3), beam("b3", 1.69, 5), { id: "d1", kind: "duct", at: [1, 1], heightM: 1.9 }, { id: "f1", kind: "furnace", at: [2, 2] }]);
    expect(tags.map((t) => t.text)).toEqual(["3 beams · lowest 1.43 m clear", "Duct · 1.90 m clear"]);
    expect(tags[0].at).toEqual([3, 1]);
  });
});

describe("where the walk starts", () => {
  it("is the filmed spot that looks furthest into the room, never one facing a wall", async () => {
    const { bestView, freeAhead, spotsOf } = await import("../../src/three/AsBuiltView");
    const e = basement();
    const walls = e.walls.map((w): [[number, number], [number, number]] => [w.a, w.b]);
    expect(freeAhead([1, 2], [1, 0], walls)).toBeCloseTo(4);
    const rooms = e.rooms.map((r) => r.polygon);
    // One spot faces the far wall from 0.6 m away; one looks down the 5 m room; one stood outside.
    const v = bestView(
      [
        { at: [4.4, 2], dir: [1, 0] },
        { at: [0.6, 2], dir: [1, 0] },
        { at: [-2, 2], dir: [1, 0] },
      ],
      walls,
      rooms,
    )!;
    expect(v.at).toEqual([0.6, 2]);
    expect(v.dir[0]).toBeGreaterThan(0.85);
    // Facing a wall up close, it turns to see across the room instead.
    const turned = bestView([{ at: [2.5, 3.6], dir: [0, 1] }], walls, rooms)!;
    expect(freeAhead(turned.at, turned.dir, walls)).toBeGreaterThan(1.5);
    // A scan's camera poses: column 2 is where it looked.
    expect(spotsOf({ frames: [{ pose: [[1, 0, 0, 2], [0, 1, 0, 1.4], [0, 0, 1, 3], [0, 0, 0, 1]] }] }, 2)).toEqual([{ at: [4, 6], dir: [0, 1] }]);
  });
});
