// The basement from the scan, for the drawings and the materials list: the rooms where the scan placed
// them (src/components/basementPlan.ts) and the chosen design of the shared model (server/model/current.ts)
// as a layout in the same frame, with its alarms. A scan the model can't be seeded from gets the
// suggested layout and alarms placed here by the code's rules.
import type { Layout, LayoutZone, Plan, PlanSide, RoomResult } from "../../src/api";
import { basementRooms, placeLayout } from "../../src/components/basementPlan";
import { suggestLayout } from "../layout";
import { currentModel } from "../model/current";
import { chosenDesign, layoutOf } from "../model/legacy";
import type { StoredState } from "../workspace";

export type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Alarm = { kind: "smoke" | "co" | "combo"; x: number; z: number; why: string };

export type Geometry = {
  rooms: { name: string; plan: Plan }[]; // every area of the basement, in one frame
  main: { name: string; plan: Plan } | null; // the area the suite goes in
  layout: Layout | null; // the chosen layout, in the same frame
  box: Box;
  ceilingM: number | null; // finished height we can stand behind: tape first, then the scan
  beamM: number | null; // clear height under the lowest beam or duct
  fuelBurning: boolean; // a furnace or water heater burns gas: CO alarms
  estimated: boolean;
  alarms: Alarm[];
  egress: { side: PlanSide; atM: number; widthM: number; existing: boolean; ok: boolean | null } | null;
};

const union = (boxes: Box[]): Box => ({
  minX: Math.min(...boxes.map((b) => b.minX)),
  maxX: Math.max(...boxes.map((b) => b.maxX)),
  minZ: Math.min(...boxes.map((b) => b.minZ)),
  maxZ: Math.max(...boxes.map((b) => b.maxZ)),
});

// The layout the homeowner picked on the Ideas tab, or the suggested one.
export function chosenLayout(result: any, state: StoredState | null | undefined): Layout | null {
  const plan = result?.plan as Plan | null;
  const pick = state?.ideas;
  if (plan && (pick?.kind || pick?.side)) return suggestLayout(plan as any, { kind: pick.kind ?? null, side: pick.side ?? null }) as unknown as Layout;
  return (result?.layout as Layout | null) ?? (plan ? (suggestLayout(plan as any) as unknown as Layout) : null);
}

// Smoke alarms in each sleeping room and between the sleeping rooms and the rest of the suite;
// CO alarms beside the sleeping area when anything in the house burns fuel (Building Code 9.10.19,
// 9.33.4; see data/rules/ontario-diy.json for the sections and wording).
export function placeAlarms(layout: Layout | null, main: Plan | null, fuelBurning: boolean): Alarm[] {
  // On the ceiling, a little off the room's middle so the room's name stays readable on the plan.
  const center = (z: { x0: number; z0: number; x1: number; z1: number }) => ({ x: (z.x0 + z.x1) / 2, z: z.z0 + (z.z1 - z.z0) * 0.25 });
  if (!layout) {
    if (!main) return [];
    const b = main.box;
    return [{ kind: fuelBurning ? "combo" : "smoke", x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, why: "One per storey of the suite" }];
  }
  const out: Alarm[] = [];
  const beds = layout.zones.filter((z) => z.kind === "bedroom");
  const living = layout.zones.find((z) => z.kind === "living") ?? null;
  for (const bed of beds) {
    const c = center(bed);
    const studio = layout.kind === "studio";
    out.push({ kind: studio && fuelBurning ? "combo" : "smoke", x: c.x, z: c.z, why: studio ? "In the sleeping area" : "In each bedroom" });
    if (studio || !living) continue;
    // Outside the bedroom door, in the living space: between the bedroom and the rest of the suite.
    const door = [...layout.doors].sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
    const lc = center(living);
    const at = door ?? { x: lc.x, z: lc.z };
    const inLiving = {
      x: Math.min(living.x1 - 0.4, Math.max(living.x0 + 0.4, at.x + Math.sign(lc.x - at.x || 1) * 0.6)),
      z: Math.min(living.z1 - 0.4, Math.max(living.z0 + 0.4, at.z + Math.sign(lc.z - at.z || 1) * 0.6)),
    };
    out.push({ kind: fuelBurning ? "combo" : "smoke", ...inLiving, why: fuelBurning ? "Outside the bedroom: smoke, and CO next to where people sleep" : "Between the bedroom and the rest of the suite" });
  }
  if (!beds.length && living) out.push({ kind: fuelBurning ? "combo" : "smoke", ...center(living), why: "One per storey of the suite" });
  // A service room with a fuel-burning furnace gets its own CO alarm, and a bedroom that shares a
  // wall with it gets CO inside the bedroom too (9.32.3.9A.(4), 9.32.3.9B.(1)).
  const mech = layout.zones.find((z) => z.kind === "mechanical");
  if (fuelBurning && mech) {
    out.push({ kind: "co", ...center(mech), why: "In the room with the fuel-burning furnace" });
    const touches = (a: LayoutZone, b: LayoutZone) => a.x0 <= b.x1 + 0.05 && b.x0 <= a.x1 + 0.05 && a.z0 <= b.z1 + 0.05 && b.z0 <= a.z1 + 0.05;
    for (const alarm of out) {
      const bed = beds.find((b) => Math.abs(center(b).x - alarm.x) < 0.01 && Math.abs(center(b).z - alarm.z) < 0.01);
      if (bed && touches(bed, mech)) Object.assign(alarm, { kind: "combo", why: "In the bedroom, which shares a wall with the furnace room" });
    }
  }
  return out;
}

// The chosen design of the model every page works from (server/model/current.ts), as a layout in the
// basement frame, with its own alarms, escape window and heights.
function fromModel(result: any, state: StoredState | null | undefined) {
  const current = currentModel(result, state);
  const design = chosenDesign(current?.model);
  const shapes = current && design ? layoutOf(current.model.existing, design) : null;
  if (!current || !design || !shapes) return null;
  const { existing } = current.model;
  const win = shapes.layout.window;
  const opening = win ? shapes.plan.openings.find((o) => o.kind === "window" && o.side === win.side && Math.abs(o.atM - win.atM) < 0.01) : null;
  const status = design.proposed.openings.find((o) => o.id === opening?.detectionId)?.status ?? "existing";
  const overhead = design.proposed.fixtures.filter((f) => (f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead") && f.heightM != null).map((f) => f.heightM as number);
  return {
    layout: shapes.layout,
    alarms: design.proposed.alarms.map((a): Alarm => ({ kind: a.kind, x: a.at[0], z: a.at[1], why: a.why })),
    egress: win ? { side: win.side, atM: win.atM, widthM: win.widthM, existing: status === "existing", ok: win.widthM >= 0.38 ? null : false } : null,
    ceilingM: existing.ceilingM,
    beamM: overhead.length ? Math.min(...overhead) : null,
  };
}

export function basementGeometry(result: any, state: StoredState | null | undefined): Geometry | null {
  const placed = basementRooms(result?.rooms as RoomResult[] | undefined);
  const mainRoom: RoomResult | undefined = (result?.rooms ?? []).find((r: RoomResult) => r.index === result?.mainRoom);
  let rooms: { name: string; plan: Plan }[];
  let main: { name: string; plan: Plan } | null = null;
  const model = fromModel(result, state);
  let layout = model?.layout ?? chosenLayout(result, state);
  if (placed) {
    rooms = placed.map((p) => ({ name: p.room.name, plan: p.plan }));
    const m = placed.find((p) => p.room.index === result.mainRoom) ?? placed[0];
    main = { name: m.room.name, plan: m.plan };
    // The model's layout is already in the basement frame.
    if (layout && !model && m.room.placement) layout = placeLayout(layout, m.room.placement);
  } else if (result?.plan) {
    rooms = [{ name: mainRoom?.name ?? "Basement", plan: result.plan }];
    main = rooms[0];
  } else return null;
  const tape = state?.tape ?? {};
  const scanCeiling = main?.plan.ceilingHeightM ?? result?.measurements?.ceilingHeightM ?? null;
  const clearances: number[] = (result?.measurements?.clearances ?? []).map((c: { clearanceM: number }) => c.clearanceM);
  // A furnace or water heater may burn gas; a panel or a floor drain doesn't.
  const fuelBurning =
    rooms.some((r) => r.plan.fixtures.some((f) => f.kind === "furnace" || f.kind === "water_heater")) ||
    (result?.detections ?? []).some((d: { kind: string; label?: string }) => d.kind === "mechanical" && /furnace|water heater/i.test(d.label ?? ""));
  const win = layout?.window ?? null;
  const bedOk = layout?.window?.inBedroom ?? layout?.checks.find((c) => /escape window/i.test(c.label))?.ok ?? null;
  let egress: Geometry["egress"] = null;
  const bed = layout?.zones.find((z) => z.kind === "bedroom") ?? null;
  if (win && bedOk) egress = { side: win.side, atM: win.atM, widthM: win.widthM, existing: true, ok: win.widthM >= 0.38 ? null : false };
  else if (bed && main) {
    // A new escape window on the bedroom's outside wall.
    const b = main.plan.box;
    const touching = (["minX", "maxX", "minZ", "maxZ"] as PlanSide[]).find((s) => Math.abs((s === "minX" ? bed.x0 - b.minX : s === "maxX" ? b.maxX - bed.x1 : s === "minZ" ? bed.z0 - b.minZ : b.maxZ - bed.z1)) < 0.05);
    if (touching) {
      const along = touching === "minZ" || touching === "maxZ" ? (bed.x0 + bed.x1) / 2 - b.minX : (bed.z0 + bed.z1) / 2 - b.minZ;
      egress = { side: touching, atM: along, widthM: 0.6, existing: false, ok: null };
    }
  }
  return {
    rooms,
    main,
    layout,
    box: union(rooms.map((r) => r.plan.box)),
    ceilingM: tape.ceilingMm ? tape.ceilingMm / 1000 : (model?.ceilingM ?? scanCeiling),
    beamM: tape.beamMm ? tape.beamMm / 1000 : (model?.beamM ?? (clearances.length ? Math.min(...clearances) : null)),
    fuelBurning,
    estimated: !tape.ceilingMm && rooms.some((r) => r.plan.scaleSource !== "user_measurement" || !r.plan.trusted),
    alarms: model?.alarms ?? placeAlarms(layout, main?.plan ?? null, fuelBurning),
    egress: model ? (model.egress ?? egress) : egress,
  };
}
