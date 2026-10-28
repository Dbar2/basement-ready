// The room's 3D scan so far, opened from the little room drawing while filming, to check coverage.
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
  // Each new version fades in, so the room visibly builds up as you film.
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
  return (
    <Canvas camera={{ fov: 45, position: [r * 0.9, r * 1.1, r * 1.1], near: 0.05, far: 100 }} dpr={[1, 2]}>
      <Cloud preview={preview} size={expanded ? 0.055 : 0.045} />
      <OrbitControls autoRotate={!expanded} autoRotateSpeed={1.2} enableZoom={expanded} enablePan={false} target={[0, 0.8, 0]} />
    </Canvas>
  );
}

export function Live3DFull({ preview, room, onClose }: { preview: Preview3d; room: string; onClose: () => void }) {
  return (
    <div className="cap-3d-full" role="dialog" aria-label={`${room} in 3D so far`}>
      <Scene preview={preview} expanded />
      <div className="cap-3d-full-bar">
        <p>
          <b>{room} so far</b> · {preview.wallsSeen} of 4 walls · {preview.views} views
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
