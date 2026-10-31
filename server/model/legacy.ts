// The chosen design in the older shapes, for code written before the model: a Plan of the area the
// suite is in and a Layout of rectangular zones, new walls and their doors (src/api.ts), in the
// basement frame. The 3D stager furnishes it (src/three/StagedBasement.tsx StagedFurniture), and the
// permit sheets and the materials list can read it until they read the model itself. Rooms the edits
// turned into L shapes become their biggest clear rectangle.
import type { Layout, LayoutZone, Plan, PlanSide } from "../../src/api";
import { bounds, centroid, floorArea, inPolygon, polygonArea, wallLength, type Box } from "./geometry";
import type { Design, Existing, Model, Pt } from "./types";

export const chosenDesign = (model: Model | null | undefined): Design | null => model?.designs.find((d) => d.chosen) ?? model?.designs[0] ?? null;

type Rect = { x0: number; z0: number; x1: number; z1: number };

// The biggest axis-aligned rectangle inside a polygon that keeps clear of `avoid`, with its sides on
// the polygon's own coordinates.
export function mainRect(poly: Pt[], avoid: Box[] = []): Rect {
  const xs = [...new Set([...poly.map((p) => p[0]), ...avoid.flatMap((b) => [b.minX, b.maxX])])].sort((a, b) => a - b);
  const zs = [...new Set([...poly.map((p) => p[1]), ...avoid.flatMap((b) => [b.minZ, b.maxZ])])].sort((a, b) => a - b);
  const pb = bounds(poly);
  let best: Rect = { x0: pb.minX, z0: pb.minZ, x1: pb.maxX, z1: pb.maxZ };
  let bestA = -1;
  const ok = (r: Rect) => {
    for (let x = r.x0 + 0.05; x < r.x1; x += Math.max(0.1, (r.x1 - r.x0) / 6))
      for (let z = r.z0 + 0.05; z < r.z1; z += Math.max(0.1, (r.z1 - r.z0) / 6)) if (!inPolygon([x, z], poly)) return false;
    return !avoid.some((b) => r.x0 < b.maxX - 0.02 && r.x1 > b.minX + 0.02 && r.z0 < b.maxZ - 0.02 && r.z1 > b.minZ + 0.02);
  };
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++)
      for (let k = 0; k < zs.length; k++)
        for (let l = k + 1; l < zs.length; l++) {
          const r = { x0: xs[i], x1: xs[j], z0: zs[k], z1: zs[l] };
          const a = (r.x1 - r.x0) * (r.z1 - r.z0);
          if (a > bestA && ok(r)) {
            best = r;
            bestA = a;
          }
        }
  return best;
}

// The area of the basement the suite is in: the scanned room holding most of its rooms.
export function suiteArea(existing: Existing, design: Design) {
  const suite = design.proposed.rooms.filter((r) => r.unit === 2);
  const holds = (poly: Pt[]) => suite.filter((s) => inPolygon(centroid(s.polygon), poly)).length;
  return [...existing.rooms].sort((a, b) => holds(b.polygon) - holds(a.polygon) || polygonArea(b.polygon) - polygonArea(a.polygon))[0] ?? null;
}

const SIDES: PlanSide[] = ["minZ", "maxZ", "minX", "maxX"];

export function layoutOf(existing: Existing, design: Design): { plan: Plan; layout: Layout } | null {
  const area = suiteArea(existing, design);
  if (!area) return null;
  const box = bounds(area.polygon);
  const { walls, openings, rooms } = design.proposed;
  const sideOf = (p: Pt): PlanSide | null => {
    const d: [PlanSide, number][] = [
      ["minZ", Math.abs(p[1] - box.minZ)],
      ["maxZ", Math.abs(p[1] - box.maxZ)],
      ["minX", Math.abs(p[0] - box.minX)],
      ["maxX", Math.abs(p[0] - box.maxX)],
    ];
    const [side, off] = d.sort((a, b) => a[1] - b[1])[0];
    return off < 0.15 ? side : null;
  };
  const planOpenings: Plan["openings"] = openings.flatMap((o) => {
    const w = walls.find((x) => x.id === o.wallId);
    if (!w || w.kind === "new") return [];
    const c: Pt = [w.a[0] + ((w.b[0] - w.a[0]) * o.offsetM) / Math.max(1e-6, wallLength(w)), w.a[1] + ((w.b[1] - w.a[1]) * o.offsetM) / Math.max(1e-6, wallLength(w))];
    const side = sideOf(c);
    if (!side) return [];
    return [{ kind: o.kind, side, atM: side === "minZ" || side === "maxZ" ? c[0] - box.minX : c[1] - box.minZ, widthM: o.widthM, detectionId: o.id }];
  });
  const widthM = box.maxX - box.minX, depthM = box.maxZ - box.minZ;
  const plan: Plan = {
    version: 1,
    box,
    sides: Object.fromEntries(SIDES.map((s) => [s, "wall"])) as Plan["sides"],
    widthM,
    depthM,
    areaM2: widthM * depthM,
    ceilingHeightM: area.ceilingM ?? existing.ceilingM,
    openings: planOpenings,
    stairs: [],
    fixtures: [],
    scaleSource: "model",
    trusted: true,
  };
  const shared = rooms.filter((r) => r.unit !== 2).map((r) => bounds(r.polygon));
  const zoneKinds = new Set(["bedroom", "bathroom", "kitchen", "living", "mechanical"]);
  const fixed = rooms.filter((r) => r.unit === 2 && r.kind !== "living" && zoneKinds.has(r.kind)).map((r) => bounds(r.polygon));
  const zones: LayoutZone[] = rooms
    .filter((r) => zoneKinds.has(r.kind) && (r.unit === 2 || r.kind === "mechanical"))
    .map((r) => {
      // Living space is furnished clear of the stair, the furnace room and the other rooms.
      const rect = r.kind === "living" ? mainRect(r.polygon, [...shared, ...fixed]) : mainRect(r.polygon);
      return { kind: r.kind as LayoutZone["kind"], name: r.name, ...rect, areaM2: floorArea(r, rooms) };
    });
  const isNew = new Set(walls.filter((w) => w.kind === "new").map((w) => w.id));
  const layoutWalls = walls.filter((w) => w.kind === "new").map((w) => ({ x0: w.a[0], z0: w.a[1], x1: w.b[0], z1: w.b[1] }));
  const doors = openings.flatMap((o) => {
    const w = o.kind === "door" && isNew.has(o.wallId) ? walls.find((x) => x.id === o.wallId) : null;
    if (!w) return [];
    const t = o.offsetM / Math.max(1e-6, wallLength(w));
    const x = w.a[0] + (w.b[0] - w.a[0]) * t, z = w.a[1] + (w.b[1] - w.a[1]) * t;
    return [{ x, z, along: Math.abs(w.b[0] - w.a[0]) >= Math.abs(w.b[1] - w.a[1]) ? ("x" as const) : ("z" as const), widthM: o.widthM }];
  });
  // The bedroom backs onto the wall with its window.
  const bed = rooms.find((r) => r.kind === "bedroom" && r.unit === 2);
  const win = bed ? planOpenings.find((o) => o.kind === "window" && touches(bed.polygon, o, box)) : undefined;
  return {
    plan,
    layout: {
      version: 1,
      kind: design.layout === "studio" ? "studio" : "one_bedroom",
      zones,
      walls: layoutWalls,
      doors,
      window: win ? { side: win.side, atM: win.atM, widthM: win.widthM } : null,
      checks: [],
    },
  };
}

function touches(poly: Pt[], o: Plan["openings"][number], box: Box) {
  const b = bounds(poly);
  const c: Pt = o.side === "minZ" ? [box.minX + o.atM, box.minZ] : o.side === "maxZ" ? [box.minX + o.atM, box.maxZ] : o.side === "minX" ? [box.minX, box.minZ + o.atM] : [box.maxX, box.minZ + o.atM];
  return c[0] >= b.minX - 0.1 && c[0] <= b.maxX + 0.1 && c[1] >= b.minZ - 0.1 && c[1] <= b.maxZ + 0.1;
}
