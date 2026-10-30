// What the iPhone app sends with a take (docs/capture-contract.md): ARKit's camera position and lens
// for every frame. Each 5 fps analysis frame gets the nearest tracked record, turned into what
// MapAnything takes: OpenCV camera-to-world (x right, y down, z forward) in ARKit's gravity-aligned
// world, and the lens in pixels of the upright 1280 px frame.

export type CaptureFrame = { t: number; transform: number[]; intrinsics: [number, number, number, number]; tracking: string };
export type Capture = {
  version: 1;
  device?: string;
  lens?: string;
  imageResolution: [number, number]; // the sensor's landscape size
  orientation?: "portrait" | "portraitUpsideDown" | "landscapeRight" | "landscapeLeft";
  rotationCW?: 0 | 90 | 180 | 270;
  frames: CaptureFrame[];
};

// What the 3D service gets for one frame.
export type KnownCamera = { intrinsics: number[][]; pose: number[][] };

type M4 = number[][];

const ORIENTATION_CW = { landscapeRight: 0, portrait: 90, landscapeLeft: 180, portraitUpsideDown: 270 } as const;

// A checked capture, or null if it isn't one we can use.
export function cleanCapture(raw: unknown): Capture | null {
  try {
    const c = (typeof raw === "string" ? JSON.parse(raw) : raw) as Capture;
    if (!c || c.version !== 1 || !Array.isArray(c.frames) || !Array.isArray(c.imageResolution)) return null;
    const [w, h] = c.imageResolution.map(Number);
    if (!(w > 0 && h > 0)) return null;
    const frames = c.frames.filter(
      (f) => Number.isFinite(f?.t) && Array.isArray(f.transform) && f.transform.length === 16 && f.transform.every(Number.isFinite) && Array.isArray(f.intrinsics) && f.intrinsics.length === 4 && f.intrinsics.every((v) => Number(v) > 0),
    );
    if (frames.length < 2) return null;
    const rotationCW = c.rotationCW ?? (c.orientation ? ORIENTATION_CW[c.orientation] : 0);
    if (![0, 90, 180, 270].includes(rotationCW)) return null;
    return { ...c, imageResolution: [w, h], rotationCW, frames: frames.sort((a, b) => a.t - b.t) };
  } catch {
    return null;
  }
}

// Column-major 16 numbers (simd_float4x4) to rows.
function rows(m: number[]): M4 {
  return [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => m[c * 4 + r]));
}

const mul = (a: M4, b: M4): M4 => a.map((row) => b[0].map((_, c) => row.reduce((s, v, k) => s + v * b[k][c], 0)));

// The camera axes after the picture is turned upright, as a 4x4 acting on camera coordinates:
// x_new = R x_old. 90° clockwise: right in the new picture is up in the sensor's (x' = -y), down is the
// sensor's right (y' = x).
function turnAxes(cw: number): M4 {
  const r = cw === 90 ? [[0, -1], [1, 0]] : cw === 180 ? [[-1, 0], [0, -1]] : cw === 270 ? [[0, 1], [-1, 0]] : [[1, 0], [0, 1]];
  return [
    [r[0][0], r[0][1], 0, 0],
    [r[1][0], r[1][1], 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

const transpose = (m: M4): M4 => m[0].map((_, c) => m.map((row) => row[c]));

// ARKit camera-to-world -> OpenCV camera-to-world for the upright picture.
export function arkitToOpenCv(transform: number[], rotationCW: number): M4 {
  const flip = [
    [1, 0, 0, 0],
    [0, -1, 0, 0],
    [0, 0, -1, 0],
    [0, 0, 0, 1],
  ];
  // x_cam_old = R^T x_cam_new, so world = T · flip · R^T.
  return mul(mul(rows(transform), flip), transpose(turnAxes(rotationCW)));
}

// The lens for the upright picture, scaled so its long side is `longSide` pixels.
export function uprightIntrinsics([fx, fy, cx, cy]: number[], [w, h]: [number, number], rotationCW: number, longSide: number): number[][] {
  let k: [number, number, number, number];
  if (rotationCW === 90) k = [fy, fx, h - cy, cx];
  else if (rotationCW === 180) k = [fx, fy, w - cx, h - cy];
  else if (rotationCW === 270) k = [fy, fx, cy, w - cx];
  else k = [fx, fy, cx, cy];
  const s = longSide / Math.max(w, h);
  return [
    [k[0] * s, 0, k[2] * s],
    [0, k[1] * s, k[3] * s],
    [0, 0, 1],
  ];
}

// The known camera for analysis frame n (at `fps`), from the nearest tracked record within `maxGapS`.
export function cameraAt(capture: Capture, n: number, fps: number, longSide: number, maxGapS = 0.1): KnownCamera | null {
  const t = n / fps;
  const frames = capture.frames;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const near = [frames[lo - 1], frames[lo]].filter(Boolean).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  if (!near || Math.abs(near.t - t) > maxGapS || near.tracking !== "normal") return null;
  const cw = capture.rotationCW ?? 0;
  return { intrinsics: uprightIntrinsics(near.intrinsics, capture.imageResolution, cw, longSide), pose: arkitToOpenCv(near.transform, cw) };
}

// The phone's camera for each of our analysis frames, from the capture stored with a scan; undefined
// when the take didn't come from the app. `read` returns the stored file's text, or null.
export async function cameraLookup(read: () => Promise<string | null>, fps: number, longSide = 1280) {
  const text = await read().catch(() => null);
  const capture = text ? cleanCapture(text) : null;
  return capture ? (n: number) => cameraAt(capture, n, fps, longSide) : undefined;
}
