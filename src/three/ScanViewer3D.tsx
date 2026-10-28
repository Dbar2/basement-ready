// Your basement as the 3D scan saw it: up to 300k coloured points that assemble in the order you
// filmed them, then orbit freely. A dollhouse cutaway hides the ceiling when you look from above.
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { Plan } from "../api";

const REVEAL_S = 3.2;

function makeMaterial(ceilingY: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    vertexColors: true,
    uniforms: {
      uReveal: { value: 0 },
      uSize: { value: 2.4 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uClipY: { value: ceilingY },
      uCut: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aOrder;
      uniform float uReveal, uSize, uPixelRatio, uClipY, uCut;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float t = clamp((uReveal - aOrder) / 0.12, 0.0, 1.0);
        float ease = 1.0 - pow(1.0 - t, 3.0);
        vec3 p = position;
        p.y += (1.0 - ease) * 0.35;
        vColor = color;
        vAlpha = ease * (position.y > uClipY ? 1.0 - uCut : 1.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPixelRatio * clamp(6.0 / -mv.z, 0.8, 3.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25 || vAlpha < 0.05) discard;
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
  });
}

function Cloud({ geometry, plan }: { geometry: THREE.BufferGeometry; plan: Plan | null }) {
  const ceiling = plan?.ceilingHeightM ?? 2.3;
  const material = useMemo(() => makeMaterial(ceiling - 0.08), [ceiling]);
  const started = useMemo(() => ({ t: -1 }), []);
  useFrame(({ clock, camera }) => {
    if (started.t < 0) started.t = clock.elapsedTime;
    material.uniforms.uReveal.value = Math.min(1.15, (clock.elapsedTime - started.t) / REVEAL_S);
    const above = camera.position.y > ceiling + 0.4 ? 1 : 0;
    material.uniforms.uCut.value += (above - material.uniforms.uCut.value) * 0.08;
  });
  useEffect(() => () => material.dispose(), [material]);
  return <points geometry={geometry} material={material} />;
}

// Labels where SAM's finds sit in the room, from the floor plan.
function Labels({ plan }: { plan: Plan }) {
  const b = plan.box;
  const along = (side: Plan["openings"][number]["side"], at: number): [number, number] => {
    if (side === "minZ") return [b.minX + at, b.minZ];
    if (side === "maxZ") return [b.minX + at, b.maxZ];
    if (side === "minX") return [b.minX, b.minZ + at];
    return [b.maxX, b.minZ + at];
  };
  const ceiling = plan.ceilingHeightM ?? 2.3;
  return (
    <>
      {plan.openings.map((o) => {
        const [x, z] = along(o.side, o.atM);
        return (
          <Html key={o.detectionId} position={[x, o.kind === "window" ? ceiling - 0.35 : 1.0, z]} center zIndexRange={[10, 0]}>
            <span className="viewer-tag" data-kind={o.kind === "window" ? "window" : "exit"}>
              <i /> {o.kind === "window" ? "Window" : "Door"}
            </span>
          </Html>
        );
      })}
      {plan.fixtures.map((f) => (
        <Html key={f.detectionId} position={[f.x, 1.4, f.z]} center zIndexRange={[10, 0]}>
          <span className="viewer-tag" data-kind="mechanical">
            <i /> {f.kind === "panel" ? "Panel" : "Furnace"}
          </span>
        </Html>
      ))}
    </>
  );
}

function Rig({ plan }: { plan: Plan | null }) {
  const { camera } = useThree();
  useEffect(() => {
    const w = plan?.widthM ?? 6, d = plan?.depthM ?? 4;
    camera.position.set(w * 0.75, Math.max(w, d) * 0.95, d * 1.15);
    camera.lookAt(0, 0.6, 0);
  }, [camera, plan]);
  return null;
}

export function ScanViewer3D({ plyUrl, plan }: { plyUrl: string; plan: Plan | null }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = new PLYLoader();
    loader.setCustomPropertyNameMapping({ aFrame: ["frame"] });
    loader.load(
      plyUrl,
      (g) => {
        if (cancelled) return;
        // Capture order (0..1) drives the reveal, so the room builds the way it was filmed.
        const frames = g.getAttribute("aFrame") as THREE.BufferAttribute | undefined;
        const n = g.getAttribute("position").count;
        const order = new Float32Array(n);
        let max = 1;
        if (frames) for (let i = 0; i < n; i++) max = Math.max(max, frames.getX(i));
        for (let i = 0; i < n; i++) order[i] = (frames ? frames.getX(i) / max : i / n) * 0.85 + Math.random() * 0.15;
        g.setAttribute("aOrder", new THREE.BufferAttribute(order, 1));
        g.computeBoundingSphere();
        setGeometry(g);
      },
      undefined,
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, [plyUrl]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (error) return <p className="viewer-empty">The 3D scan couldn't be loaded.</p>;
  if (!geometry) return <p className="viewer-empty mono">Loading your basement in 3D…</p>;

  return (
    <Canvas className="viewer-canvas" camera={{ fov: 45, near: 0.05, far: 200 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={[getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim() || "#E6EBE4"]} />
      <Rig plan={plan} />
      <Cloud geometry={geometry} plan={plan} />
      {plan && <Labels plan={plan} />}
      <OrbitControls enablePan target={[0, 0.8, 0]} minDistance={1} maxDistance={30} maxPolarAngle={Math.PI * 0.95} />
    </Canvas>
  );
}
