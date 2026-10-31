// Where the bedrooms are upstairs, tapped on the house's outline (the basement's, with its stair), floor
// by floor. Each gets a smoke alarm on the drawings, linked to the suite's. Or: there are none.
import { useRef, useState, type PointerEvent } from "react";
import type { CardProps } from "../mount";
import { savePermit, stepFor, useBuild } from "./data";
import { CardFrame, Loading, Saved } from "./parts";

const FLOORS = ["Main floor", "Second floor", "Third floor"];

export function UpstairsCard({ scanId, card, act }: CardProps) {
  const { ws, status } = useBuild(scanId);
  const [floor, setFloor] = useState(1);
  const [editing, setEditing] = useState(false);
  // Each tap saves, and one bedroom already counts as done: the card folds only on "Done" here, or if
  // it was done before it opened.
  const [finished, setFinished] = useState(false);
  const doneAtOpen = useRef<boolean | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  if (!ws || !status) return <CardFrame card={card} label="Bedrooms upstairs"><Loading /></CardFrame>;
  const up = ws.state.permit?.upstairs ?? { bedrooms: [] };
  doneAtOpen.current ??= status.items.some((i) => i.group === "upstairs" && i.done);
  const done = finished || doneAtOpen.current;
  const said = (n: number, none: boolean) => (none ? "No bedrooms upstairs" : `${n} bedroom${n === 1 ? "" : "s"} upstairs`);
  const finish = (n: number, none: boolean) => {
    setEditing(false);
    setFinished(true);
    act({ type: "permitItem", itemId: stepFor("upstairs"), value: { said: said(n, none) } });
  };
  if (done && !editing)
    return (
      <CardFrame card={card} label="Bedrooms upstairs">
        <Saved onChange={() => setEditing(true)}>{said(up.bedrooms.length, Boolean(up.none))}</Saved>
      </CardFrame>
    );

  const fp = status.footprint;
  const W = 1000;
  const H = fp ? Math.round((1000 * fp.depthM) / fp.widthM) : 600;
  const floors = fp ? Math.max(1, Math.min(3, fp.storeys)) : 1;
  const tap = (e: PointerEvent<SVGSVGElement>) => {
    const box = svg.current!.getBoundingClientRect();
    const at: [number, number] = [Math.round(((e.clientX - box.left) / box.width) * 1000) / 1000, Math.round(((e.clientY - box.top) / box.height) * 1000) / 1000];
    const near = up.bedrooms.findIndex((b) => b.floor === floor && Math.hypot((b.at[0] - at[0]) * W, (b.at[1] - at[1]) * H) < 60);
    const bedrooms = near >= 0 ? up.bedrooms.filter((_, i) => i !== near) : [...up.bedrooms, { floor, at }];
    void savePermit(scanId, { upstairs: { bedrooms, none: false } });
  };
  const s = fp?.stair;
  return (
    <CardFrame card={card} label="Bedrooms upstairs">
      {fp ? (
        <>
          {floors > 1 && (
            <div className="gc-row" role="group" aria-label="Which floor">
              {FLOORS.slice(0, floors).map((label, i) => (
                <button key={label} type="button" className="chip" aria-pressed={floor === i + 1} onClick={() => setFloor(i + 1)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <svg ref={svg} className="gc-house" viewBox={`0 0 ${W} ${H}`} onPointerDown={tap} role="img" aria-label="Your house's outline: tap where each bedroom is">
            <rect x={6} y={6} width={W - 12} height={H - 12} className="gc-house-wall" />
            {s && <rect x={s.u0 * W} y={s.v0 * H} width={(s.u1 - s.u0) * W} height={(s.v1 - s.v0) * H} className="gc-house-stair" />}
            {s && (
              <text x={((s.u0 + s.u1) / 2) * W} y={((s.v0 + s.v1) / 2) * H + 12} textAnchor="middle" className="gc-house-label">
                Stairs
              </text>
            )}
            {up.bedrooms
              .filter((b) => b.floor === floor)
              .map((b, i) => (
                <g key={i}>
                  <rect x={b.at[0] * W - 90} y={b.at[1] * H - 90} width={180} height={180} className="gc-house-bed" />
                  <text x={b.at[0] * W} y={b.at[1] * H + 12} textAnchor="middle" className="gc-house-label">
                    Bedroom
                  </text>
                </g>
              ))}
          </svg>
          <p className="field-help">Tap a bedroom again to take it away.</p>
        </>
      ) : (
        <p className="field-help">There's no outline of the house to tap on yet.</p>
      )}
      <div className="gc-row">
        {fp && (
          <button type="button" className="btn btn-primary gc-btn" disabled={!up.bedrooms.length} onClick={() => finish(up.bedrooms.length, false)}>
            Done
          </button>
        )}
        <button
          type="button"
          className="link-quiet"
          onClick={() => {
            void savePermit(scanId, { upstairs: { bedrooms: [], none: true } }).then(() => finish(0, true));
          }}
        >
          There are no bedrooms upstairs
        </button>
      </div>
    </CardFrame>
  );
}
