// The example's real numbers, read from its result (public/samples/sample/result.json) at build time, so
// the home page's copy and its 3D always say what the example itself says. Only these keys are bundled.
import { fixGroups, layout, plan, rooms } from "../../public/samples/sample/result.json";
import type { Layout, Plan } from "../api";

const m = (n: number) => `${n.toFixed(2)} m`;
const cad = (n: number) => `$${n.toLocaleString("en-CA")}`;

const side = (s: string, at: number): [number, number] => {
  const b = plan.box;
  if (s === "minZ") return [b.minX + at, b.minZ];
  if (s === "maxZ") return [b.minX + at, b.maxZ];
  if (s === "minX") return [b.minX, b.minZ + at];
  return [b.maxX, b.minZ + at];
};

const fix = fixGroups[0];

export const EXAMPLE = {
  plan: plan as unknown as Plan,
  layout: layout as unknown as Layout,
  placement: rooms[0].placement,
  ceilingM: plan.ceilingHeightM,
  size: `${plan.widthM.toFixed(2)} × ${plan.depthM.toFixed(2)} m`,
  width: m(plan.widthM),
  depth: m(plan.depthM),
  area: `${plan.areaM2.toFixed(1)} m²`,
  ceiling: m(plan.ceilingHeightM),
  // The Building Code's minimum in a suite (rule ceiling_height_suite, Div. B 9.5.3.1).
  ceilingMin: m(1.95),
  // Where the scan put each opening, in the room's own frame (metres).
  openings: plan.openings.map((o) => ({ kind: o.kind as "window" | "door", side: o.side, widthM: o.widthM, width: m(o.widthM), at: side(o.side, o.atM) })),
  stairs: plan.stairs,
  fix: fix ? { title: fix.title, cost: `${cad(fix.costLow)}–${cad(fix.costHigh).slice(1)}`, count: fixGroups.length } : null,
  zones: layout.zones.filter((z) => z.kind !== "stairs" && z.kind !== "kitchen").map((z) => ({ ...z, area: `${z.areaM2.toFixed(1)} m²` })),
};
