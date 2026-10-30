// A model built from a scan's result and the layout picked on the workspace, through the same
// geometry the permit drawings use (server/permit/plans.ts). The quote and the book read the model;
// this is how they get one for scans saved before the model existed, and for the sample. When the
// workspace carries the homeowner's own model (the plan they confirmed and the design they edited in
// the 3D studio), that one wins.
import type { Design, Fixture, Model, Opening, Pt, Room, RoomKind, Wall } from "../model/types";
import { basementGeometry, type Box, type Geometry } from "../permit/plans";
import type { StoredState } from "../workspace";

const SIDES = ["minZ", "maxX", "maxZ", "minX"] as const;
type Side = (typeof SIDES)[number];

function sideWall(b: Box, side: Side, kind: Wall["kind"]): Wall {
  const ends: Record<Side, [Pt, Pt]> = {
    minZ: [[b.minX, b.minZ], [b.maxX, b.minZ]],
    maxZ: [[b.minX, b.maxZ], [b.maxX, b.maxZ]],
    minX: [[b.minX, b.minZ], [b.minX, b.maxZ]],
    maxX: [[b.maxX, b.minZ], [b.maxX, b.maxZ]],
  };
  return { id: `w_${side}`, a: ends[side][0], b: ends[side][1], thicknessM: 0.2, kind, rating: null };
}

const rect = (z: { x0: number; z0: number; x1: number; z1: number }): Pt[] => [[z.x0, z.z0], [z.x1, z.z0], [z.x1, z.z1], [z.x0, z.z1]];
// The finish picked on the Ideas tab, by the name the workspace shows it under.
const FINISH: Record<string, string> = { light: "Light oak", warm: "Warm wood", deep: "Deep green" };
const ZONE: Record<string, RoomKind> = { bedroom: "bedroom", bathroom: "bathroom", kitchen: "kitchen", living: "living", stairs: "stairs", mechanical: "mechanical" };

// Where a point sits along a wall, from its `a` end.
const offsetOn = (w: Wall, p: Pt) => Math.hypot(p[0] - w.a[0], p[1] - w.a[1]);
function distTo(w: Wall, p: Pt) {
  const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - w.a[0] - t * dx, p[1] - w.a[1] - t * dz);
}

export function modelFromGeometry(geo: Geometry, at = new Date().toISOString(), finish: string | null = null): Model {
  const main = geo.main!.plan;
  const b = geo.box;
  // The basement's outline is foundation all round, even a side the camera only saw the end of.
  const foundation = SIDES.map((s) => sideWall(b, s, "foundation"));
  const openings: Opening[] = main.openings.map((o, i) => ({
    id: `o_${o.detectionId || i}`,
    wallId: `w_${o.side}`,
    kind: o.kind,
    offsetM: o.atM,
    widthM: o.widthM,
    heightM: o.kind === "door" ? 2.03 : null,
    status: "existing",
    detectionId: o.detectionId,
  }));
  const fixtures: Fixture[] = [
    ...main.fixtures.map((f, i): Fixture => ({ id: `f_${f.detectionId || i}`, kind: f.kind, at: [f.x, f.z], detectionId: f.detectionId })),
    ...main.stairs.map((s, i): Fixture => ({ id: `s_${s.detectionId || i}`, kind: "stairs", at: [(s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2], sizeM: [s.x1 - s.x0, s.z1 - s.z0], detectionId: s.detectionId })),
  ];
  const existing: Model["existing"] = {
    walls: foundation,
    openings,
    rooms: geo.rooms.map((r, i) => ({ id: `r_existing_${i}`, polygon: rect({ x0: r.plan.box.minX, z0: r.plan.box.minZ, x1: r.plan.box.maxX, z1: r.plan.box.maxZ }), kind: "other", name: r.name, unit: 1 })),
    fixtures,
    ceilingM: geo.ceilingM,
    scale: { source: main.scaleSource === "user_measurement" ? "user_measurement" : main.scaleSource === "arkit" ? "arkit" : "model" },
    confirmedAt: null,
  };
  return { version: 1, existing, designs: geo.layout ? [designFromGeometry(geo, foundation, openings, fixtures, at, finish)] : [], mood: { liked: [], disliked: [], style: null, finishes: {} } };
}

function designFromGeometry(geo: Geometry, foundation: Wall[], openings: Opening[], fixtures: Fixture[], at: string, finish: string | null): Design {
  const L = geo.layout!;
  const zones = L.zones;
  const walls: Wall[] = [...foundation.map((w) => ({ ...w }))];
  const opens: Opening[] = openings.map((o) => ({ ...o }));
  const rooms: Room[] = zones.map((z, i) => ({
    id: `r_${z.kind}_${i}`,
    polygon: rect(z),
    kind: ZONE[z.kind] ?? "other",
    name: z.name,
    unit: z.kind === "stairs" || z.kind === "mechanical" ? "shared" : 2,
    ceilingM: geo.ceilingM,
  }));
  const at2 = (z: (typeof zones)[number], p: Pt) => p[0] >= z.x0 - 0.01 && p[0] <= z.x1 + 0.01 && p[1] >= z.z0 - 0.01 && p[1] <= z.z1 + 0.01;
  const shared = zones.filter((z) => z.kind === "stairs" || z.kind === "mechanical");
  L.walls.forEach((w, i) => {
    const m: Pt = [(w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2];
    const n: Pt = w.x0 === w.x1 ? [0.2, 0] : [0, 0.2];
    const sides = [[m[0] + n[0], m[1] + n[1]], [m[0] - n[0], m[1] - n[1]]] as Pt[];
    const rated = sides.some((p) => shared.some((z) => at2(z, p)));
    walls.push({ id: `w_new_${i}`, a: [w.x0, w.z0], b: [w.x1, w.z1], thicknessM: 0.12, kind: "new", rating: rated ? "30min" : null });
  });
  // The stairs belong to both homes: enclose them with a 30-minute wall where they open onto the
  // suite, with a 20-minute door, so the separation runs continuously around the stair.
  const b = geo.box;
  for (const s of zones.filter((z) => z.kind === "stairs")) {
    const edges: [Pt, Pt][] = [
      [[s.x0, s.z0], [s.x1, s.z0]],
      [[s.x1, s.z0], [s.x1, s.z1]],
      [[s.x0, s.z1], [s.x1, s.z1]],
      [[s.x0, s.z0], [s.x0, s.z1]],
    ];
    const open = edges.filter(([p, q]) => !(Math.abs(p[0] - q[0]) < 1e-6 ? Math.abs(p[0] - b.minX) < 0.1 || Math.abs(p[0] - b.maxX) < 0.1 : Math.abs(p[1] - b.minZ) < 0.1 || Math.abs(p[1] - b.maxZ) < 0.1));
    open.forEach(([p, q], i) => walls.push({ id: `w_stair_${i}`, a: p, b: q, thicknessM: 0.12, kind: "new", rating: "30min" }));
    const longest = walls.filter((w) => w.id.startsWith("w_stair_")).sort((x, y) => Math.hypot(y.b[0] - y.a[0], y.b[1] - y.a[1]) - Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]))[0];
    if (longest) opens.push({ id: "o_stair_door", wallId: longest.id, kind: "door", offsetM: Math.hypot(longest.b[0] - longest.a[0], longest.b[1] - longest.a[1]) / 2, widthM: 0.81, heightM: 2.03, status: "new", swing: "right", rating: "20min" });
  }
  L.doors.forEach((d, i) => {
    const p: Pt = [d.x, d.z];
    const w = walls.filter((x) => x.kind === "new").sort((x, y) => distTo(x, p) - distTo(y, p))[0];
    if (!w) return;
    opens.push({ id: `o_door_${i}`, wallId: w.id, kind: "door", offsetM: offsetOn(w, p), widthM: d.widthM, heightM: 2.03, status: "new", swing: "left", rating: w.rating ? "20min" : null });
  });
  if (geo.egress && !geo.egress.existing) {
    opens.push({ id: "o_egress", wallId: `w_${geo.egress.side}`, kind: "window", offsetM: geo.egress.atM, widthM: Math.max(0.6, geo.egress.widthM), heightM: 1.0, sillM: 0.9, status: "new" });
  }
  return {
    id: `d_${L.kind}`,
    name: L.kind === "studio" ? "Studio" : "One bedroom",
    layout: L.kind,
    proposed: { walls, openings: opens, rooms, fixtures: fixtures.map((f) => ({ ...f })), alarms: geo.alarms.map((a, i) => ({ id: `a_${i}`, kind: a.kind, at: [a.x, a.z], why: a.why })) },
    finishes: { style: FINISH[finish ?? "light"], floor: "Vinyl plank", walls: "White" },
    chosen: true,
    updatedAt: at,
  };
}

// The homeowner's model when the workspace has one; otherwise one built from the scan.
export function modelFor(result: any, state: StoredState | null | undefined): Model | null {
  const own = (state as { model?: Model } | null | undefined)?.model;
  if (own?.version === 1 && own.designs?.length) return own;
  const geo = basementGeometry(result, state);
  if (!geo?.main) return null;
  const finish = state?.ideas?.finish ?? null;
  const model = modelFromGeometry(geo, "", finish);
  // The other layout they could have picked, so the book can show what they weighed.
  const kind = geo.layout?.kind === "studio" ? "one_bedroom" : "studio";
  const other = basementGeometry(result, { ...(state ?? {}), ideas: { ...(state?.ideas ?? {}), kind } });
  if (other?.layout && other.layout.kind !== geo.layout?.kind) {
    const alt = modelFromGeometry(other, "", finish).designs[0];
    if (alt) model.designs.push({ ...alt, chosen: false });
  }
  return model;
}

export const chosenDesign = (m: Model | null) => m?.designs.find((d) => d.chosen) ?? m?.designs[0] ?? null;
