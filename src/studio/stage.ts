// The studio's 3D helpers: the design as the stager furnishes it (server/model/legacy.ts), and walking.
import { distToSegment } from "../../server/model/geometry";
import type { Fixture, Pt } from "../../server/model/types";

export { layoutOf as stagingFor, mainRect, suiteArea } from "../../server/model/legacy";

// Walking: one step, sliding along a wall rather than through it. Null when every way is blocked.
export const BODY_M = 0.25; // how close the walker gets to a wall
export function walkStep(p: Pt, d: Pt, walls: [Pt, Pt][], body = BODY_M): Pt | null {
  const free = (x: number, z: number) => !walls.some(([a, b]) => distToSegment([x, z], a, b) < body);
  if (free(p[0] + d[0], p[1] + d[1])) return [p[0] + d[0], p[1] + d[1]];
  if (d[0] && free(p[0] + d[0], p[1])) return [p[0] + d[0], p[1]];
  if (d[1] && free(p[0], p[1] + d[1])) return [p[0], p[1] + d[1]];
  return null;
}

const OVERHEAD_NAME: Record<string, [string, string]> = { beam: ["Beam", "beams"], duct: ["Duct", "ducts"], bulkhead: ["Bulkhead", "bulkheads"] };

// One label per kind of overhead find, at the lowest one: its headroom is the one that counts.
export function overheadTags(fixtures: Fixture[]) {
  const by = new Map<string, typeof fixtures>();
  for (const f of fixtures) if (f.heightM != null && OVERHEAD_NAME[f.kind]) by.set(f.kind, [...(by.get(f.kind) ?? []), f]);
  return [...by].map(([kind, fs]) => {
    const low = fs.reduce((a, b) => (b.heightM! < a.heightM! ? b : a));
    const [one, many] = OVERHEAD_NAME[kind];
    const clear = `${low.heightM!.toFixed(2)} m clear`;
    return { id: low.id, at: low.at, heightM: low.heightM!, text: fs.length > 1 ? `${fs.length} ${many} · lowest ${clear}` : `${one} · ${clear}` };
  });
}
