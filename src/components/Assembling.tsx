// The basement putting itself together while the 3D service works (wait screen). First the camera's
// walk, drawn on the floor like a line on a plan; then each area's surface points (or its mesh, when
// the server made one) fading in in filming order, as the server sends them. It turns slowly so it
// reads as 3D. The scan sends `path` and `model` events; a take without 3D sends neither, and the wait
// screen never shows this.
import { Line, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import * as THREE from "three";
import { parseSurfels } from "../three/RealScan";

export type AreaModel = { key: string; area: number | "all"; surfels: string; mesh?: string };
type V2 = [number, number];

const MAX_POINTS = 45_000; // per area, so a phone keeps up
const DRAW_S = 3.2; // the walk draws itself in this long
const REVEAL_S = 2.8; // an area assembles in this long
const SPIN = 0.09; // radians a second

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Cloud = { geometry: THREE.BufferGeometry; min: THREE.Vector3; max: THREE.Vector3; cutY: number };

// The phone-sized share of the points, every one placed in metres, ordered by when it was filmed.
async function loadCloud(url: string): Promise<Cloud> {
  const lite = `${url}${url.includes("?") ? "&" : "?"}lite=1`;
  const buf = await fetch(url.startsWith("/samples/") ? url : lite).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
  const s = parseSurfels(buf);
  const step = Math.max(1, Math.ceil(s.count / MAX_POINTS));
  const n = Math.floor(s.count / step);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const order = new Float32Array(n);
  let lastFrame = 1;
  for (let i = 0; i < n; i++) lastFrame = Math.max(lastFrame, s.frame[i * step]);
  for (let i = 0; i < n; i++) {
    const j = i * step;
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = s.pos[j * 3 + k] * 0.001;
      col[i * 3 + k] = Math.min(1, (s.color[j * 3 + k] / 255) * 1.15);
    }
    // Filming order, with a little noise so an area grows as a cloud, not a wipe.
    order[i] = Math.min(1, s.frame[j] / lastFrame) * 0.85 + ((i * 2654435761) % 1000) / 1000 * 0.15;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geometry.setAttribute("aOrder", new THREE.BufferAttribute(order, 1));
  // Robust bounds: the far 3% of points are often a stray reflection.
  const q = (axis: number, p: number) => {
    const v = Array.from({ length: Math.min(n, 4000) }, (_, i) => pos[Math.floor((i * n) / Math.min(n, 4000)) * 3 + axis]).sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.max(0, Math.floor(v.length * p)))] ?? 0;
  };
  const min = new THREE.Vector3(q(0, 0.03), q(1, 0.02), q(2, 0.03));
  const max = new THREE.Vector3(q(0, 0.97), q(1, 0.98), q(2, 0.97));
  // The ceiling lifted off, so the view looks in.
  return { geometry, min, max, cutY: min.y + (max.y - min.y) * 0.78 };
}

function pointsMaterial(cutY: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uReveal: { value: 0 }, uFade: { value: 1 }, uCut: { value: cutY }, uScale: { value: 300 } },
    vertexShader: /* glsl */ `
      attribute float aOrder;
      attribute vec3 color;
      uniform float uReveal, uCut, uScale;
      varying vec3 vColor;
      varying float vShown;
      void main() {
        vColor = color;
        vShown = clamp((uReveal - aOrder) / 0.08, 0.0, 1.0) * step(position.y, uCut);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(0.035 * uScale / max(-mv.z, 0.1), 1.5, 6.0) * vShown;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vColor;
      varying float vShown;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(vColor, vShown * uFade);
      }
    `,
  });
}

function AreaPoints({ cloud, hidden }: { cloud: Cloud; hidden: boolean }) {
  const material = useMemo(() => pointsMaterial(cloud.cutY), [cloud]);
  const born = useRef<number | null>(null);
  const { size } = useThree();
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }, dt) => {
    born.current ??= clock.elapsedTime;
    const u = material.uniforms;
    u.uReveal.value = still() ? 1.2 : Math.min(1.2, (clock.elapsedTime - born.current) / REVEAL_S);
    u.uFade.value = THREE.MathUtils.damp(u.uFade.value, hidden ? 0 : 1, 3, dt);
    u.uScale.value = size.height;
  });
  return <points geometry={cloud.geometry} material={material} />;
}

// A mesh, when the server made one: lit, fading in over its points.
function AreaMesh({ url, hidden }: { url: string; hidden: boolean }) {
  const gltf = useGLTF(url, false, true);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const materials = useMemo(() => {
    const list: THREE.Material[] = [];
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) {
        const c = x.clone();
        c.transparent = true;
        c.opacity = 0;
        (o as THREE.Mesh).material = c;
        list.push(c);
      }
    });
    return list;
  }, [scene]);
  useFrame((_, dt) => {
    for (const m of materials) m.opacity = THREE.MathUtils.damp(m.opacity, hidden ? 0 : 1, 1.6, dt);
  });
  return <primitive object={scene} />;
}

// A mesh that won't load leaves the points showing.
class Quietly extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Walk({ path, color, y }: { path: V2[]; color: string; y: number }) {
  const line = useRef<ComponentRef<typeof Line>>(null);
  const head = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);
  const points = useMemo(() => path.map(([x, z]) => new THREE.Vector3(x, y + 0.02, z)), [path, y]);
  useFrame(({ clock }) => {
    born.current ??= clock.elapsedTime;
    const k = still() ? 1 : Math.min(1, (clock.elapsedTime - born.current) / DRAW_S);
    const segments = Math.max(1, Math.round((points.length - 1) * k));
    if (line.current) (line.current.geometry as THREE.InstancedBufferGeometry).instanceCount = segments;
    const at = points[Math.min(points.length - 1, segments)];
    if (head.current && at) {
      head.current.position.copy(at);
      head.current.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 4));
    }
  });
  if (points.length < 2) return null;
  return (
    <>
      <Line ref={line} points={points} color={color} lineWidth={3} />
      <mesh ref={head}>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </>
  );
}

// Frames everything shown so far, slowly turning; straight down while there's only the walk, then
// tilting to look in once an area arrives.
function Rig({ min, max, tilted }: { min: THREE.Vector3; max: THREE.Vector3; tilted: boolean }) {
  const { camera, size } = useThree();
  const yaw = useRef(0.6);
  const pitch = useRef(1.45);
  const centre = useRef<THREE.Vector3 | null>(null);
  const reach = useRef<number | null>(null);
  useFrame((_, dt) => {
    if (!still()) yaw.current += SPIN * dt;
    pitch.current = THREE.MathUtils.damp(pitch.current, tilted ? 0.72 : 1.45, 1.2, dt);
    const c = min.clone().add(max).multiplyScalar(0.5);
    c.y = tilted ? min.y + (max.y - min.y) * 0.3 : 0;
    // The first frame starts framed; after that it eases to whatever has arrived.
    centre.current = centre.current ? centre.current.lerp(c, Math.min(1, dt * 2)) : c;
    const span = Math.max(max.x - min.x, max.z - min.z, 2);
    const aspect = size.width / Math.max(1, size.height);
    const want = (span * 0.62) / Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360) / Math.min(1, aspect);
    reach.current = reach.current == null ? want : THREE.MathUtils.damp(reach.current, want, 1.5, dt);
    const r = reach.current;
    camera.position.set(
      centre.current.x + r * Math.cos(pitch.current) * Math.sin(yaw.current),
      centre.current.y + r * Math.sin(pitch.current),
      centre.current.z + r * Math.cos(pitch.current) * Math.cos(yaw.current),
    );
    camera.lookAt(centre.current);
  });
  return null;
}

export default function Assembling({ path, models }: { path: V2[] | null; models: AreaModel[] }) {
  const [clouds, setClouds] = useState<Record<string, Cloud>>({});
  const loaded = useRef(clouds);
  loaded.current = clouds;
  useEffect(() => {
    let live = true;
    for (const m of models) {
      if (clouds[m.key]) continue;
      loadCloud(m.surfels)
        .then((c) => live && setClouds((prev) => ({ ...prev, [m.key]: c })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
    // Each model loads once; clouds only grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);
  useEffect(() => () => Object.values(loaded.current).forEach((c) => c.geometry.dispose()), []);

  // The whole basement, once it's here, stands in for the areas.
  const whole = models.find((m) => m.area === "all" && clouds[m.key]);
  const shown = models.filter((m) => clouds[m.key]);
  const bounds = useMemo(() => {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const [x, z] of path ?? []) {
      min.min(new THREE.Vector3(x, 0, z));
      max.max(new THREE.Vector3(x, 0, z));
    }
    for (const m of shown) {
      min.min(clouds[m.key].min);
      max.max(clouds[m.key].max);
    }
    // The floor: the lowest of the areas' points, or the plan's own level before any arrive.
    const floor = shown.length ? Math.min(...shown.map((m) => clouds[m.key].min.y)) : 0;
    if (!Number.isFinite(min.x)) return { min: new THREE.Vector3(-2, 0, -2), max: new THREE.Vector3(2, 2.4, 2), floor };
    min.y = Math.min(min.y, floor);
    return { min, max, floor };
  }, [path, shown.length, clouds]);
  const colors = useMemo(() => ({ walk: cssVar("--color-mint"), grid: cssVar("--color-mint-line") }), []);
  const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;

  return (
    <Canvas className="assemble-canvas" camera={{ fov: 40, near: 0.05, far: 200 }} dpr={[1, phone ? 1.5 : 2]} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 8, 4]} intensity={1.2} />
      <Rig min={bounds.min} max={bounds.max} tilted={shown.length > 0} />
      <gridHelper
        args={[40, 80, colors.grid, colors.grid]}
        position={[(bounds.min.x + bounds.max.x) / 2, bounds.floor, (bounds.min.z + bounds.max.z) / 2]}
        material-transparent
        material-opacity={0.16}
      />
      {path && <Walk path={path} color={colors.walk} y={bounds.floor} />}
      {shown.map((m) => (
        <group key={m.key}>
          <AreaPoints cloud={clouds[m.key]} hidden={Boolean(whole && m !== whole)} />
          {m.mesh && (
            <Quietly>
              <Suspense fallback={null}>
                <AreaMesh url={m.mesh} hidden={Boolean(whole && m !== whole)} />
              </Suspense>
            </Quietly>
          )}
        </group>
      ))}
    </Canvas>
  );
}
