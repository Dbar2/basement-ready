// Drawing-style marks: viewfinder corner ticks, dimension lines and the recording ruler.
import { formatTime } from "./media";

export function CornerTicks() {
  return (
    <span className="cap-ticks" aria-hidden>
      <i data-c="tl" />
      <i data-c="tr" />
      <i data-c="bl" />
      <i data-c="br" />
    </span>
  );
}

export function Crosshair() {
  return <span className="cap-cross" aria-hidden />;
}

// An architectural dimension line: slash ticks at both ends, the measurement in the middle.
export function Dimension({ label, axis = "x", className = "" }: { label: string; axis?: "x" | "y"; className?: string }) {
  return (
    <span className={`cap-dim ${className}`} data-axis={axis} aria-hidden>
      <span className="cap-dim-label">{label}</span>
    </span>
  );
}

const TICK_EVERY = 10;

export function Ruler({ elapsed, min, max }: { elapsed: number; min: number; max: number }) {
  const at = (sec: number) => `${(Math.min(sec, max) / max) * 100}%`;
  const ticks = Array.from({ length: max / TICK_EVERY + 1 }, (_, i) => i * TICK_EVERY);
  return (
    <div
      className="cap-ruler"
      role="progressbar"
      aria-label="Recording length"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.floor(elapsed)}
      aria-valuetext={`${formatTime(elapsed)} of ${formatTime(max)}. At least ${formatTime(min)}.`}
      data-past-min={elapsed >= min}
    >
      <div className="cap-ruler-track">
        <span className="cap-ruler-fill" style={{ width: at(elapsed) }} />
        {ticks.map((t) => (
          <span key={t} className="cap-ruler-tick" data-major={t % 30 === 0} style={{ left: at(t) }} />
        ))}
        <span className="cap-ruler-min" style={{ left: at(min) }} />
      </div>
      <div className="cap-ruler-labels" aria-hidden>
        <span style={{ left: 0 }}>0:00</span>
        <span className="cap-ruler-minlabel" style={{ left: at(min) }}>
          min {formatTime(min)}
        </span>
        <span style={{ right: 0 }}>max {formatTime(max)}</span>
      </div>
    </div>
  );
}

const svg = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true } as const;

export const Icon = {
  close: () => (
    <svg {...svg}>
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" />
    </svg>
  ),
  check: () => (
    <svg {...svg} viewBox="0 0 16 16">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  ),
  play: () => (
    <svg {...svg}>
      <path d="M6 4l10 6-10 6z" fill="currentColor" />
    </svg>
  ),
  pause: () => (
    <svg {...svg}>
      <path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" fill="currentColor" />
    </svg>
  ),
  rec: () => (
    <svg {...svg} viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.5" fill="currentColor" />
    </svg>
  ),
  stop: () => (
    <svg {...svg} viewBox="0 0 16 16">
      <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  ),
  arrow: () => (
    <svg {...svg}>
      <path d="M4 10h11M11 6l4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" />
    </svg>
  ),
};
