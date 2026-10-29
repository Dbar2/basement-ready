// The measured floor plan, drawn like a sheet from a drawing set: walls, openings, dimensions, labels.
import { useMemo, useRef } from "react";
import type { Layout, Plan, PlanSide } from "../api";

export type Units = "m" | "ft";

export function fmtLength(m: number, units: Units) {
  if (units === "m") return `${m.toFixed(2)} m`;
  const inches = Math.round(m / 0.0254);
  return `${Math.floor(inches / 12)}' ${inches % 12}"`;
}

export function fmtArea(m2: number, units: Units) {
  return units === "m" ? `${m2.toFixed(1)} m²` : `${Math.round(m2 * 10.7639)} sq ft`;
}

const W = 1000; // drawing width in SVG units
const M = 96; // margin for dimension lines

// Where along a side an opening sits, as SVG points from one end to the other.
function sideLine(side: PlanSide, b: Plan["box"], s: number, ox: number, oz: number) {
  const X = (x: number) => ox + (x - b.minX) * s;
  const Z = (z: number) => oz + (z - b.minZ) * s;
  switch (side) {
    case "minZ":
      return { x0: X(b.minX), y0: Z(b.minZ), x1: X(b.maxX), y1: Z(b.minZ), inward: [0, 1] };
    case "maxZ":
      return { x0: X(b.minX), y0: Z(b.maxZ), x1: X(b.maxX), y1: Z(b.maxZ), inward: [0, -1] };
    case "minX":
      return { x0: X(b.minX), y0: Z(b.minZ), x1: X(b.minX), y1: Z(b.maxZ), inward: [1, 0] };
    case "maxX":
      return { x0: X(b.maxX), y0: Z(b.minZ), x1: X(b.maxX), y1: Z(b.maxZ), inward: [-1, 0] };
  }
}

export function FloorPlan({ plan, units, name = "Main room", layout = null }: { plan: Plan; units: Units; name?: string; layout?: Layout | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const b = plan.box;
  const s = (W - 2 * M) / Math.max(plan.widthM, plan.depthM * 1.2);
  const ox = M + (W - 2 * M - plan.widthM * s) / 2;
  const oz = M;
  const H = oz + plan.depthM * s + M;
  const X = (x: number) => ox + (x - b.minX) * s;
  const Z = (z: number) => oz + (z - b.minZ) * s;
  const wallW = Math.max(6, 0.12 * s);

  const sides = useMemo(() => (["minZ", "maxX", "maxZ", "minX"] as PlanSide[]).map((side) => ({ side, ...sideLine(side, b, s, ox, oz) })), [b, s, ox, oz]);
  const estimated = plan.scaleSource !== "user_measurement" || !plan.trusted;

  return (
    <svg ref={svgRef} className="plan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Floor plan, ${fmtLength(plan.widthM, units)} by ${fmtLength(plan.depthM, units)}`}>
      <rect x={0} y={0} width={W} height={H} className="plan-paper" />

      {/* the suggested layout: rooms as soft fills with their names, new walls as thin lines */}
      {layout && (
        <g className="plan-layout">
          {layout.zones
            .filter((z) => z.kind !== "stairs")
            .map((z, i) => (
              <g key={i} className="plan-zone" data-kind={z.kind}>
                <rect x={X(z.x0)} y={Z(z.z0)} width={(z.x1 - z.x0) * s} height={(z.z1 - z.z0) * s} />
                {(z.x1 - z.x0) * s > 70 && (z.z1 - z.z0) * s > 34 && (
                  <text x={X((z.x0 + z.x1) / 2)} y={Z((z.z0 + z.z1) / 2) + 4} textAnchor="middle" className="plan-zone-name">
                    {z.name}
                    {z.areaM2 >= 2 && <tspan className="plan-zone-area"> {fmtArea(z.areaM2, units)}</tspan>}
                  </text>
                )}
              </g>
            ))}
          {layout.walls.map((w, i) => (
            <line key={`w${i}`} x1={X(w.x0)} y1={Z(w.z0)} x2={X(w.x1)} y2={Z(w.z1)} className="plan-partition" strokeWidth={Math.max(4, wallW * 0.6)} />
          ))}
          {layout.doors.map((d, i) => {
            const half = (d.widthM / 2) * s;
            return d.along === "x" ? (
              <line key={`d${i}`} x1={X(d.x) - half} y1={Z(d.z)} x2={X(d.x) + half} y2={Z(d.z)} className="plan-cut" strokeWidth={Math.max(4, wallW * 0.6) + 2} />
            ) : (
              <line key={`d${i}`} x1={X(d.x)} y1={Z(d.z) - half} x2={X(d.x)} y2={Z(d.z) + half} className="plan-cut" strokeWidth={Math.max(4, wallW * 0.6) + 2} />
            );
          })}
        </g>
      )}

      {/* walls: solid where the scan saw one, dashed where it never did */}
      {sides.map((l) => (
        <line
          key={l.side}
          x1={l.x0}
          y1={l.y0}
          x2={l.x1}
          y2={l.y1}
          // pathLength drives the draw-in on seen walls; unseen ones keep a real dash.
          pathLength={plan.sides[l.side] === "wall" ? 1 : undefined}
          className={plan.sides[l.side] === "wall" ? "plan-wall" : "plan-unseen"}
          strokeWidth={plan.sides[l.side] === "wall" ? wallW : 2}
          strokeLinecap="square"
        />
      ))}

      {/* stairs: treads and an arrow pointing up */}
      {plan.stairs.map((st) => {
        const x0 = X(st.x0), y0 = Z(st.z0), x1 = X(st.x1), y1 = Z(st.z1);
        const along = x1 - x0 > y1 - y0;
        const steps = Math.max(4, Math.round((along ? st.x1 - st.x0 : st.z1 - st.z0) / 0.25));
        return (
          <g key={st.detectionId} className="plan-stairs">
            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
            {Array.from({ length: steps - 1 }, (_, i) => {
              const t = (i + 1) / steps;
              return along ? <line key={i} x1={x0 + t * (x1 - x0)} y1={y0} x2={x0 + t * (x1 - x0)} y2={y1} /> : <line key={i} x1={x0} y1={y0 + t * (y1 - y0)} x2={x1} y2={y0 + t * (y1 - y0)} />;
            })}
            <text x={(x0 + x1) / 2} y={(y0 + y1) / 2 + 5} textAnchor="middle" className="plan-tag">
              STAIRS
            </text>
          </g>
        );
      })}

      {/* windows and doors, cut into their walls */}
      {plan.openings.map((o) => {
        const l = sides.find((x) => x.side === o.side)!;
        const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
        const ux = (l.x1 - l.x0) / len, uy = (l.y1 - l.y0) / len;
        const a = o.atM * s - (o.widthM * s) / 2, c = o.atM * s + (o.widthM * s) / 2;
        const p0 = [l.x0 + ux * a, l.y0 + uy * a], p1 = [l.x0 + ux * c, l.y0 + uy * c];
        const [nx, ny] = l.inward;
        if (o.kind === "window") {
          const off = wallW / 2.6;
          return (
            <g key={o.detectionId} className="plan-window">
              <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} className="plan-cut" strokeWidth={wallW + 2} />
              <line x1={p0[0] - nx * off} y1={p0[1] - ny * off} x2={p1[0] - nx * off} y2={p1[1] - ny * off} />
              <line x1={p0[0] + nx * off} y1={p0[1] + ny * off} x2={p1[0] + nx * off} y2={p1[1] + ny * off} />
              <text x={(p0[0] + p1[0]) / 2 + nx * 30} y={(p0[1] + p1[1]) / 2 + ny * 30 + 4} textAnchor="middle" className="plan-tag">
                W {fmtLength(o.widthM, units)}
              </text>
            </g>
          );
        }
        const r = o.widthM * s;
        const leafEnd = [p0[0] + nx * r, p0[1] + ny * r];
        const sweep = ux * ny - uy * nx > 0 ? 1 : 0;
        return (
          <g key={o.detectionId} className="plan-door">
            <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} className="plan-cut" strokeWidth={wallW + 2} />
            <line x1={p0[0]} y1={p0[1]} x2={leafEnd[0]} y2={leafEnd[1]} />
            <path d={`M ${leafEnd[0]} ${leafEnd[1]} A ${r} ${r} 0 0 ${sweep} ${p1[0]} ${p1[1]}`} className="plan-swing" />
            <text x={(p0[0] + p1[0]) / 2 + nx * (r + 22)} y={(p0[1] + p1[1]) / 2 + ny * (r + 22) + 4} textAnchor="middle" className="plan-tag">
              DOOR
            </text>
          </g>
        );
      })}

      {/* furnace and panel */}
      {plan.fixtures.map((f) => {
        const x = X(f.x), y = Z(f.z), size = Math.max(22, 0.5 * s);
        const inX = Math.min(Math.max(x, ox + size / 2 + wallW), ox + plan.widthM * s - size / 2 - wallW);
        const inY = Math.min(Math.max(y, oz + size / 2 + wallW), oz + plan.depthM * s - size / 2 - wallW);
        return (
          <g key={f.detectionId} className="plan-fixture">
            <rect x={inX - size / 2} y={inY - size / 2} width={size} height={size} />
            <line x1={inX - size / 2} y1={inY - size / 2} x2={inX + size / 2} y2={inY + size / 2} />
            <text x={inX} y={inY + size / 2 + 18} textAnchor="middle" className="plan-tag">
              {f.kind === "panel" ? "PANEL" : "FURNACE"}
            </text>
          </g>
        );
      })}

      {/* dimension lines */}
      <g className="plan-dim">
        <line x1={X(b.minX)} y1={oz - 44} x2={X(b.maxX)} y2={oz - 44} />
        <line x1={X(b.minX)} y1={oz - 56} x2={X(b.minX)} y2={oz - 32} />
        <line x1={X(b.maxX)} y1={oz - 56} x2={X(b.maxX)} y2={oz - 32} />
        <text x={(X(b.minX) + X(b.maxX)) / 2} y={oz - 54} textAnchor="middle">
          {fmtLength(plan.widthM, units)}
        </text>
        <line x1={ox - 44} y1={Z(b.minZ)} x2={ox - 44} y2={Z(b.maxZ)} />
        <line x1={ox - 56} y1={Z(b.minZ)} x2={ox - 32} y2={Z(b.minZ)} />
        <line x1={ox - 56} y1={Z(b.maxZ)} x2={ox - 32} y2={Z(b.maxZ)} />
        <text x={ox - 54} y={(Z(b.minZ) + Z(b.maxZ)) / 2} textAnchor="middle" transform={`rotate(-90 ${ox - 54} ${(Z(b.minZ) + Z(b.maxZ)) / 2})`}>
          {fmtLength(plan.depthM, units)}
        </text>
      </g>

      {/* room label */}
      <g className="plan-room" display={layout ? "none" : undefined}>
        <text x={X((b.minX + b.maxX) / 2)} y={Z((b.minZ + b.maxZ) / 2) - 8} textAnchor="middle" className="plan-room-name">
          {name}
        </text>
        <text x={X((b.minX + b.maxX) / 2)} y={Z((b.minZ + b.maxZ) / 2) + 22} textAnchor="middle" className="plan-room-meta">
          {fmtArea(plan.areaM2, units)}
          {plan.ceilingHeightM != null && ` · ceiling ${fmtLength(plan.ceilingHeightM, units)}`}
        </text>
      </g>

      {/* the stamp: how far to trust these numbers */}
      <g className="plan-stamp" transform={`translate(${W - 24} ${H - 22})`}>
        <text textAnchor="end">{estimated ? "ESTIMATED FROM VIDEO · CONFIRM WITH A TAPE" : "SCALED TO YOUR TAPE MEASUREMENT"}</text>
      </g>
    </svg>
  );
}

// Saves the drawing as an SVG file a designer can open.
export function downloadSvg(svg: SVGSVGElement, name: string) {
  const css = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules].map((r) => r.cssText).filter((t) => t.includes(".plan"));
      } catch {
        return [];
      }
    })
    .join("\n");
  const rootVars = getComputedStyle(document.documentElement);
  const vars = ["--color-ink", "--color-ink-muted", "--color-card", "--color-bg", "--color-border", "--color-mint", "--color-mint-line", "--find-window", "--find-exit", "--find-stairs", "--find-mechanical", "--font-mono", "--font-display"]
    .map((v) => `${v}: ${rootVars.getPropertyValue(v)};`)
    .join(" ");
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `svg { ${vars} } ${css}`;
  clone.prepend(style);
  const url = URL.createObjectURL(new Blob([clone.outerHTML], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
