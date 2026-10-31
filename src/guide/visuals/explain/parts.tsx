// The pieces every explainer drawing is built from, in Drawing Set (brand/ui.md): a paper sheet with a
// title, ink lines, callout leaders (a line to a shoulder, the label on the shoulder) and dimension lines
// (ticks at the ends, the figure centred on a knock-out). One 400 × 300 drawing space, scaled to the pane.
import type { ReactNode } from "react";

export const VW = 400;
export const VH = 300;

type P = [number, number];

// The drawing: a figure that fills the pane, with its title drawn on the sheet and its words for screen
// readers. Lines marked `draw` stroke in once when it appears (not with reduced motion).
export function Sheet({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return (
    <svg className="ex" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <rect className="ex-paper" x={0} y={0} width={VW} height={VH} />
      <text className="ex-title" x={20} y={30}>
        {title}
      </text>
      {children}
    </svg>
  );
}

// A callout: a 1 px ink line from the thing to a shoulder, then the words on the shoulder. `figure` is a
// measurement under the words, in Geist Mono. The shoulder runs right unless `left`.
export function Leader({ from, to, label, figure, left, tone }: { from: P; to: P; label: string; figure?: string; left?: boolean; tone?: "stop" }) {
  const shoulder = left ? to[0] - 14 : to[0] + 14;
  const tx = left ? shoulder - 4 : shoulder + 4;
  const anchor = left ? "end" : "start";
  return (
    <g className="ex-leader" data-tone={tone}>
      <circle className="ex-dot" cx={from[0]} cy={from[1]} r={2.5} />
      <path className="ex-thin" d={`M${from[0]} ${from[1]} L${to[0]} ${to[1]} H${shoulder}`} />
      <text className="ex-label" x={tx} y={to[1] + 4} textAnchor={anchor}>
        {label}
      </text>
      {figure && (
        <text className="ex-figure" x={tx} y={to[1] + 19} textAnchor={anchor}>
          {figure}
        </text>
      )}
    </g>
  );
}

// A dimension line from a to b, `off` px to one side, with 6 px ticks and the figure centred on it.
export function Dim({ a, b, label, off = 0 }: { a: P; b: P; label: string; off?: number }) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const A: P = [a[0] + nx * off, a[1] + ny * off];
  const B: P = [b[0] + nx * off, b[1] + ny * off];
  const tick = (p: P) => `M${p[0] - nx * 6} ${p[1] - ny * 6} L${p[0] + nx * 6} ${p[1] + ny * 6}`;
  const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
  const vertical = Math.abs(dy) > Math.abs(dx);
  const w = label.length * 6.8 + 10;
  return (
    <g className="ex-dim">
      {off !== 0 && <path className="ex-ext" d={`M${a[0]} ${a[1]} L${A[0] + nx * 4} ${A[1] + ny * 4} M${b[0]} ${b[1]} L${B[0] + nx * 4} ${B[1] + ny * 4}`} />}
      <path className="ex-thin" d={`M${A[0]} ${A[1]} L${B[0]} ${B[1]} ${tick(A)} ${tick(B)}`} />
      <g transform={vertical ? `rotate(-90 ${mx} ${my})` : undefined}>
        <rect className="ex-knock" x={mx - w / 2} y={my - 8} width={w} height={16} />
        <text className="ex-figure" x={mx} y={my + 4} textAnchor="middle">
          {label}
        </text>
      </g>
    </g>
  );
}

// Plain words on the sheet, in body type; `muted` for the places ("The home upstairs").
export function Words({ at, children, muted, anchor }: { at: P; children: ReactNode; muted?: boolean; anchor?: "start" | "middle" | "end" }) {
  return (
    <text className={muted ? "ex-words ex-muted" : "ex-words"} x={at[0]} y={at[1]} textAnchor={anchor}>
      {children}
    </text>
  );
}
