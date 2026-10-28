// The record ring: the record button in the middle, the six things to show us around it, and a thin
// outer track that fills where the phone has pointed in this room. One control, nothing else on screen.
import type { ReactNode } from "react";
import { CHECKLIST, MAX_SEC, MIN_SEC, type ChecklistId } from "./checklist";

const C = 120; // viewBox centre; the ring is drawn on a 240 × 240 grid
const R_IN = 52;
const R_OUT = 104;
const R_TRACK = 114;
const R_TIME = 46;
const GAP = 3.5; // degrees between segments

// Clockwise from the top, the way a walk-through usually goes.
const ORDER: ChecklistId[] = ["stairs", "ceiling", "door", "plans", "furnace", "windows"];

const rad = (deg: number) => (deg * Math.PI) / 180;
const at = (deg: number, r: number) => [C + r * Math.sin(rad(deg)), C - r * Math.cos(rad(deg))] as const;

function sector(a0: number, a1: number, r0: number, r1: number) {
  const [x0, y0] = at(a0, r1), [x1, y1] = at(a1, r1), [x2, y2] = at(a1, r0), [x3, y3] = at(a0, r0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

function arc(a0: number, a1: number, r: number) {
  const [x0, y0] = at(a0, r), [x1, y1] = at(a1, r);
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<ChecklistId, ReactNode> = {
  stairs: <path {...stroke} d="M4 19h4v-4h4v-4h4V7h4" />,
  windows: (
    <g {...stroke}>
      <rect x="5" y="5" width="14" height="14" rx="1" />
      <path d="M12 5v14M5 12h14" />
    </g>
  ),
  ceiling: <path {...stroke} d="M4 5h16M12 19V9M8.5 12.5 12 9l3.5 3.5" />,
  door: (
    <g {...stroke}>
      <path d="M7 20V4h10v16M4 20h16" />
      <circle cx="14.2" cy="12.5" r="0.6" fill="currentColor" />
    </g>
  ),
  furnace: (
    <g {...stroke}>
      <rect x="6" y="3.5" width="12" height="17" rx="1" />
      <path d="M9 7.5h6M12 17.2c-1.4 0-2.3-.9-2.3-2.1 0-1.3 1.3-2 2.3-3.4 1 1.4 2.3 2.1 2.3 3.4 0 1.2-.9 2.1-2.3 2.1Z" />
    </g>
  ),
  plans: <path {...stroke} d="M5 6h14v9h-8l-4 3v-3H5z" />,
};

export type RingCoverage = { covered: boolean[]; heading: number | null; supported: boolean };

export function Ring(props: {
  recording: boolean;
  done: ChecklistId[];
  windows: number;
  coverage: RingCoverage;
  elapsed: number;
  canStart: boolean;
  onPrimary: () => void;
  onToggle: (id: ChecklistId) => void;
}) {
  const { recording, done, windows, coverage, elapsed, canStart, onPrimary, onToggle } = props;
  const seg = 360 / ORDER.length;
  const bin = 360 / coverage.covered.length;
  const pastMin = elapsed >= MIN_SEC;
  const timeEnd = Math.min(359.9, (elapsed / MAX_SEC) * 360);

  return (
    <div className="ring" data-recording={recording}>
      <svg className="ring-svg" viewBox="0 0 240 240" aria-hidden>
        <circle cx={C} cy={C} r={R_OUT + 3} className="ring-back" />
        {ORDER.map((id, i) => (
          <path
            key={id}
            className="ring-seg"
            data-done={done.includes(id)}
            d={sector(i * seg - seg / 2 + GAP, (i + 1) * seg - seg / 2 - GAP, R_IN + 3, R_OUT - 3)}
          />
        ))}

        {/* This room's walls: lit where the phone has pointed. A gap means a wall not filmed yet. */}
        {recording &&
          coverage.supported &&
          coverage.covered.map((on, i) => <path key={i} className="ring-track" data-on={on} d={arc(i * bin + 0.8, (i + 1) * bin - 0.8, R_TRACK)} />)}
        {recording && !coverage.supported && <circle cx={C} cy={C} r={R_TRACK} className="ring-track-plain" />}
        {recording && coverage.supported && coverage.heading != null && (
          <circle className="ring-heading" cx={at(coverage.heading, R_TRACK)[0]} cy={at(coverage.heading, R_TRACK)[1]} r={4.5} />
        )}

        {/* Time: a hairline round the button, with a tick at the 30-second minimum. */}
        {recording && (
          <>
            <circle cx={C} cy={C} r={R_TIME} className="ring-time-base" />
            {elapsed > 0.2 && <path className="ring-time" d={arc(0, timeEnd, R_TIME)} />}
            <line
              className="ring-time-min"
              data-past={pastMin}
              x1={at((MIN_SEC / MAX_SEC) * 360, R_TIME - 4)[0]}
              y1={at((MIN_SEC / MAX_SEC) * 360, R_TIME - 4)[1]}
              x2={at((MIN_SEC / MAX_SEC) * 360, R_TIME + 4)[0]}
              y2={at((MIN_SEC / MAX_SEC) * 360, R_TIME + 4)[1]}
            />
          </>
        )}
      </svg>

      {ORDER.map((id, i) => {
        const item = CHECKLIST.find((c) => c.id === id)!;
        const [x, y] = at(i * seg, (R_IN + R_OUT) / 2);
        const isDone = done.includes(id);
        return (
          <button
            key={id}
            className="ring-icon"
            data-done={isDone}
            style={{ left: `${(x / 240) * 100}%`, top: `${(y / 240) * 100}%` }}
            aria-pressed={recording ? isDone : undefined}
            aria-label={recording ? `${item.label}${isDone ? ", done" : ""}` : item.label}
            disabled={!recording}
            onClick={() => onToggle(id)}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              {ICONS[id]}
            </svg>
            {id === "windows" && windows > 1 && <span className="ring-count">{windows}</span>}
          </button>
        );
      })}

      <button
        className="ring-primary"
        data-waiting={recording && !pastMin}
        onClick={onPrimary}
        disabled={!recording && !canStart}
        aria-disabled={recording && !pastMin}
        aria-label={recording ? (pastMin ? "Stop and review" : `Keep filming, ${Math.ceil(MIN_SEC - elapsed)} seconds to go`) : "Start recording"}
      >
        <span className="ring-primary-mark" aria-hidden />
      </button>
    </div>
  );
}
