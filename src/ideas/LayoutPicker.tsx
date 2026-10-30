// "Pick a layout": the model's designs for their basement (server/model/seed.ts: one bedroom on the
// window, the studio, the bedroom on another wall, two bedrooms where they fit), each permit-ready from
// the start. Every card has the plan, a picture of the design itself from the real angle that shows it
// best (src/views/covers.tsx), how many of its checks it meets, and what it costs hired out
// (server/quote). On a phone they swipe between them; on a computer they sit side by side.
import { useMemo } from "react";
import { checkDesign, tally } from "../../server/model/checks";
import { bounds, centroid, polygonArea } from "../../server/model/geometry";
import type { Design, Model } from "../../server/model/types";
import { quote } from "../../server/quote/quote";
import { useDesignCovers } from "../views/covers";
import "./ideas.css";

const cad = (n: number) => `$${Math.round(n / 1000)}k`;

export function LayoutPicker({ scanId, model, municipality, onPick }: { scanId: string; model: Model; municipality?: string; onPick: (id: string) => void }) {
  const { covers, renderer } = useDesignCovers(scanId, model.designs);
  const facts = useMemo(
    () =>
      new Map(
        model.designs.map((d) => {
          const count = tally(checkDesign(d, model.existing));
          const q = quote(model, d, { municipality });
          const suite = d.proposed.rooms.filter((r) => r.unit === 2);
          const beds = suite.filter((r) => r.kind === "bedroom").length;
          const area = suite.reduce((s, r) => s + polygonArea(r.polygon), 0);
          return [d.id, { count, low: q.totalLow, high: q.totalHigh, beds, area }];
        }),
      ),
    [model, municipality],
  );

  return (
    <section className="layouts" aria-labelledby="layouts-title">
      <h2 id="layouts-title" className="visually-hidden">The layouts</h2>
      <ul className="layout-row">
        {model.designs.map((d) => {
          const f = facts.get(d.id)!;
          const cover = covers[d.id];
          return (
            <li key={d.id} className="layout-card" data-chosen={d.chosen || undefined}>
              <button type="button" className="layout-hit" aria-pressed={d.chosen} onClick={() => onPick(d.id)} aria-label={`Pick ${d.name}`}>
                <figure className="layout-corner">
                  <span className="layout-pic" data-ready={Boolean(cover) || undefined}>
                    {cover ? <img src={cover.url} alt={`${d.name}, virtually staged in your basement`} draggable={false} /> : cover === null ? <DesignThumb design={d} /> : null}
                  </span>
                  <figcaption className="mono">
                    {cover ? (cover.making ? "Virtually staged · making it look real…" : `Virtually staged · ${cover.kind === "photo" ? cover.checked : "3D render"}`) : cover === null ? "The plan" : "Drawing it in your basement…"}
                  </figcaption>
                </figure>
                {cover !== null && <DesignThumb design={d} />}
                <h3>{d.name}</h3>
                <p className="layout-facts mono">
                  <span>{f.beds ? `${f.beds} bedroom${f.beds > 1 ? "s" : ""}` : "Studio"} · {Math.round(f.area)} m²</span>
                  <span data-ok={f.count.fix === 0 || undefined}>
                    Meets {f.count.ok} checks{f.count.fix ? ` · ${f.count.fix} to fix` : ""}
                  </span>
                  <span>{cad(f.low)}–{cad(f.high)} hired out</span>
                </p>
                <span className={d.chosen ? "btn btn-primary layout-pick" : "btn btn-ghost layout-pick"}>{d.chosen ? "Picked ✓" : "Pick this layout"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {renderer}
    </section>
  );
}

// The design drawn small: its rooms with their names, the walls (new ones, and the fire separation in
// red), and the windows.
export function DesignThumb({ design }: { design: Design }) {
  const P = design.proposed;
  const pts = [...P.walls.flatMap((w) => [w.a, w.b]), ...P.rooms.flatMap((r) => r.polygon)];
  if (!pts.length) return null;
  const b = bounds(pts);
  const pad = 0.3;
  const w = b.maxX - b.minX + 2 * pad, h = b.maxZ - b.minZ + 2 * pad;
  const walls = new Map(P.walls.map((x) => [x.id, x]));
  return (
    <svg className="layout-thumb" viewBox={`${b.minX - pad} ${b.minZ - pad} ${w} ${h}`} role="img" aria-label={`Plan of ${design.name}`}>
      {P.rooms.map((r) => (
        <polygon key={r.id} points={r.polygon.map((p) => p.join(",")).join(" ")} className="thumb-room" data-kind={r.kind} data-unit={r.unit} />
      ))}
      {P.walls.map((x) => (
        <line key={x.id} x1={x.a[0]} y1={x.a[1]} x2={x.b[0]} y2={x.b[1]} className="thumb-wall" data-kind={x.kind} data-rated={x.rating ? "" : undefined} />
      ))}
      {P.openings
        .filter((o) => o.kind === "window")
        .map((o) => {
          const x = walls.get(o.wallId);
          if (!x) return null;
          const L = Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) || 1;
          const u = [(x.b[0] - x.a[0]) / L, (x.b[1] - x.a[1]) / L];
          const t0 = o.offsetM - o.widthM / 2, t1 = o.offsetM + o.widthM / 2;
          return <line key={o.id} x1={x.a[0] + u[0] * t0} y1={x.a[1] + u[1] * t0} x2={x.a[0] + u[0] * t1} y2={x.a[1] + u[1] * t1} className="thumb-window" />;
        })}
      {P.rooms
        .filter((r) => r.unit === 2 && polygonArea(r.polygon) > 3)
        .map((r) => {
          const c = centroid(r.polygon);
          return (
            <text key={r.id} x={c[0]} y={c[1]} className="thumb-name" fontSize={Math.max(0.28, Math.min(w, h) / 22)}>
              {r.name}
            </text>
          );
        })}
    </svg>
  );
}
