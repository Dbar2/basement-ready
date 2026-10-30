// Which wall of a room's box a point is nearest. Its own module so the browser can use the layout
// (server/layout.ts) without pulling in the plan's 3D code.
import type { Plan, Side } from "./plan";

export function nearestSide(box: Plan["box"], x: number, z: number): { side: Side; dist: number } {
  const options: { side: Side; dist: number }[] = [
    { side: "minX", dist: Math.abs(x - box.minX) },
    { side: "maxX", dist: Math.abs(x - box.maxX) },
    { side: "minZ", dist: Math.abs(z - box.minZ) },
    { side: "maxZ", dist: Math.abs(z - box.maxZ) },
  ];
  return options.sort((a, b) => a.dist - b.dist)[0];
}
