// A design for the pictures from what a scan already has: the main room's plan and its suggested
// layout (server/layout.ts), moved into the basement frame by the room's placement, then furnished.
// A bridge until the shared model is seeded from the scan (session 1, server/model/*): then the
// pictures take the chosen design from the model instead, and this goes.
import type { Layout } from "../layout";
import type { Plan, Side } from "../plan";
import { furnishDesign } from "../model/furniture";
import type { Design, Fixture, Opening, Pt, Room, RoomKind, Wall } from "../model/types";
import type { RoomPlacement } from "../basement";

type ScanRoom = { index: number; name: string; plan: Plan | null; placement?: RoomPlacement | null };
export type ScanForDesign = { mainRoom: number | null; rooms?: ScanRoom[]; plan?: Plan | null; layout?: Layout | null; vision?: { style?: string } | null };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// Room frame -> basement frame (server/basement.ts): x' = c·x − s·z + x0, z' = s·x + c·z + z0.
export function mover(p: RoomPlacement | null | undefined) {
  const t = ((p?.turn ?? 0) * Math.PI) / 2;
  const c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
  return (x: number, z: number): Pt => [r3(c * x - s * z + (p?.x ?? 0)), r3(s * x + c * z + (p?.z ?? 0))];
}

const SIDE_ENDS: Record<Side, (b: Plan["box"]) => [Pt, Pt]> = {
  minZ: (b) => [[b.minX, b.minZ], [b.maxX, b.minZ]],
  maxZ: (b) => [[b.minX, b.maxZ], [b.maxX, b.maxZ]],
  minX: (b) => [[b.minX, b.minZ], [b.minX, b.maxZ]],
  maxX: (b) => [[b.maxX, b.minZ], [b.maxX, b.maxZ]],
};

const KIND: Record<Layout["zones"][number]["kind"], RoomKind> = {
  bedroom: "bedroom",
  bathroom: "bathroom",
  kitchen: "kitchen",
  living: "living",
  stairs: "stairs",
  mechanical: "mechanical",
};

export function designFromScan(result: ScanForDesign, now = "2026-10-30T00:00:00.000Z"): Design | null {
  const main = result.rooms?.find((r) => r.index === result.mainRoom) ?? null;
  const plan = main?.plan ?? result.plan ?? null;
  const layout = result.layout ?? null;
  if (!plan || !layout) return null;
  const move = mover(main?.placement);
  const b = plan.box;

  // The room's own walls, each side from its low end, so a plan opening's `atM` is its offset.
  const walls: Wall[] = (Object.keys(SIDE_ENDS) as Side[]).map((side) => {
    const [a, e] = SIDE_ENDS[side](b);
    return { id: `wall-${side}`, a: move(...a), b: move(...e), thicknessM: 0.2, kind: plan.sides[side] === "wall" ? "foundation" : "existing", rating: null };
  });
  const openings: Opening[] = plan.openings.map((o, i) => ({
    id: `${o.kind}-${i + 1}`,
    wallId: `wall-${o.side}`,
    kind: o.kind,
    offsetM: o.atM,
    widthM: o.widthM,
    heightM: o.kind === "door" ? 2.03 : 0.5,
    ...(o.kind === "window" ? { sillM: Math.max(0.9, (plan.ceilingHeightM ?? 2.3) - 0.75) } : {}),
    status: "existing",
    detectionId: o.detectionId,
  }));
  layout.walls.forEach((w, i) => {
    walls.push({ id: `wall-new-${i + 1}`, a: move(w.x0, w.z0), b: move(w.x1, w.z1), thicknessM: 0.12, kind: "new", rating: null });
  });
  layout.doors.forEach((d, i) => {
    const w = layout.walls.findIndex((x) =>
      d.along === "x" ? Math.abs(x.z0 - d.z) < 0.05 && Math.abs(x.z1 - d.z) < 0.05 && d.x > Math.min(x.x0, x.x1) && d.x < Math.max(x.x0, x.x1) : Math.abs(x.x0 - d.x) < 0.05 && Math.abs(x.x1 - d.x) < 0.05 && d.z > Math.min(x.z0, x.z1) && d.z < Math.max(x.z0, x.z1),
    );
    if (w < 0) return;
    const x = layout.walls[w];
    openings.push({ id: `door-new-${i + 1}`, wallId: `wall-new-${w + 1}`, kind: "door", offsetM: r3(Math.hypot(d.x - x.x0, d.z - x.z0)), widthM: d.widthM, heightM: 2.03, status: "new", swing: "left" });
  });

  const count: Record<string, number> = {};
  const rooms: Room[] = layout.zones.map((z) => {
    const kind = KIND[z.kind];
    count[kind] = (count[kind] ?? 0) + 1;
    return { id: `${kind}-${count[kind]}`, kind, name: z.name, unit: z.kind === "stairs" || z.kind === "mechanical" ? "shared" : 2, polygon: [move(z.x0, z.z0), move(z.x1, z.z0), move(z.x1, z.z1), move(z.x0, z.z1)] };
  });
  const fixtures: Fixture[] = [
    ...plan.stairs.map((s, i): Fixture => {
      const [p, q] = [move(s.x0, s.z0), move(s.x1, s.z1)];
      return { id: `stairs-${i + 1}`, kind: "stairs", at: [r3((p[0] + q[0]) / 2), r3((p[1] + q[1]) / 2)], sizeM: [r3(Math.abs(q[0] - p[0])), r3(Math.abs(q[1] - p[1]))], detectionId: s.detectionId };
    }),
    ...plan.fixtures.map((f, i): Fixture => ({ id: `${f.kind}-${i + 1}`, kind: f.kind, at: move(f.x, f.z), sizeM: [0.6, 0.6], detectionId: f.detectionId })),
  ];

  return furnishDesign({
    id: "design-1",
    name: layout.kind === "studio" ? "Studio" : "One bedroom",
    layout: layout.kind,
    proposed: { walls, openings, rooms, fixtures, alarms: [], furniture: [] },
    finishes: { style: result.vision?.style || "bright, calm and uncluttered", floor: "light oak vinyl plank", walls: "warm white" },
    chosen: true,
    updatedAt: now,
  });
}
