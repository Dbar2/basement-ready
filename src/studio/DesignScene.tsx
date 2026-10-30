// The design drawn in 3D and nothing else: no camera, walker, labels or handles. New walls with their
// door gaps, the furniture and finishes, the fire separation marked on top of its walls, and, when
// asked, the real scan or a plain shell for the house's own walls. Mount it inside any <Canvas>: the
// studio does (src/studio/Studio3D.tsx), and the pictures render it in an offscreen canvas from the
// real cameras' poses over the real frames.
//
// Furniture comes from the model (design.proposed.furniture) once it's placed there; until then the
// stager (src/three/StagedBasement.tsx StagedFurniture) furnishes the rooms itself.
import { Suspense, useMemo, type ReactNode } from "react";
import { bounds, midpoint, wallLength } from "../../server/model/geometry";
import { layoutOf } from "../../server/model/legacy";
import type { Design, Existing, Furniture, Wall } from "../../server/model/types";
import { SolidView, type Solid } from "../three/RealScan";
import { StagedFurniture } from "../three/StagedBasement";

export type Finish = "light" | "warm" | "deep";

export const css = (name: string, fallback: string) => (typeof document === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

// The height new walls are drawn to: the ceiling, kept between 2.0 and 2.6 m.
export const wallHeight = (existing: Existing) => Math.min(2.6, Math.max(2.0, existing.ceilingM ?? 2.3));

export function DesignScene({
  existing,
  design,
  finish = "light",
  scan = null,
  overview = false,
  shell = false,
  rated = true,
}: {
  existing: Existing;
  design: Design;
  finish?: Finish;
  scan?: Solid | null; // the real scan's solid surface (src/three/RealScan.tsx parseMesh)
  overview?: boolean; // looking down: the scan's ceiling is cut away
  shell?: boolean; // no scan: draw the floor and the house's own walls plain
  rated?: boolean; // mark the fire separation on top of its walls
}) {
  const k = existing.scale.factor ?? 1;
  const ceiling = existing.ceilingM ?? 2.4;
  const h = wallHeight(existing);
  const placed = (design.proposed.furniture ?? []).length > 0;
  const staging = useMemo(() => {
    const s = layoutOf(existing, design);
    // With furniture in the model, the stager draws only the walls; the model's pieces are drawn below.
    return s && placed ? { ...s, layout: { ...s.layout, zones: [] } } : s;
  }, [existing, design, placed]);
  return (
    <>
      {scan ? (
        // The scan was measured before their tape: drawn at the tape's scale, it lines up with the plan.
        <group scale={k}>
          <SolidView solid={scan} ceilingY={ceiling / k} overview={overview} floors={existing.rooms.map((r) => scaleBox(bounds(r.polygon), 1 / k))} />
        </group>
      ) : (
        shell && <Shell existing={existing} h={ceiling} />
      )}
      {staging && (
        <Suspense fallback={null}>
          <StagedFurniture plan={staging.plan} layout={staging.layout} finishKey={finish} />
        </Suspense>
      )}
      {placed && <ModelFurniture items={design.proposed.furniture} />}
      {rated &&
        design.proposed.walls
          .filter((w) => w.rating)
          .map((w) => (
            <WallBox key={w.id} w={w} y={(w.kind === "new" ? h : 0.02) + 0.012} height={0.024} thick={0.13}>
              <meshBasicMaterial color={css("--color-stop", "#B42318")} />
            </WallBox>
          ))}
    </>
  );
}

const scaleBox = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, k: number) => ({ minX: b.minX * k, maxX: b.maxX * k, minZ: b.minZ * k, maxZ: b.maxZ * k });

// Without a solid scan (older scans): the floor and the outside walls, plain.
function Shell({ existing, h }: { existing: Existing; h: number }) {
  const floor = css("--color-surface", "#E6EBE4");
  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[3, 8, 4]} intensity={1.4} />
      {existing.rooms.map((r) => {
        const b = bounds(r.polygon);
        return (
          <mesh key={r.id} position={[(b.minX + b.maxX) / 2, -0.01, (b.minZ + b.maxZ) / 2]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
            <meshLambertMaterial color={floor} />
          </mesh>
        );
      })}
      {existing.walls.map((w) => (
        <WallBox key={w.id} w={w} y={h / 2} height={h} thick={Math.max(0.1, w.thicknessM)}>
          <meshLambertMaterial color="#D9DDD6" />
        </WallBox>
      ))}
    </>
  );
}

// How tall each piece stands, for drawing its footprint as a block until it has a real model.
const HEIGHT: Record<Furniture["kind"], number> = {
  bed: 0.55,
  sofa: 0.8,
  armchair: 0.8,
  desk: 0.75,
  dining: 0.75,
  dresser: 0.9,
  tv: 0.6,
  rug: 0.012,
  shelf: 1.8,
  kitchen: 0.9,
  fridge: 1.8,
  vanity: 0.85,
  toilet: 0.75,
  shower: 2.0,
  washer_dryer: 0.9,
  other: 0.8,
};

// The model's furniture: one block per piece, in its colour, where the model puts it.
function ModelFurniture({ items }: { items: Furniture[] }) {
  return (
    <>
      {items.map((f) => (
        <mesh key={f.id} position={[f.at[0], HEIGHT[f.kind] / 2, f.at[1]]} rotation-y={(f.rotDeg * Math.PI) / 180} userData={{ kind: "furniture", id: f.id }} castShadow receiveShadow>
          <boxGeometry args={[f.sizeM[0], HEIGHT[f.kind], f.sizeM[1]]} />
          <meshStandardMaterial color={f.colour?.startsWith("#") ? f.colour : "#D8D4CB"} roughness={0.85} />
        </mesh>
      ))}
    </>
  );
}

// A box along a wall, from `a` to `b`.
export function WallBox({ w, y, height, thick, extra = 0, children, ...rest }: { w: Pick<Wall, "a" | "b">; y: number; height: number; thick: number; extra?: number; children: ReactNode; userData?: Record<string, unknown> }) {
  const m = midpoint(w);
  const ang = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
  return (
    <mesh position={[m[0], y, m[1]]} rotation-y={-ang} {...rest}>
      <boxGeometry args={[wallLength(w) + extra, height, thick]} />
      {children}
    </mesh>
  );
}
