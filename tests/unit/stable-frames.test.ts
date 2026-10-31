import { describe, expect, it } from "vitest";
import { pickFrames, type FrameView } from "../../server/concepts";
import { pickAngles, pickDesignAngles, type View } from "../../server/views/angles";
import { beforeUrl } from "../../server/views/routes";
import { frameQuality, heightsAlong, levelOf, lookOf, motionOf, pathUp, rotationDeg } from "../../server/views/stable";
import { layoutCamera } from "../../src/views/layoutCamera";

const rad = (d: number) => (d * Math.PI) / 180;
// A camera at (x, h, z) looking along yaw (0 = +z), tipped by pitch (up positive) and roll, as an OpenCV
// camera-to-room pose: columns are the camera's x (right), y (down), z (forward).
function pose(x: number, z: number, yaw: number, { h = 1.5, pitch = 0, roll = 0 } = {}) {
  const y = rad(yaw), p = rad(pitch), r = rad(roll);
  const fwd = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  const right0 = [Math.cos(y), 0, -Math.sin(y)];
  const down0 = [fwd[1] * right0[2] - fwd[2] * right0[1], fwd[2] * right0[0] - fwd[0] * right0[2], fwd[0] * right0[1] - fwd[1] * right0[0]];
  const right = right0.map((v, i) => v * Math.cos(r) + down0[i] * Math.sin(r));
  const down = down0.map((v, i) => v * Math.cos(r) - right0[i] * Math.sin(r));
  return [0, 1, 2].map((i) => [right[i], down[i], fwd[i], [x, h, z][i]]).concat([[0, 0, 0, 1]]);
}
// The same pose in a 3D whose up is tipped `tilt` degrees about the x axis (as a slanted measuring makes).
function tipped(P: number[][], tilt: number) {
  const c = Math.cos(rad(tilt)), s = Math.sin(rad(tilt));
  const R = [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
  const out = [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => R[i][0] * P[0][j] + R[i][1] * P[1][j] + R[i][2] * P[2][j]));
  return [...out, [0, 0, 0, 1]];
}

describe("which frames are fit to picture", () => {
  it("measures how fast the camera turned, and how sharp a frame is against the ones around it", () => {
    // Kept every second frame (0.4 s apart): steady at first, then swinging round 20° a frame.
    const yaws = [0, 1, 2, 3, 23, 43, 63, 64, 65];
    const frames = yaws.map((yaw, i) => ({ frame: i * 2, pose: pose(0, 0, yaw), sharpness: i === 5 ? 60 : 200 }));
    const m = motionOf(frames);
    expect(m.get(2)!.turnDegS).toBeCloseTo(2 / 0.8, 5);
    expect(m.get(10)!.turnDegS).toBeCloseTo(40 / 0.8, 5);
    expect(m.get(10)!.sharpRel).toBeCloseTo(60 / 200, 5);
    expect(m.get(0)!.sharpRel).toBe(1);
    expect(rotationDeg(pose(0, 0, 0), pose(0, 0, 0, { roll: 10 }))).toBeCloseTo(10, 5);
  });

  it("reads light and detail from a frame's grey pixels", () => {
    const w = 32, h = 32;
    const flat = new Uint8Array(w * h).fill(128);
    const checks = Uint8Array.from({ length: w * h }, (_, i) => (((i % w) + Math.floor(i / w)) % 2 ? 200 : 60));
    const dark = new Uint8Array(w * h).fill(8);
    expect(lookOf(flat, w, h)).toMatchObject({ mean: 128, dark: 0, bright: 0, lap: 0 });
    expect(lookOf(checks, w, h).lap).toBeGreaterThan(1000);
    expect(lookOf(dark, w, h).dark).toBe(1);
  });

  it("never pictures a frame that leans, is tipped, swings round, is blurrier than its neighbours, dark or blown out", () => {
    const good = { heightM: 1.5, pitchDeg: -5, rollDeg: 0.5, motion: { turnDegS: 4, sharpRel: 1.05 }, look: { mean: 120, dark: 0.01, bright: 0.01, lap: 800 } };
    expect(frameQuality(good, 900).ok).toBe(true);
    const bad = [
      { ...good, rollDeg: 8 },
      { ...good, pitchDeg: -32 },
      { ...good, motion: { turnDegS: 60, sharpRel: 1 } },
      { ...good, motion: { turnDegS: 4, sharpRel: 0.5 } },
      { ...good, look: { ...good.look, mean: 30, dark: 0.6 } },
      { ...good, look: { ...good.look, mean: 230, bright: 0.4 } },
      { ...good, heightM: 0.5 },
    ];
    for (const b of bad) expect(frameQuality(b, 900)).toMatchObject({ ok: false, score: 0 });
    expect(frameQuality(bad[2], 900).why).toContain("turning 60°/s");
    // Each fault on its own a little: still fit, but less so; all at once: not.
    const meh = { ...good, pitchDeg: -18, motion: { turnDegS: 25, sharpRel: 0.75 }, look: { ...good.look, mean: 60 } };
    expect(frameQuality(meh, 900).ok).toBe(false);
    expect(frameQuality({ ...good, pitchDeg: -12 }, 900).score).toBeLessThan(frameQuality(good, 900).score);
  });

  it("finds up from the camera path when the 3D was measured on a slant, and keeps the 3D's when it was level", () => {
    // A level phone panned round a room, at one height, in a 3D tipped 14°.
    const level = Array.from({ length: 30 }, (_, i) => pose(Math.cos(i / 5), Math.sin(i / 5), i * 4 - 60, { pitch: -10 }));
    const slanted = level.map((P) => tipped(P, 14));
    const up = pathUp(slanted)!;
    expect(up).not.toBeNull();
    const P = slanted[0]; // turned 60° off the tilt's axis, where the slant shows most as lean
    expect(Math.abs(levelOf(P).rollDeg)).toBeGreaterThan(3); // against the 3D's up it seems to lean
    expect(Math.abs(levelOf(P, up).rollDeg)).toBeLessThan(0.5); // against the path's own, it doesn't
    expect(levelOf(P, up).pitchDeg).toBeCloseTo(-10, 0);
    // And its height, measured along the path's up, doesn't rise and fall as it turns.
    const height = heightsAlong(slanted, up);
    const hs = slanted.map(height);
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(0.02);
    // Measured level, the path agrees with the 3D's up to well under a degree.
    const flat = pathUp(level);
    expect(flat === null || Math.acos(flat[1]) < rad(1)).toBe(true);
    // A phone held crooked the whole way round isn't a slanted 3D: its lean stays.
    const crooked = Array.from({ length: 30 }, (_, i) => pose(Math.cos(i / 5), Math.sin(i / 5), i * 12, { roll: 9 }));
    const u = pathUp(crooked);
    expect(Math.abs(levelOf(crooked[3], u).rollDeg)).toBeGreaterThan(6);
  });
});

describe("the frames pictures are made from", () => {
  const K = { fx: 500, fy: 500, cx: 360, cy: 640, width: 720, height: 1280, source: "scan" as const };
  let n = 0;
  const view = (room: number, over: Partial<View> & { at?: [number, number]; yaw?: number } = {}): View => {
    const { at = [0, 0], yaw = 0, ...rest } = over;
    n += 20;
    return {
      room,
      frame: n,
      pose: pose(at[0], at[1], yaw),
      intrinsics: K,
      heightM: 1.5,
      pitchDeg: -4,
      rollDeg: 0,
      sharpness: 200,
      seen: { floor: 0.3, wall: 0.3, near: 0.05 },
      motion: { turnDegS: 5, sharpRel: 1 },
      look: { mean: 120, dark: 0.01, bright: 0.01, lap: 800 },
      ...rest,
    };
  };

  it("skips a room with no frame fit to picture rather than show a bad one", () => {
    const fine = [view(0), view(0, { at: [3, 2], yaw: 180 })];
    const swinging = [view(1, { motion: { turnDegS: 80, sharpRel: 0.6 } }), view(1, { rollDeg: 9, at: [2, 0] }), view(1, { look: { mean: 25, dark: 0.7, bright: 0, lap: 50 }, at: [0, 3] })];
    const picked = pickAngles([...fine, ...swinging], 4);
    expect(picked.map((a) => a.room)).toEqual([0, 0]);
    expect(picked.every((a) => a.why.length > 0)).toBe(true);
  });

  it("keeps a room's best spot and no weak ones to make up the numbers", () => {
    const best = view(0, { seen: { floor: 0.4, wall: 0.4, near: 0.02 } });
    const weak = view(0, { at: [3, 3], yaw: 180, seen: { floor: 0.06, wall: 0.05, near: 0.05 } });
    expect(pickAngles([best, weak], 5).map((a) => a.frame)).toEqual([best.frame]);
  });

  it("never pictures the design from a frame that isn't fit, however much of it shows", () => {
    const sofa = { id: "sofa", kind: "sofa" as const, at: [0, 3] as [number, number], rotDeg: 180, sizeM: [2.2, 0.95] as [number, number] };
    const blurred = view(0, { at: [0, 0.5], motion: { turnDegS: 70, sharpRel: 0.5 } });
    const steady = view(0, { at: [0.6, 0.2], seen: { floor: 0.2, wall: 0.2, near: 0.05 } });
    expect(pickDesignAngles([blurred, steady], 3, [sofa]).map((a) => a.frame)).toEqual([steady.frame]);
  });

  it("gives every picture the frame it was made from, as its before", () => {
    expect(beforeUrl("sample", "0-0042")).toBe("/samples/sample/frames/0042.jpg");
    expect(beforeUrl("4a3f7e2c-0000-4000-8000-000000000000", "2-0413")).toBe("/api/scans/4a3f7e2c-0000-4000-8000-000000000000/frames/413");
  });

  it("finishes a concept photo only from a fit frame, and makes none where the 3D saw no fit one", () => {
    const views = new Map<number, FrameView>([
      [100, { depthM: 5, tilt: 0.1, area: 0, fit: false }], // the widest, but blurred
      [104, { depthM: 3, tilt: 0.1, area: 0, fit: true }],
      [300, { depthM: 6, tilt: 0.1, area: 1, fit: false }],
    ]);
    const vision = { rooms: [{ room: "office", atSeconds: 20.4 }, { room: "gym", atSeconds: 60 }] };
    const picks = pickFrames([], vision, "unsure", 600, null, views);
    expect(picks.find((p) => p.title === "Office")?.frame).toBe(104);
    expect(picks.some((p) => p.title === "Gym")).toBe(false);
    expect(picks.some((p) => p.frame === 100 || p.frame === 300)).toBe(false);
  });
});

describe("the layout card's camera", () => {
  it("sees the whole basement from above at an angle, its long side across the picture", () => {
    const box = { minX: -4, maxX: 6, minZ: -2, maxZ: 3, height: 2.3 };
    const shot = layoutCamera(box, 4 / 3);
    const [x, y, z] = shot.position;
    const [tx, ty, tz] = shot.target;
    const el = Math.atan2(y - ty, Math.hypot(x - tx, z - tz));
    expect(el).toBeCloseTo(rad(55), 3);
    // Looking across the shorter (z) side: the camera stands off the long side.
    expect(Math.abs(z - tz)).toBeGreaterThan(Math.abs(x - tx));
    // Every corner of the basement is in the picture.
    const fwd = [tx - x, ty - y, tz - z];
    const len = Math.hypot(...fwd);
    const f = fwd.map((v) => v / len);
    const right = [-f[2], 0, f[0]].map((v) => v / Math.hypot(f[0], f[2]));
    const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
    const tanY = Math.tan(rad(shot.fovDeg / 2)), tanX = tanY * (4 / 3);
    for (const cx of [box.minX, box.maxX])
      for (const cy of [0, box.height])
        for (const cz of [box.minZ, box.maxZ]) {
          const q = [cx - x, cy - y, cz - z];
          const d = q[0] * f[0] + q[1] * f[1] + q[2] * f[2];
          expect(Math.abs((q[0] * right[0] + q[1] * right[1] + q[2] * right[2]) / d)).toBeLessThanOrEqual(tanX);
          expect(Math.abs((q[0] * up[0] + q[1] * up[1] + q[2] * up[2]) / d)).toBeLessThanOrEqual(tanY);
        }
  });
});
