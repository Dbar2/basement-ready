import React from "react";
import { interpolate, Sequence, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { MONO, SANS } from "../fonts";
import { Browser, Dim, Draw, Title } from "../components/kit";
import { SHOTS } from "../shots";
import { easeDraw, prog } from "../anim";
import { SceneTiming, lineIn } from "../timeline";

type L = { from: number; dur: number };

// The opening: the live home page, with what was built this week on screen; then the question drawn
// in section (the house, the grade line, the basement below it) for the rules and the cost.
export const Question: React.FC<{ scene: SceneTiming }> = ({ scene }) => {
  const l0 = lineIn(scene, "L00");
  const n2 = lineIn(scene, "N02");
  // the drawing tells N02 in two halves: the three homes, then the rules and the cost
  const l2 = { from: n2.from, dur: Math.round(n2.dur * 0.32) };
  const l3 = { from: n2.from + Math.round(n2.dur * 0.32), dur: n2.dur - Math.round(n2.dur * 0.32) };
  const D = l2.from - 10;
  const home = SHOTS.home!;
  return (
    <>
      <Sequence from={0} durationInFrames={D + 12}>
        <HomeOpen dur={D + 12} l0={l0} l1at={lineIn(scene, "L01").from} />
      </Sequence>
      <Sequence from={D}>
        <Drawn l2={{ from: l2.from - D, dur: l2.dur }} l3={{ from: l3.from - D, dur: l3.dur }} />
      </Sequence>
      <div style={{ display: "none" }}>{home.file}</div>
    </>
  );
};

const HomeOpen: React.FC<{ dur: number; l0: L; l1at: number }> = ({ dur, l0, l1at }) => {
  const frame = useCurrentFrame();
  const o = 1 - prog(frame, dur - 12, 12, easeDraw);
  const card = Math.min(prog(frame, l0.from + 4, 14), 1 - prog(frame, l0.from + l0.dur + 24, 12, easeDraw));
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      <Browser x={180} y={38} w={1560} src="footage/desktop-home.mp4" start={0.2} rate={0.27} url="basementready.com" cam={[[0, 1, 0.5, 0.5], [l1at / 30 - 0.2, 1, 0.5, 0.5], [l1at / 30 + 1.4, 1.38, 0, 0.5]]} />
      <div
        style={{
          position: "absolute",
          left: 850,
          top: 170,
          width: 860,
          padding: "26px 32px 28px",
          background: C.card,
          border: `1.5px solid ${C.ink}`,
          borderRadius: 6,
          opacity: card,
          transform: `translateY(${(1 - card) * 16}px)`,
          fontFamily: SANS,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 40, letterSpacing: "-0.02em", lineHeight: 1.1 }}>Everything you'll see was built during the hackathon.</div>
        <div style={{ fontSize: 26, color: C.muted, marginTop: 14 }}>
          It started from an empty repo on <span style={{ fontFamily: MONO, fontSize: 24, color: C.ink }}>Oct 28, 2026</span>.
        </div>
      </div>
    </div>
  );
};

export const Drawn: React.FC<{ l2: L; l3: L }> = ({ l2, l3 }) => {
  const frame = useCurrentFrame();

  // the section drawing
  const gx0 = 940, gx1 = 1830, gy = 560; // grade line
  const hx0 = 1110, hx1 = 1660; // house walls
  const by = 800; // basement slab
  const pGrade = prog(frame, 4, 26, easeDraw);
  const pHouse = prog(frame, 14, 40, easeDraw);
  const pBase = prog(frame, 40, 36, easeDraw);
  const fillBase = prog(frame, 70, 24);
  const hatch = Array.from({ length: 56 }, (_, i) => {
    const x = gx0 + i * 16;
    if (x > hx0 - 30 && x < hx1 + 30) return "";
    return `M${x} ${gy + 4} L${x - 12} ${gy + 16}`;
  }).join(" ");
  const soil = Array.from({ length: 16 }, (_, i) => `M${hx0 - 20} ${gy + 30 + i * 16} L${hx0 - 32} ${gy + 42 + i * 16} M${hx1 + 32} ${gy + 30 + i * 16} L${hx1 + 20} ${gy + 42 + i * 16}`).join(" ");

  // L02: up to three homes
  const threeP = prog(frame, l2.from + 6, 16);
  const count = Math.round(interpolate(frame, [l2.from + 10, l2.from + 40], [1, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const threeOut = prog(frame, l3.from - 4, 12, easeDraw);
  const doorsP = [0, 1, 2].map((i) => prog(frame, l2.from + 10 + i * 10, 14));

  // L03: the rules, and what drawings cost
  const rules = [
    ["Ontario Building Code", "ceiling, windows, exits"],
    ["Ontario Fire Code", "separations, alarms"],
    ["City by-laws", "size, parking, servicing"],
  ];
  const costAt = l3.from + l3.dur * 0.5;
  const costP = prog(frame, costAt, 16);
  const lo = Math.round(interpolate(frame, [costAt - 8, costAt + 24], [0, 2000], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeDraw }) / 100) * 100;
  const hi = Math.round(interpolate(frame, [costAt - 8, costAt + 24], [0, 5000], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeDraw }) / 100) * 100;
  const qP = prog(frame, l3.from + 20, 24);

  return (
    <>
      <div style={{ position: "absolute", left: 120, top: 150 }}>
        <Title text="Could your basement be a home?" start={10} size={124} width={760} />
      </div>

      {/* L02: three homes on a lot */}
      <div style={{ position: "absolute", left: 124, top: 640, opacity: threeP * (1 - threeOut), transform: `translateY(${(1 - threeP) * 20}px)` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <span style={{ fontFamily: SANS, fontWeight: 900, fontSize: 150, letterSpacing: "-0.05em", lineHeight: 0.9 }}>{count}</span>
          <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 38, lineHeight: 1.15, maxWidth: 460 }}>homes allowed on a serviced lot in Ontario</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 22 }}>
          {doorsP.map((p, i) => (
            <svg key={i} width={58} height={52} style={{ opacity: p, transform: `translateY(${(1 - p) * 10}px)` }}>
              <path d="M5 24 L29 4 L53 24 M10 20 V48 H48 V20 M24 48 V34 H34 V48" fill={i === 2 ? C.mint : "none"} stroke={C.ink} strokeWidth={2.5} strokeLinejoin="miter" />
            </svg>
          ))}
          <span style={{ fontFamily: SANS, fontSize: 22, color: C.muted, marginLeft: 14 }}>
            Planning Act, <span style={{ fontFamily: MONO, fontSize: 20 }}>s. 35.1</span>
          </span>
        </div>
      </div>

      {/* L03: the rules, then the cost of drawings */}
      <div style={{ position: "absolute", left: 124, top: 610, width: 700, opacity: threeOut }}>
        <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
          {rules.map(([name, what], i) => {
            const p = prog(frame, l3.from + 4 + i * 9, 14);
            return (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "13px 0", borderBottom: `1px solid ${C.border}`, opacity: p, transform: `translateX(${(1 - p) * -24}px)` }}>
                <span style={{ fontWeight: 700, fontSize: 30 }}>{name}</span>
                <span style={{ fontSize: 22, color: C.muted }}>{what}</span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 30, opacity: costP, display: "flex", alignItems: "baseline", gap: 18 }}>
          <span style={{ fontWeight: 900, fontSize: 64, letterSpacing: "-0.04em" }}>
            ${lo.toLocaleString("en-CA")}–${hi.toLocaleString("en-CA")}
          </span>
          <span style={{ fontSize: 26, color: C.muted, lineHeight: 1.2 }}>for permit drawings alone, before you know</span>
        </div>
      </div>

      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {/* basement, selected: the mint fill */}
        <rect x={hx0 + 3} y={gy + 2} width={hx1 - hx0 - 6} height={by - gy - 4} fill={C.mint} opacity={fillBase * 0.55} />
        <Draw d={`M${gx0} ${gy} L${gx1} ${gy}`} p={pGrade} width={2} />
        <path d={hatch} stroke={C.muted} strokeWidth={1.2} opacity={prog(frame, 20, 20)} />
        <path d={soil} stroke={C.border} strokeWidth={1.2} opacity={prog(frame, 50, 20)} />
        {/* house above grade */}
        <Draw d={`M${hx0} ${gy} L${hx0} 330 L${hx1} 330 L${hx1} ${gy}`} p={pHouse} width={3} />
        <Draw d={`M${hx0 - 40} 345 L${(hx0 + hx1) / 2} 170 L${hx1 + 40} 345`} p={pHouse} width={3} />
        <Draw d={`M${hx0} 445 L${hx1} 445`} p={prog(frame, 34, 20, easeDraw)} width={1.5} />
        {/* windows above grade */}
        {[[1170, 360], [1470, 360], [1170, 475], [1470, 475]].map(([wx, wy], i) => (
          <Draw key={i} d={`M${wx} ${wy} L${wx + 110} ${wy} L${wx + 110} ${wy + 58} L${wx} ${wy + 58} Z M${wx + 55} ${wy} L${wx + 55} ${wy + 58}`} p={prog(frame, 30 + i * 4, 18)} width={1.5} />
        ))}
        {/* front door */}
        <Draw d={`M1340 ${gy} L1340 474 L1420 474 L1420 ${gy}`} p={prog(frame, 40, 16)} width={1.5} />
        {/* basement walls and slab, thicker: the foundation */}
        <Draw d={`M${hx0} ${gy} L${hx0} ${by} L${hx1} ${by} L${hx1} ${gy}`} p={pBase} width={6} cap="butt" />
        <Draw d={`M${hx0 - 26} ${by + 3} L${hx0 + 40} ${by + 3} M${hx1 - 40} ${by + 3} L${hx1 + 26} ${by + 3}`} p={prog(frame, 64, 14)} width={10} cap="butt" />
        {/* the basement window and its well */}
        <Draw d={`M${hx1 - 3} ${gy + 22} L${hx1 - 3} ${gy + 80}`} p={prog(frame, 66, 12)} width={4} stroke={C.card} cap="butt" />
        <Draw d={`M${hx1} ${gy + 22} L${hx1} ${gy + 80} M${hx1 - 6} ${gy + 22} L${hx1 - 6} ${gy + 80}`} p={prog(frame, 68, 12)} width={1.2} />
        <Draw d={`M${hx1} ${gy + 96} L${hx1 + 80} ${gy + 96} L${hx1 + 80} ${gy}`} p={prog(frame, 70, 16)} width={2} />
        {/* stairs down */}
        <Draw d={Array.from({ length: 7 }, (_, i) => `M${1200 + i * 34} ${gy + 34 * i + 6} L${1234 + i * 34} ${gy + 34 * i + 6} L${1234 + i * 34} ${gy + 34 * (i + 1) + 6}`).join(" ")} p={prog(frame, 72, 24)} width={1.5} />

        {/* L03: what nobody has measured yet */}
        <g opacity={qP}>
          <Dim x1={hx0 + 70} y1={gy + 6} x2={hx0 + 70} y2={by - 6} label="? m" p={qP} bg={C.mint} size={20} />
          <Draw d={`M${hx1 - 60} ${gy + 52} L${hx1 - 150} ${gy + 52}`} p={qP} width={1.5} />
          <text x={hx1 - 160} y={gy + 59} textAnchor="end" fontFamily={MONO} fontSize={20} fill={C.ink} opacity={qP}>
            WINDOW ? m²
          </text>
          <Draw d={`M${hx0 + 6} ${gy + 14} L${hx1 - 6} ${gy + 14}`} p={prog(frame, l3.from + 34, 24)} width={5} stroke={C.fix} cap="butt" />
          <text x={(hx0 + hx1) / 2 + 60} y={gy + 44} textAnchor="middle" fontFamily={MONO} fontSize={18} fill={C.ink} opacity={prog(frame, l3.from + 46, 12)}>
            FIRE SEPARATION ?
          </text>
        </g>
      </svg>
    </>
  );
};
