// Which side of a room's box a point is nearest, and how far. Its own file so the browser can use the
// layout planner (server/layout.ts) without bundling the 3D service client behind server/plan.ts.
export type Side = "minX" | "maxX" | "minZ" | "maxZ";
export type SideBox = { minX: number; maxX: number; minZ: number; maxZ: number };

export function nearestSide(box: SideBox, x: number, z: number): { side: Side; dist: number } {
  const options: { side: Side; dist: number }[] = [
    { side: "minX", dist: Math.abs(x - box.minX) },
    { side: "maxX", dist: Math.abs(x - box.maxX) },
    { side: "minZ", dist: Math.abs(z - box.minZ) },
    { side: "maxZ", dist: Math.abs(z - box.maxZ) },
  ];
  return options.sort((a, b) => a.dist - b.dist)[0];
}
