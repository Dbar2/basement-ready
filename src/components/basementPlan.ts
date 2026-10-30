// A room's plan moved into the one basement plan: turned by its placement's quarter turns and shifted,
// so every room draws in the same frame. Walls, openings, stairs and fixtures all move with it.
import { FIXTURE_LABEL, type Layout, type Plan, type PlanSide, type RoomPlacement, type RoomResult } from "../api";

const NORMAL: Record<PlanSide, [number, number]> = { minX: [-1, 0], maxX: [1, 0], minZ: [0, -1], maxZ: [0, 1] };

function mover(p: RoomPlacement) {
  const t = (p.turn * Math.PI) / 2;
  const c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
  return {
    point: (x: number, z: number): [number, number] => [c * x - s * z + p.x, s * x + c * z + p.z],
    dir: (x: number, z: number): [number, number] => [c * x - s * z, s * x + c * z],
  };
}

function sideOf([nx, nz]: [number, number]): PlanSide {
  if (Math.abs(nx) > Math.abs(nz)) return nx < 0 ? "minX" : "maxX";
  return nz < 0 ? "minZ" : "maxZ";
}

// A point on a side, `at` metres from the side's low end (minX for the z sides, minZ for the x sides).
function onSide(b: Plan["box"], side: PlanSide, at: number): [number, number] {
  if (side === "minZ") return [b.minX + at, b.minZ];
  if (side === "maxZ") return [b.minX + at, b.maxZ];
  if (side === "minX") return [b.minX, b.minZ + at];
  return [b.maxX, b.minZ + at];
}

export function placePlan(plan: Plan, placement: RoomPlacement): Plan {
  const m = mover(placement);
  const b = plan.box;
  const corners = [m.point(b.minX, b.minZ), m.point(b.maxX, b.maxZ)];
  const box = {
    minX: Math.min(corners[0][0], corners[1][0]),
    maxX: Math.max(corners[0][0], corners[1][0]),
    minZ: Math.min(corners[0][1], corners[1][1]),
    maxZ: Math.max(corners[0][1], corners[1][1]),
  };
  const sides = Object.fromEntries((Object.keys(NORMAL) as PlanSide[]).map((side) => [sideOf(m.dir(...NORMAL[side])), plan.sides[side]])) as Plan["sides"];
  const turned = placement.turn % 2 === 1;
  return {
    ...plan,
    box,
    sides,
    widthM: turned ? plan.depthM : plan.widthM,
    depthM: turned ? plan.widthM : plan.depthM,
    openings: plan.openings.map((o) => {
      const side = sideOf(m.dir(...NORMAL[o.side]));
      const [x, z] = m.point(...onSide(b, o.side, o.atM));
      return { ...o, side, atM: side === "minZ" || side === "maxZ" ? x - box.minX : z - box.minZ };
    }),
    stairs: plan.stairs.map((st) => {
      const [a, c] = [m.point(st.x0, st.z0), m.point(st.x1, st.z1)];
      return { ...st, x0: Math.min(a[0], c[0]), z0: Math.min(a[1], c[1]), x1: Math.max(a[0], c[0]), z1: Math.max(a[1], c[1]) };
    }),
    fixtures: plan.fixtures.map((f) => {
      const [x, z] = m.point(f.x, f.z);
      return { ...f, x, z };
    }),
  };
}

// The rooms of a scan in one frame, when the scan put them there; null for older scans.
export function basementRooms(rooms: RoomResult[] | undefined): { room: RoomResult; plan: Plan }[] | null {
  const placed = (rooms ?? []).filter((r): r is RoomResult & { plan: Plan; placement: RoomPlacement } => Boolean(r.plan && r.placement));
  return placed.length ? placed.map((room) => ({ room, plan: placePlan(room.plan, room.placement) })) : null;
}

// The suggested layout of one room, moved into the basement frame with that room.
export function placeLayout(layout: Layout, placement: RoomPlacement): Layout {
  const m = mover(placement);
  const rect = <T extends { x0: number; z0: number; x1: number; z1: number }>(r: T): T => {
    const [a, c] = [m.point(r.x0, r.z0), m.point(r.x1, r.z1)];
    return { ...r, x0: Math.min(a[0], c[0]), z0: Math.min(a[1], c[1]), x1: Math.max(a[0], c[0]), z1: Math.max(a[1], c[1]) };
  };
  return {
    ...layout,
    zones: layout.zones.map(rect),
    walls: layout.walls.map((w) => {
      const [a, c] = [m.point(w.x0, w.z0), m.point(w.x1, w.z1)];
      return { x0: a[0], z0: a[1], x1: c[0], z1: c[1] };
    }),
    doors: layout.doors.map((d) => {
      const [x, z] = m.point(d.x, d.z);
      return { ...d, x, z, along: placement.turn % 2 ? (d.along === "x" ? "z" : "x") : d.along };
    }),
  };
}

// What SAM found, as tags in the basement 3D: windows high on their wall, doors at hand height, the
// stairs and the furnace or panel where the plan has them.
export function scanLabels(plans: Plan[]): { text: string; kind: "window" | "exit" | "stairs" | "mechanical"; at: [number, number, number] }[] {
  return plans.flatMap((p) => {
    const ceiling = p.ceilingHeightM ?? 2.3;
    return [
      ...p.openings.map((o) => {
        const [x, z] = onSide(p.box, o.side, o.atM);
        return { text: o.kind === "window" ? "Window" : "Door", kind: o.kind === "window" ? ("window" as const) : ("exit" as const), at: [x, o.kind === "window" ? ceiling - 0.35 : 1.0, z] as [number, number, number] };
      }),
      ...p.stairs.map((st) => ({ text: "Stairs", kind: "stairs" as const, at: [(st.x0 + st.x1) / 2, 1.0, (st.z0 + st.z1) / 2] as [number, number, number] })),
      ...p.fixtures.map((f) => ({ text: FIXTURE_LABEL[f.kind], kind: "mechanical" as const, at: [f.x, 1.4, f.z] as [number, number, number] })),
    ];
  });
}
