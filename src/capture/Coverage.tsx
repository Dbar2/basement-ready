// What's been filmed, from the phone's own compass and tilt: the walls, ceiling and floor around the
// phone, painted as it points at them (paint.ts). Never drawn; it ticks the walls, ceiling and floor
// steps and points the turn-or-tilt hints at what's missed. The map shows the rest.
import { useEffect, useRef, useState, type RefObject } from "react";
import { cameraLift, type Lens } from "./media";
import { CoverageGrid, LENS_FOV, cameraHeading, type View } from "./paint";
import type { Steadiness } from "./live";

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
