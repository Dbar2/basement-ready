import React from "react";
import { Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { MONO, SANS } from "../fonts";
import { Browser, Draw } from "../components/kit";
import { easeDraw, lerp, prog } from "../anim";
import { SceneTiming, lineIn } from "../timeline";
import { SHOTS, Shot } from "../shots";
import logs from "../data/logs.json";

// The models the app really calls (README "The Meta models"), as plain names with their ids.
const NODES = [
  { id: "video", name: "Your video", role: "one take, on a phone", model: "" },
  { id: "sam", name: "SAM 3.1", role: "finds and tracks", model: "sam-3.1" },
  { id: "map", name: "MapAnything", role: "measures depth", model: "open weights · Modal" },
  { id: "wonder", name: "Muse Wonder", role: "watches the take", model: "muse-wonder-1.0" },
  { id: "spark", name: "Muse Spark", role: "checks the code", model: "muse-spark-1.3" },
  { id: "image", name: "Muse Image", role: "restyles your frames", model: "muse-image-1.0" },
];
const NW = 252, NGAP = 44, NX = 96;

/** The pipeline: drawn big on its own for a moment, then it rises into a strip over the real footage. */
export const Pipeline: React.FC<{ frame: number; enter: number; rise: number; leave: number; active: string }> = ({ frame, enter, rise, leave, active }) => {
  const t = prog(frame, rise, 16, easeDraw);
  const y = lerp(330, 44, t);
  const h = lerp(132, 88, t);
  const out = 1 - prog(frame, leave, 12, easeDraw);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      <svg width={1920} height={400} style={{ position: "absolute", left: 0, top: 0 }}>
        {NODES.slice(0, -1).map((n, i) => {
          const x1 = NX + (i + 1) * NW + i * NGAP, x2 = x1 + NGAP;
          const cy = y + h / 2;
          const p = prog(frame, enter + 6 + i * 5, 10, easeDraw);
          const dot = (frame * 1.6 + i * 20) % 60;
          return (
            <g key={n.id}>
              <Draw d={`M${x1} ${cy} L${x2 - 2} ${cy}`} p={p} width={2} />
              <Draw d={`M${x2 - 10} ${cy - 7} L${x2 - 2} ${cy} L${x2 - 10} ${cy + 7}`} p={p >= 1 ? 1 : 0} width={2} />
              {p >= 1 && dot < NGAP - 12 && <circle cx={x1 + dot} cy={cy} r={4.5} fill={C.mint} />}
            </g>
          );
        })}
      </svg>
      {NODES.map((n, i) => {
        const p = prog(frame, enter + i * 5, 12);
        const on = active === n.id;
        return (
          <div
            key={n.id}
            style={{
              position: "absolute",
              left: NX + i * (NW + NGAP),
              top: y + (1 - p) * 18,
              width: NW,
              height: h,
              boxSizing: "border-box",
              border: `1.5px solid ${C.ink}`,
              borderRadius: 6,
              background: on ? C.ink : C.bg,
              color: on ? C.card : C.ink,
              padding: lerp(16, 12, t) + "px 18px",
              opacity: p,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              fontFamily: SANS,
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: lerp(30, 26, t), letterSpacing: "-0.02em", lineHeight: 1 }}>{n.name}</div>
              <div style={{ fontSize: 19, marginTop: lerp(8, 0, t), color: on ? C.border : C.muted, opacity: 1 - t, height: lerp(24, 0, t), overflow: "hidden" }}>{n.role}</div>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 15, color: on ? C.mint : C.muted }}>{n.model || " "}</div>
          </div>
        );
      })}
    </div>
  );
};

/** Footage under the pipeline strip. */
const Under: React.FC<{ shot: Shot; cam?: Shot["cam"]; start?: number; dur: number; w?: number; x?: number; y?: number; children?: React.ReactNode }> = ({ shot, cam, start, dur, w = 1350, x, y = 162, children }) => {
  const frame = useCurrentFrame();
  const o = Math.min(prog(frame, 0, 12), 1 - prog(frame, dur - 10, 10, easeDraw));
  const left = x ?? (1920 - w) / 2;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      <Browser x={left} y={y} w={w} src={shot.file} start={start ?? shot.start} url={shot.url} cam={cam ?? shot.cam} />
      {children}
    </div>
  );
};

/** What MapAnything measured, from the live plan: a card over the footage with the figures counting up. */
export const Measured: React.FC = () => {
  const frame = useCurrentFrame();
  const n = (v: number, d: number) => interpolate(frame, [12 + d, 40 + d], [0, v], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeDraw });
  const rows: [string, string][] = [
    ["Floor", `${n(7.56, 0).toFixed(2)} × ${n(5.52, 0).toFixed(2)} m`],
    ["Area", `${n(41.7, 6).toFixed(1)} m²`],
    ["Ceiling", `${n(2.08, 12).toFixed(2)} m`],
    ["Under the duct", `${n(1.64, 18).toFixed(2)} m`],
  ];
  const p = prog(frame, 4, 14);
  return (
    <div style={{ position: "absolute", left: 300, top: 545, width: 520, background: C.card, border: `1.5px solid ${C.ink}`, borderRadius: 6, padding: "22px 28px", fontFamily: SANS, opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
      <div style={{ fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", paddingBottom: 12 }}>Measured from the video</div>
      <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontWeight: 600, fontSize: 24 }}>{k}</span>
            <span style={{ fontFamily: MONO, fontSize: 22 }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 21, color: C.muted, marginTop: 14 }}>An ordinary phone video. No LiDAR.</div>
    </div>
  );
};

/** The live Meta call log from the server, beside the wait screen: real lines from a live run today
 * (src/data/logs.json), shown exactly as logged, each appearing in order, timed to its real timestamp. */
type LogLine = { at: string; secs: number; text: string };
export const LogPanel: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const lines = logs.lines as LogLine[];
  const p = prog(frame, 0, 12);
  const last = Math.max(1, lines[lines.length - 1]?.secs ?? 1);
  const span = Math.max(30, dur - 110); // every line is up about 3 s before the beat ends
  return (
    <div style={{ position: "absolute", left: 975, top: 162, width: 865, height: 790, background: C.ink, borderRadius: 6, padding: "22px 26px", boxSizing: "border-box", opacity: p, fontFamily: MONO, color: C.card, overflow: "hidden" }}>
      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 21, color: C.card }}>{logs.title}</div>
      <div style={{ fontFamily: SANS, fontSize: 17, color: C.border, marginTop: 4, marginBottom: 18 }}>{logs.note}</div>
      {lines.map((l, i) => {
        // the burst of SAM calls lands together, the long Spark calls later, as in the real run
        const show = 8 + Math.round((l.secs / last) ** 0.7 * span) + i;
        const o = prog(frame, show, 6);
        const [model, ...rest] = l.text.replace(/^\[meta\] /, "").split(" · ");
        return (
          <div key={i} style={{ fontSize: 15.5, lineHeight: 1.5, opacity: o, paddingLeft: "9.6ch", textIndent: "-9.6ch", marginBottom: 3 }}>
            <span style={{ color: C.border }}>{l.at} [meta] </span>
            <span style={{ color: C.mint }}>{model}</span>
            {rest.length ? " · " + rest.join(" · ") : ""}
          </div>
        );
      })}
    </div>
  );
};

/** The answer that live run came back with (a screenshot of the live site), over the left side as the log finishes. */
export const LiveAnswer: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, from, 12);
  if (p <= 0) return null;
  const w = 770, h = (w * 667) / 1200;
  return (
    <div style={{ position: "absolute", left: 180, top: 300 + (1 - p) * 20, width: w, opacity: p, fontFamily: SANS }}>
      <div style={{ border: `1.5px solid ${C.ink}`, borderRadius: 6, overflow: "hidden", background: C.card }}>
        <Img src={staticFile("live-run-answer.jpg")} style={{ width: w, height: h, display: "block" }} />
      </div>
      <div style={{ fontSize: 22, color: C.ink, marginTop: 12, fontWeight: 600 }}>That live run's answer, 1.5 minutes later</div>
      <div style={{ fontSize: 19, color: C.muted, marginTop: 4 }}>A new scan of the same video, today: measured, checked, "Yes, after 3 fixes".</div>
    </div>
  );
};

export const Models: React.FC<{ scene: SceneTiming }> = ({ scene }) => {
  const frame = useCurrentFrame();
  // N06b: the example on the live site. N04: the pipeline, SAM, then MapAnything. N05: Wonder and Spark
  // with the live log. L09: the guide's questions.
  const n6 = lineIn(scene, "N06b"), n4 = lineIn(scene, "N04"), n5 = lineIn(scene, "N05"), l9 = lineIn(scene, "L09");
  const l5 = { from: n4.from, dur: 60 };
  const l8 = n5;
  const s6 = n4.from + 66, s7 = n4.from + Math.round(n4.dur * 0.56), s8 = n5.from - 8, s9 = l9.from - 8;
  const sparkAt = l8.from + Math.round(l8.dur * 0.42);
  const active = frame >= s9 ? "" : frame >= sparkAt ? "spark" : frame >= s8 ? "wonder" : frame >= s7 ? "map" : frame >= s6 ? "sam" : frame >= l5.from + 12 ? "video" : "";
  const big = Math.min(prog(frame, l5.from + 8, 12), 1 - prog(frame, s6 - 12, 10, easeDraw));
  const wait = SHOTS.wait!;
  return (
    <>
      {/* N06b: the example basement on the live site, measuring */}
      <Sequence from={0} durationInFrames={n4.from + 6}>
        <Under shot={wait} dur={n4.from + 6} start={0.3} w={1560} x={180} y={38} cam={[[0, 1, 0.5, 0.5], [1.2, 1, 0.5, 0.5], [3.4, 1.25, 0, 0.45]]} />
      </Sequence>
      {/* N04: the pipeline on its own, briefly */}
      <div style={{ position: "absolute", left: NX, top: 560, opacity: big, fontFamily: SANS, fontWeight: 900, fontSize: 104, letterSpacing: "-0.045em", lineHeight: 0.95 }}>
        Meta's models go to work.
      </div>

      {/* L06: SAM 3.1's outlines on the real wait screen */}
      <Sequence from={s6} durationInFrames={s7 - s6 + 10}>
        <Under shot={wait} dur={s7 - s6 + 10} start={4.0} cam={[[0, 1.3, 0, 0.45], [6, 1.36, 0, 0.45]]} />
      </Sequence>
      {/* L07: MapAnything's measured plan, real, with the figures */}
      <Sequence from={s7} durationInFrames={s8 - s7 + 10}>
        <Under shot={SHOTS.home!} dur={s8 - s7 + 10} start={5.3} cam={[[0, 1.35, 1, 0.45], [8, 1.42, 1, 0.45]]}>
          <Measured />
        </Under>
      </Sequence>
      {/* L08: Wonder and Spark, with the live Meta call log beside the wait screen */}
      <Sequence from={s8} durationInFrames={s9 - s8 + 10}>
        <Under shot={wait} dur={s9 - s8 + 10} start={1.0} w={770} x={180} cam={[[0, 1.32, 0, 0.5]]}>
          <LogPanel dur={s9 - s8} />
          <LiveAnswer from={s9 - s8 - 78} />
        </Under>
      </Sequence>
      {/* L09: the guide asks while it measures */}
      <Sequence from={s9}>
        <WaitFull dur={scene.duration - s9} />
      </Sequence>

      <Pipeline frame={frame} enter={l5.from} rise={s6 - 14} leave={s9 - 6} active={active} />
    </>
  );
};

const WaitFull: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, 0, 14);
  const shot = SHOTS.wait!;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: p }}>
      <Browser x={180} y={38} w={1560} src={shot.file} start={4.6} url={shot.url} cam={[[0, 1.6, 1, 0.92], [Math.max(1, dur / 30 - 1), 1.6, 1, 0.92]]} />
    </div>
  );
};
