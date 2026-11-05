import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Easing, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import "./fonts";
import { C, FIND } from "./theme";
import { MONO, SANS } from "./fonts";
import { Draw, Status } from "./components/kit";
import { Plan, PLAN_D, PLAN_W } from "./components/Plan";
import { easeDraw, easeOut, lerp, prog } from "./anim";
import POINTS from "./data/hiw-points.json";
import TRACKS from "./data/hiw-tracks.json";

// "How it works": the pipeline from a phone video to a permit set, built from the example basement's
// real intermediate outputs (public/samples/sample: frames, SAM 3.1 tracks, the 3D surfels, the measured
// plan, the rule findings and the Muse Image look). One slow camera drift left to right, then a pull back.

export const HIW_FPS = 30;
export const HIW_DURATION = 435; // 14.5 s

const SP = 760; // stage spacing in world px
const X0 = 960;
const PW = 640; // panel width
const TOP = 250; // panel top (world y)
const VIS = TOP + 128; // visual area top
const VH = 360;
const VC = VIS + VH / 2; // the pipeline line runs through the visuals' middle
const N = 8;
const STEP = 48;
const F = Array.from({ length: N }, (_, i) => 16 + STEP * i); // frame each stage is centred
const cx = (i: number) => X0 + i * SP;
const ZOOM_AT = F[N - 1] + 12;

const inOut = Easing.bezier(0.45, 0, 0.55, 1);

const camX = (f: number) => {
  if (f <= F[0]) return cx(0) - (F[0] - f) * 2.4;
  if (f >= F[N - 1]) return cx(N - 1) + (f - F[N - 1]) * 2.4;
  const i = Math.min(N - 2, Math.floor((f - F[0]) / STEP));
  const t = (f - F[i]) / STEP;
  const u = 0.62 * inOut(t) + 0.38 * t;
  return cx(i) + SP * u;
};

const RAIL = ["video", "sam-3.1", "depth", "plan", "checks", "muse-spark", "muse-image", "permit"];

/* ---------- small pieces ---------- */

const ModelChip: React.FC<{ id: string }> = ({ id }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 9,
      background: C.ink,
      color: C.bg,
      fontFamily: MONO,
      fontSize: 18,
      padding: "6px 12px 6px 10px",
      borderRadius: 4,
      letterSpacing: "0.01em",
    }}
  >
    <span style={{ width: 8, height: 8, background: C.mint, boxShadow: `0 0 10px ${C.mint}` }} />
    {id}
  </span>
);

const PlainChip: React.FC<{ text: string }> = ({ text }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      border: `1px solid ${C.border}`,
      color: C.muted,
      fontFamily: MONO,
      fontSize: 17,
      padding: "5px 11px",
      borderRadius: 4,
      background: C.card,
    }}
  >
    {text}
  </span>
);

const Panel: React.FC<{
  i: number;
  f: number;
  chips: React.ReactNode;
  title: string;
  line: string;
  focus: number;
  children: React.ReactNode;
}> = ({ i, f, chips, title, line, focus, children }) => {
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f - (F[i] - 40), fps, config: { damping: 200, mass: 0.9 } });
  return (
    <div
      style={{
        position: "absolute",
        left: cx(i) - PW / 2,
        top: TOP,
        width: PW,
        opacity: enter * (0.42 + 0.58 * focus),
        transform: `translateY(${(1 - enter) * 26}px)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 34 }}>
        <span style={{ fontFamily: MONO, fontSize: 17, color: C.muted, width: 30 }}>{String(i + 1).padStart(2, "0")}</span>
        {chips}
      </div>
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 38, letterSpacing: "-0.025em", lineHeight: 1, marginTop: 14, color: C.ink }}>
        {title}
      </div>
      <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 22, color: C.muted, marginTop: 10, whiteSpace: "nowrap" }}>{line}</div>
      <div style={{ position: "absolute", top: VIS - TOP, left: 0, width: PW, height: VH }}>{children}</div>
    </div>
  );
};

const frameSrc = (n: number) => staticFile(`sample/sample/frames/${String(n).padStart(4, "0")}.jpg`);

/* ---------- 01 phone video → frames ---------- */

const FRAMES = [0, 15, 21, 34, 49, 59];

const StageVideo: React.FC<{ lf: number }> = ({ lf }) => {
  const head = prog(lf, 4, 34, easeDraw);
  const tw = 206, th = 116, gap = 11;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={PW} height={44} style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}>
        <line x1={0} y1={22} x2={PW} y2={22} stroke={C.border} strokeWidth={1} />
        {Array.from({ length: 60 }, (_, k) => {
          const x = (k / 59) * PW;
          const taken = FRAMES.includes(k);
          const lit = head * 59 >= k;
          return <line key={k} x1={x} x2={x} y1={taken ? 10 : 17} y2={taken ? 34 : 27} stroke={lit ? (taken ? C.mintLine : C.ink) : C.border} strokeWidth={taken ? 2 : 1} />;
        })}
        <rect x={head * PW - 1.5} y={4} width={3} height={36} fill={C.mint} style={{ filter: `drop-shadow(0 0 6px ${C.mint})` }} />
      </svg>
      {FRAMES.map((n, k) => {
        const p = prog(lf, 8 + k * 4.5, 14);
        const col = k % 3, row = Math.floor(k / 3);
        return (
          <div
            key={n}
            style={{
              position: "absolute",
              left: col * (tw + gap),
              top: 60 + row * (th + gap),
              width: tw,
              height: th,
              opacity: p,
              transform: `translateY(${(1 - p) * 14}px) scale(${0.94 + 0.06 * p})`,
              outline: `1px solid ${C.border}`,
              overflow: "hidden",
            }}
          >
            <Img src={frameSrc(n)} style={{ width: tw, height: th, display: "block" }} />
            <span style={{ position: "absolute", left: 6, bottom: 6, background: C.ink, color: C.bg, fontFamily: MONO, fontSize: 13, padding: "2px 6px" }}>
              f {String(n).padStart(2, "0")}
            </span>
          </div>
        );
      })}
      <div style={{ position: "absolute", top: 322, left: 0, fontFamily: MONO, fontSize: 16, color: C.muted, opacity: prog(lf, 30, 10) }}>
        60 frames · 1280×720 · one take
      </div>
    </div>
  );
};

/* ---------- 02 sam-3.1 → masks and tracks ---------- */

const StageSam: React.FC<{ lf: number }> = ({ lf }) => {
  const t = prog(lf, 44, 22, easeDraw); // frame 49 → 59
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", outline: `1px solid ${C.border}` }}>
      <Img src={frameSrc(49)} style={{ position: "absolute", width: PW, height: VH }} />
      <Img src={frameSrc(59)} style={{ position: "absolute", width: PW, height: VH, opacity: t }} />
      <svg width={PW} height={VH} style={{ position: "absolute", inset: 0 }}>
        {TRACKS.map((tr, k) => {
          const b = tr.a.map((v, j) => lerp(v, tr.b[j], t));
          const x = b[0] * PW, y = b[1] * VH, w = b[2] * PW, h = b[3] * VH;
          const col = FIND[tr.kind] ?? C.ink;
          const p = prog(lf, 6 + k * 3.5, 14, easeDraw);
          const d = `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
          const tag = tr.label.toLowerCase();
          return (
            <g key={k}>
              <rect x={x} y={y} width={w} height={h} fill={col} opacity={0.16 * prog(lf, 14 + k * 3.5, 10)} />
              <Draw d={d} p={p} stroke={col} width={3} />
              <g opacity={prog(lf, 12 + k * 3.5, 8)} transform={tr.kind === "exit" ? `translate(0 ${h})` : undefined}>
                <rect x={x + 3} y={y + 3} width={tag.length * 8.6 + 12} height={20} fill={col} />
                <text x={x + 9} y={y + 17.5} fontFamily={MONO} fontSize={14} fill="#fff">
                  {tag}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
      <span style={{ position: "absolute", right: 8, bottom: 8, background: "rgba(15,42,30,0.82)", color: C.bg, fontFamily: MONO, fontSize: 14, padding: "3px 8px" }}>
        f {Math.round(lerp(49, 59, t))} · {TRACKS.length} tracks
      </span>
    </div>
  );
};

/* ---------- 03 mapanything + dinov2 → depth and points ---------- */

type P6 = [number, number, number, number, number, number];
const PTS = POINTS as P6[];
const CEN = PTS.reduce((a, p) => [a[0] + p[0] / PTS.length, a[1] + p[1] / PTS.length, a[2] + p[2] / PTS.length], [0, 0, 0]);
const NEAR = [75, 227, 138];
const FAR = [15, 42, 30];

const StagePoints: React.FC<{ lf: number }> = ({ lf }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const lift = prog(lf, 6, 34, easeOut);
  const rgb = 0.55 * prog(lf, 38, 22);
  const yaw = -1.0 + 0.7 * prog(lf, 14, 110, (x) => x);
  const pitch = 0.45;
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const S = 2; // supersample
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.clearRect(0, 0, PW, VH);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const D = 8.2, foc = 560;
    const proj: [number, number, number, number, number, number, number][] = [];
    let zmin = Infinity, zmax = -Infinity;
    for (const p of PTS) {
      const x = p[0] - CEN[0], y = p[1] - CEN[1], z = p[2] - CEN[2];
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp;
      let z2 = y * sp + z1 * cp;
      z2 = z2 * lift; // depth lifts out of the flat frame
      const zc = z2 + D;
      zmin = Math.min(zmin, z2);
      zmax = Math.max(zmax, z2);
      proj.push([PW / 2 + (foc * x1) / zc, VH / 2 + 10 - (foc * y2) / zc, z2, p[3], p[4], p[5], zc]);
    }
    proj.sort((a, b) => b[2] - a[2]);
    const span = Math.max(0.001, zmax - zmin);
    for (const q of proj) {
      const dn = (q[2] - zmin) / span; // 0 near … 1 far
      const r = lerp(lerp(NEAR[0], FAR[0], dn), q[3], rgb);
      const g = lerp(lerp(NEAR[1], FAR[1], dn), q[4], rgb);
      const b = lerp(lerp(NEAR[2], FAR[2], dn), q[5], rgb);
      const s = (2.1 * D) / q[6];
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(q[0] - s / 2, q[1] - s / 2, s, s);
    }
  }, [lift, rgb, yaw]);
  return (
    <div style={{ position: "absolute", inset: 0, background: C.surface, outline: `1px solid ${C.border}`, overflow: "hidden" }}>
      <canvas ref={ref} width={PW * 2} height={VH * 2} style={{ width: PW, height: VH, position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", left: 12, bottom: 12, display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 13, color: C.muted, opacity: 1 - rgb * 0.6 }}>
        near
        <span style={{ width: 90, height: 8, background: `linear-gradient(90deg, ${C.mint}, ${C.ink})` }} />
        far
      </div>
      <span style={{ position: "absolute", right: 12, top: 12, fontFamily: MONO, fontSize: 14, color: C.ink }}>400k points · showing 11k</span>
    </div>
  );
};

/* ---------- 04 measured plan ---------- */

const StagePlan: React.FC<{ lf: number }> = ({ lf }) => {
  const s = 50;
  const w = PLAN_W * s, d = PLAN_D * s;
  const x = (PW - w) / 2 - 22, y = (VH - d) / 2 - 22;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={PW} height={VH} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <Plan x={x} y={y} s={s} frame={lf} start={2} finds={18} dims={22} paper={false} />
      </svg>
      <div style={{ position: "absolute", right: 0, top: 0, fontFamily: MONO, fontSize: 16, color: C.ink, opacity: prog(lf, 34, 10), textAlign: "right", lineHeight: 1.5 }}>
        ceiling 2.09 m
        <br />
        <span style={{ color: C.muted }}>41.7 m²</span>
      </div>
    </div>
  );
};

/* ---------- 05 code checks ---------- */

const CHECKS: { id: string; cite: string; kind: "ok" | "fix" }[] = [
  { id: "ceiling_height_suite", cite: "9.5.3.1 · 2.09 m ≥ 1.95 m", kind: "ok" },
  { id: "egress_window_bedroom_area", cite: "9.9.10.1 · opening ≥ 0.35 m²", kind: "ok" },
  { id: "fire_separation_between_units", cite: "9.10.9.16 · 15.9 mm Type X", kind: "fix" },
];

const Tick: React.FC<{ p: number; kind: "ok" | "fix" }> = ({ p, kind }) => {
  const col = kind === "ok" ? C.ok : C.fix;
  return (
    <svg width={30} height={30} style={{ flex: "none" }}>
      <rect x={1} y={1} width={28} height={28} fill="none" stroke={col} strokeWidth={1.5} opacity={Math.min(1, p * 3)} />
      {kind === "ok" ? (
        <Draw d="M8 15.5 L13 20.5 L22.5 10" p={p} stroke={col} width={2.6} />
      ) : (
        <Draw d="M15 7.5 V17.5 M15 20.5 V23" p={p} stroke={col} width={2.6} />
      )}
    </svg>
  );
};

const StageChecks: React.FC<{ lf: number }> = ({ lf }) => (
  <div style={{ position: "absolute", inset: 0, borderTop: `1px solid ${C.ink}` }}>
    {CHECKS.map((c, k) => {
      const p = prog(lf, 8 + k * 9, 12);
      const tp = prog(lf, 13 + k * 9, 10, easeDraw);
      return (
        <div
          key={c.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            height: 82,
            borderBottom: `1px solid ${C.border}`,
            opacity: p,
            transform: `translateX(${(1 - p) * 18}px)`,
          }}
        >
          <Tick p={tp} kind={c.kind} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: MONO, fontSize: 19, color: C.ink, whiteSpace: "nowrap" }}>{c.id}</div>
            <div style={{ fontFamily: MONO, fontSize: 15, color: C.muted, marginTop: 5, whiteSpace: "nowrap" }}>OBC {c.cite}</div>
          </div>
          <div style={{ opacity: tp }}>
            <Status kind={c.kind} size={19}>{c.kind === "ok" ? "Pass" : "To fix"}</Status>
          </div>
        </div>
      );
    })}
    <div style={{ marginTop: 18, fontFamily: MONO, fontSize: 15, color: C.muted, opacity: prog(lf, 38, 10) }}>
      + 12 more rules · no model in the loop
    </div>
  </div>
);

/* ---------- 06 muse-spark → the answer ---------- */

const StageAnswer: React.FC<{ lf: number }> = ({ lf }) => {
  const s = prog(lf, 14, 10, easeOut);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", paddingTop: 18 }}>
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 24, color: C.muted, opacity: prog(lf, 4, 10) }}>Can this basement be a second home?</div>
      <div
        style={{
          marginTop: 30,
          marginLeft: 8,
          border: `5px solid ${C.fix}`,
          borderRadius: 5,
          padding: "14px 30px 20px",
          color: C.fix,
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 76,
          letterSpacing: "-0.045em",
          lineHeight: 1,
          opacity: s,
          transform: `rotate(-3deg) scale(${1.32 - 0.32 * s})`,
          transformOrigin: "30% 50%",
        }}
      >
        Yes, with fixes
      </div>
      <div style={{ marginTop: 40, width: PW, borderTop: `1px solid ${C.border}`, paddingTop: 16, opacity: prog(lf, 28, 10) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 22 }}>Fire separation between the two homes</span>
          <Status kind="fix" size={18}>To fix</Status>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 15, color: C.muted, marginTop: 8 }}>reason cites fire_separation_between_units</div>
      </div>
    </div>
  );
};

/* ---------- 07 muse-image → before / after ---------- */

const StageImage: React.FC<{ lf: number }> = ({ lf }) => {
  const wipe = prog(lf, 10, 30, easeDraw);
  const xw = PW * (1 - wipe);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", outline: `1px solid ${C.border}` }}>
      <Img src={frameSrc(0)} style={{ position: "absolute", width: PW, height: VH }} />
      <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${xw}px)` }}>
        <Img src={staticFile("sample/sample/looks/warm/1.jpg")} style={{ position: "absolute", width: PW, height: VH }} />
      </div>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: xw - 1.5, width: 3, background: C.mint, boxShadow: `0 0 14px ${C.mint}`, opacity: wipe > 0 && wipe < 1 ? 1 : 0 }} />
      <span style={{ position: "absolute", left: 10, top: 10, background: C.ink, color: C.bg, fontFamily: MONO, fontSize: 14, padding: "3px 8px", opacity: 1 - wipe }}>before</span>
      <span style={{ position: "absolute", right: 10, top: 10, background: C.ink, color: C.bg, fontFamily: MONO, fontSize: 14, padding: "3px 8px", opacity: prog(lf, 14, 8) }}>after</span>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 40,
          background: "rgba(15,42,30,0.84)",
          color: C.bg,
          fontFamily: MONO,
          fontSize: 15,
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingLeft: 14,
          opacity: prog(lf, 36, 10),
        }}
      >
        <span style={{ width: 8, height: 8, background: C.mint }} />
        windows and stairs kept · checked by sam-3.1
      </div>
    </div>
  );
};

/* ---------- 08 → the permit set ---------- */

const Sheet: React.FC<{ lf: number; front?: boolean }> = ({ lf, front }) => {
  const sw = 560, sh = 330, tb = 132;
  const s = 30;
  const px = (sw - tb - PLAN_W * s) / 2 - 8;
  const py = (sh - PLAN_D * s) / 2 - 10;
  return (
    <svg width={sw} height={sh} style={{ display: "block", overflow: "visible" }}>
      <rect x={0} y={0} width={sw} height={sh} fill={C.card} stroke={C.ink} strokeWidth={1.2} />
      <rect x={10} y={10} width={sw - 20} height={sh - 20} fill="none" stroke={C.ink} strokeWidth={0.8} />
      <line x1={sw - 10 - tb} y1={10} x2={sw - 10 - tb} y2={sh - 10} stroke={C.ink} strokeWidth={0.8} />
      {front && (
        <>
          <Plan x={px} y={py} s={s} frame={lf} start={-30} zones={-30} fix={10} paper={false} />
          <g fontFamily={SANS} fill={C.ink}>
            <text x={sw - tb} y={44} fontSize={21} fontWeight={800} letterSpacing="-0.02em">Floor plan</text>
            <text x={sw - tb} y={68} fontSize={14} fill={C.muted}>Second unit</text>
            <text x={sw - tb} y={88} fontSize={14} fill={C.muted}>Waterloo, ON</text>
            <line x1={sw - 10 - tb} x2={sw - 10} y1={sh - 86} y2={sh - 86} stroke={C.ink} strokeWidth={0.8} />
            <text x={sw - tb} y={sh - 54} fontSize={13} fontFamily={MONO} fill={C.muted}>drafted from</text>
            <text x={sw - tb} y={sh - 34} fontSize={13} fontFamily={MONO} fill={C.muted}>the scan</text>
          </g>
        </>
      )}
    </svg>
  );
};

const StagePermit: React.FC<{ lf: number }> = ({ lf }) => {
  const { fps } = useVideoConfig();
  const a = spring({ frame: lf - 10, fps, config: { damping: 18, stiffness: 90, mass: 0.8 } });
  const back = prog(lf, 2, 14);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {[2, 1].map((k) => (
        <div key={k} style={{ position: "absolute", left: 30 + k * 16, top: 14 - k * 12, opacity: back * (0.5 + 0.2 * (2 - k)) }}>
          <Sheet lf={lf} />
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: 30,
          top: 14,
          opacity: Math.min(1, a * 1.6),
          transform: `translate(${(1 - a) * 300}px, ${(1 - a) * 30}px) rotate(${(1 - a) * 5}deg)`,
          boxShadow: `0 ${18 * a}px ${40 * a}px rgba(15,42,30,${0.12 * a})`,
        }}
      >
        <Sheet lf={lf} front />
      </div>
    </div>
  );
};

/* ---------- side inputs ---------- */

const SideNode: React.FC<{ x: number; y: number; f: number; at: number; model: string; line: string; children: React.ReactNode; focus: number }> = ({
  x,
  y,
  f,
  at,
  model,
  line,
  children,
  focus,
}) => {
  const { fps } = useVideoConfig();
  const e = spring({ frame: f - at, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        position: "absolute",
        left: x - 180,
        top: y,
        width: 360,
        padding: "12px 14px 13px",
        background: C.card,
        border: `1px solid ${C.border}`,
        opacity: e * (0.5 + 0.5 * focus),
        transform: `translateY(${(1 - e) * 16}px)`,
      }}
    >
      <ModelChip id={model} />
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 19, color: C.ink, marginTop: 8, whiteSpace: "nowrap" }}>{line}</div>
      {children}
    </div>
  );
};

const Wave: React.FC<{ f: number }> = ({ f }) => (
  <svg width={330} height={18} style={{ display: "block", marginTop: 6 }}>
    {Array.from({ length: 42 }, (_, k) => {
      const h = 3 + Math.abs(Math.sin(k * 1.7 + f * 0.21) * Math.cos(k * 0.45 - f * 0.07)) * 14;
      return <rect key={k} x={k * 8} y={9 - h / 2} width={4} height={h} fill={k * 8 < ((f * 9) % 420) ? C.mintLine : C.border} />;
    })}
  </svg>
);

/* ---------- the composition ---------- */

export const HowItWorks: React.FC = () => {
  const f = useCurrentFrame();
  const z = prog(f, ZOOM_AT, 52, easeDraw);

  // camera: slow continuous drift through the stages, then pull back to the whole pipeline
  const baseX = camX(f);
  const baseY = 452 + 6 * Math.sin(f / 44);
  const baseS = 1.2 + 0.014 * Math.sin(f / 52);
  const left = cx(0) - PW / 2 - 40, right = cx(N - 1) + PW / 2 + 40;
  const sFit = 1760 / (right - left);
  const fitX = (left + right) / 2;
  const fitY = 419 + (540 - 395) / sFit;
  const s = Math.exp(lerp(Math.log(baseS), Math.log(sFit), z));
  const zx = Math.pow(z, 0.8);
  const camx = lerp(baseX, fitX, zx);
  const camy = lerp(baseY, fitY, zx);

  const focusOf = (i: number) => lerp(Math.max(0, 1 - Math.abs(baseX - cx(i)) / SP), 1, z);
  const lf = (i: number) => f - (F[i] - 34);

  const voiceX = cx(0) + SP / 2;
  const wonderX = cx(1) + SP / 2;

  const railP = Math.min(1, Math.max(0, (baseX - cx(0)) / (cx(N - 1) - cx(0))));
  const current = Math.round(railP * (N - 1));

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: SANS, color: C.ink, overflow: "hidden" }}>
      {/* faint drafting grid that drifts with the camera */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.border}55 1px, transparent 1px), linear-gradient(90deg, ${C.border}55 1px, transparent 1px)`,
          backgroundSize: `${48 * s}px ${48 * s}px`,
          backgroundPosition: `${-camx * s}px ${-camy * s}px`,
        }}
      />

      {/* the world */}
      <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(960px, 540px) scale(${s}) translate(${-camx}px, ${-camy}px)` }}>
        <svg width={8200} height={1200} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <defs>
            <filter id="hiwGlow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* main connectors */}
          {Array.from({ length: N - 1 }, (_, i) => {
            const x1 = cx(i) + PW / 2 + 18, x2 = cx(i + 1) - PW / 2 - 18;
            const p = prog(f, F[i] + 4, 22, easeDraw);
            const loop = ((f - F[i] - 26) % 40) / 40;
            return (
              <g key={i}>
                <Draw d={`M${x1} ${VC} L${x2} ${VC}`} p={p} stroke={C.ink} width={1.5} />
                {p >= 1 && <Draw d={`M${x2 - 9} ${VC - 7} L${x2} ${VC} L${x2 - 9} ${VC + 7}`} p={1} stroke={C.ink} width={1.5} />}
                {p > 0 && p < 1 && <circle cx={lerp(x1, x2, p)} cy={VC} r={5} fill={C.mint} filter="url(#hiwGlow)" />}
                {p >= 1 && loop >= 0 && <circle cx={lerp(x1, x2 - 10, loop)} cy={VC} r={3.5} fill={C.mint} opacity={Math.sin(loop * Math.PI)} filter="url(#hiwGlow)" />}
              </g>
            );
          })}
          {/* side inputs join the line */}
          {(() => {
            const pv = prog(f, F[0] + 14, 20, easeDraw);
            const pw = prog(f, F[1] + 10, 20, easeDraw);
            return (
              <>
                <Draw d={`M${voiceX} 226 L${voiceX} ${VC - 1}`} p={pv} stroke={C.mintLine} width={1.5} />
                {pv >= 1 && <circle cx={voiceX} cy={VC} r={5} fill={C.mint} stroke={C.ink} strokeWidth={1} />}
                <Draw d={`M${wonderX} 226 L${wonderX} ${VC - 1}`} p={pw} stroke={C.mintLine} width={1.5} />
                {pw >= 1 && <circle cx={wonderX} cy={VC} r={5} fill={C.mint} stroke={C.ink} strokeWidth={1} />}
              </>
            );
          })()}
        </svg>

        <Panel i={0} f={f} focus={focusOf(0)} chips={<PlainChip text="input" />} title="Phone video" line="one walk-through, split into frames">
          <StageVideo lf={lf(0) + 14} />
        </Panel>
        <Panel i={1} f={f} focus={focusOf(1)} chips={<ModelChip id="sam-3.1" />} title="Masks and tracks" line="finds windows, stairs, ducts, beams, mechanicals">
          <StageSam lf={lf(1)} />
        </Panel>
        <Panel
          i={2}
          f={f}
          focus={focusOf(2)}
          chips={
            <>
              <ModelChip id="mapanything" />
              <ModelChip id="dinov2" />
            </>
          }
          title="Depth and points"
          line="every frame lifted into one 3D scan"
        >
          <StagePoints lf={lf(2)} />
        </Panel>
        <Panel i={3} f={f} focus={focusOf(3)} chips={<PlainChip text="from the scan" />} title="Measured plan" line="walls, openings and finds, dimensioned">
          <StagePlan lf={lf(3)} />
        </Panel>
        <Panel i={4} f={f} focus={focusOf(4)} chips={<PlainChip text="rules engine" />} title="Code checks" line="plain code, every rule cited">
          <StageChecks lf={lf(4)} />
        </Panel>
        <Panel i={5} f={f} focus={focusOf(5)} chips={<ModelChip id="muse-spark-1.3" />} title="The answer" line="reads the checks, writes the verdict and reasons">
          <StageAnswer lf={lf(5)} />
        </Panel>
        <Panel i={6} f={f} focus={focusOf(6)} chips={<ModelChip id="muse-image-1.0" />} title="Before and after" line="shows it finished, then SAM checks it">
          <StageImage lf={lf(6)} />
        </Panel>
        <Panel i={7} f={f} focus={focusOf(7)} chips={<PlainChip text="output" />} title="The permit set" line="drawings drafted from the measured plan">
          <StagePermit lf={lf(7)} />
        </Panel>

        <SideNode x={voiceX} y={92} f={f} at={F[0] + 2} focus={lerp(Math.max(0, 1 - Math.abs(baseX - voiceX) / SP), 1, z)} model="muse-voice-transcribe-1.0" line="hears what you say while filming">
          <div style={{ fontFamily: SANS, fontSize: 16, color: C.muted, marginTop: 6, whiteSpace: "nowrap" }}>“I'd want the kitchen over here by the stairs”</div>
          <Wave f={f} />
        </SideNode>
        <SideNode x={wonderX} y={92} f={f} at={F[1] - 4} focus={lerp(Math.max(0, 1 - Math.abs(baseX - wonderX) / SP), 1, z)} model="muse-wonder-1.0" line="watches the whole take, names the rooms">
          <svg width={330} height={32} style={{ display: "block", marginTop: 8 }}>
            <line x1={0} y1={22} x2={330} y2={22} stroke={C.border} />
            <rect x={0} y={14} width={330 * prog(f, F[1] + 2, 26, easeDraw)} height={16} fill={C.mint} opacity={0.85} />
            <text x={6} y={26.5} fontFamily={SANS} fontWeight={600} fontSize={13} fill={C.ink} opacity={prog(f, F[1] + 18, 8)}>
              Your basement
            </text>
            <text x={0} y={9} fontFamily={MONO} fontSize={11} fill={C.muted}>0 s</text>
            <text x={330} y={9} fontFamily={MONO} fontSize={11} fill={C.muted} textAnchor="end">12 s</text>
          </svg>
        </SideNode>
      </div>

      {/* HUD: title */}
      <div style={{ position: "absolute", left: 64, top: 54, opacity: Math.min(prog(f, 0, 10), 1 - prog(f, 30, 14, easeDraw)) }}>
        <div style={{ fontFamily: MONO, fontSize: 16, letterSpacing: "0.14em", color: C.muted }}>UNDER THE HOOD</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 6 }}>
          <span style={{ fontFamily: SANS, fontWeight: 900, fontSize: 44, letterSpacing: "-0.035em" }}>How it works</span>
          <span style={{ fontFamily: MONO, fontSize: 18, color: C.muted }}>phone video → permit set</span>
        </div>
      </div>

      {/* rail */}
      <svg width={1920} height={80} style={{ position: "absolute", left: 0, top: 972, opacity: prog(f, 4, 12) }}>
        <line x1={160} x2={1760} y1={22} y2={22} stroke={C.border} strokeWidth={1} />
        <line x1={160} x2={160 + 1600 * lerp(railP, 1, z)} y1={22} y2={22} stroke={C.mintLine} strokeWidth={2} />
        {RAIL.map((r, k) => {
          const x = 160 + (1600 * k) / (N - 1);
          const on = k === current && z < 0.5;
          const done = k <= current || z >= 0.5;
          return (
            <g key={r}>
              <rect x={x - 5} y={17} width={10} height={10} fill={on ? C.mint : done ? C.ink : C.bg} stroke={done ? C.ink : C.border} strokeWidth={1} />
              <text x={x} y={52} textAnchor="middle" fontFamily={MONO} fontSize={15} fill={on ? C.ink : C.muted} fontWeight={on ? 500 : 400}>
                {r}
              </text>
            </g>
          );
        })}
      </svg>

      {/* the pull-back line */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 632, textAlign: "center", opacity: prog(f, ZOOM_AT + 24, 16), transform: `translateY(${(1 - prog(f, ZOOM_AT + 24, 18)) * 18}px)` }}>
        <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 68, letterSpacing: "-0.04em", lineHeight: 1 }}>Phone video in. Permit set out.</div>
        <div style={{ fontFamily: MONO, fontSize: 19, color: C.muted, marginTop: 20 }}>
          sam-3.1 · mapanything · dinov2 · muse-wonder · muse-voice-transcribe · muse-spark · muse-image
        </div>
      </div>

      {/* the sheet's drawn border */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <rect x={28} y={28} width={1864} height={1024} fill="none" stroke={C.border} strokeWidth={1} />
      </svg>
    </AbsoluteFill>
  );
};
