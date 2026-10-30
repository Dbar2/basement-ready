import { describe, expect, it } from "vitest";
import { arkitToOpenCv, cameraAt, cleanCapture, uprightIntrinsics, type Capture } from "../../server/capture";

// Column-major 4x4 with a translation, like simd_float4x4.
const at = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

// Where a world point lands in the picture, through an OpenCV camera-to-world pose and a lens.
function project(pose: number[][], k: number[][], p: [number, number, number]) {
  const d = [0, 1, 2].map((i) => p[i] - pose[i][3]);
  const c = [0, 1, 2].map((j) => pose[0][j] * d[0] + pose[1][j] * d[1] + pose[2][j] * d[2]); // R^T (p - t)
  return { u: (k[0][0] * c[0]) / c[2] + k[0][2], v: (k[1][1] * c[1]) / c[2] + k[1][2], z: c[2] };
}

const lens = [1500, 1500, 960, 720]; // a 1920 x 1440 sensor
const size: [number, number] = [1920, 1440];

describe("ARKit camera to MapAnything's camera", () => {
  it("looks down -Z with y down when the phone is held as the sensor sits", () => {
    const pose = arkitToOpenCv(at(0, 1.5, 0), 0);
    const k = uprightIntrinsics(lens, size, 0, 1920);
    const ahead = project(pose, k, [0, 1.5, -2]);
    expect(ahead.z).toBeCloseTo(2, 9);
    expect(ahead.u).toBeCloseTo(960, 6);
    expect(ahead.v).toBeCloseTo(720, 6);
    // Higher in the world is higher in the picture (smaller v).
    expect(project(pose, k, [0, 2.0, -2]).v).toBeLessThan(720);
  });

  it("turns with the picture when the phone is held upright (portrait)", () => {
    const pose = arkitToOpenCv(at(0, 1.5, 0), 90);
    const k = uprightIntrinsics(lens, size, 90, 1280);
    // The picture is 960 x 1280 now; straight ahead is still its centre.
    const ahead = project(pose, k, [0, 1.5, -2]);
    expect(ahead.u).toBeCloseTo(480, 6);
    expect(ahead.v).toBeCloseTo(640, 6);
    // The sensor's right (ARKit +X) is down in an upright portrait picture.
    const right = project(pose, k, [0.5, 1.5, -2]);
    expect(right.v).toBeGreaterThan(640);
    expect(right.u).toBeCloseTo(480, 6);
  });

  it("scales the lens to the analysis frame", () => {
    expect(uprightIntrinsics(lens, size, 0, 1280)).toEqual([
      [1000, 0, 640],
      [0, 1000, 480],
      [0, 0, 1],
    ]);
  });
});

describe("matching analysis frames to ARKit records", () => {
  const capture = cleanCapture({
    version: 1,
    imageResolution: [1920, 1440],
    orientation: "portrait",
    frames: [
      { t: 0.0, transform: at(0, 1.5, 0), intrinsics: lens, tracking: "normal" },
      { t: 0.19, transform: at(0.1, 1.5, 0), intrinsics: lens, tracking: "normal" },
      { t: 0.41, transform: at(0.2, 1.5, 0), intrinsics: lens, tracking: "limited:excessiveMotion" },
      { t: 1.0, transform: at(0.3, 1.5, 0), intrinsics: lens, tracking: "normal" },
    ],
  }) as Capture;

  it("checks the capture and reads portrait as a quarter turn", () => {
    expect(capture.rotationCW).toBe(90);
    expect(cleanCapture({ version: 2, imageResolution: [1, 1], frames: [] })).toBeNull();
  });

  it("takes the nearest tracked record, and none when tracking was lost or too far away", () => {
    expect(cameraAt(capture, 1, 5, 1280)!.pose[0][3]).toBeCloseTo(0.1, 9); // 0.2 s -> 0.19 s
    expect(cameraAt(capture, 2, 5, 1280)).toBeNull(); // 0.4 s -> limited tracking
    expect(cameraAt(capture, 3, 5, 1280)).toBeNull(); // 0.6 s -> nearest is the 0.41 s record, with lost tracking
    expect(cameraAt(capture, 5, 5, 1280)!.pose[0][3]).toBeCloseTo(0.3, 9);
  });
});
