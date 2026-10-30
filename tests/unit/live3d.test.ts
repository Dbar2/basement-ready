import { describe, expect, it } from "vitest";
import { mapOf, placeOf } from "../../server/live3d";

// Camera-to-room poses with OpenCV camera axes (x right, y down, z forward), columns x, y, z, t.
const pose = (x: number[], y: number[], z: number[], t: number[]) => [
  [x[0], y[0], z[0], t[0]],
  [x[1], y[1], z[1], t[1]],
  [x[2], y[2], z[2], t[2]],
  [0, 0, 0, 1],
];
// Level, looking along +X (right on the map).
const facingRight = (t = [1, 1.4, 2]) => pose([0, 0, 1], [0, -1, 0], [1, 0, 0], t);
// Looking straight up at the ceiling, standing so the top of the map is in front of them.
const lookingUp = pose([1, 0, 0], [0, 0, -1], [0, 1, 0], [0, 1.4, 0]);

describe("the live map from a 3D rebuild", () => {
  it("places the camera on the map and reads which way it faces, even pointed at the ceiling", () => {
    expect(placeOf(facingRight())).toEqual({ x: 1, z: 2, yaw: 90 });
    // Identity: an OpenCV camera looks along +Z, down the map.
    expect(placeOf(pose([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0])).yaw).toBe(180);
    expect(placeOf(lookingUp).yaw).toBe(0);
  });

  it("finds each kept frame's heading and order by its place in the request, and the newest", () => {
    const sent = [
      { heading: 10, seq: 0 },
      { heading: 20, seq: 7 },
      { heading: null, seq: 12 },
      { heading: 40, seq: 15 },
    ];
    // The service kept three of the four, in its own order.
    const scan = {
      frames: [
        { index: 0, sourceIndex: 0, pose: facingRight([0, 1.4, 0]) },
        { index: 1, sourceIndex: 3, pose: lookingUp },
        { index: 2, sourceIndex: 2, pose: facingRight([2, 1.4, 1]) },
      ],
      room: {
        ceiling: { heightM: 2.3 },
        box: { min: [-2, 0, -1.5], max: [2, 2.3, 1.5], sides: { minX: "wall", maxX: "extent", minZ: "wall", maxZ: "nonsense" } },
        walls: [{ segment: [[-2, -1.5], [2, -1.5]] }],
      },
    };
    const map = mapOf(scan, sent);
    expect(map.path.map((p) => p.seq)).toEqual([0, 12, 15]);
    expect(map.path.map((p) => p.heading)).toEqual([10, null, 40]);
    expect(map.newest).toMatchObject({ seq: 15, yaw: 0, heading: 40 });
    expect(map.newestView).toBe(1);
    expect(map.box?.sides).toEqual({ minX: "wall", maxX: "extent", minZ: "wall", maxZ: "extent" });
    expect(map.walls).toEqual([[[-2, -1.5], [2, -1.5]]]);
    expect(map.ceiling).toBe(true);
  });

  it("copes with a rebuild that found no room box or kept no frames", () => {
    const map = mapOf({ frames: [], room: {} }, []);
    expect(map).toMatchObject({ box: null, path: [], newest: null, newestView: null, ceiling: false });
  });
});
