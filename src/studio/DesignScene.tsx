// The design drawn in 3D and nothing else: no camera, walker, labels or handles. New walls with their
// door gaps, the furniture and finishes, the fire separation marked on top of its walls, and, when
// asked, the basement as built (src/three/AsBuilt.tsx: its plan painted with the video, the walls the
// design removes gone), the raw scan, or a plain shell for the house's own walls. Mount it inside any <Canvas>: the
// studio does (src/studio/Studio3D.tsx), and the pictures render it in an offscreen canvas from the
// real cameras' poses over the real frames.
//
// Furniture comes from the model (design.proposed.furniture), drawn by the same pieces as the pictures
// (src/views/DesignScene.tsx FurnitureMesh), so the 3D and the pictures agree. A design saved before
// furniture joined the model has none: the stager (src/three/StagedBasement.tsx) furnishes its rooms.
import { Suspense, useMemo, type ReactNode } from "react";
import { bounds, midpoint, wallLength } from "../../server/model/geometry";
import { layoutOf } from "../../server/model/legacy";
import type { Design, Existing, Wall } from "../../server/model/types";
import { AsBuiltScene, type Atlas } from "../three/AsBuilt";
import { SolidView, type Solid } from "../three/RealScan";
import { StagedFurniture } from "../three/StagedBasement";
import { DesignFurniture } from "../views/DesignScene";

export type Finish = "light" | "warm" | "deep";

export const css = (name: string, fallback: string) => (typeof document === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

// The height new walls are drawn to: the ceiling, kept between 2.0 and 2.6 m.
export const wallHeight = (existing: Existing) => Math.min(2.6, Math.max(2.0, existing.ceilingM ?? 2.3));

export function DesignScene({
  existing,
  design,
  finish = "light",
  built = null,
  scan = null,
  overview = false,
  shell = false,
  rated = true,
}: {
  existing: Existing;
  design: Design;
  finish?: Finish;
  built?: { atlas: Atlas | null } | null; // the basement as built, painted once `atlas` is in
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
      {built ? (
        // The design's own new walls are drawn by the stager below.
        <AsBuiltScene existing={existing} design={design} newWalls={false} atlas={built.atlas} overview={overview} />
      ) : scan ? (
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
      {placed && (
        <Suspense fallback={null}>
          <DesignFurniture design={design} />
        </Suspense>
      )}
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
