import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import { getPointAtLength, getLength, getTangentAtLength } from "@remotion/paths";
import { C } from "../theme";
import { Title } from "../components/kit";
import { Plan } from "../components/Plan";
import { easeDraw, prog } from "../anim";
import { SceneTiming } from "../timeline";

const FRAMES = ["0000", "0015", "0021", "0034", "0042", "0044", "0049", "0055", "0059"];

// Film it once: a phone traces a path through the example's measured plan, and frames drop along it.
export const Film: React.FC<{ scene: SceneTiming }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const px = 200, py = 330, s = 92;
  const path = `M${px + 3.2 * s} ${py + 0.7 * s} C${px + 1.5 * s} ${py + 1.4 * s} ${px + 1.0 * s} ${py + 3.2 * s} ${px + 2.2 * s} ${py + 4.3 * s} S${px + 5.6 * s} ${py + 4.6 * s} ${px + 6.3 * s} ${py + 3.0 * s} S${px + 5.2 * s} ${py + 1.0 * s} ${px + 4.2 * s} ${py + 1.5 * s}`;
  const len = getLength(path);
  const walk = prog(frame, 16, scene.duration - 40, easeDraw);
  const at = Math.max(0.5, len * walk);
  const pt = getPointAtLength(path, at) ?? { x: 0, y: 0 };
  const tan = getTangentAtLength(path, at) ?? { x: 1, y: 0 };
  const angle = (Math.atan2(tan.y, tan.x) * 180) / Math.PI;
  const dots = Array.from({ length: Math.floor((len * walk) / 18) }, (_, i) => getPointAtLength(path, i * 18) ?? { x: 0, y: 0 });

  return (
    <>
      <div style={{ position: "absolute", left: 120, top: 120 }}>
        <Title text="Film it once." size={112} width={900} />
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <Plan x={px} y={py} s={s} frame={frame} start={4} />
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={3.2} fill={C.mintLine} />
        ))}
        {/* the phone, drawn, with what it sees */}
        <g transform={`translate(${pt.x} ${pt.y}) rotate(${angle - 90})`} opacity={prog(frame, 12, 8)}>
          <path d="M0 0 L-80 150 L80 150 Z" fill={C.mint} opacity={0.45} />
          <rect x={-20} y={-36} width={40} height={72} rx={8} fill={C.card} stroke={C.ink} strokeWidth={3} />
          <circle cx={0} cy={26} r={4} fill={C.ink} />
        </g>
      </svg>
      {/* the frames it keeps */}
      <div style={{ position: "absolute", left: 1150, top: 180, width: 660, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {FRAMES.slice(0, 8).map((f, i) => {
          const t = 24 + (i / 8) * (scene.duration - 60);
          const p = prog(frame, t, 12);
          return (
            <div key={f} style={{ opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
              <Img src={staticFile(`sample/sample/frames/${f}.jpg`)} style={{ width: "100%", borderRadius: 4, display: "block" }} />
            </div>
          );
        })}
      </div>
    </>
  );
};
