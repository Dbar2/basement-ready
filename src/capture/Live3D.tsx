// The basement's 3D so far, while filming: a small turning view in the coverage panel, and the full
// screen view it opens, to check what's missing before stopping.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Preview3d } from "./live";

function Cloud({ preview, size }: { preview: Preview3d; size: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(preview.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(preview.colors, 3, true));
    g.computeBoundingSphere();
    return g;
  }, [preview]);
  const material = useMemo(
    () => new THREE.PointsMaterial({ size, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0 }),
    [size],
  );
  // Each new version fades in, so the basement visibly builds up as you film.
  useEffect(() => {
    material.opacity = 0;
  }, [preview.version, material]);
  useFrame(() => {
    material.opacity = Math.min(1, material.opacity + 0.05);
  });
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <points geometry={geometry} material={material} />;
}

function Scene({ preview, expanded }: { preview: Preview3d; expanded: boolean }) {
  const r = Math.max(2.5, preview.positions.length ? Math.max(preview.widthM ?? 4, preview.depthM ?? 4) : 4);
  // The small view looks down from higher up, so the shape of the whole floor reads at a glance.
  const at: [number, number, number] = expanded ? [r * 0.9, r * 1.1, r * 1.1] : [r * 0.7, r * 1.5, r * 0.9];
  return (
    <Canvas camera={{ fov: 45, position: at, near: 0.05, far: 100 }} dpr={expanded ? [1, 2] : [1, 1.5]} gl={{ alpha: true }}>
      <Cloud preview={preview} size={expanded ? 0.055 : 0.07} />
      <OrbitControls autoRotate={!expanded} autoRotateSpeed={expanded ? 1.2 : 2.4} enableZoom={expanded} enableRotate={expanded} enablePan={false} target={[0, 0.8, 0]} />
    </Canvas>
  );
}

export function Live3DThumb({ preview }: { preview: Preview3d }) {
  return <Scene preview={preview} expanded={false} />;
}

export function Live3DFull({ preview, onClose }: { preview: Preview3d; onClose: () => void }) {
  return (
    <div className="cap-3d-full" role="dialog" aria-label="Your basement in 3D so far">
      <Scene preview={preview} expanded />
      <div className="cap-3d-full-bar">
        <p>
          <b>Your basement so far</b> · {preview.views} views
          <br />
          Missed something? Go back and film it. The 3D keeps building while you record.
        </p>
        <button className="cap-btn cap-btn--primary" onClick={onClose}>
          Keep filming
        </button>
      </div>
    </div>
  );
}
