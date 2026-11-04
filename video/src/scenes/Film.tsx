import React from "react";
import { OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { getPointAtLength, getLength, getTangentAtLength } from "@remotion/paths";
import { C } from "../theme";
import { Title } from "../components/kit";
import { Plan } from "../components/Plan";
import { easeDraw, prog } from "../anim";
import { SceneTiming } from "../timeline";


// Film it once: a phone traces a path through the example's measured plan, and frames drop along it.
export const Film: React.FC<{ scene: SceneTiming }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const px = 190, py = 420, s = 72;
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
        <Title text="Film it once." size={112} width={700} />
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
      {/* the example's real phone video, in a drawn phone held sideways */}
      <div
        style={{
          position: "absolute",
          left: 880,
          top: 250 + (1 - prog(frame, 0, 16)) * 30,
          width: 952 + 28,
          height: 536 + 28,
          borderRadius: 44,
          background: C.ink,
          padding: 14,
          boxSizing: "border-box",
          opacity: prog(frame, 0, 16),
        }}
      >
        <div style={{ width: 952, height: 536, borderRadius: 30, overflow: "hidden" }}>
          <OffthreadVideo src={staticFile("sample/sample-basement.mp4")} muted style={{ width: 952, height: 536, display: "block" }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 880, top: 836, fontSize: 22, color: C.muted, opacity: prog(frame, 20, 12) }}>
        The example basement, filmed on a phone in one take
      </div>
    </>
  );
};
