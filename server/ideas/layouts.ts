// "Pick a layout": three or four floor plans for their own basement, each with a picture of one real
// corner as it would look in it, finished the way their mood board reads. Until the shared model's
// designs are seeded (server/model, session 1), the options come from server/layout.ts suggestLayout:
// the one-bedroom on the window, the studio, and the bedroom on another wall. The one they pick is
// saved as a Design (server/model/types.ts) on the workspace.
import { suggestLayout, type Layout, type Zone } from "../layout";
import type { Design, Finishes, Opening, Room, RoomKind, Wall } from "../model/types";
import type { Plan, Side } from "../plan";
import { STYLES, type StyleId, type Use } from "./styles";

export type LayoutOption = {
  id: string;
  name: string;
  kind: Design["layout"];
  side: Side;
  layout: Layout;
  checks: { passed: number; total: number };
  // The real frame that looks at the room this layout is about, and what that room becomes.
  corner: { frame: number; use: Use; zone: string; aspect: number } | null;
  // The quote's low–high for this layout (session 4's quote()); missing until it lands, never guessed.
  price: { lowCAD: number; highCAD: number } | null;
};

// Which wall a zone stands against.
function sideOf(z: Zone, box: Plan["box"]): Side {
  const d: [Side, number][] = [
    ["minX", Math.abs(z.x0 - box.minX)],
    ["maxX", Math.abs(z.x1 - box.maxX)],
    ["minZ", Math.abs(z.z0 - box.minZ)],
    ["maxZ", Math.abs(z.z1 - box.maxZ)],
  ];
  return d.sort((a, b) => a[1] - b[1])[0][0];
}

const opposite: Record<Side, Side> = { minX: "maxX", maxX: "minX", minZ: "maxZ", maxZ: "minZ" };
const passed = (l: Layout) => ({ passed: l.checks.filter((c) => c.ok === true).length, total: l.checks.length });
const sameRooms = (a: Layout, b: Layout) => JSON.stringify(a.zones) === JSON.stringify(b.zones);

// Up to four layouts that really differ, the best first.
export function layoutOptions(plan: Plan): Omit<LayoutOption, "corner">[] {
  const out: Omit<LayoutOption, "corner">[] = [];
  const add = (layout: Layout, name: string) => {
    const bed = layout.zones.find((z) => z.kind === "bedroom");
    if (!bed || out.length >= 4 || out.some((o) => sameRooms(o.layout, layout))) return;
    // The second of two ends is "the other end wall".
    if (out.some((o) => o.name === name)) name = name.replace(/^Bedroom on the /, "Bedroom on the other ");
    const side = sideOf(bed, plan.box);
    out.push({ id: `${layout.kind}-${side}`, name, kind: layout.kind, side, layout, checks: passed(layout), price: null });
  };
  const first = suggestLayout(plan);
  const onWindow = first.checks[0]?.ok === true;
  const firstSide = sideOf(first.zones.find((z) => z.kind === "bedroom")!, plan.box);
  add(first, first.kind === "studio" ? "Studio" : onWindow ? "One bedroom on the window" : "One bedroom");
  const other = suggestLayout(plan, { kind: first.kind === "studio" ? "one_bedroom" : "studio", side: firstSide });
  add(other, other.kind === "studio" ? "Studio" : other.checks[0]?.ok ? "One bedroom on the window" : "One bedroom");
  // The bedroom on another wall: another window first, then across the room, then the ends.
  const windows = plan.openings.filter((o) => o.kind === "window" && o.side !== firstSide).map((o) => o.side);
  const ends = (["minX", "maxX", "minZ", "maxZ"] as Side[]).filter((s) => s !== firstSide && s !== opposite[firstSide]);
  for (const side of [...new Set([...windows, opposite[firstSide], ...ends])]) {
    const l = suggestLayout(plan, { kind: "one_bedroom", side });
    // Only a bedroom big enough to be one.
    if (l.checks[1]?.ok !== true) continue;
    add(l, windows.includes(side) ? "Bedroom on the other window" : side === opposite[firstSide] ? "Bedroom across the room" : "Bedroom on the end wall");
  }
  return out;
}

// ---- The real corner ----

export type Camera = { frame: number; x: number; z: number; fx: number; fz: number; tilt: number };

// Where the camera stood and looked for each frame of the 3D, in the plan's frame (the pose's third
// column is where it looks; frames map back to ours through sentFrames, or `frame` in older scans).
export function cameras(scan: { frames?: { sourceIndex?: number; frame?: number; pose: number[][] }[]; sentFrames?: number[] }): Camera[] {
  return (scan.frames ?? [])
    .map((f) => ({
      frame: (f.sourceIndex != null ? scan.sentFrames?.[f.sourceIndex] : undefined) ?? f.frame ?? -1,
      x: f.pose[0][3],
      z: f.pose[2][3],
      fx: f.pose[0][2],
      fz: f.pose[2][2],
      tilt: Math.abs(f.pose[1][2]),
    }))
    .filter((c) => c.frame >= 0);
}

// The frame that looks most squarely at a spot from a few metres back, level. `allowed`: only these.
export function frameFacing(cams: Camera[], at: [number, number], allowed?: number[]): number | null {
  const ok = allowed ? new Set(allowed) : null;
  const scored = cams
    .filter((c) => !ok || ok.has(c.frame))
    .map((c) => {
      const dx = at[0] - c.x, dz = at[1] - c.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      const cos = (c.fx * dx + c.fz * dz) / (Math.hypot(c.fx, c.fz) * dist || 1);
      return { frame: c.frame, s: cos - 0.08 * Math.abs(dist - 3.5) - c.tilt };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0]?.frame ?? null;
}

// The room a layout is about: the bedroom, or for a studio its open living space.
export function cornerOf(o: Pick<LayoutOption, "kind" | "layout">): { zone: Zone; use: Use } | null {
  const want = o.kind === "studio" ? "living" : "bedroom";
  const zone = o.layout.zones.find((z) => z.kind === want);
  return zone ? { zone, use: want } : null;
}

// `aspect`: the frames' width over height, so the picture's place is the right shape before it loads.
export function withCorners(options: Omit<LayoutOption, "corner">[], cams: Camera[], aspect: number, allowed?: number[]): LayoutOption[] {
  return options.map((o) => {
    const c = cornerOf(o);
    const frame = c && cams.length ? frameFacing(cams, [(c.zone.x0 + c.zone.x1) / 2, (c.zone.z0 + c.zone.z1) / 2], allowed) : null;
    return { ...o, corner: c && frame != null ? { frame, use: c.use, zone: c.zone.name, aspect } : null };
  });
}

// ---- Into the model ----

const r2 = (n: number) => Math.round(n * 100) / 100;
const ZONE_ROOM: Record<Zone["kind"], RoomKind> = { bedroom: "bedroom", bathroom: "bathroom", kitchen: "kitchen", living: "living", stairs: "stairs", mechanical: "mechanical" };

// A layout as the model's design: its new walls, their doors, the rooms as rectangles and the mood's
// finishes. Fixtures and alarms come with the model's own seeding.
export function designFrom(o: Pick<LayoutOption, "id" | "name" | "kind" | "layout">, finishes: Partial<Finishes>): Design {
  const walls: Wall[] = o.layout.walls.map((w, i) => ({ id: `${o.id}-w${i + 1}`, a: [w.x0, w.z0], b: [w.x1, w.z1], thicknessM: 0.12, kind: "new", rating: null }));
  const openings: Opening[] = o.layout.doors.flatMap((d, i) => {
    const wall = walls.find((w) => {
      const [ax, az] = w.a, [bx, bz] = w.b;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const t = ((d.x - ax) * (bx - ax) + (d.z - az) * (bz - az)) / len ** 2;
      const off = Math.abs((d.x - ax) * (bz - az) - (d.z - az) * (bx - ax)) / len;
      return off < 0.05 && t >= -0.01 && t <= 1.01;
    });
    if (!wall) return [];
    return [{ id: `${o.id}-d${i + 1}`, wallId: wall.id, kind: "door", offsetM: r2(Math.hypot(d.x - wall.a[0], d.z - wall.a[1])), widthM: d.widthM, heightM: 2.03, status: "new", swing: null }];
  });
  const rooms: Room[] = o.layout.zones.map((z, i) => ({
    id: `${o.id}-r${i + 1}`,
    polygon: [[z.x0, z.z0], [z.x1, z.z0], [z.x1, z.z1], [z.x0, z.z1]],
    kind: ZONE_ROOM[z.kind],
    name: z.name,
    unit: z.kind === "stairs" || z.kind === "mechanical" ? "shared" : 2,
  }));
  const style = (finishes.style && finishes.style in STYLES ? finishes.style : "bright") as StyleId;
  const s = STYLES[style];
  return {
    id: o.id,
    name: o.name,
    layout: o.kind,
    proposed: { walls, openings, rooms, fixtures: [], alarms: [] },
    finishes: { style, floor: finishes.floor ?? s.floors[0], walls: finishes.walls ?? s.walls[0], kitchen: finishes.kitchen ?? s.kitchen, bath: finishes.bath ?? s.bath },
    chosen: true,
    updatedAt: new Date().toISOString(),
  };
}
