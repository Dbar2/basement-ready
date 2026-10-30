// What the wait screen draws of the basement, from the scan's `path` and `model` events (server/basement.ts).
// Two frames:
// - The walk frame: the `path` event's walk, with each area's 3D (in that area's own frame) set into
//   it by its `place`. The placement is provisional, so a later event for the same area moves it.
// - The final frame: the whole basement (`area: "all"`), which re-sends the walk in its own frame.
//   It replaces the walk frame once it's in; the two never overlay, since the turn between them isn't sent.
type Logged = { type: string; data?: { points?: V2[]; area?: number | "all"; files?: { surfels: string; mesh?: string }; place?: Place | null; path?: V2[] } };

export type V2 = [number, number];

// An area's own frame into the walk frame: x' = s·(cos a·x − sin a·z) + x, z' = s·(sin a·x + cos a·z) + z, y' = s·y.
export type Place = { angle: number; scale: number; x: number; z: number };

export type AreaModel = { key: string; area: number | "all"; surfels: string; mesh?: string; place: Place | null; path: V2[] | null };

export function placePoint(p: Place | null, x: number, y: number, z: number): [number, number, number] {
  if (!p) return [x, y, z];
  const c = Math.cos(p.angle), s = Math.sin(p.angle);
  return [p.scale * (c * x - s * z) + p.x, p.scale * y, p.scale * (s * x + c * z) + p.z];
}

// The same placement as a three.js group: turned by −angle about y, then scaled, then moved.
export function placeGroup(p: Place | null): { rotationY: number; scale: number; position: [number, number, number] } {
  return p ? { rotationY: -p.angle, scale: p.scale, position: [p.x, 0, p.z] } : { rotationY: 0, scale: 1, position: [0, 0, 0] };
}

// The newest walk.
export function walkFrom(events: Logged[]): V2[] | null {
  return [...events].reverse().find((e) => e.type === "path" && (e.data?.points?.length ?? 0) > 1)?.data?.points ?? null;
}

const finite = (p: Place | null | undefined): p is Place => !!p && [p.angle, p.scale, p.x, p.z].every(Number.isFinite) && p.scale > 0;

// One model per area, the newest event for it winning (its placement settles as the layout does).
export function modelsFrom(events: Logged[]): AreaModel[] {
  const byArea = new Map<string, AreaModel>();
  for (const e of events) {
    const f = e.data?.files;
    if (e.type !== "model" || !f?.surfels) continue;
    const area = e.data?.area === "all" || /room=all/.test(f.surfels) ? "all" : Number(e.data?.area ?? 0);
    const path = area === "all" && (e.data?.path?.length ?? 0) > 1 ? e.data!.path! : null;
    byArea.set(String(area), { key: `${area}:${f.surfels}`, area, surfels: f.surfels, mesh: f.mesh, place: area !== "all" && finite(e.data?.place) ? e.data!.place! : null, path });
  }
  return [...byArea.values()];
}
