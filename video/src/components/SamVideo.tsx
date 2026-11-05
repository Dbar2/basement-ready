import React from "react";
import { OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { FIND, C } from "../theme";
import { MONO } from "../fonts";
import sample from "../data/sample.json";

// The example video with SAM 3.1's real tracks drawn over it (public/samples/sample/result.json:
// boxes for 60 frames sampled at 5 per second from the 12 s video).
type Track = [number, number, number, number, number];
const DETS = sample.detections as { id: string; kind: string; label: string; track: Track[] }[];

export const boxesAt = (t: number) => {
  const fi = t * 5;
  const out: { id: string; kind: string; label: string; x: number; y: number; w: number; h: number }[] = [];
  for (const d of DETS) {
    const tr = d.track;
    if (!tr.length || fi < tr[0][0] - 0.5 || fi > tr[tr.length - 1][0] + 0.5) continue;
    let a = tr[0], b = tr[0];
    for (let i = 0; i < tr.length; i++) {
      if (tr[i][0] <= fi) a = tr[i];
      if (tr[i][0] >= fi) { b = tr[i]; break; }
      b = tr[i];
    }
    const k = b[0] === a[0] ? 0 : (fi - a[0]) / (b[0] - a[0]);
    const l = (i: number) => a[i] + (b[i] - a[i]) * k;
    out.push({ id: d.id, kind: d.kind, label: d.label, x: l(1), y: l(2), w: l(3), h: l(4) });
  }
  return out;
};

export const SamVideo: React.FC<{ w: number; offset?: number; seen?: (ids: string[]) => void }> = ({ w, offset = 0 }) => {
  const frame = useCurrentFrame();
  const h = (w * 720) / 1280;
  const t = ((frame + offset) % 360) / 30;
  const boxes = boxesAt(t);
  return (
    <div style={{ position: "relative", width: w, height: h, borderRadius: 4, overflow: "hidden", background: C.surface }}>
      <OffthreadVideo src={staticFile("sample/sample-basement.mp4")} startFrom={offset} muted style={{ width: w, height: h, display: "block" }} />
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        {boxes.map((b) => {
          const color = FIND[b.kind] ?? C.ink;
          const x = b.x * w, y = b.y * h, bw = b.w * w, bh = b.h * h;
          const tag = b.label.toUpperCase();
          const tw = tag.length * 10.4 + 16;
          const ty = y > 30 ? y - 28 : y + bh + 2;
          return (
            <g key={b.id}>
              <rect x={x} y={y} width={bw} height={bh} fill="none" stroke={color} strokeWidth={3} />
              <rect x={Math.min(x, w - tw)} y={ty} width={tw} height={26} fill={color} />
              <text x={Math.min(x, w - tw) + 8} y={ty + 18} fontFamily={MONO} fontSize={16} fill="#FBFCFA">
                {tag}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/** Which finds SAM has shown so far, by video time. */
export const firstSeen = () =>
  DETS.map((d) => ({ id: d.id, kind: d.kind, label: d.label, at: (d.track[0]?.[0] ?? 0) / 5 })).sort((a, b) => a.at - b.at);
