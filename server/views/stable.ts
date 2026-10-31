// Which filmed frames are fit to make a picture from: steady (the phone wasn't swinging round, so no
// motion blur), sharp against the frames filmed just before and after it (which see much the same
// thing: the painter judges blur the same way, services/scan3d/scan3d/texture.py), level (little roll
// or tilt), well exposed (not dark, not blown out by the lights) and at eye height. A frame that fails
// any of these is never pictured: a room with no good frame gets no picture rather than a bad one.
//
// Pure: the poses and sharpness come from the 3D (server/views/angles.ts), what a frame looks like from
// a small grey copy of it (server/views/looks.ts).

export const FPS = 5; // frames are cut from the video at 5 a second (server/pipeline.ts)

// A frame's light and detail, from a small grey copy: mean brightness 0..255, the shares of pixels
// near black and near white, and the variance of its Laplacian (detail: blur lowers it).
export type Look = { mean: number; dark: number; bright: number; lap: number };

// How the camera moved around a frame: how fast it turned (degrees a second, between the frames
// filmed just before and after) and how sharp it is against those neighbours (1: as sharp as they are).
export type Motion = { turnDegS: number | null; sharpRel: number | null };

export type Quality = { score: number; ok: boolean; why: string };

const NEIGHBOURS = 3; // frames either side, in filming order, a frame's sharpness is judged against
const GAP_S = 2; // further apart than this, two kept frames don't say how fast the camera turned
const SHARP_GAP_S = 1.5; // or see enough of the same thing to compare their sharpness

// The limits: past any of these, no picture from this frame.
export const LIMITS = {
  rollDeg: 6, // a picture leaning more than this looks crooked
  pitchDeg: 25, // tipped further up or down, the walls lean in (worse on a wide lens)
  turnDegS: 30, // swinging round faster than this smears the frame
  sharpRel: 0.7, // blurrier than its neighbours by more than this
  dark: 0.45, // more than this share of the picture near black
  bright: 0.25, // or blown out near white
  meanLo: 45,
  meanHi: 215,
  heightLo: 0.9,
  heightHi: 2.2,
  score: 0.3, // and all told, at least this fit (a frame tipped, turning and dim at once isn't)
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// 1 inside [lo, hi], falling to 0 `soft` outside it.
const band = (x: number, lo: number, hi: number, soft: number) => (x >= lo && x <= hi ? 1 : Math.max(0, 1 - (x < lo ? lo - x : x - hi) / soft));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

// How far a camera turned between two poses, in degrees: the larger of how far its view swung (its
// forward axis) and how far it rolled about it (its sideways axis), so panning, tipping and rolling all
// count.
export function rotationDeg(A: number[][], B: number[][]) {
  const angle = (j: number) => {
    const a = [A[0][j], A[1][j], A[2][j]], b = [B[0][j], B[1][j], B[2][j]];
    const la = Math.hypot(a[0], a[1], a[2]), lb = Math.hypot(b[0], b[1], b[2]);
    if (la < 0.5 || lb < 0.5) return 0;
    return (Math.acos(clamp((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb), -1, 1)) * 180) / Math.PI;
  };
  return Math.max(angle(2), angle(0));
}

// Which way is up, from the camera path itself: a phone is held with its sideways axis level (roll near
// 0) however it's tipped or turned, so up is the direction the cameras' sideways axes are most nearly
// square to (the smallest eigenvector of Σ r rᵀ). Frames rolled a long way (turned to landscape, say)
// are left out and the fit made again. Null when the path can't tell (too few frames, or all facing one
// way) or it disagrees with the 3D's own up by more than 12° without the cameras' heights backing it (a
// 3D measured on a slant has the camera rise and fall as it turns; filmed level, it stays at one height):
// then the 3D's up stands.
export function pathUp(poses: number[][][]): [number, number, number] | null {
  const right = (P: number[][]): [number, number, number] => [P[0][0], P[1][0], P[2][0]];
  let up: [number, number, number] = [0, 1, 0];
  let keep = poses.map(right);
  for (let round = 0; round < 3; round++) {
    keep = poses.map(right).filter((r) => Math.abs(r[0] * up[0] + r[1] * up[1] + r[2] * up[2]) < 0.35);
    if (keep.length < 8) return null;
    // Σ r rᵀ, and its smallest eigenvector by inverse iteration on (M + εI).
    const M = [0, 1, 2].map((i) => [0, 1, 2].map((k) => keep.reduce((s, r) => s + r[i] * r[k], 0) / keep.length));
    const eig = smallestEigen(M);
    if (!eig) return null;
    const [vec, vals] = eig;
    // The sideways axes must spread round the room for the fit to mean anything.
    if (vals[1] < 0.08) return null;
    up = (vec[1] < 0 ? vec.map((x) => -x) : vec) as [number, number, number];
  }
  const off = Math.acos(clamp(up[1], -1, 1)) * (180 / Math.PI);
  if (off <= 12) return up;
  const sd = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + (x - xs.reduce((a, b) => a + b, 0) / xs.length) ** 2, 0) / xs.length);
  const along = (u: number[]) => sd(poses.map((P) => P[0][3] * u[0] + P[1][3] * u[1] + P[2][3] * u[2]));
  return off <= 25 && along(up) <= 0.6 * along([0, 1, 0]) ? up : null;
}

// The cameras' heights measured along `up`, about the same middle as the 3D's own heights.
export function heightsAlong(poses: number[][][], up: [number, number, number] | null): (P: number[][]) => number {
  if (!up || up[1] > 0.9998) return (P) => P[1][3];
  const along = (P: number[][]) => P[0][3] * up[0] + P[1][3] * up[1] + P[2][3] * up[2];
  const mid = median(poses.map(along)) - median(poses.map((P) => P[1][3]));
  return (P) => along(P) - mid;
}

// The eigenvector of a symmetric 3×3's smallest eigenvalue, and its two smallest eigenvalues.
function smallestEigen(M: number[][]): [number[], [number, number]] | null {
  // Jacobi rotations.
  const A = M.map((r) => [...r]);
  const V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += A[p][q] ** 2;
    if (off < 1e-14) break;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = [0, 1, 2].sort((a, b) => A[a][a] - A[b][b]);
  const vec = [V[0][order[0]], V[1][order[0]], V[2][order[0]]];
  const n = Math.hypot(...vec);
  return n > 0 ? [vec.map((x) => x / n), [A[order[0]][order[0]], A[order[1]][order[1]]]] : null;
}

// Pitch (up positive) and roll of a camera-to-room pose, against `up` (the room's +y without one).
export function levelOf(P: number[][], up: [number, number, number] | null = null) {
  const u = up ?? [0, 1, 0];
  const dot = (j: number) => P[0][j] * u[0] + P[1][j] * u[1] + P[2][j] * u[2];
  const deg = (r: number) => (r * 180) / Math.PI;
  return { pitchDeg: deg(Math.asin(clamp(dot(2), -1, 1))), rollDeg: deg(Math.asin(clamp(dot(0), -1, 1))) };
}

// Each kept frame's motion, from the frames kept around it in filming order (one area's, or one
// camera path's). `sharpness`: the 3D service's variance of the Laplacian, null where unknown.
export function motionOf(frames: { frame: number; pose: number[][]; sharpness: number | null }[], fps = FPS): Map<number, Motion> {
  const list = [...new Map(frames.map((f) => [f.frame, f])).values()].sort((a, b) => a.frame - b.frame);
  const out = new Map<number, Motion>();
  list.forEach((f, i) => {
    const near = (j: number) => (j >= 0 && j < list.length && Math.abs(list[j].frame - f.frame) / fps <= GAP_S ? list[j] : null);
    const a = near(i - 1) ?? f, b = near(i + 1) ?? f;
    const dt = (b.frame - a.frame) / fps;
    const turnDegS = dt > 0 ? rotationDeg(a.pose, b.pose) / dt : null;
    // Against the frames filmed just before and after it; with none close enough, unknown.
    let sharpRel: number | null = null;
    if (f.sharpness != null) {
      const around = list.slice(Math.max(0, i - NEIGHBOURS), i + NEIGHBOURS + 1).filter((g) => g.sharpness != null && Math.abs(g.frame - f.frame) / fps <= SHARP_GAP_S);
      const m = median(around.map((g) => g.sharpness!));
      sharpRel = around.length > 1 && m > 0 ? f.sharpness / m : null;
    }
    out.set(f.frame, { turnDegS, sharpRel });
  });
  return out;
}

// A frame's look from its grey pixels (row by row, `w` wide).
export function lookOf(gray: ArrayLike<number>, w: number, h: number): Look {
  let sum = 0, dark = 0, bright = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const g = gray[i];
    sum += g;
    if (g < 20) dark++;
    else if (g > 245) bright++;
  }
  let ls = 0, ls2 = 0, m = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      ls += l;
      ls2 += l * l;
      m++;
    }
  const lm = m ? ls / m : 0;
  return { mean: n ? sum / n : 0, dark: n ? dark / n : 0, bright: n ? bright / n : 0, lap: m ? ls2 / m - lm * lm : 0 };
}

// What a room's sharp frames look like: the upper quartile of its frames' detail.
export function roomDetail(looks: (Look | null | undefined)[]) {
  const laps = looks.flatMap((l) => (l ? [l.lap] : [])).sort((a, b) => a - b);
  return laps.length ? laps[Math.floor(laps.length * 0.75)] : null;
}

// How fit a frame is to picture, 0..1, whether it may be pictured at all, and why. Unknowns (no
// sharpness from the 3D, no look yet) neither help nor count against it. `sharpRoom`: its sharpness
// against the room's middling frame, which counts a little (a plain wall is never very "sharp").
export function frameQuality(v: { heightM: number; pitchDeg: number; rollDeg: number; motion?: Motion | null; look?: Look | null; sharpRoom?: number | null }, detail: number | null = null): Quality {
  const roll = Math.abs(v.rollDeg), pitch = Math.abs(v.pitchDeg);
  const turn = v.motion?.turnDegS ?? null, rel = v.motion?.sharpRel ?? null;
  const look = v.look ?? null;
  const fails: string[] = [];
  if (roll > LIMITS.rollDeg) fails.push(`leans ${Math.round(roll)}°`);
  if (pitch > LIMITS.pitchDeg) fails.push(`tipped ${Math.round(pitch)}°`);
  if (v.heightM < LIMITS.heightLo || v.heightM > LIMITS.heightHi) fails.push(`${v.heightM.toFixed(1)} m up`);
  if (turn != null && turn > LIMITS.turnDegS) fails.push(`turning ${Math.round(turn)}°/s`);
  if (rel != null && rel < LIMITS.sharpRel) fails.push(`blurrier than the frames around it`);
  if (look && (look.mean < LIMITS.meanLo || look.dark > LIMITS.dark)) fails.push("too dark");
  if (look && (look.mean > LIMITS.meanHi || look.bright > LIMITS.bright)) fails.push("blown out");

  const level = band(pitch, 0, 8, 20) * band(roll, 0, 1.5, 6);
  const height = band(v.heightM, 1.1, 1.8, 0.5);
  const steady = turn == null ? 1 : band(turn, 0, 8, 30);
  // Detail against the room's sharpest frames counts only a little: a plain wall has little detail
  // however sharp it is (a whole blurry pan is caught by how fast the camera turned).
  const sharp = (rel == null ? 1 : clamp(rel, 0, 1) ** 2) * (look && detail ? Math.sqrt(clamp(look.lap / detail, 0.5, 1)) : 1) * (v.sharpRoom == null ? 1 : 0.4 + 0.6 * clamp(v.sharpRoom, 0, 1) ** 1.5);
  const exposed = look ? band(look.mean, 80, 170, 70) * (1 - clamp((look.dark + look.bright - 0.05) / 0.4, 0, 1)) : 1;
  const score = level * height * (0.3 + 0.7 * steady) * (0.3 + 0.7 * sharp) * (0.4 + 0.6 * exposed);
  if (!fails.length && score < LIMITS.score) fails.push(`only ${Math.round(score * 100)}% fit to picture`);
  const why = [
    `${v.heightM.toFixed(2)} m up`,
    `pitch ${v.pitchDeg.toFixed(0)}°, roll ${v.rollDeg.toFixed(0)}°`,
    turn == null ? null : `turning ${Math.round(turn)}°/s`,
    rel == null ? null : `${Math.round(clamp(rel, 0, 9) * 100)}% as sharp as the frames around it`,
    look ? `brightness ${Math.round(look.mean)}${look.dark + look.bright > 0.05 ? `, ${Math.round((look.dark + look.bright) * 100)}% clipped` : ""}` : null,
    fails.length ? `not pictured: ${fails.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { score: fails.length ? 0 : score, ok: fails.length === 0, why };
}
