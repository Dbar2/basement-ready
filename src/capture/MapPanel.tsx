// The big map under the camera while filming: the task on top, the basement so far below it (the 3D
// rebuilt every few seconds, map.ts and Live3D.tsx), and one line on what's still missing. Before the
// first rebuild, and wherever the 3D can't run, a compass cone shows which way the phone points.
import { Component, Suspense, useMemo, useRef, type ReactNode } from "react";
import { lazy3d } from "../components/View3D";
import type { Preview3d } from "./live";
import { ceilingMissing, mapStatus, markerYaw, quarterTurns, shownYaws, type LiveMap } from "./map";

const LiveMap3D = lazy3d(() => import("./Live3D").then((m) => m.LiveMap3D));

// Each rebuild turned to match the one before, so the map never flips while you film.
export function useMapView(preview: Preview3d | null) {
  const shownRef = useRef<{ version: number; turns: number; yaws: Map<number, number> } | null>(null);
  const map = preview?.map?.box ? preview.map : null;
  if (preview && map && shownRef.current?.version !== preview.version) {
    const turns = quarterTurns(map.path, shownRef.current?.yaws ?? null);
    shownRef.current = { version: preview.version, turns, yaws: shownYaws(map.path, turns) };
  }
  if (!preview) shownRef.current = null;
  return { map, turns: shownRef.current?.turns ?? 0 };
}

// A failed WebGL context or a failed download shows the compass instead.
class MapBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Which way the phone points, before there's a map to put it on. North is up.
function Compass({ heading, note }: { heading: number | null; note: string }) {
  const half = 28 * (Math.PI / 180);
  const r = 64;
  const cone = `M0 0L${-Math.sin(half) * r} ${-Math.cos(half) * r}A${r} ${r} 0 0 1 ${Math.sin(half) * r} ${-Math.cos(half) * r}Z`;
  return (
    <div className="map-compass">
      <svg viewBox="-80 -80 160 160" aria-hidden>
        <circle r={r} className="map-ring" />
        <text y={-r - 6} className="map-north">
          N
        </text>
        {heading != null && <path d={cone} className="map-cone" transform={`rotate(${heading.toFixed(1)})`} />}
        <circle r={9} className="map-you" />
      </svg>
      <p>{note}</p>
    </div>
  );
}

export function MapPanel(props: {
  title: string;
  count: string;
  action?: ReactNode;
  children?: ReactNode;
  preview: Preview3d | null;
  available: boolean;
  compass: number | null; // the phone's compass now, if it has one
  ceilingPainted: number; // 0..1 of the ceiling the phone has pointed at
  onOpen3d?: () => void;
}) {
  const { title, count, action, children, preview, available, compass, ceilingPainted, onOpen3d } = props;
  const { map, turns } = useMapView(preview);
  const yaw = map ? markerYaw(map, compass) : null;
  const ceilingGap = ceilingMissing(map, ceilingPainted);
  const status = map ? mapStatus(map, ceilingGap) : "";
  const label = useMemo(() => describe(map, status), [map, status]);
  const compassView = <Compass heading={compass} note={available ? "Starting the map…" : "No live map right now. Follow the voice."} />;

  return (
    <section className="map-panel" aria-label="Your basement so far">
      <div className="map-head">
        <h2 className="guide-task" key={title} data-focus tabIndex={-1}>
          {title}
        </h2>
        <span className="map-count">
          {count}
          {action}
        </span>
      </div>
      {children}
      <div className="map-view">
        <div className="map-art" role="img" aria-label={label}>
          {map && preview ? (
            <MapBoundary fallback={compassView}>
              <Suspense fallback={compassView}>
                <LiveMap3D preview={preview} turns={turns} yaw={yaw} ceilingGap={ceilingGap} />
              </Suspense>
            </MapBoundary>
          ) : (
            compassView
          )}
        </div>
        {status && (
          <p className="map-status" aria-hidden>
            {/not filmed/.test(status) ? (
              <svg viewBox="0 0 22 4" className="map-dash">
                <path d="M1 2H21" />
              </svg>
            ) : null}
            {status}
          </p>
        )}
        {preview && preview.count > 0 && onOpen3d && (
          <button className="map-open" onClick={onOpen3d} aria-label="Open the 3D of your basement so far">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}

function describe(map: LiveMap | null, status: string) {
  if (!map) return "The map of your basement is starting.";
  return `Map of your basement so far, with where you are. ${status}.`;
}
