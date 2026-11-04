import React from "react";
import { C, FIND } from "../theme";
import { MONO, SANS } from "../fonts";
import { Dim, Draw } from "./kit";
import { prog } from "../anim";
import sample from "../data/sample.json";

// The example basement's measured plan (public/samples/sample/result.json, from MapAnything's depth).
const P = sample.plan;
export const PLAN_W = P.box.maxX - P.box.minX; // 7.55 m
export const PLAN_D = P.box.maxZ - P.box.minZ; // 5.52 m

export type PlanProps = {
  x: number;
  y: number;
  s: number; // px per metre
  frame: number; // local frame
  start?: number; // when the walls start drawing
  dims?: number; // frame the dimension lines start, or undefined
  zones?: number; // frame the layout's rooms appear
  fix?: number; // frame the fire separation is marked
  finds?: number; // frame the finds appear
  paper?: boolean;
};

export const Plan: React.FC<PlanProps> = ({ x, y, s, frame, start = 0, dims, zones, fix, finds, paper = true }) => {
  const X = (m: number) => x + (m - P.box.minX) * s;
  const Y = (m: number) => y + (m - P.box.minZ) * s;
  const w = PLAN_W * s;
  const d = PLAN_D * s;
  const pw = prog(frame, start, 27);
  const door = P.openings.find((o) => o.kind === "door")!;
  const win = P.openings.find((o) => o.kind === "window")!;
  const st = P.stairs[0];
  const pad = 70;

  // Seen walls in ink, the sides only bounded by the spread of points dashed (brand/ui.md plans).
  const top = `M${X(P.box.minX)} ${Y(P.box.minZ)} L${X(P.box.minX) + door.atM * s} ${Y(P.box.minZ)} M${X(P.box.minX) + (door.atM + door.widthM) * s} ${Y(P.box.minZ)} L${X(P.box.maxX)} ${Y(P.box.minZ)}`;
  const left = `M${X(P.box.minX)} ${Y(P.box.minZ)} L${X(P.box.minX)} ${Y(P.box.maxZ)}`;
  const bottom = `M${X(P.box.minX)} ${Y(P.box.maxZ)} L${X(P.box.minX) + win.atM * s} ${Y(P.box.maxZ)} M${X(P.box.minX) + (win.atM + win.widthM) * s} ${Y(P.box.maxZ)} L${X(P.box.maxX)} ${Y(P.box.maxZ)}`;
  const right = `M${X(P.box.maxX)} ${Y(P.box.minZ)} L${X(P.box.maxX)} ${Y(P.box.maxZ)}`;
  const stairsSteps = Array.from({ length: 9 }, (_, i) => {
    const sx = X(st.x0) + ((X(st.x1) - X(st.x0)) * (i + 1)) / 10;
    return `M${sx} ${Y(st.z0)} L${sx} ${Y(st.z1)}`;
  }).join(" ");
  const furnace = P.fixtures.find((f) => f.kind === "furnace")!;
  const heater = P.fixtures.find((f) => f.kind === "water_heater")!;
  const zp = zones === undefined ? 0 : prog(frame, zones, 20);
  const fp = fix === undefined ? 0 : prog(frame, fix, 24);
  const findP = finds === undefined ? 0 : prog(frame, finds, 16);
  const sep = sample.zones.find((z) => z.kind === "mechanical")!;

  return (
    <g>
      {paper && (
        <rect
          x={x - pad}
          y={y - pad}
          width={w + pad * 2}
          height={d + pad * 2}
          rx={4}
          fill={C.card}
          stroke={C.border}
          strokeWidth={1}
          opacity={prog(frame, start - 8, 10)}
        />
      )}
      {/* the layout's rooms */}
      {zp > 0 &&
        sample.zones
          .filter((z) => z.kind !== "stairs")
          .map((z, i) => {
            const zx = X(z.x0);
            const zy = Y(z.z0);
            const zw = (z.x1 - z.x0) * s;
            const zh = (z.z1 - z.z0) * s;
            const o = prog(frame, (zones ?? 0) + i * 5, 14);
            const small = zh < 0.9 * s;
            return (
              <g key={z.name} opacity={o}>
                <rect x={zx} y={zy} width={zw} height={zh} fill="none" stroke={C.ink} strokeWidth={1} />
                {!small && (
                  <>
                    <text x={zx + zw / 2} y={zy + zh / 2 - 4} textAnchor="middle" fontFamily={SANS} fontWeight={800} fontSize={Math.min(22, s * 0.26)} fill={C.ink}>
                      {z.name}
                    </text>
                    <text x={zx + zw / 2} y={zy + zh / 2 + 22} textAnchor="middle" fontFamily={MONO} fontSize={Math.min(17, s * 0.2)} fill={C.muted}>
                      {z.areaM2.toFixed(1)} m²
                    </text>
                  </>
                )}
              </g>
            );
          })}
      <Draw d={left} p={pw} width={4} />
      <Draw d={bottom} p={pw} width={4} />
      <Draw d={top} p={pw} width={1.5} stroke={C.muted} />
      <Draw d={right} p={pw} width={1.5} stroke={C.muted} />
      {/* door swing on the open top side */}
      <Draw
        d={`M${X(P.box.minX) + door.atM * s} ${Y(P.box.minZ)} L${X(P.box.minX) + door.atM * s} ${Y(P.box.minZ) + door.widthM * s} A${door.widthM * s} ${door.widthM * s} 0 0 0 ${X(P.box.minX) + (door.atM + door.widthM) * s} ${Y(P.box.minZ)}`}
        p={prog(frame, start + 20, 16)}
        width={1.2}
      />
      {/* window: three thin lines in the wall gap */}
      {[-4, 0, 4].map((o) => (
        <Draw
          key={o}
          d={`M${X(P.box.minX) + win.atM * s} ${Y(P.box.maxZ) + o} L${X(P.box.minX) + (win.atM + win.widthM) * s} ${Y(P.box.maxZ) + o}`}
          p={prog(frame, start + 22, 10)}
          width={1.2}
          stroke={o === 0 ? FIND.window : C.ink}
        />
      ))}
      {/* stairs */}
      <Draw
        d={`M${X(st.x0)} ${Y(st.z0)} L${X(st.x1)} ${Y(st.z0)} L${X(st.x1)} ${Y(st.z1)} L${X(st.x0)} ${Y(st.z1)} Z ${stairsSteps}`}
        p={prog(frame, start + 16, 20)}
        width={1.2}
      />
      <g opacity={prog(frame, start + 30, 12)}>
        <text x={(X(st.x0) + X(st.x1)) / 2} y={Y(st.z1) + 22} textAnchor="middle" fontFamily={MONO} fontSize={14} fill={C.ink}>
          STAIRS
        </text>
        {/* furnace and water heater as plan symbols */}
        <circle cx={X(furnace.x)} cy={Y(furnace.z)} r={0.28 * s} fill="none" stroke={C.ink} strokeWidth={1.2} />
        <text x={X(furnace.x)} y={Y(furnace.z) + 0.28 * s + 18} textAnchor="middle" fontFamily={MONO} fontSize={13} fill={C.ink}>
          FURNACE
        </text>
        <circle cx={X(heater.x)} cy={Y(heater.z)} r={0.2 * s} fill="none" stroke={C.ink} strokeWidth={1.2} />
        <text x={X(heater.x) + 0.2 * s + 6} y={Y(heater.z) + 5} fontFamily={MONO} fontSize={13} fill={C.ink}>
          W.H.
        </text>
      </g>
      {findP > 0 && (
        <g opacity={findP}>
          <rect x={X(st.x0) - 4} y={Y(st.z0) - 4} width={(st.x1 - st.x0) * s + 8} height={(st.z1 - st.z0) * s + 8} fill="none" stroke={FIND.stairs} strokeWidth={2.5} />
          <circle cx={X(furnace.x)} cy={Y(furnace.z)} r={0.28 * s + 6} fill="none" stroke={FIND.mechanical} strokeWidth={2.5} />
          <rect x={X(P.box.minX) + win.atM * s - 6} y={Y(P.box.maxZ) - 8} width={win.widthM * s + 12} height={16} fill="none" stroke={FIND.window} strokeWidth={2.5} />
          <rect x={X(P.box.minX) + door.atM * s - 4} y={Y(P.box.minZ) - 8} width={door.widthM * s + 8} height={16} fill="none" stroke={FIND.exit} strokeWidth={2.5} />
        </g>
      )}
      {fp > 0 && (
        <g>
          <Draw d={`M${X(sep.x1)} ${Y(sep.z0)} L${X(sep.x1)} ${Y(sep.z1)}`} p={fp} width={7} stroke={C.fix} cap="butt" />
          <Draw d={`M${X(sep.x0)} ${Y(sep.z0)} L${X(sep.x1)} ${Y(sep.z0)}`} p={fp} width={7} stroke={C.fix} cap="butt" />
        </g>
      )}
      {dims !== undefined && (
        <g>
          <Dim x1={X(P.box.minX)} y1={Y(P.box.maxZ) + 36} x2={X(P.box.maxX)} y2={Y(P.box.maxZ) + 36} label={`${PLAN_W.toFixed(2)} m`} p={prog(frame, dims, 22, undefined)} bg={paper ? C.card : C.bg} size={18} />
          <Dim x1={X(P.box.maxX) + 36} y1={Y(P.box.minZ)} x2={X(P.box.maxX) + 36} y2={Y(P.box.maxZ)} label={`${PLAN_D.toFixed(2)} m`} p={prog(frame, dims + 8, 22, undefined)} bg={paper ? C.card : C.bg} size={18} />
        </g>
      )}
    </g>
  );
};
