// Lifting SAM boxes into the room (formula from services/scan3d/README.md). Pure: the web app reaches
// this through server/plan.ts and server/layout.ts, so it must not import anything from Node.

export function half(bits: number) {
  const e = (bits >> 10) & 0x1f;
  const m = bits & 0x3ff;
  const s = bits & 0x8000 ? -1 : 1;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

type Box = { x: number; y: number; w: number; h: number };

// Room-frame points (metres) under a box on one scan frame; percentiles per axis.
export function liftBox(scan: any, depth: ArrayBuffer, scanFrame: number, box: Box, erodePx = 2) {
  const f = scan.frames[scanFrame];
  const [, H, W] = scan.files.depth.shape;
  const m = f.model;
  const u0 = Math.max(0, Math.ceil(box.x * m.resizedWidth - m.cropLeft) + erodePx);
  const v0 = Math.max(0, Math.ceil(box.y * m.resizedHeight - m.cropTop) + erodePx);
  const u1 = Math.min(W - 1, Math.floor((box.x + box.w) * m.resizedWidth - m.cropLeft) - erodePx);
  const v1 = Math.min(H - 1, Math.floor((box.y + box.h) * m.resizedHeight - m.cropTop) - erodePx);
  const [[fx, , cx], [, fy, cy]] = f.intrinsics;
  const P = f.pose;
  const view = new DataView(depth, f.depthOffset, H * W * 2);
  const pts: number[][] = [];
  for (let v = v0; v <= v1; v++) {
    for (let u = u0; u <= u1; u++) {
      const z = half(view.getUint16((v * W + u) * 2, true));
      if (!(z > 0)) continue;
      const c = [((u - cx) * z) / fx, ((v - cy) * z) / fy, z];
      pts.push([0, 1, 2].map((r) => P[r][0] * c[0] + P[r][1] * c[1] + P[r][2] * c[2] + P[r][3]));
    }
  }
  if (pts.length < 20) return null;
  const pct = (q: number) =>
    [0, 1, 2].map((a) => {
      const s = pts.map((p) => p[a]).sort((x, y) => x - y);
      return s[Math.min(s.length - 1, Math.floor(q * s.length))];
    });
  return { count: pts.length, median: pct(0.5), p05: pct(0.05), p95: pct(0.95) };
}
