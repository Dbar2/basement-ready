// The model drawn as a plan, the same way the measured floor plan is (src/components/FloorPlan.tsx):
// walls by kind, doors with their swing, windows, the stairs and mechanicals SAM found, beams and
// ducts with the headroom under them, alarms, rooms with their areas. Walls, doors and finds can be
// dragged (or nudged with the arrow keys once picked), and a new wall drawn with a finger.
import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { add, along, bounds, centroid, dist, dot, floorArea, inPolygon, mul, openingEnds, project, sub, wallLength, wallNormal, type Box } from "../../server/model/geometry";
import type { Alarm, Fixture, Furniture, Opening, Pt, Room, Wall } from "../../server/model/types";
import { fmtArea, fmtLength, type Units } from "../components/FloorPlan";
import { placeTags, textBox, type Box as TagBox, type Placed, type Tag } from "./labels";

export type PlanLayer = { walls: Wall[]; openings: Opening[]; rooms: Room[]; fixtures: Fixture[]; alarms?: Alarm[]; furniture?: Furniture[] };
export type Picked = { kind: "wall" | "opening" | "room" | "fixture"; id: string } | null;

const W = 1000;
const M = 84;
const SNAP = 0.01;
const snap = (v: number, step = SNAP) => Math.round(v / step) * step;

export const FIXTURE_NAME: Record<Fixture["kind"], string> = {
  furnace: "Furnace",
  water_heater: "Water heater",
  panel: "Panel",
  plumbing: "Plumbing rough-in",
  beam: "Beam",
  duct: "Duct",
  bulkhead: "Bulkhead",
  post: "Post",
  stairs: "Stairs",
};
const OVERHEAD = new Set<Fixture["kind"]>(["beam", "duct", "bulkhead"]);

// The frame a plan is drawn in: everything, plus a little room around it to drag into.
export function frameOf(layer: PlanLayer, pad = 0.6): Box {
  const pts = [...layer.walls.flatMap((w) => [w.a, w.b]), ...layer.rooms.flatMap((r) => r.polygon)];
  const b = pts.length ? bounds(pts) : { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };
  return { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad };
}

type Drag =
  | { kind: "wall"; id: string; start: Pt; orig: Wall; moved: boolean }
  | { kind: "opening"; id: string; start: Pt; orig: Opening; wall: Wall; moved: boolean }
  | { kind: "fixture"; id: string; start: Pt; orig: Fixture; moved: boolean }
  | { kind: "draw"; start: Pt; end: Pt };

export function PlanSvg(props: {
  layer: PlanLayer;
  frame: Box;
  units: Units;
  label: string;
  selected: Picked;
  onSelect: (p: Picked) => void;
  canDragWall?: (w: Wall) => boolean;
  canDragOpening?: (o: Opening) => boolean;
  canDragFixture?: (f: Fixture) => boolean;
  onWall?: (id: string, a: Pt, b: Pt, done: boolean) => void;
  onOpening?: (id: string, offsetM: number, done: boolean) => void;
  onFixture?: (id: string, at: Pt, done: boolean) => void;
  drawing?: boolean;
  onDraw?: (a: Pt, b: Pt) => void;
  marker?: Pt | null;
  roomNames?: boolean;
}) {
  const { layer, frame, units, selected } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [sketch, setSketch] = useState<{ a: Pt; b: Pt } | null>(null);
  const wM = frame.maxX - frame.minX, dM = frame.maxZ - frame.minZ;
  const s = (W - 2 * M) / Math.max(wM, dM * 1.15);
  const ox = M + (W - 2 * M - wM * s) / 2;
  const H = Math.round(M * 2 + dM * s);
  const X = (x: number) => ox + (x - frame.minX) * s;
  const Z = (z: number) => M + (z - frame.minZ) * s;
  const P = (p: Pt) => `${X(p[0]).toFixed(1)},${Z(p[1]).toFixed(1)}`;
  const metres = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [(q.x - ox) / s + frame.minX, (q.y - M) / s + frame.minZ];
  };
  const wallOf = (id: string) => layer.walls.find((w) => w.id === id);

  // ---- pointer handling: one drag at a time, captured on the drawing ----
  const begin = (e: ReactPointerEvent, d: Drag) => {
    e.stopPropagation();
    drag.current = d;
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = metres(e);
    if (d.kind === "draw") {
      const dx = p[0] - d.start[0], dz = p[1] - d.start[1];
      d.end = Math.abs(dx) >= Math.abs(dz) ? [snap(p[0], 0.05), d.start[1]] : [d.start[0], snap(p[1], 0.05)];
      setSketch({ a: d.start, b: d.end });
      return;
    }
    const delta = sub(p, d.start);
    if (!d.moved && Math.hypot(delta[0], delta[1]) * s < 5) return;
    d.moved = true;
    if (d.kind === "wall") {
      const n = wallNormal(d.orig);
      const k = snap(dot(delta, n));
      props.onWall?.(d.id, add(d.orig.a, mul(n, k)), add(d.orig.b, mul(n, k)), false);
    } else if (d.kind === "opening") {
      props.onOpening?.(d.id, snap(project(d.wall, p).t), false);
    } else props.onFixture?.(d.id, [snap(d.orig.at[0] + delta[0]), snap(d.orig.at[1] + delta[1])], false);
  };
  const end = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "draw") {
      setSketch(null);
      if (dist(d.start, d.end) >= 0.3) props.onDraw?.(d.start, d.end);
      return;
    }
    if (!d.moved) return props.onSelect({ kind: d.kind, id: d.id });
    const p = metres(e);
    const delta = sub(p, d.start);
    if (d.kind === "wall") {
      const n = wallNormal(d.orig);
      const k = snap(dot(delta, n));
      props.onWall?.(d.id, add(d.orig.a, mul(n, k)), add(d.orig.b, mul(n, k)), true);
    } else if (d.kind === "opening") props.onOpening?.(d.id, snap(project(d.wall, p).t), true);
    else props.onFixture?.(d.id, [snap(d.orig.at[0] + delta[0]), snap(d.orig.at[1] + delta[1])], true);
  };

  // Arrow keys nudge what's picked by 5 cm.
  const nudge = (e: KeyboardEvent) => {
    const dir: Pt | null = e.key === "ArrowLeft" ? [-1, 0] : e.key === "ArrowRight" ? [1, 0] : e.key === "ArrowUp" ? [0, -1] : e.key === "ArrowDown" ? [0, 1] : null;
    if (e.key === "Escape") props.onSelect(null);
    if (!dir || !selected) return;
    const step = e.shiftKey ? 0.25 : 0.05;
    if (selected.kind === "wall") {
      const w = wallOf(selected.id);
      if (!w || !props.canDragWall?.(w)) return;
      const n = wallNormal(w);
      const k = Math.sign(dot(dir, n)) * (Math.abs(dot(dir, n)) > 0.5 ? step : 0);
      if (k) props.onWall?.(w.id, add(w.a, mul(n, k)), add(w.b, mul(n, k)), true);
    } else if (selected.kind === "opening") {
      const o = layer.openings.find((x) => x.id === selected.id);
      const w = o && wallOf(o.wallId);
      if (!o || !w || !props.canDragOpening?.(o)) return;
      const k = dot(dir, sub(w.b, w.a)) > 0 ? step : dot(dir, sub(w.b, w.a)) < 0 ? -step : 0;
      if (k) props.onOpening?.(o.id, o.offsetM + k, true);
    } else if (selected.kind === "fixture") {
      const f = layer.fixtures.find((x) => x.id === selected.id);
      if (!f || !props.canDragFixture?.(f)) return;
      props.onFixture?.(f.id, add(f.at, mul(dir, step)), true);
    } else return;
    e.preventDefault();
  };

  const thick = (w: Wall) => Math.max(w.kind === "new" ? 4 : 6, w.thicknessM * s);
  const roomLabel = (r: Room): Pt => {
    const c = centroid(r.polygon);
    if (inPolygon(c, r.polygon)) return c;
    const b = bounds(r.polygon);
    return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  };
  const all = layer.walls.length ? bounds(layer.walls.flatMap((w) => [w.a, w.b])) : frame;
  const rated = layer.walls.some((w) => w.rating);
  const isSel = (kind: string, id: string) => selected?.kind === kind && selected.id === id;

  // Room names first, where they are; then each find's label in the first spot clear of them and of the
  // labels already placed (a long beam label moves along its beam or beside it, then drops its hint).
  const names = props.roomNames === false
    ? []
    : layer.rooms.flatMap((r) => {
        const c = roomLabel(r);
        const b = bounds(r.polygon);
        const wide = (b.maxX - b.minX) * s;
        if (wide < 60 || (b.maxZ - b.minZ) * s < 30) return [];
        const area = wide > 120 && floorArea(r, layer.rooms) >= 2 ? ` ${fmtArea(floorArea(r, layer.rooms), units)}` : "";
        return [{ r, x: X(c[0]), y: Z(c[1]) + 5, area }];
      });
  const fixed: TagBox[] = names.map((n) => {
    const w = n.r.name.length * 26 * 0.56 + n.area.length * 19 * 0.62;
    return { x0: n.x - w / 2, y0: n.y - 22, x1: n.x + w / 2, y1: n.y + 6 };
  });
  for (const o of layer.openings) {
    const w = wallOf(o.wallId);
    if (!w) continue;
    const n = wallNormal(w), mid = along(w, o.offsetM);
    const k = o.kind === "window" ? 0.38 : 0.3 * (o.swing === "right" ? -1 : 1);
    fixed.push(textBox(X(mid[0] - n[0] * k), Z(mid[1] - n[1] * k) + 5, o.kind === "window" ? "W 000×000" : `${Math.round(o.widthM * 100)}${o.rating ? " · 20 MIN" : ""}`, 16));
    // Its drag handle, a 14 px circle on the opening.
    fixed.push({ x0: X(mid[0]) - 15, y0: Z(mid[1]) - 15, x1: X(mid[0]) + 15, y1: Z(mid[1]) + 15 });
  }
  // The stairs and mechanicals' own boxes: a label shouldn't sit on another find either.
  for (const f of layer.fixtures) {
    if (OVERHEAD.has(f.kind)) continue;
    const size = f.sizeM ?? [0.4, 0.4];
    const half = f.kind === "stairs" ? [size[0] * s / 2, size[1] * s / 2] : [Math.max(22, size[0] * s, size[1] * s) / 2, Math.max(22, size[0] * s, size[1] * s) / 2];
    if (f.kind !== "stairs") fixed.push({ x0: X(f.at[0]) - half[0], y0: Z(f.at[1]) - half[1], x1: X(f.at[0]) + half[0], y1: Z(f.at[1]) + half[1] });
  }
  const tags: Tag[] = layer.fixtures.map((f) => {
    const size = f.sizeM ?? [0.4, 0.4];
    const cx = X(f.at[0]), cy = Z(f.at[1]);
    const w = size[0] * s, h = size[1] * s;
    if (OVERHEAD.has(f.kind)) {
      const short = `${FIXTURE_NAME[f.kind].toUpperCase()}${f.heightM != null ? ` · ${fmtLength(f.heightM, units)} CLEAR` : ""}`;
      const along = w >= h ? [0, -0.3, 0.3, -0.15, 0.15].map((t): [number, number] => [cx + t * w, cy + 5]) : [0, -0.3, 0.3].map((t): [number, number] => [cx, cy + 5 + t * h]);
      const beside = w >= h ? [[cx, cy - h / 2 - 8], [cx, cy + h / 2 + 20], [cx - 0.3 * w, cy - h / 2 - 8], [cx + 0.3 * w, cy + h / 2 + 20]] : [[cx + w / 2 + 70, cy + 5], [cx - w / 2 - 70, cy + 5]];
      return { id: f.id, text: short + (f.guess ? " · DRAG TO PLACE" : ""), short, size: 16, spots: [...along, ...(beside as [number, number][])] };
    }
    if (f.kind === "stairs") return { id: f.id, text: "STAIRS", size: 16, spots: [[cx, cy + 5], [cx, cy - h / 2 - 8], [cx, cy + h / 2 + 20]] };
    const box = Math.max(22, Math.max(w, h));
    const name = FIXTURE_NAME[f.kind].toUpperCase();
    return { id: f.id, text: name, size: 16, spots: [[cx, cy + box / 2 + 18], [cx, cy - box / 2 - 8], [cx + box / 2 + name.length * 5.5, cy + 5], [cx - box / 2 - name.length * 5.5, cy + 5]] };
  });
  // Stairs and mechanicals before the long overhead labels, which have the most room to move.
  const placed = placeTags(fixed, [...tags.filter((t) => !OVERHEAD.has(layer.fixtures.find((f) => f.id === t.id)!.kind)), ...tags.filter((t) => OVERHEAD.has(layer.fixtures.find((f) => f.id === t.id)!.kind))]);

  return (
    <svg
      ref={svgRef}
      className={`plan model-plan${props.drawing ? " is-drawing" : ""}`}
      viewBox={`0 0 ${W} ${H}`}
      role="application"
      aria-label={props.label}
      tabIndex={0}
      onKeyDown={nudge}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerDown={(e) => {
        if (props.drawing) {
          const p = metres(e);
          begin(e, { kind: "draw", start: [snap(p[0], 0.05), snap(p[1], 0.05)], end: [snap(p[0], 0.05), snap(p[1], 0.05)] });
        } else props.onSelect(null);
      }}
    >
      <rect x={0} y={0} width={W} height={H} className="plan-paper" />

      {/* rooms: soft fills by kind, the suite's and the house's */}
      {layer.rooms.map((r) => (
        <polygon
          key={r.id}
          points={r.polygon.map(P).join(" ")}
          className="model-room"
          data-kind={r.kind}
          data-unit={String(r.unit)}
          data-selected={isSel("room", r.id) || undefined}
          onPointerDown={(e) => {
            if (props.drawing) return;
            e.stopPropagation();
            props.onSelect({ kind: "room", id: r.id });
          }}
        />
      ))}

      {/* furniture, where the model puts it: the same pieces the 3D and the pictures show */}
      {(layer.furniture ?? []).map((f) => (
        <rect
          key={f.id}
          className="model-furniture"
          x={-(f.sizeM[0] * s) / 2}
          y={-(f.sizeM[1] * s) / 2}
          width={f.sizeM[0] * s}
          height={f.sizeM[1] * s}
          rx={3}
          transform={`translate(${X(f.at[0])} ${Z(f.at[1])}) rotate(${-f.rotDeg})`}
        />
      ))}

      {/* overhead: beams, ducts, bulkheads, dashed with the headroom under them */}
      {layer.fixtures.filter((f) => OVERHEAD.has(f.kind)).map((f) => (
        <FixtureShape key={f.id} f={f} X={X} Z={Z} s={s} selected={isSel("fixture", f.id)} tag={placed.get(f.id)} />
      ))}

      {/* walls */}
      {layer.walls.map((w) => (
        <g key={w.id} className="model-wall" data-kind={w.kind} data-guess={w.guess || undefined} data-selected={isSel("wall", w.id) || undefined}>
          <line
            x1={X(w.a[0])}
            y1={Z(w.a[1])}
            x2={X(w.b[0])}
            y2={Z(w.b[1])}
            strokeWidth={thick(w)}
            strokeLinecap={w.guess ? "butt" : "square"}
            // A guess is dashed at a scale the wall's own thickness can't fill in, so it never reads as scanned.
            style={w.guess ? { strokeDasharray: `${Math.max(10, 2 * thick(w))} ${Math.max(8, 1.4 * thick(w))}` } : undefined}
          />
          {w.rating && <line className="model-rated" x1={X(w.a[0])} y1={Z(w.a[1])} x2={X(w.b[0])} y2={Z(w.b[1])} />}
        </g>
      ))}

      {/* doors and windows, cut into their walls */}
      {layer.openings.map((o) => {
        const w = wallOf(o.wallId);
        if (!w) return null;
        const [p0, p1] = openingEnds(w, o);
        const n = wallNormal(w);
        const flip = o.swing === "right" ? -1 : 1;
        const cut = <line x1={X(p0[0])} y1={Z(p0[1])} x2={X(p1[0])} y2={Z(p1[1])} className="plan-cut" strokeWidth={thick(w) + 2} />;
        const mid = along(w, o.offsetM);
        if (o.kind === "window") {
          const off = mul(n, Math.min(0.06, w.thicknessM / 2.6));
          return (
            <g key={o.id} className="plan-window" data-status={o.status} data-selected={isSel("opening", o.id) || undefined}>
              {cut}
              <line x1={X(p0[0] + off[0])} y1={Z(p0[1] + off[1])} x2={X(p1[0] + off[0])} y2={Z(p1[1] + off[1])} />
              <line x1={X(p0[0] - off[0])} y1={Z(p0[1] - off[1])} x2={X(p1[0] - off[0])} y2={Z(p1[1] - off[1])} />
              <text x={X(mid[0] - n[0] * 0.38)} y={Z(mid[1] - n[1] * 0.38) + 5} textAnchor="middle" className="plan-tag">
                W {Math.round(o.widthM * 100)}{o.heightM ? `×${Math.round(o.heightM * 100)}` : ""}
              </text>
            </g>
          );
        }
        const leaf = add(p0, mul(n, o.widthM * flip));
        const sweep = (p1[0] - p0[0]) * (leaf[1] - p0[1]) - (p1[1] - p0[1]) * (leaf[0] - p0[0]) > 0 ? 0 : 1;
        return (
          <g key={o.id} className="plan-door" data-selected={isSel("opening", o.id) || undefined}>
            {cut}
            <line x1={X(p0[0])} y1={Z(p0[1])} x2={X(leaf[0])} y2={Z(leaf[1])} />
            <path d={`M ${X(leaf[0])} ${Z(leaf[1])} A ${o.widthM * s} ${o.widthM * s} 0 0 ${sweep} ${X(p1[0])} ${Z(p1[1])}`} className="plan-swing" />
            <text x={X(mid[0] - n[0] * flip * 0.3)} y={Z(mid[1] - n[1] * flip * 0.3) + 5} textAnchor="middle" className="plan-tag">
              {Math.round(o.widthM * 100)}
              {o.rating ? " · 20 MIN" : ""}
            </text>
          </g>
        );
      })}

      {/* stairs and mechanicals */}
      {layer.fixtures.filter((f) => !OVERHEAD.has(f.kind)).map((f) => (
        <FixtureShape key={f.id} f={f} X={X} Z={Z} s={s} selected={isSel("fixture", f.id)} tag={placed.get(f.id)} />
      ))}

      {/* alarms */}
      {(layer.alarms ?? []).map((a) => (
        <g key={a.id} className="model-alarm" data-kind={a.kind} transform={`translate(${X(a.at[0])} ${Z(a.at[1])})`}>
          <title>{a.why}</title>
          <circle r={13} />
          <text y={4} textAnchor="middle">{a.kind === "smoke" ? "S" : a.kind === "co" ? "CO" : "S+C"}</text>
        </g>
      ))}

      {/* room names and areas */}
      {names.map(({ r, x, y, area }) => (
        <text key={r.id} x={x} y={y} textAnchor="middle" className="plan-zone-name" pointerEvents="none">
          {r.name}
          {area && <tspan className="plan-zone-area">{area}</tspan>}
        </text>
      ))}

      {/* overall size */}
      <g className="plan-dim">
        <line x1={X(all.minX)} y1={Z(all.minZ) - 44} x2={X(all.maxX)} y2={Z(all.minZ) - 44} />
        <line x1={X(all.minX)} y1={Z(all.minZ) - 54} x2={X(all.minX)} y2={Z(all.minZ) - 34} />
        <line x1={X(all.maxX)} y1={Z(all.minZ) - 54} x2={X(all.maxX)} y2={Z(all.minZ) - 34} />
        <text x={(X(all.minX) + X(all.maxX)) / 2} y={Z(all.minZ) - 52} textAnchor="middle">{fmtLength(all.maxX - all.minX, units)}</text>
        <line x1={X(all.minX) - 44} y1={Z(all.minZ)} x2={X(all.minX) - 44} y2={Z(all.maxZ)} />
        <line x1={X(all.minX) - 54} y1={Z(all.minZ)} x2={X(all.minX) - 34} y2={Z(all.minZ)} />
        <line x1={X(all.minX) - 54} y1={Z(all.maxZ)} x2={X(all.minX) - 34} y2={Z(all.maxZ)} />
        <text x={X(all.minX) - 52} y={(Z(all.minZ) + Z(all.maxZ)) / 2} textAnchor="middle" transform={`rotate(-90 ${X(all.minX) - 52} ${(Z(all.minZ) + Z(all.maxZ)) / 2})`}>
          {fmtLength(all.maxZ - all.minZ, units)}
        </text>
      </g>

      {/* the picked wall's length, along it */}
      {selected?.kind === "wall" &&
        (() => {
          const w = wallOf(selected.id);
          if (!w) return null;
          const n = wallNormal(w);
          const m = add(along(w, wallLength(w) / 2), mul(n, 0.32));
          return (
            <text x={X(m[0])} y={Z(m[1]) + 6} textAnchor="middle" className="model-length">
              {fmtLength(wallLength(w), units)}
            </text>
          );
        })()}

      {/* handles: wide invisible strokes to grab, on top of everything */}
      {!props.drawing && (
        <g className="model-handles">
          {layer.fixtures.map((f) => {
            const size = f.sizeM ?? [0.4, 0.4];
            const can = props.canDragFixture?.(f);
            return (
              <rect
                key={f.id}
                x={X(f.at[0] - size[0] / 2)}
                y={Z(f.at[1] - size[1] / 2)}
                width={Math.max(18, size[0] * s)}
                height={Math.max(18, size[1] * s)}
                className="model-fixture-hit"
                data-drag={can ? "fixture" : undefined}
                data-fixture={f.id}
                onPointerDown={(e) => {
                  if (can) begin(e, { kind: "fixture", id: f.id, start: metres(e), orig: f, moved: false });
                  else {
                    e.stopPropagation();
                    props.onSelect({ kind: "fixture", id: f.id });
                  }
                }}
              />
            );
          })}
          {layer.walls.map((w) =>
            props.canDragWall?.(w) || props.onSelect ? (
              <line
                key={w.id}
                x1={X(w.a[0])}
                y1={Z(w.a[1])}
                x2={X(w.b[0])}
                y2={Z(w.b[1])}
                data-drag={props.canDragWall?.(w) ? "wall" : undefined}
                data-wall={w.id}
                onPointerDown={(e) => {
                  const p = metres(e);
                  if (props.canDragWall?.(w)) begin(e, { kind: "wall", id: w.id, start: p, orig: w, moved: false });
                  else {
                    e.stopPropagation();
                    props.onSelect({ kind: "wall", id: w.id });
                  }
                }}
              >
                <title>{`${w.kind === "new" ? "New wall" : w.kind === "foundation" ? "Outside wall" : "Wall"}, ${fmtLength(wallLength(w), units)}${w.guess ? ", a guess: we couldn't see it clearly" : ""}${props.canDragWall?.(w) ? ". Drag to move it." : ""}`}</title>
              </line>
            ) : null,
          )}
          {layer.openings.map((o) => {
            const w = wallOf(o.wallId);
            if (!w || !props.canDragOpening?.(o)) return null;
            const c = along(w, o.offsetM);
            return (
              <circle
                key={o.id}
                cx={X(c[0])}
                cy={Z(c[1])}
                r={14}
                className="model-handle"
                data-drag="opening"
                data-opening={o.id}
                onPointerDown={(e) => begin(e, { kind: "opening", id: o.id, start: metres(e), orig: o, wall: w, moved: false })}
              >
                <title>{`${o.kind === "door" ? "Door" : "Window"}, ${Math.round(o.widthM * 100)} cm. Drag along the wall.`}</title>
              </circle>
            );
          })}
        </g>
      )}

      {sketch && <line className="model-sketch" x1={X(sketch.a[0])} y1={Z(sketch.a[1])} x2={X(sketch.b[0])} y2={Z(sketch.b[1])} />}
      {props.marker && <circle className="model-marker" cx={X(props.marker[0])} cy={Z(props.marker[1])} r={26} />}

      {rated && (
        <g className="model-legend" transform={`translate(${W - 24} ${H - 22})`}>
          <line x1={-250} y1={-5} x2={-210} y2={-5} className="model-rated" />
          <text textAnchor="end">30-MIN FIRE SEPARATION</text>
        </g>
      )}
    </svg>
  );
}

function FixtureShape({ f, X, Z, s, selected, tag }: { f: Fixture; X: (x: number) => number; Z: (z: number) => number; s: number; selected: boolean; tag?: Placed }) {
  const size = f.sizeM ?? [0.4, 0.4];
  const x0 = X(f.at[0] - size[0] / 2), y0 = Z(f.at[1] - size[1] / 2);
  const w = size[0] * s, h = size[1] * s;
  if (f.kind === "stairs") {
    const along = w > h;
    const steps = Math.max(4, Math.round((along ? size[0] : size[1]) / 0.25));
    return (
      <g className="plan-stairs" data-selected={selected || undefined}>
        <rect x={x0} y={y0} width={w} height={h} />
        {Array.from({ length: steps - 1 }, (_, i) => {
          const t = (i + 1) / steps;
          return along ? <line key={i} x1={x0 + t * w} y1={y0} x2={x0 + t * w} y2={y0 + h} /> : <line key={i} x1={x0} y1={y0 + t * h} x2={x0 + w} y2={y0 + t * h} />;
        })}
        {tag && <text x={tag.x} y={tag.y} textAnchor="middle" className="plan-tag">{tag.text}</text>}
      </g>
    );
  }
  if (OVERHEAD.has(f.kind)) {
    return (
      <g className="model-overhead" data-kind={f.kind} data-guess={f.guess || undefined} data-selected={selected || undefined}>
        <rect x={x0} y={y0} width={w} height={h} />
        {tag && <text x={tag.x} y={tag.y} textAnchor="middle" className="plan-tag">{tag.text}</text>}
      </g>
    );
  }
  const box = Math.max(22, Math.max(w, h));
  return (
    <g className="plan-fixture" data-selected={selected || undefined}>
      <rect x={X(f.at[0]) - box / 2} y={Z(f.at[1]) - box / 2} width={box} height={box} />
      <line x1={X(f.at[0]) - box / 2} y1={Z(f.at[1]) - box / 2} x2={X(f.at[0]) + box / 2} y2={Z(f.at[1]) + box / 2} />
      {tag && <text x={tag.x} y={tag.y} textAnchor="middle" className="plan-tag">{tag.text}</text>}
    </g>
  );
}
