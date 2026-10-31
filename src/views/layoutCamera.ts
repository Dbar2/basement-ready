// Where the camera stands for a layout card's picture (src/views/LayoutShotCanvas.tsx): above the
// basement at an angle, like the studio's overview (src/studio/Studio3D.tsx), the long side of the
// basement across the picture, near enough that the whole of it just fits. Pure, so it's tested.
export type Box3 = { minX: number; maxX: number; minZ: number; maxZ: number; height: number };
export type Shot = { position: [number, number, number]; target: [number, number, number]; fovDeg: number };

const ELEVATION = 55; // degrees above the floor the camera looks down from
const SKEW = 20; // degrees round from square-on, so the walls show some depth
const MARGIN = 0.9; // the basement fills this much of the picture at most, each way

export function layoutCamera(b: Box3, aspect: number, fovDeg = 35): Shot {
  // Aimed at the basement's middle, a third of the way up its walls.
  const centre: [number, number, number] = [(b.minX + b.maxX) / 2, b.height / 3, (b.minZ + b.maxZ) / 2];
  // Looking across the shorter side, so the longer one runs along the picture.
  const along = b.maxX - b.minX >= b.maxZ - b.minZ ? 0 : 90;
  const az = ((along + SKEW) * Math.PI) / 180, el = (ELEVATION * Math.PI) / 180;
  const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]; // from the centre to the camera
  // The camera's own axes: forward (towards the centre), right, up.
  const fwd = dir.map((x) => -x);
  const right = norm([-fwd[2], 0, fwd[0]]);
  const up = cross(right, fwd);
  const tanY = Math.tan((fovDeg * Math.PI) / 360), tanX = tanY * aspect;
  const corners = [b.minX, b.maxX].flatMap((x) => [0, b.height].flatMap((y) => [b.minZ, b.maxZ].map((z) => [x - centre[0], y - centre[1], z - centre[2]])));
  // The nearest distance at which every corner is inside the picture, with the margin.
  const fits = (d: number) =>
    corners.every((p) => {
      const q = [p[0] - dir[0] * d, p[1] - dir[1] * d, p[2] - dir[2] * d];
      const z = dot(q, fwd);
      return z > 0.1 && Math.abs(dot(q, right) / z) <= tanX * MARGIN && Math.abs(dot(q, up) / z) <= tanY * MARGIN;
    });
  let lo = 0.5, hi = 200;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return { position: [centre[0] + dir[0] * hi, centre[1] + dir[1] * hi, centre[2] + dir[2] * hi], target: centre, fovDeg };
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return a.map((x) => x / l);
};
