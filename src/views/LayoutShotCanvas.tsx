// One layout drawn in 3D for its card (src/views/layoutShots.tsx): the basement as built, painted with the
// video, the walls the design removes gone, its new walls and furniture inside (src/studio/DesignScene.tsx,
// the studio's own scene), seen from above at an angle (src/views/layoutCamera.ts). No photo under it.
// A hidden canvas: once the paint and every piece of furniture are in, it keeps the picture and says so.
import { useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { bounds } from "../../server/model/geometry";
import type { Design, Existing } from "../../server/model/types";
import { useAtlas, type Atlas } from "../three/AsBuilt";
import { DesignScene, wallHeight } from "../studio/DesignScene";
import { layoutCamera } from "./layoutCamera";

export const SHOT_SIZE: [number, number] = [960, 720];
const SETTLE_FRAMES = 30; // frames drawn with nothing loading and nothing added before the picture is kept
const MIN_MS = 1200; // never sooner than this after a design goes in: its pieces load in their own time
const SHARPEST_MS = 4000; // past this, the first paint (1024) does: a card is small
const GIVE_UP_MS = 20000; // keep what's there by then, painted or not

function Snapper({ design, existing, atlas, onShot }: { design: Design; existing: Existing; atlas: Atlas | null; onShot: (blob: Blob | null) => void }) {
  const { camera, gl, size, scene } = useThree();
  const loading = useProgress((s) => s.active);
  const quiet = useRef(0);
  const count = useRef(-1);
  const done = useRef(false);
  const started = useRef(performance.now());
  // The paint is in once the sharpest atlas this canvas loads is on (src/three/AsBuilt.tsx useAtlasTexture).
  const sharpest = useMemo(() => {
    if (!atlas) return null;
    const sizes = Object.keys(atlas.index.levels).map(Number).sort((a, b) => a - b);
    const cap = Math.min(window.matchMedia("(pointer: coarse)").matches ? 2048 : 4096, gl.capabilities.maxTextureSize);
    return String(sizes.filter((s) => s <= cap).pop() ?? sizes.find((s) => s >= 1024) ?? sizes[sizes.length - 1]);
  }, [atlas, gl]);
  useEffect(() => {
    // Framed on the suite's rooms (the layout is about them); the rest of the basement shows round it.
    const suite = design.proposed.rooms.filter((r) => r.unit === 2).flatMap((r) => r.polygon);
    const all = design.proposed.rooms.flatMap((r) => r.polygon);
    const b = bounds(suite.length ? suite : all.length ? all : existing.rooms.flatMap((r) => r.polygon));
    const shot = layoutCamera({ ...b, height: wallHeight(existing) }, size.width / size.height);
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = shot.fovDeg;
    cam.near = 0.1;
    cam.far = 400;
    cam.position.set(...shot.position);
    cam.lookAt(...shot.target);
    cam.updateProjectionMatrix();
    quiet.current = 0;
    count.current = -1;
    done.current = false;
    started.current = performance.now();
  }, [design, existing, camera, size]);
  useFrame(() => {
    if (done.current) return;
    const on = Number(gl.domElement.dataset.atlas ?? 0);
    const age = performance.now() - started.current;
    const painted = !sharpest || on >= Number(sharpest) || (on >= 1024 && age > SHARPEST_MS);
    // Settled: the paint is on, nothing is loading, and nothing was added to the scene for a while.
    let n = 0;
    scene.traverse(() => void n++);
    const same = n === count.current;
    count.current = n;
    quiet.current = !loading && painted && same ? quiet.current + 1 : 0;
    if ((quiet.current < SETTLE_FRAMES || age < MIN_MS) && age < GIVE_UP_MS) return;
    done.current = true;
    // The frame just drawn is still in the buffer (preserveDrawingBuffer).
    gl.domElement.toBlob((blob) => onShot(blob), "image/webp", 0.86);
  });
  return null;
}

export function LayoutShotCanvas({ design, existing, atlas, onShot }: { design: Design; existing: Existing; atlas: Atlas | null; onShot: (blob: Blob | null) => void }) {
  const [w, h] = SHOT_SIZE;
  return (
    <div aria-hidden style={{ position: "fixed", left: -10 - w, top: 0, width: w, height: h, opacity: 0, pointerEvents: "none" }}>
      <Canvas dpr={1} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }} camera={{ fov: 35, position: [0, 10, 10] }}>
        <DesignScene existing={existing} design={design} built={{ atlas }} overview rated={false} reveal={false} />
        <Snapper design={design} existing={existing} atlas={atlas} onShot={onShot} />
      </Canvas>
    </div>
  );
}

// For src/views/layoutShots.tsx, loaded only when a card needs a picture: the scan's paint first (the
// example's is in the repo, a real scan's comes from the server), then each design in turn in one canvas.
// `painted`: false while the server is still painting (the picture is plain and is drawn again later).
export default function LayoutShots({ scanId, existing, design, onShot }: { scanId: string; existing: Existing; design: Design; onShot: (blob: Blob | null, painted: boolean) => void }) {
  const { atlas, status } = useAtlas(scanId, existing);
  if (status === "loading") return null;
  return <LayoutShotCanvas design={design} existing={existing} atlas={atlas} onShot={(blob) => onShot(blob, status !== "painting")} />;
}
