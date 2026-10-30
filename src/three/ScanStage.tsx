import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { findings, objects, REVEAL_SECONDS, room } from "../data/sampleBasement";
import { buildSampleCloud, FIND_KINDS, findColors, makeScanMaterial } from "./scanCloud";
import { Tag, TagRoot, TagTracker } from "./Tags";

type Props = {
  // "reveal" plays the timed scan; "ambient" shows the finished cloud turning slowly.
  mode: "reveal" | "ambient";
  onTime?: (t: number) => void;
};

function Cloud({ mode, onTime }: Props) {
  const geometry = useMemo(() => buildSampleCloud(mode === "ambient" ? 700 : 1000), [mode]);
  const material = useMemo(() => makeScanMaterial(findColors()), []);
  const start = useRef<number | null>(null);
  const [t, setT] = useState(mode === "ambient" ? REVEAL_SECONDS : 0);

  useFrame(({ clock, camera }) => {
    const above = camera.position.y > room.height + 0.6 ? 1 : 0;
    material.uniforms.uCeilingFade.value += (above - material.uniforms.uCeilingFade.value) * 0.06;
    if (mode === "ambient") {
      material.uniforms.uReveal.value = 1.2;
      return;
    }
    if (start.current === null) start.current = clock.elapsedTime;
    const now = clock.elapsedTime - start.current;
    material.uniforms.uReveal.value = Math.min(1.2, now / (REVEAL_SECONDS * 0.7));
    const hl = material.uniforms.uHighlight.value as number[];
    FIND_KINDS.forEach((kind, i) => {
      const first = findings.find((f) => f.kind === kind);
      const target = first && now >= first.at ? 1 : 0;
      hl[i] += (target - hl[i]) * 0.08;
    });
    if (Math.abs(now - t) > 0.1) {
      setT(now);
      onTime?.(now);
    }
  });

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  return (
    <group>
      <points geometry={geometry} material={material} />
      {mode === "reveal" &&
        findings.map((f) => {
          const o = objects.find((x) => x.id === f.id);
          if (!o) return null;
          const shown = t >= f.at;
          return (
            <Tag key={f.id} position={[o.center[0], o.center[1] + o.size[1] / 2 + 0.15, o.center[2]]}>
              <div className={`find-tag ${shown ? "is-shown" : ""}`} data-kind={f.kind}>
                <span className="find-dot" />
                <span className="find-label">{f.label}</span>
                <span className="find-measure">{f.measure}</span>
              </div>
            </Tag>
          );
        })}
    </group>
  );
}

// Walks the camera from eye height at the stairs to a three-quarter overview.
function CameraRig({ mode }: { mode: Props["mode"] }) {
  const { camera, size } = useThree();
  const start = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime;
    const now = clock.elapsedTime - start.current;
    const k = mode === "ambient" ? 1 : Math.min(1, now / REVEAL_SECONDS);
    const ease = 1 - Math.pow(1 - k, 3);
    const angle = -0.9 + ease * 1.5 + (mode === "ambient" ? now * 0.05 : 0);
    // Pull back on tall, narrow panels so the whole room stays in frame.
    const fit = Math.sqrt(Math.max(1, 1.15 / (size.width / size.height)));
    const radius = THREE.MathUtils.lerp(4.5, 10.5 * fit, ease);
    const height = THREE.MathUtils.lerp(1.5, 7.2 * fit, ease);
    camera.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    camera.lookAt(0, room.height * 0.35, 0);
  });
  return null;
}

export function ScanStage({ mode, onTime }: Props) {
  const [done, setDone] = useState(mode === "ambient");
  return (
    <TagRoot>
      <Canvas
        className="scan-canvas"
        camera={{ fov: 42, near: 0.05, far: 100, position: [4, 1.5, 4] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <TagTracker />
        <Cloud
          mode={mode}
          onTime={(t) => {
            onTime?.(t);
            if (t > REVEAL_SECONDS + 0.5 && !done) setDone(true);
          }}
        />
        {done && mode === "reveal" ? (
          <OrbitControls enablePan={false} minDistance={4} maxDistance={16} maxPolarAngle={Math.PI / 2.1} target={[0, 0.7, 0]} />
        ) : (
          <CameraRig mode={mode} />
        )}
      </Canvas>
    </TagRoot>
  );
}
