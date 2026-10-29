// "Your basement, scanned": the 3D scan and the measured floor plan, one tap apart. A scan that put
// its rooms together shows one basement; older scans show a tab per room.
import { Suspense, useRef, useState } from "react";
import type { Layout, Plan, RoomPlacement, RoomResult } from "../api";
import { basementRooms, placeLayout, scanLabels } from "./basementPlan";
import { BasementFloorPlan, downloadSvg, FloorPlan, type Units } from "./FloorPlan";
import { lazy3d, View3DBoundary } from "./View3D";

// three.js is heavy; load the 3D view only when someone opens it.
const ScanViewer3D = lazy3d(() => import("../three/ScanViewer3D").then((m) => m.ScanViewer3D));
const RealScan = lazy3d(() => import("../three/RealScan").then((m) => m.RealScan));
const StagedFurniture = lazy3d(() => import("../three/StagedBasement").then((m) => m.StagedFurniture));

const size = (p: Plan | null) => (p ? `${p.widthM.toFixed(1)} × ${p.depthM.toFixed(1)} m` : "No 3D");

// The whole basement, one model and one plan.
function BasementViews(props: {
  scanId: string;
  rooms: NonNullable<ReturnType<typeof basementRooms>>;
  layout: Layout | null; // in the basement frame, for the plan
  staging: { plan: Plan; layout: Layout; placement: RoomPlacement } | null; // the main room's own frame, for the 3D
}) {
  const { scanId, rooms, layout, staging } = props;
  const [view, setView] = useState<"3d" | "plan">("3d");
  const [units, setUnits] = useState<Units>("m");
  const planRef = useRef<HTMLDivElement>(null);
  const ceilings = rooms.flatMap((r) => (r.plan.ceilingHeightM != null ? [r.plan.ceilingHeightM] : []));
  const rough = rooms.some((r) => !r.plan.trusted);
  return (
    <section className="block scan-views">
      <div className="scan-views-head">
        <h2>Your basement, scanned</h2>
        <div className="segmented" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "3d"} onClick={() => setView("3d")}>
            3D
          </button>
          <button role="tab" aria-selected={view === "plan"} onClick={() => setView("plan")}>
            Plan
          </button>
        </div>
      </div>
      <div className="scan-views-frame" data-view={view}>
        <div className="view-layer" hidden={view !== "3d"}>
          <View3DBoundary>
            <Suspense fallback={<p className="viewer-empty mono">Loading your basement in 3D…</p>}>
              <RealScan
                surfelsUrl={`/api/scans/${scanId}/3d/surfels.bin?room=all`}
                scanUrl={`/api/scans/${scanId}/3d/scan.json?room=all`}
                ceilingHeightM={ceilings.length ? Math.max(...ceilings) : null}
                labels={scanLabels(rooms.map((r) => r.plan))}
                ideas={
                  staging && (
                    // Room frame -> basement frame: x' = c·x − s·z is a turn of −θ about +Y in three.js.
                    <group rotation-y={(-staging.placement.turn * Math.PI) / 2} position={[staging.placement.x, 0, staging.placement.z]}>
                      <StagedFurniture plan={staging.plan} layout={staging.layout} />
                    </group>
                  )
                }
              />
            </Suspense>
          </View3DBoundary>
        </div>
        <div ref={planRef} className="plan-wrap" hidden={view !== "plan"}>
          <BasementFloorPlan rooms={rooms.map((r) => ({ name: r.room.name, plan: r.plan }))} units={units} layout={layout} />
        </div>
      </div>
      {view === "plan" && (
        <div className="scan-views-tools">
          <div className="segmented small" role="group" aria-label="Units">
            <button aria-pressed={units === "m"} onClick={() => setUnits("m")}>m</button>
            <button aria-pressed={units === "ft"} onClick={() => setUnits("ft")}>ft</button>
          </div>
          <button
            className="link-quiet"
            onClick={() => {
              const svg = planRef.current?.querySelector("svg");
              if (svg) downloadSvg(svg, "basement-plan.svg");
            }}
          >
            Download plan (SVG)
          </button>
          {rough && <span className="muted">Sizes are from your video. A designer confirms them with a tape before drawing.</span>}
        </div>
      )}
    </section>
  );
}

export function ScanViews(props: { scanId: string; plan: Plan | null; has3d: boolean; rooms?: RoomResult[]; mainRoom?: number | null; layout?: Layout | null }) {
  const basement = basementRooms(props.rooms);
  if (basement) {
    // The layout was worked out in the main room; it moves with that room.
    const main = basement.find((b) => b.room.index === props.mainRoom)?.room;
    const layout = props.layout && main?.placement ? placeLayout(props.layout, main.placement) : null;
    const staging = props.layout && main?.plan && main.placement ? { plan: main.plan, layout: props.layout, placement: main.placement } : null;
    return <BasementViews scanId={props.scanId} rooms={basement} layout={layout} staging={staging} />;
  }
  return <RoomViews {...props} />;
}

function RoomViews(props: { scanId: string; plan: Plan | null; has3d: boolean; rooms?: RoomResult[]; mainRoom?: number | null; layout?: Layout | null }) {
  const layout = props.layout ?? null;
  const { scanId } = props;
  const scanned = (props.rooms ?? []).filter((r) => r.has3d || r.plan);
  const multi = scanned.length > 1;
  const [roomIx, setRoomIx] = useState(props.mainRoom ?? scanned[0]?.index ?? 0);
  // Rooms opened in 3D stay mounted (hidden when not shown): tearing a 3D view down breaks its labels.
  const [opened, setOpened] = useState<number[]>([roomIx]);
  const room = multi ? (scanned.find((r) => r.index === roomIx) ?? scanned[0]) : null;
  const plan = room ? room.plan : props.plan;
  const has3d = room ? room.has3d : props.has3d;
  const any3d = multi ? scanned.some((r) => r.has3d) : props.has3d;
  const fileUrl = (file: string, index: number) => `/api/scans/${scanId}/3d/${file}${index > 0 ? `?room=${index}` : ""}`;
  // The photo-like scan where there is one; older scans show their points.
  const viewer = (index: number, p: Plan | null) => (
    <RealScan surfelsUrl={fileUrl("surfels.bin", index)} scanUrl={fileUrl("scan.json", index)} ceilingHeightM={p?.ceilingHeightM ?? null} fallback={
        <>
          <ScanViewer3D plyUrl={fileUrl("points.ply", index)} plan={p} />
          <p className="viewer-hint mono">Drag to orbit · pinch or scroll to zoom</p>
        </>
      } />
  );
  const pick = (index: number) => {
    setRoomIx(index);
    setOpened((o) => (o.includes(index) ? o : [...o, index]));
  };

  const [view, setView] = useState<"3d" | "plan">(props.has3d ? "3d" : "plan");
  const [units, setUnits] = useState<Units>("m");
  const planRef = useRef<HTMLDivElement>(null);
  if (!props.plan && !props.has3d && !multi) return null;
  // A room without one of the two views shows the other.
  const shown = view === "3d" && has3d ? "3d" : plan ? "plan" : "3d";

  return (
    <section className="block scan-views">
      <div className="scan-views-head">
        <h2>Your basement, scanned</h2>
        <div className="segmented" role="tablist" aria-label="View">
          {has3d && (
            <button role="tab" aria-selected={shown === "3d"} onClick={() => setView("3d")}>
              3D
            </button>
          )}
          {plan && (
            <button role="tab" aria-selected={shown === "plan"} onClick={() => setView("plan")}>
              Plan
            </button>
          )}
        </div>
      </div>

      {multi && (
        <div className="room-tabs" role="tablist" aria-label="Room">
          {scanned.map((r) => (
            <button key={r.index} role="tab" aria-selected={r.index === room!.index} onClick={() => pick(r.index)}>
              <b>{r.name}</b>
              <span className="mono">{size(r.plan)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Both views stay mounted: switching back to 3D is instant and nothing is torn down mid-frame. */}
      <div className="scan-views-frame" data-view={shown}>
        {any3d && (
          <div className="view-layer" hidden={shown !== "3d"}>
            <View3DBoundary>
              <Suspense fallback={<p className="viewer-empty mono">Loading your basement in 3D…</p>}>
                {multi ? (
                  scanned
                    .filter((r) => r.has3d && opened.includes(r.index))
                    .map((r) => (
                      <div key={r.index} className="view-layer" hidden={r.index !== room!.index}>
                        {viewer(r.index, r.plan)}
                      </div>
                    ))
                ) : (
                  viewer(0, plan)
                )}
              </Suspense>
            </View3DBoundary>
          </div>
        )}
        {plan && (
          <div ref={planRef} className="plan-wrap" hidden={shown !== "plan"}>
            <FloorPlan plan={plan} units={units} name={room?.name} layout={layout && (!room || room.index === props.mainRoom) ? layout : null} />
          </div>
        )}
      </div>

      {shown === "plan" && plan && (
        <div className="scan-views-tools">
          <div className="segmented small" role="group" aria-label="Units">
            <button aria-pressed={units === "m"} onClick={() => setUnits("m")}>m</button>
            <button aria-pressed={units === "ft"} onClick={() => setUnits("ft")}>ft</button>
          </div>
          <button
            className="link-quiet"
            onClick={() => {
              const svg = planRef.current?.querySelector("svg");
              if (svg) downloadSvg(svg, room ? `basement-plan-${room.name.toLowerCase().replace(/\s+/g, "-")}.svg` : "basement-plan.svg");
            }}
          >
            Download plan (SVG)
          </button>
          {!plan.trusted && (
            <span className="muted">Rough: some walls came out twice. Film this room slowly along its walls, and add one tape number for an exact plan.</span>
          )}
        </div>
      )}
    </section>
  );
}
