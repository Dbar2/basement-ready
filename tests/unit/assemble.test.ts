import { describe, expect, it } from "vitest";
import { PARTITION_M, place, placedRect, quarterTurns, sameRooms, settle, splitWalk, square, turn, type Rect, type V2 } from "../../server/assemble";

// A wobbly walk around a centre, deterministic.
const around = (cx: number, cz: number, n: number, r = 0.8): V2[] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(i * 2.4), cz + r * Math.sin(i * 1.7)]);

describe("splitting the walk into areas", () => {
  it("cuts where the walk moves on to a new area, door or not", () => {
    const walk = [...around(0, 0, 20), ...around(5, 0, 20), ...around(5, 5, 15, 0.6)];
    expect(splitWalk(walk)).toEqual([
      [0, 20],
      [20, 40],
      [40, 55],
    ]);
  });

  it("leaves a walk around one room whole", () => {
    expect(splitWalk(around(0, 0, 50, 1.2))).toEqual([[0, 50]]);
  });
});

describe("placing a room in the whole-walk plan", () => {
  it("recovers the turn, scale and shift from cameras both runs have", () => {
    const theta = 0.4, scale = 0.8, shift: V2 = [3, -2];
    const idx = Array.from({ length: 12 }, (_, i) => i * 3);
    const pos = around(0, 0, 12, 1.5);
    const fwd: V2[] = idx.map((_, i) => [Math.cos(i), Math.sin(i)]);
    const wholePos = pos.map((p) => turn(p, theta)).map(([x, z]): V2 => [scale * x + shift[0], scale * z + shift[1]]);
    const wholeFwd = fwd.map((f) => turn(f, theta));
    const p = place(idx, pos, fwd, idx, wholePos, wholeFwd)!;
    expect(p.theta).toBeCloseTo(theta, 6);
    expect(p.scale).toBeCloseTo(scale, 6);
    expect(p.shift[0]).toBeCloseTo(shift[0], 6);
    expect(p.shift[1]).toBeCloseTo(shift[1], 6);
  });

  it("needs at least three shared cameras", () => {
    expect(place([0, 50], [[0, 0], [1, 1]], [[1, 0], [0, 1]], [0, 50], [[0, 0], [1, 1]], [[1, 0], [0, 1]])).toBeNull();
  });
});

describe("squaring and boxes", () => {
  it("snaps near right angles and leaves odd turns", () => {
    expect(square(Math.PI / 2 + 0.1)).toBeCloseTo(Math.PI / 2, 9);
    expect(square(0.6)).toBe(0.6);
    expect(quarterTurns(-Math.PI / 2)).toBe(3);
  });

  it("swaps width and depth on a quarter turn", () => {
    expect(placedRect(6, 4, Math.PI / 2, [0, 0])).toEqual({ x0: -2, z0: -3, x1: 2, z1: 3 });
  });
});

describe("one open room filmed in two stretches", () => {
  it("is one room when each box holds most of the other's cameras", () => {
    const rects: Rect[] = [
      { x0: -4, z0: -3, x1: 4, z1: 3 },
      { x0: -3.6, z0: -2.8, x1: 4.2, z1: 3.1 },
      { x0: 5, z0: -3, x1: 8, z1: 0 },
    ];
    const cams = [around(-2, 0, 10), around(2, 0, 10), around(6.5, -1.5, 10, 0.5)];
    expect(sameRooms(rects, cams)).toEqual([0, 0, 2]);
  });
});

describe("settling rooms against each other", () => {
  it("backs an overlapping room out to a partition's width", () => {
    const moves = settle([
      { x0: 0, z0: 0, x1: 6, z1: 4 },
      { x0: 5.5, z0: 0, x1: 8.5, z1: 4 },
    ]);
    expect(moves[0]).toEqual([0, 0]);
    expect(moves[1][0]).toBeCloseTo(0.5 + PARTITION_M, 9);
  });

  it("closes a sliver between facing walls and leaves far rooms alone", () => {
    const moves = settle([
      { x0: 0, z0: 0, x1: 6, z1: 4 },
      { x0: 6.5, z0: 0, x1: 9, z1: 4 },
      { x0: 0, z0: 8, x1: 3, z1: 10 },
    ]);
    expect(moves[1][0]).toBeCloseTo(-(0.5 - PARTITION_M), 9);
    expect(moves[2]).toEqual([0, 0]);
  });
});
