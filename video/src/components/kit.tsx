import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { getLength } from "@remotion/paths";
import { C } from "../theme";
import { MONO, SANS } from "../fonts";
import { easeDraw, easeOut, prog } from "../anim";

export const W = 1920;
export const H = 1080;
export const INSET = 28; // the sheet's drawn border
export const BAND = 112; // bottom band: the caption and the title block

/** The logo's mark: the B with a house cut out of its lower half (brand/logo/mark.svg). */
export const Mark: React.FC<{ h: number; color?: string }> = ({ h, color = C.ink }) => (
  <svg viewBox="0 0 100 120" height={h} width={(h * 100) / 120} style={{ display: "block" }}>
    <path
      fill={color}
      fillRule="evenodd"
      d="M0 0H56C76 0 90 13 90 30C90 42 84 50 76 55C90 60 98 72 98 87C98 106 84 120 62 120H0Z M12 120V84L39 61L66 84V120Z"
    />
    <rect x="31" y="92" width="16" height="28" fill={color} />
  </svg>
);

/** A path that strokes itself in as `p` goes 0→1. */
export const Draw: React.FC<{
  d: string;
  p: number;
  stroke?: string;
  width?: number;
  fill?: string;
  cap?: "butt" | "round" | "square";
  opacity?: number;
}> = ({ d, p, stroke = C.ink, width = 2, fill = "none", cap = "square", opacity = 1 }) => {
  const len = Math.max(1, getLength(d));
  if (p <= 0) return null;
  return (
    <path
      d={d}
      fill={fill}
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap={cap}
      strokeLinejoin="miter"
      strokeDasharray={`${len} ${len}`}
      strokeDashoffset={len * (1 - p)}
      opacity={opacity}
    />
  );
};

/** A dimension line: 1px ink, 6px tick ends, the figure centred with a knock-out (brand/ui.md). */
export const Dim: React.FC<{
  x1: number; y1: number; x2: number; y2: number; label: string; p: number; size?: number; color?: string; bg?: string;
}> = ({ x1, y1, x2, y2, label, p, size = 20, color = C.ink, bg = C.bg }) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * 7;
  const ny = (dx / len) * 7;
  const mx = x1 + dx * 0.5;
  const my = y1 + dy * 0.5;
  const vertical = Math.abs(dy) > Math.abs(dx);
  const tw = label.length * size * 0.62 + 16;
  const labelP = prog(p * 30, 18, 10);
  return (
    <g>
      <Draw d={`M${x1} ${y1} L${x1 + dx * p} ${y1 + dy * p}`} p={1} stroke={color} width={1.5} />
      <Draw d={`M${x1 - nx} ${y1 - ny} L${x1 + nx} ${y1 + ny}`} p={Math.min(1, p * 4)} stroke={color} width={1.5} />
      <Draw d={`M${x2 - nx} ${y2 - ny} L${x2 + nx} ${y2 + ny}`} p={p >= 1 ? 1 : 0} stroke={color} width={1.5} />
      <g opacity={labelP} transform={`translate(${mx} ${my}) ${vertical ? "rotate(-90)" : ""}`}>
        <rect x={-tw / 2} y={-size * 0.75} width={tw} height={size * 1.5} fill={bg} />
        <text x={0} y={size * 0.36} textAnchor="middle" fontFamily={MONO} fontSize={size} fill={color}>
          {label}
        </text>
      </g>
    </g>
  );
};

/** The sheet: a drawn border and a title block, like one sheet of a drawing set. */
export const Sheet: React.FC<{ name: string; index: number; of: number; children: React.ReactNode }> = ({
  name,
  index,
  of,
  children,
}) => {
  const tbW = 600;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: SANS, color: C.ink }}>
      {children}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <rect x={INSET} y={INSET} width={W - INSET * 2} height={H - INSET * 2} fill="none" stroke={C.border} strokeWidth={1} />
        <line x1={W - INSET - tbW} y1={H - INSET - 64} x2={W - INSET} y2={H - INSET - 64} stroke={C.ink} strokeWidth={1} />
        <line x1={W - INSET - tbW} y1={H - INSET - 64} x2={W - INSET - tbW} y2={H - INSET} stroke={C.border} strokeWidth={1} />
        <line x1={W - INSET - 112} y1={H - INSET - 64} x2={W - INSET - 112} y2={H - INSET} stroke={C.border} strokeWidth={1} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: W - INSET - tbW + 20,
          top: H - INSET - 64,
          height: 64,
          width: tbW - 20 - 112,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Mark h={26} />
        <span style={{ fontWeight: 800, fontSize: 21, letterSpacing: "-0.02em" }}>Basement Ready</span>
        <span style={{ width: 1, height: 24, background: C.border, margin: "0 6px" }} />
        <span style={{ fontWeight: 600, fontSize: 19, color: C.muted }}>{name}</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: W - INSET - 112,
          width: 112,
          top: H - INSET - 64,
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: MONO,
          fontSize: 18,
        }}
      >
        {String(index).padStart(2, "0")} / {String(of).padStart(2, "0")}
      </div>
    </AbsoluteFill>
  );
};

/** One line of the voiceover, shown at the bottom left of the sheet. Long lines show sentence by sentence. */
export const Caption: React.FC<{ text: string; dur: number }> = ({ text, dur }) => {
  const frame = useCurrentFrame();
  const parts = splitCaption(text);
  const total = parts.reduce((a, p) => a + p.length, 0);
  let acc = 0;
  let shown = parts[0];
  for (const part of parts) {
    const start = (acc / total) * dur;
    if (frame >= start - 2) shown = part;
    acc += part.length;
  }
  const o = Math.min(prog(frame, 0, 6), 1 - prog(frame, dur + 4, 6));
  return (
    <div
      style={{
        position: "absolute",
        left: INSET + 32,
        bottom: INSET + 14,
        width: W - INSET * 2 - 600 - 64,
        height: 72,
        display: "flex",
        alignItems: "flex-end",
        fontFamily: SANS,
        fontWeight: 500,
        fontSize: 27,
        lineHeight: 1.3,
        color: C.ink,
        opacity: o,
      }}
    >
      <span>{shown}</span>
    </div>
  );
};

const splitCaption = (text: string) => {
  if (text.length <= 96) return [text];
  const sentences = text.match(/[^.?!:]+[.?!:]+(\s|$)|[^.?!:]+$/g)?.map((s) => s.trim()) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    const last = out[out.length - 1];
    if (last && (last + " " + s).length <= 96) out[out.length - 1] = last + " " + s;
    else out.push(s);
  }
  return out;
};

/** A big screen title: Hanken 900, tight, words rising into place one after another. */
export const Title: React.FC<{
  text: string;
  start?: number;
  size?: number;
  width?: number;
  style?: React.CSSProperties;
  out?: number;
}> = ({ text, start = 0, size = 112, width = 900, style, out }) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  const fadeOut = out === undefined ? 1 : 1 - prog(frame, out, 10, easeDraw);
  return (
    <div
      style={{
        fontFamily: SANS,
        fontWeight: 900,
        fontSize: size,
        letterSpacing: "-0.045em",
        lineHeight: 0.95,
        width,
        opacity: fadeOut,
        ...style,
      }}
    >
      {words.map((w, i) => {
        const p = prog(frame, start + i * 3, 16);
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: size * 0.12 }}>
            <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 100}%)` }}>
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/** Camera keys for a recording: [seconds into the shot, zoom, focus x 0..1, focus y 0..1]. */
export type CamKey = [number, number, number, number];

const camAt = (keys: CamKey[] | undefined, t: number) => {
  if (!keys || !keys.length) return { z: 1, fx: 0.5, fy: 0.5 };
  if (t <= keys[0][0]) return { z: keys[0][1], fx: keys[0][2], fy: keys[0][3] };
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, z0, x0, y0] = keys[i];
    const [t1, z1, x1, y1] = keys[i + 1];
    if (t <= t1) {
      const k = easeOut(Math.min(1, Math.max(0, (t - t0) / Math.max(0.001, t1 - t0))));
      return { z: z0 + (z1 - z0) * k, fx: x0 + (x1 - x0) * k, fy: y0 + (y1 - y0) * k };
    }
  }
  const l = keys[keys.length - 1];
  return { z: l[1], fx: l[2], fy: l[3] };
};

/** A drawn browser window holding a desktop recording, with an easing camera to make small text readable. */
export const Browser: React.FC<{
  x: number; y: number; w: number; src: string; start: number; url?: string; p?: number; rate?: number; cam?: CamKey[]; tilt?: boolean; tag?: string; aspect?: number;
}> = ({ x, y, w, src, start, url = "basementready.com", p = 1, rate = 1, cam, tilt = false, tag, aspect = 1080 / 1920 }) => {
  const frame = useCurrentFrame();
  const h = w * aspect;
  const still = /\.(png|jpe?g)$/i.test(src);
  const bar = 40;
  const c = camAt(cam, frame / 30);
  const c0 = camAt(cam, (frame - 1) / 30);
  const blur = Math.min(3.5, Math.abs(c.z - c0.z) * 140 + (Math.abs(c.fx - c0.fx) + Math.abs(c.fy - c0.fy)) * 180);
  const dir = src.length % 2 ? 1 : -1;
  const k = easeOut(Math.min(1, Math.max(0, frame / 150)));
  const rotY = tilt ? dir * (-15 + 23 * k) + 1.2 * Math.sin(frame / 70) : 0;
  const rotX = tilt ? 7 - 4 * k : 0;
  const dolly = tilt ? -150 + 190 * easeOut(Math.min(1, Math.max(0, frame / 120))) : 0;
  const floatY = tilt ? 5 * Math.sin(frame / 55) : 0;
  const glare = Math.min(1, Math.max(0, (frame - 6) / 34));
  // keep the zoomed picture inside the frame: translate so the focus point moves toward the centre
  const tx = (0.5 - c.fx) * w * (c.z - 1);
  const ty = (0.5 - c.fy) * h * (c.z - 1);
  const maxX = (w * (c.z - 1)) / 2, maxY = (h * (c.z - 1)) / 2;
  const cx = Math.max(-maxX, Math.min(maxX, tx));
  const cy = Math.max(-maxY, Math.min(maxY, ty));
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y + (1 - p) * 40,
        width: w,
        height: h + bar,
        borderRadius: 6,
        border: `1.5px solid ${C.ink}`,
        background: C.card,
        overflow: "hidden",
        opacity: p,
        transform: tilt ? `perspective(1800px) translateZ(${dolly}px) rotateY(${rotY}deg) rotateX(${rotX}deg) translateY(${floatY}px)` : undefined,
        boxShadow: tilt ? "0 50px 90px -40px rgb(15 42 30 / 0.55), 0 12px 24px -12px rgb(15 42 30 / 0.25)" : undefined,
      }}
    >
      <div style={{ height: bar, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: `1px solid ${C.border}` }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 11, height: 11, borderRadius: 99, border: `1.5px solid ${C.ink}`, opacity: 0.6 }} />
        ))}
        <span
          style={{
            marginLeft: 18,
            fontFamily: MONO,
            fontSize: 16,
            color: C.muted,
            padding: "3px 14px",
            border: `1px solid ${C.border}`,
            borderRadius: 4,
          }}
        >
          {url}
        </span>
        {tag && <span style={{ marginLeft: "auto", fontFamily: SANS, fontWeight: 600, fontSize: 17, color: C.ink, padding: "3px 12px", border: `1.5px solid ${C.ink}`, borderRadius: 4 }}>{tag}</span>}
      </div>
      <div style={{ width: w, height: h, overflow: "hidden", position: "relative" }}>
        <div style={{ width: w, height: h, transform: `translate(${cx}px, ${cy}px) scale(${c.z})`, transformOrigin: "50% 50%", filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined }}>
          {still ? (
            <Img src={staticFile(src)} style={{ width: w, height: h, display: "block" }} />
          ) : (
            <OffthreadVideo src={staticFile(src)} startFrom={Math.round(start * 30)} playbackRate={rate} muted style={{ width: w, height: h, display: "block" }} />
          )}
        </div>
        {tilt && glare > 0 && glare < 1 && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(105deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0) 60%)", transform: `translateX(${(glare * 2 - 1) * 110}%)` }} />
        )}
      </div>
    </div>
  );
};

/** A drawn phone holding a phone-size recording (390 × 844 points). */
export const Phone: React.FC<{
  x: number; y: number; h: number; src?: string; start?: number; p?: number; rate?: number; children?: React.ReactNode;
}> = ({ x, y, h, src, start = 0, p = 1, rate = 1, children }) => {
  const frame = useCurrentFrame();
  const sw = (h - 28) * (390 / 844);
  const w = sw + 28;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y + (1 - p) * 40,
        width: w,
        height: h,
        borderRadius: 54,
        border: `3px solid ${C.ink}`,
        background: C.ink,
        padding: 11,
        opacity: p,
        boxSizing: "border-box",
        transform: `perspective(1800px) rotateY(${-18 + 24 * easeOut(Math.min(1, frame / 150))}deg) rotateX(5deg)`,
        boxShadow: "0 50px 90px -40px rgb(15 42 30 / 0.55)",
      }}
    >
      <div style={{ width: "100%", height: "100%", borderRadius: 42, overflow: "hidden", background: C.card, position: "relative" }}>
        {src ? (
          <OffthreadVideo src={staticFile(src)} startFrom={Math.round(start * 30)} playbackRate={rate} muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          children
        )}
      </div>
    </div>
  );
};

/** A status word with its square (brand/ui.md lists): Ready, To fix, Check. */
export const Status: React.FC<{ kind: "ok" | "fix" | "check" | "stop"; children: React.ReactNode; size?: number }> = ({
  kind,
  children,
  size = 22,
}) => {
  const color = kind === "ok" ? C.ok : kind === "fix" ? C.fix : kind === "stop" ? C.stop : C.muted;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color, fontWeight: 600, fontSize: size }}>
      <span style={{ width: 10, height: 10, background: color }} />
      {children}
    </span>
  );
};
