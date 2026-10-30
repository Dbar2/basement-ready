import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { besideWalk, modelsFrom, placeGroup, placePoint, walkFrom } from "../../src/screens/assembly";

const area = (i: number, place?: unknown) => ({ type: "model", data: { area: i, files: { surfels: `/api/scans/s/3d/surfels.bin?area=${i}`, mesh: `/api/scans/s/3d/mesh.bin?area=${i}`, scan: "x" }, place } }) as never;

describe("the wait screen's basement: areas set into the walk, then the whole basement in its own frame", () => {
  it("sets an area into the walk frame the way the 3D service says (RoomPlacement's turn)", () => {
    const place = { angle: 0.7, scale: 1.3, x: 2.5, z: -1.2 };
    const c = Math.cos(0.7), s = Math.sin(0.7);
    expect(placePoint(place, 1, 0.5, 2)).toEqual([1.3 * (c * 1 - s * 2) + 2.5, 1.3 * 0.5, 1.3 * (s * 1 + c * 2) - 1.2]);
    // Drawn as a three.js group, a point lands in the same spot.
    const g = placeGroup(place);
    const o = new THREE.Object3D();
    o.rotation.y = g.rotationY;
    o.scale.setScalar(g.scale);
    o.position.set(...g.position);
    o.updateMatrixWorld();
    const p = new THREE.Vector3(1, 0.5, 2).applyMatrix4(o.matrixWorld);
    const [x, y, z] = placePoint(place, 1, 0.5, 2);
    expect(p.x).toBeCloseTo(x, 9);
    expect(p.y).toBeCloseTo(y, 9);
    expect(p.z).toBeCloseTo(z, 9);
  });

  it("leaves an area with no placement where it is", () => {
    expect(placePoint(null, 1, 2, 3)).toEqual([1, 2, 3]);
    expect(placeGroup(null)).toEqual({ rotationY: 0, scale: 1, position: [0, 0, 0] });
  });

  it("keeps one model per area, moving it when its placement settles, without loading it again", () => {
    const first = { angle: 0.1, scale: 1, x: 0, z: 0 };
    const settled = { angle: 0, scale: 1, x: 0.03, z: 0 };
    const models = modelsFrom([area(0, first), area(1, { angle: 1, scale: 0.9, x: 3, z: 1 }), area(0, settled)]);
    expect(models.map((m) => [m.area, m.place])).toEqual([
      [0, settled],
      [1, { angle: 1, scale: 0.9, x: 3, z: 1 }],
    ]);
    expect(modelsFrom([area(0, first)])[0].key).toBe(models[0].key);
  });

  it("ignores a placement it can't use", () => {
    expect(modelsFrom([area(0, { angle: 0, scale: 0, x: 0, z: 0 })])[0].place).toBeNull();
    expect(modelsFrom([area(0, { angle: Number.NaN, scale: 1, x: 0, z: 0 })])[0].place).toBeNull();
    expect(modelsFrom([area(0)])[0].place).toBeNull();
  });

  it("shows an area the layout couldn't place on its own, in a row beside the walk, overlapping nothing", () => {
    const walk = { minX: -1, maxX: 3, minZ: -2, maxZ: 2 };
    const a = { minX: -2, maxX: 2, minZ: -1, maxZ: 1 }; // 4 m wide, centred on its own origin
    const b = { minX: 10, maxX: 13, minZ: 5, maxZ: 9 }; // 3 m wide, far from its origin
    const [pa, pb] = besideWalk(walk, [a, b], 0.8);
    const moved = (box: typeof a, p: typeof pa) => ({ minX: box.minX + p.x, maxX: box.maxX + p.x, minZ: box.minZ + p.z, maxZ: box.maxZ + p.z });
    const ma = moved(a, pa), mb = moved(b, pb);
    expect(ma.minX).toBeCloseTo(3.8);
    expect(mb.minX).toBeCloseTo(ma.maxX + 0.8);
    // Level with the middle of the walk, unturned, at its own size.
    expect((ma.minZ + ma.maxZ) / 2).toBeCloseTo(0);
    expect((mb.minZ + mb.maxZ) / 2).toBeCloseTo(0);
    expect([pa.angle, pa.scale, pb.angle, pb.scale]).toEqual([0, 1, 0, 1]);
    // With nothing placed yet, the first one starts at the middle.
    expect(besideWalk(null, [a])[0]).toEqual({ angle: 0, scale: 1, x: 2, z: 0 });
  });

  it("knows the whole basement by its area or its ?room=all files, and carries the walk re-sent in its frame", () => {
    const path: [number, number][] = [[0, 0], [1, 2], [2, 2]];
    const [whole] = modelsFrom([{ type: "model", data: { area: "all", files: { surfels: "/api/scans/s/3d/surfels.bin?room=all", mesh: "/api/scans/s/3d/mesh.bin?room=all", scan: "x" }, path } } as never]);
    expect(whole).toMatchObject({ area: "all", path, place: null, mesh: "/api/scans/s/3d/mesh.bin?room=all" });
    const [byUrl] = modelsFrom([{ type: "model", data: { files: { surfels: "/api/scans/s/3d/surfels.bin?room=all", scan: "x" } } } as never]);
    expect(byUrl).toMatchObject({ area: "all", path: null });
  });

  it("draws the newest walk", () => {
    const events = [
      { type: "path", data: { points: [[0, 0], [1, 1]] } },
      { type: "path", data: { points: [[5, 5]] } }, // too short to draw
      { type: "path", data: { points: [[0, 0], [2, 2], [3, 1]] } },
    ] as never[];
    expect(walkFrom(events)).toEqual([[0, 0], [2, 2], [3, 1]]);
    expect(walkFrom([])).toBeNull();
  });
});
