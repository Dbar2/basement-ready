// Development only: one painted as-built basement on its own, for checking the painting by eye and for
// screenshots (scripts/asbuilt-eval.ts writes the folders). Served by Vite at
// /tools/asbuilt-preview.html?dir=/tmp/asbuilt/b1/ with:
//   view=eye                      where the walk starts (src/three/AsBuilt.tsx homeView), or
//   view=eye&at=x,y,z&look=x,y,z  standing somewhere, looking at a point (basement frame, metres)
//   view=above                    the overview, ceilings off
//   layer=plain                   the model unpainted; layer=mesh&mesh=URL the old solid scan instead
//   atlas=/samples/sample/3d/asbuilt/  the painting from somewhere other than `dir`
//   labels=1                      the beams, ducts and bulkheads named, as the walk-through does
// It sets <body data-ready> once the sharpest atlas is on.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import type { Existing } from "../../server/model/types";
import { AsBuiltScene, asBuiltOf, homeView, type Atlas, type AtlasIndex } from "./AsBuilt";
import { parseMesh, SolidView, type Solid } from "./RealScan";
import { TagRoot, TagTracker } from "./Tags";
import "../styles/global.css"; // the labels' look

const q = new URLSearchParams(location.search);
const dir = q.get("dir") ?? "/tmp/asbuilt/b1/";
const view = q.get("view") ?? "above";
const layer = q.get("layer") ?? "built";
const atlasDir = q.get("atlas") ?? dir;
let readyTimer: ReturnType<typeof setTimeout> | undefined;
const vec = (s: string | null, d: [number, number, number]) => (s ? (s.split(",").map(Number) as [number, number, number]) : d);

function Camera({ existing, atlas }: { existing: Existing; atlas: Atlas | null }) {
  const state = useThree();
  const { camera, size } = state;
  (window as unknown as { r3f: unknown }).r3f = state; // for poking at it from the console
  const model = useMemo(() => asBuiltOf(existing, null, atlas), [existing, atlas]);
  const b = model.box;
  const centre = new THREE.Vector3((b.minX + b.maxX) / 2, 0.6, (b.minZ + b.maxZ) / 2);
  const span = Math.max(4, b.maxX - b.minX, b.maxZ - b.minZ) * Math.max(1, 1.1 / (size.width / Math.max(1, size.height)));
  useEffect(() => {
    if (view === "eye") {
      const home = homeView(existing);
      camera.position.set(...vec(q.get("at"), home?.at ?? [centre.x, 1.5, centre.z]));
      camera.lookAt(...vec(q.get("look"), home?.look ?? [centre.x + 1, 1.3, centre.z]));
    } else {
      camera.position.set(centre.x + span * 0.25, span * 1.05, centre.z + span * 0.7);
      camera.lookAt(centre);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);
  return view === "eye" ? null : <OrbitControls makeDefault target={centre} />;
}

function Preview() {
  const [existing, setExisting] = useState<Existing | null>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [solid, setSolid] = useState<Solid | null>(null);
  useEffect(() => {
    fetch(dir + "existing.json").then((r) => r.json()).then(setExisting);
    if (layer === "built") fetch(atlasDir + "index.json").then((r) => (r.ok ? r.json() : null)).then((index: AtlasIndex | null) => index && setAtlas({ index, base: atlasDir }));
    if (layer === "mesh" && q.get("mesh")) fetch(q.get("mesh")!).then((r) => r.arrayBuffer()).then((b) => setSolid(parseMesh(b)));
  }, []);
  useEffect(() => {
    // Plain and mesh layers are ready once drawn.
    if (existing && (layer === "plain" || (layer === "mesh" && solid))) setTimeout(() => (document.body.dataset.ready = "1"), 2500);
  }, [existing, solid]);
  if (!existing) return null;
  const k = existing.scale.factor ?? 1;
  return (
    <TagRoot>
      <Canvas camera={{ fov: Number(q.get("fov") ?? 70), near: 0.03, far: 100 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <TagTracker />
        <color attach="background" args={["#0F2A1E"]} />
        {layer === "mesh" && solid ? (
          <group scale={k}>
            <SolidView solid={solid} ceilingY={(existing.ceilingM ?? 2.4) / k} overview={view === "above"} floors={[]} />
          </group>
        ) : (
          <AsBuiltScene
            existing={existing}
            atlas={atlas}
            overview={view === "above"}
            reveal={false}
            labels={q.get("labels") === "1"}
            onLoaded={() => {
              // Ready once no sharper atlas follows for a moment.
              clearTimeout(readyTimer);
              readyTimer = setTimeout(() => (document.body.dataset.ready = "1"), 1500);
            }}
          />
        )}
        <Camera existing={existing} atlas={atlas} />
      </Canvas>
    </TagRoot>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
