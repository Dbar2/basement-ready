import { describe, expect, it } from "vitest";
import { designInView, frameIntrinsics, pickAngles, pickDesignAngles, placePose, poseAt, viewsFromArea, type View } from "../../server/views/angles";
import { bestAngles, designAngles, designFor } from "../../server/views/load";
import type { Furniture } from "../../server/model/types";

// A camera at (x, h, z) looking along yaw (0 = +z), tipped by pitch (up positive) and roll, as an
// OpenCV camera-to-room pose: columns are the camera's x (right), y (down), z (forward).
function pose(x: number, z: number, yawDeg: number, { h = 1.5, pitch = 0, roll = 0 } = {}) {
  const y = (yawDeg * Math.PI) / 180, p = (pitch * Math.PI) / 180, r = (roll * Math.PI) / 180;
  const fwd = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  const right0 = [Math.cos(y), 0, -Math.sin(y)];
  const down0 = [fwd[1] * right0[2] - fwd[2] * right0[1], fwd[2] * right0[0] - fwd[0] * right0[2], fwd[0] * right0[1] - fwd[1] * right0[0]];
  const right = right0.map((v, i) => v * Math.cos(r) + down0[i] * Math.sin(r));
  const down = down0.map((v, i) => v * Math.cos(r) - right0[i] * Math.sin(r));
  return [0, 1, 2].map((i) => [right[i], down[i], fwd[i], [x, h, z][i]]).concat([[0, 0, 0, 1]]);
}

const K = { fx: 500, fy: 500, cx: 360, cy: 640, width: 720, height: 1280, source: "scan" as const };
let frame = 0;
const view = (over: Partial<View> & { at?: [number, number]; yaw?: number; pitch?: number; roll?: number; h?: number } = {}): View => {
  const { at = [0, 0], yaw = 0, pitch = 0, roll = 0, h = 1.5, ...rest } = over;
  frame += 20;
  return {
    room: 1,
    frame,
    pose: pose(at[0], at[1], yaw, { h, pitch, roll }),
    intrinsics: K,
    heightM: h,
    pitchDeg: pitch,
    rollDeg: roll,
    sharpness: 200,
    seen: { floor: 0.3, wall: 0.3, near: 0.05 },
    ...rest,
  };
};

describe("best angles", () => {
  it("prefers a sharp frame", () => {
    const blurry = view({ sharpness: 40 }), sharp = view({ sharpness: 220, at: [0.01, 0] });
    expect(pickAngles([blurry, sharp], 1)[0].frame).toBe(sharp.frame);
  });

  it("prefers the wide view that sees more floor and wall", () => {
    const narrow = view({ seen: { floor: 0.05, wall: 0.06, near: 0.05 } }), wide = view({ seen: { floor: 0.35, wall: 0.3, near: 0.05 } });
    expect(pickAngles([narrow, wide], 1)[0].frame).toBe(wide.frame);
  });

  it("prefers eye height and a level phone", () => {
    const low = view({ h: 0.6 }), tipped = view({ pitch: -40 }), rolled = view({ roll: 15 }), level = view({ h: 1.45 });
    expect(pickAngles([low, tipped, rolled, level], 1)[0].frame).toBe(level.frame);
  });

  it("drops a view with something right in front of the lens", () => {
    const blocked = view({ seen: { floor: 0.4, wall: 0.4, near: 0.6 } }), clear = view({ seen: { floor: 0.3, wall: 0.3, near: 0.05 } });
    expect(pickAngles([blocked, clear], 1)[0].frame).toBe(clear.frame);
  });

  it("spreads the picks round the room, never neighbours in time", () => {
    // Ten near-identical views from one corner, and three weaker ones from elsewhere.
    const corner = Array.from({ length: 10 }, (_, i) => view({ at: [0.05 * i, 0], yaw: i, frame: 100 + i * 2 }));
    const others = [view({ at: [3, 2], yaw: 180, frame: 300, sharpness: 150 }), view({ at: [-3, 2], yaw: 90, frame: 400, sharpness: 150 }), view({ at: [0, 4], yaw: -90, frame: 500, sharpness: 150 })];
    const picked = pickAngles([...corner, ...others], 4);
    expect(picked).toHaveLength(4);
    expect(picked.filter((a) => a.frame < 200)).toHaveLength(1);
    for (const a of picked) for (const b of picked) if (a !== b) expect(Math.abs(a.frame - b.frame)).toBeGreaterThanOrEqual(10);
  });

  it("never pictures the design from inside its furniture, and prefers the views that show it", () => {
    const sofa: Furniture = { id: "sofa", kind: "sofa", at: [0, 3], rotDeg: 180, sizeM: [2.2, 0.95] };
    const inSofa = view({ at: [0, 3], yaw: 0 });
    const looksAway = view({ at: [0, 0], yaw: 180 });
    const looksAt = view({ at: [0.4, 1], yaw: 0, seen: { floor: 0.25, wall: 0.25, near: 0.05 } });
    expect(designInView(inSofa, [sofa]).blocked).toBe(true);
    expect(designInView(looksAt, [sofa]).shows).toEqual(["sofa"]);
    expect(designInView(looksAway, [sofa]).shows).toEqual([]);
    const picked = pickAngles([inSofa, looksAway, looksAt], 1, [sofa]);
    expect(picked[0].frame).toBe(looksAt.frame);
    expect(pickDesignAngles([inSofa, looksAway, looksAt], 3, [sofa]).map((a) => a.frame)).toEqual([looksAt.frame]);
  });
});

describe("views from an area's 3D", () => {
  // A 6 × 4 m room, 2.4 m high, measured by one level camera in the middle looking at the +x wall.
  const W = 60, H = 100;
  function syntheticArea() {
    const P = pose(0, 0, 90, { h: 1.5 });
    const model = { width: W, height: H, resizedWidth: W, resizedHeight: H + 2, cropLeft: 0, cropTop: 1 };
    const f = 40;
    const depth = new Uint16Array(W * H);
    const toHalf = (v: number) => {
      // float16 bits for positive v
      const e = Math.floor(Math.log2(v));
      return ((e + 15) << 10) | Math.round((v / 2 ** e - 1) * 1024);
    };
    for (let v = 0; v < H; v++) {
      for (let u = 0; u < W; u++) {
        const c = [(u - W / 2) / f, (v - H / 2) / f, 1];
        const d = [0, 1, 2].map((r) => P[r][0] * c[0] + P[r][1] * c[1] + P[r][2] * c[2]);
        // Distance along the ray (in camera-z units) to the first of the room's six planes.
        const ts = [d[0] > 0 ? (3 - 0) / d[0] : Infinity, d[0] < 0 ? (-3 - 0) / d[0] : Infinity, d[2] > 0 ? 2 / d[2] : Infinity, d[2] < 0 ? -2 / d[2] : Infinity, d[1] < 0 ? -1.5 / d[1] : Infinity, d[1] > 0 ? 0.9 / d[1] : Infinity];
        depth[v * W + u] = toHalf(Math.min(...ts));
      }
    }
    const scan = {
      room: { box: { min: [-3, 0, -2], max: [3, 2.4, 2] }, ceilingHeightM: 2.4 },
      files: { depth: { shape: [1, H, W] } },
      sentFrames: [42],
      frames: [{ sourceIndex: 0, width: 600, height: 1020, sharpness: 150, validFraction: 1, depthOffset: 0, model, intrinsics: [[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]], pose: P }],
    };
    return { scan, depth: new Uint8Array(depth.buffer) };
  }

  it("measures height, level, the floor and walls seen and nothing too close", () => {
    const { scan, depth } = syntheticArea();
    const [v] = viewsFromArea({ room: 2, scan, depth, placement: null, step: 1 });
    expect(v.frame).toBe(42);
    expect(v.heightM).toBeCloseTo(1.5, 5);
    expect(Math.abs(v.pitchDeg)).toBeLessThan(0.01);
    expect(Math.abs(v.rollDeg)).toBeLessThan(0.01);
    expect(v.seen.floor).toBeGreaterThan(0.02);
    expect(v.seen.wall).toBeGreaterThan(0.05);
    expect(v.seen.near).toBeLessThan(0.05);
    expect(v.depth?.z.some((z) => z < 99)).toBe(true);
  });

  it("turns the model's lens into the saved frame's pixels", () => {
    const K2 = frameIntrinsics({ width: 720, height: 1280, model: { resizedWidth: 294, resizedHeight: 522, cropLeft: 0, cropTop: 2 }, intrinsics: [[210, 0, 147], [0, 210, 259], [0, 0, 1]] });
    expect(K2.fx).toBeCloseTo((210 * 720) / 294, 6);
    expect(K2.cy).toBeCloseTo(((259 + 2) * 1280) / 522, 6);
  });

  it("places a room's camera in the basement frame and fills in a frame between kept ones", () => {
    const P = pose(1, 2, 0);
    const placed = placePose(P, { turn: 1, x: 10, z: 20 });
    expect(placed[0][3]).toBeCloseTo(-2 + 10, 6);
    expect(placed[2][3]).toBeCloseTo(1 + 20, 6);
    const mid = poseAt([{ frame: 10, room: 0, pose: pose(0, 0, 0) }, { frame: 12, room: 0, pose: pose(1, 0, 20) }], 11)!;
    expect(mid.pose[0][3]).toBeCloseTo(0.5, 6);
    expect(poseAt([{ frame: 10, room: 0, pose: P }], 30)).toBeNull();
  });
});

describe("the example", () => {
  it("picks the same angles every time, from frames it has, with the design in view", async () => {
    const a = await bestAngles("sample", 4);
    const b = await bestAngles("sample", 4);
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a.every((x) => x.intrinsics.width === 1280 && x.intrinsics.height === 720)).toBe(true);
    // Judged against the model's chosen design, as the pictures step draws it.
    const design = await designFor("sample");
    expect(design?.proposed.furniture.length).toBeGreaterThan(0);
    const own = await designAngles("sample", 4, design!.proposed.furniture);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((x) => x.shows.length > 0)).toBe(true);
  });
});
