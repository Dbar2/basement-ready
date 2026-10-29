// "Paint the room": the whole basement as one unrolled 360° wall strip, with the ceiling folded up
// above it and the floor folded down below. The middle of the strip is always where the phone points;
// a viewfinder frame shows what's in the picture right now, and what has been filmed fills in mint.
// The live 3D, once the server has some, sits in the same panel and fills in as you film.
import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { lazy3d, View3DBoundary } from "../components/View3D";
import { cameraLift, type Lens } from "./media";
import {
  BAND_EDGES,
  BANDS,
  COL_DEG,
  COLS,
  CoverageGrid,
  LENS_FOV,
  cameraHeading,
  cellIndex,
  turnDelta,
  type Gap,
  type View,
} from "./paint";
import type { Preview3d, Steadiness } from "./live";

const Live3DThumb = lazy3d(() => import("./Live3D").then((m) => m.Live3DThumb));

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };

// Where the phone points, from either orientation event. iOS gives a true compass heading; Android's
// absolute event gives alpha from north, turned here into the rear camera's own heading.
function headingOf(e: OrientationEventWithCompass): number | null {
  if (typeof e.webkitCompassHeading === "number") return e.webkitCompassHeading;
  if (e.absolute && e.alpha != null && e.beta != null && e.gamma != null) return cameraHeading(e.alpha, e.beta, e.gamma);
  return null;
}

export type CoverageState = {
  view: { heading: number | null; elev: number } | null; // null until the tilt sensor reports
  compass: boolean;
  tilt: boolean;
  walls: number; // 0..1 painted
  ceiling: number;
  floor: number;
  version: number; // bumps on every repaint, for drawing
};

// Paints the grid from the phone's orientation while `active`, and re-renders about 8 times a second.
export function useCoverage(active: boolean, lens: Lens, portrait: boolean, steadyRef: RefObject<Steadiness>) {
  const gridRef = useRef(new CoverageGrid());
  const headingRef = useRef<number | null>(null);
  const viewRef = useRef<View | null>(null);
  const lensRef = useRef({ lens, portrait });
  lensRef.current = { lens, portrait };
  const [state, setState] = useState<CoverageState>({ view: null, compass: false, tilt: false, walls: 0, ceiling: 0, floor: 0, version: 0 });

  useEffect(() => {
    if (!active) return;
    const grid = gridRef.current;
    grid.reset();
    headingRef.current = null;
    viewRef.current = null;
    let heading: { value: number; at: number } | null = null;
    let elev: number | null = null;
    let version = 0;
    let drawnAt = 0;

    const draw = () => {
      setState({
        view: elev == null ? null : { heading: heading?.value ?? null, elev },
        compass: heading != null,
        tilt: elev != null,
        walls: grid.percent("walls"),
        ceiling: grid.percent("ceiling"),
        floor: grid.percent("floor"),
        version: ++version,
      });
    };

    const onOrient = (e: OrientationEventWithCompass) => {
      const now = performance.now();
      const h = headingOf(e);
      if (h != null) heading = { value: h, at: now };
      if (e.beta == null || e.gamma == null) return;
      elev = (Math.asin(Math.max(-1, Math.min(1, cameraLift(e.beta, e.gamma)))) * 180) / Math.PI;
      // A heading from the other event a moment ago still holds.
      const hv = heading && now - heading.at < 1000 ? heading.value : null;
      headingRef.current = hv;
      if (hv != null) {
        const view = { heading: hv, elev };
        viewRef.current = view;
        const { lens: l, portrait: p } = lensRef.current;
        const fov = p ? LENS_FOV[l] : { h: LENS_FOV[l].v, v: LENS_FOV[l].h };
        const s = steadyRef.current;
        grid.push(view, now, fov, !s || (s.bright && s.steady));
      }
      if (now - drawnAt > 120) {
        drawnAt = now;
        draw();
      }
    };
    const absolute = "ondeviceorientationabsolute" in window;
    window.addEventListener("deviceorientation", onOrient as EventListener);
    if (absolute) window.addEventListener("deviceorientationabsolute", onOrient as EventListener);
    return () => {
      window.removeEventListener("deviceorientation", onOrient as EventListener);
      if (absolute) window.removeEventListener("deviceorientationabsolute", onOrient as EventListener);
    };
  }, [active, steadyRef]);

  return {
    ...state,
    grid: gridRef.current,
    headingRef,
    viewRef,
    // Another part of the basement: the old paint fades, quietly.
    fade: () => {
      gridRef.current.fade();
      setState((s) => ({ ...s, walls: gridRef.current.percent("walls"), ceiling: gridRef.current.percent("ceiling"), floor: gridRef.current.percent("floor"), version: s.version + 1 }));
    },
  };
}

// ---------- the drawing ----------

const W = 336;
const CELL = W / COLS; // 14 units a column
const ROW = 15;
const CAP = 17;
const GAP = 1.5;
// Rows from the top: ceiling cap, high, mid and low wall, floor cap.
const ROWS = [
  { band: 4, y: 0, h: CAP },
  { band: 3, y: CAP + GAP, h: ROW },
  { band: 2, y: CAP + ROW + GAP * 2, h: ROW },
  { band: 1, y: CAP + ROW * 2 + GAP * 3, h: ROW },
  { band: 0, y: CAP + ROW * 3 + GAP * 4, h: CAP },
];
const H = CAP * 2 + ROW * 3 + GAP * 4;
const CENTRE = W / 2;

// Elevation (degrees) to a height in the drawing, band by band.
function yOf(elev: number) {
  const e = Math.max(-90, Math.min(90, elev));
  for (const r of ROWS) {
    const lo = BAND_EDGES[r.band], hi = BAND_EDGES[r.band + 1];
    if (e >= lo && e <= hi) return r.y + r.h * (1 - (e - lo) / (hi - lo));
  }
  return e > 0 ? 0 : H;
}

// One cell's outline. Ceiling and floor cells narrow away from the walls, like a box folded flat.
function cellPath(x: number, band: number) {
  const r = ROWS.find((row) => row.band === band)!;
  const w = CELL - GAP;
  if (band === 4 || band === 0) {
    const inset = w * 0.16;
    const [near, far] = band === 4 ? [r.y + r.h, r.y] : [r.y, r.y + r.h];
    return `M${x} ${near}H${x + w}L${x + w - inset} ${far}H${x + inset}Z`;
  }
  return `M${x} ${r.y}h${w}v${r.h}h${-w}Z`;
}

export function CoverageStrip(props: {
  grid: CoverageGrid;
  view: CoverageState["view"];
  version: number;
  lens: Lens;
  portrait: boolean;
  gap: Gap | null;
}) {
  const { grid, view, lens, portrait, gap } = props;
  const heading = view?.heading ?? 0;
  const cells: ReactNode[] = [];
  for (const r of ROWS) {
    for (let c = 0; c < COLS; c++) {
      // Column centre relative to where the phone points, so the middle is always straight ahead.
      const d = turnDelta(heading, (c + 0.5) * COL_DEG);
      const x = CENTRE + (d / COL_DEG) * CELL - (CELL - GAP) / 2;
      const f = grid.fill(cellIndex(r.band, c));
      const target = gap && gap.col === c && gap.band === r.band;
      const style = { "--f": f.toFixed(2) } as CSSProperties;
      // The column straddling the back seam shows at both ends.
      for (const at of x < 0 ? [x, x + W] : [x]) {
        cells.push(<path key={`${r.band}-${c}-${at}`} d={cellPath(at, r.band)} className="cov-cell" data-band={BANDS[r.band]} data-target={target || undefined} style={style} />);
      }
    }
  }
  const fov = portrait ? LENS_FOV[lens] : { h: LENS_FOV[lens].v, v: LENS_FOV[lens].h };
  const frame = view
    ? (() => {
        const fw = (fov.h / COL_DEG) * CELL;
        const top = yOf(view.elev + fov.v / 2), bottom = yOf(view.elev - fov.v / 2);
        return { x: CENTRE - fw / 2, y: top, w: fw, h: Math.max(6, bottom - top) };
      })()
    : null;
  const tick = 6;
  return (
    <svg className="cov-strip" viewBox={`-2 -3 ${W + 4} ${H + 6}`} aria-hidden>
      <defs>
        <clipPath id="cov-clip">
          <rect x={0} y={-3} width={W} height={H + 6} />
        </clipPath>
      </defs>
      <g clipPath="url(#cov-clip)">{cells}</g>
      {frame && (
        <g className="cov-frame">
          <path
            d={[
              `M${frame.x} ${frame.y + tick}V${frame.y}H${frame.x + tick}`,
              `M${frame.x + frame.w - tick} ${frame.y}H${frame.x + frame.w}V${frame.y + tick}`,
              `M${frame.x} ${frame.y + frame.h - tick}V${frame.y + frame.h}H${frame.x + tick}`,
              `M${frame.x + frame.w - tick} ${frame.y + frame.h}H${frame.x + frame.w}V${frame.y + frame.h - tick}`,
            ].join("")}
          />
        </g>
      )}
    </svg>
  );
}

// The one panel at the bottom while filming: the task, the painted basement, and the 3D so far.
export function CoveragePanel(props: {
  title: string;
  count: string;
  coverage: ReturnType<typeof useCoverage>;
  lens: Lens;
  portrait: boolean;
  gap: Gap | null;
  preview: Preview3d | null;
  onOpen3d?: () => void;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { title, count, coverage, lens, portrait, gap, preview, onOpen3d, action, children } = props;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const summary = `Filmed so far: walls ${pct(coverage.walls)}, ceiling ${pct(coverage.ceiling)}, floor ${pct(coverage.floor)}`;
  return (
    <div className="cov-panel">
      <div className="cov-head">
        <div className="cov-task">
          <h2 className="guide-task" key={title} data-focus tabIndex={-1}>
            {title}
          </h2>
          <span className="cov-count">
            {count}
            {action}
          </span>
        </div>
        {preview && preview.count > 0 && (
          <button className="cov-3d" onClick={onOpen3d} aria-label="Open the 3D of your basement so far">
            <View3DBoundary quiet>
              <Suspense fallback={null}>
                <Live3DThumb preview={preview} />
              </Suspense>
            </View3DBoundary>
            <span>3D</span>
          </button>
        )}
      </div>
      {children}
      {coverage.compass ? (
        <figure className="cov-figure" role="img" aria-label={summary}>
          <CoverageStrip grid={coverage.grid} view={coverage.view} version={coverage.version} lens={lens} portrait={portrait} gap={gap} />
          <figcaption className="cov-legend" aria-hidden>
            <span>Ceiling {pct(coverage.ceiling)}</span>
            <span>Walls {pct(coverage.walls)}</span>
            <span>Floor {pct(coverage.floor)}</span>
          </figcaption>
        </figure>
      ) : (
        <p className="cov-none">{coverage.tilt ? "No compass on this phone: follow the voice." : "Turn on motion to see what's filmed. Or just follow the voice."}</p>
      )}
    </div>
  );
}
