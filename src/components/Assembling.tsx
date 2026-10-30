// The basement putting itself together while the 3D service works (wait screen). First the camera's
// walk, drawn on the floor like a line on a plan; then each area's surface points fading in in filming
// order, set into the walk where the layout puts them (src/screens/assembly.ts); an area the layout
// couldn't place sits on its own beside the walk. When the whole basement is done it takes over in its
// own frame, cross-fading from the walk's view (the final layout can move an area metres), with the
// walk re-drawn in it, and its solid surface fades in over the points. It turns slowly so it reads as 3D. A take without 3D sends no `path` or
// `model` events, and the wait screen never shows this.
import { Line } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import * as THREE from "three";
import { besideWalk, placeGroup, placePoint, type AreaModel, type Box2, type Place, type V2 } from "../screens/assembly";
import { parseMesh, parseSurfels } from "../three/RealScan";

const MAX_POINTS = 45_000; // per area, so a phone keeps up
const DRAW_S = 3.2; // the walk draws itself in this long
const REVEAL_S = 2.8; // an area assembles in this long
const SPIN = 0.09; // radians a second
const FADE = 1.4; // things fade in and out at this rate: the solid surface over the points, the walk's view into the final one
const CROSS_S = 2.4; // the walk's view is gone this long after the whole basement arrives

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
    uniforms: { uReveal: { value: 0 }, uFade: { value: 0 }, uCut: { value: cutY }, uScale: { value: 300 } },
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
    u.uFade.value = THREE.MathUtils.damp(u.uFade.value, hidden ? 0 : 1, FADE, dt);
    u.uScale.value = size.height;
  });
  return <points geometry={cloud.geometry} material={material} />;
}

const toLinear = Array.from({ length: 256 }, (_, i) => new THREE.Color().setRGB(i / 255, 0, 0, THREE.SRGBColorSpace).r);

// The whole basement's solid surface (BRM1), in the colours the camera saw.
async function loadSolid(url: string): Promise<THREE.BufferGeometry> {
  const solid = parseMesh(await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))));
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(solid.pos.length), col = new Float32Array(solid.color.length);
  for (let i = 0; i < pos.length; i++) {
    pos[i] = solid.pos[i] / 1000;
    col[i] = toLinear[solid.color[i]];
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(solid.faces, 1));
  g.computeVertexNormals();
  return g;
}

// Fading in over the points, with the ceiling cut at the same height as theirs.
function SolidSurface({ geometry, cutY }: { geometry: THREE.BufferGeometry; cutY: number }) {
  const { gl } = useThree();
  const material = useMemo(() => {
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), cutY);
    return new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: [cut], toneMapped: false, transparent: true, opacity: 0, depthWrite: false });
  }, [cutY]);
  useEffect(() => {
    gl.localClippingEnabled = true;
    return () => material.dispose();
  }, [gl, material]);
  useFrame((_, dt) => {
    if (!material.transparent) return;
    material.opacity = still() ? 1 : THREE.MathUtils.damp(material.opacity, 1, FADE, dt);
    if (material.opacity < 0.98) return;
    // Fully in: draw it as the solid it is.
    material.opacity = 1;
    material.transparent = false;
    material.depthWrite = true;
    material.needsUpdate = true;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// An area set into the walk. The layout is provisional, so a later placement eases it to where it settles.
function Placed({ place, children }: { place: Place | null; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const target = placeGroup(place);
  const [x, , z] = target.position;
  const to = useMemo(() => new THREE.Vector3(x, 0, z), [x, z]);
  const ready = useRef(false);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = ready.current && !still() ? 1 - Math.exp(-3 * dt) : 1;
    ready.current = true;
    g.position.lerp(to, k);
    const turn = target.rotationY - g.rotation.y;
    g.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * k;
    g.scale.setScalar(g.scale.x + (target.scale - g.scale.x) * k);
  });
  return <group ref={group}>{children}</group>;
}

function Walk({ path, color, y, hidden }: { path: V2[]; color: string; y: number; hidden: boolean }) {
  const line = useRef<ComponentRef<typeof Line>>(null);
  const head = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const born = useRef<number | null>(null);
  const points = useMemo(() => path.map(([x, z]) => new THREE.Vector3(x, y + 0.02, z)), [path, y]);
  useFrame(({ clock }, dt) => {
    born.current ??= clock.elapsedTime;
    const k = still() ? 1 : Math.min(1, (clock.elapsedTime - born.current) / DRAW_S);
    const segments = Math.max(1, Math.round((points.length - 1) * k));
    if (line.current) {
      (line.current.geometry as THREE.InstancedBufferGeometry).instanceCount = segments;
      const m = line.current.material as THREE.Material;
      m.opacity = THREE.MathUtils.damp(m.opacity, hidden ? 0 : 1, FADE, dt);
    }
    const at = points[Math.min(points.length - 1, segments)];
    if (head.current && at) {
      head.current.position.copy(at);
      head.current.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 4));
      head.current.material.opacity = THREE.MathUtils.damp(head.current.material.opacity, hidden ? 0 : 1, FADE, dt);
    }
  });
  if (points.length < 2) return null;
  return (
    <>
      <Line ref={line} points={points} color={color} lineWidth={3} transparent />
      <mesh ref={head}>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshBasicMaterial color={color} transparent />
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

type Bounds = { min: THREE.Vector3; max: THREE.Vector3; floor: number };

const boxOf = (c: Cloud): Box2 => ({ minX: c.min.x, maxX: c.max.x, minZ: c.min.z, maxZ: c.max.z });

// What a view spans: its walk and its points, each set where it's placed.
function spanOf(walk: V2[] | null, items: { c: Cloud; place: Place | null }[]): Bounds {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const add = (x: number, z: number) => {
    min.x = Math.min(min.x, x);
    max.x = Math.max(max.x, x);
    min.z = Math.min(min.z, z);
    max.z = Math.max(max.z, z);
  };
  for (const [x, z] of walk ?? []) add(x, z);
  for (const { c, place } of items) {
    for (const x of [c.min.x, c.max.x])
      for (const z of [c.min.z, c.max.z]) {
        const [px, , pz] = placePoint(place, x, 0, z);
        add(px, pz);
      }
    min.y = Math.min(min.y, placePoint(place, 0, c.min.y, 0)[1]);
    max.y = Math.max(max.y, placePoint(place, 0, c.max.y, 0)[1]);
  }
  // The floor: the lowest of the points, or the plan's own level before any arrive.
  if (!Number.isFinite(min.y)) {
    min.y = 0;
    max.y = 2.4;
  }
  if (!Number.isFinite(min.x)) return { min: new THREE.Vector3(-2, 0, -2), max: new THREE.Vector3(2, 2.4, 2), floor: 0 };
  return { min, max, floor: min.y };
}

export default function Assembling({ path, models }: { path: V2[] | null; models: AreaModel[] }) {
  const [clouds, setClouds] = useState<Record<string, Cloud>>({});
  const loaded = useRef(clouds);
  loaded.current = clouds;
  const final = models.find((m) => m.area === "all");
  const finalCloud = final ? clouds[final.key] : undefined;
  useEffect(() => {
    let live = true;
    for (const m of models) {
      // Once the whole basement is in, the areas left over aren't needed.
      if (clouds[m.key] || (finalCloud && m !== final)) continue;
      loadCloud(m.surfels)
        .then((c) => live && setClouds((prev) => ({ ...prev, [m.key]: c })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
    // Each model loads once; clouds only grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, Boolean(finalCloud)]);
  useEffect(() => () => Object.values(loaded.current).forEach((c) => c.geometry.dispose()), []);

  // The solid surface, once the whole basement's points have assembled. If it won't load, the points stay.
  const [solid, setSolid] = useState<THREE.BufferGeometry | null>(null);
  const meshUrl = finalCloud ? final?.mesh : undefined;
  useEffect(() => {
    if (!meshUrl) return;
    let live = true;
    let made: THREE.BufferGeometry | null = null;
    Promise.all([loadSolid(meshUrl), new Promise((r) => setTimeout(r, REVEAL_S * 1000))])
      .then(([g]) => {
        made = g;
        if (live) setSolid(g);
        else g.dispose();
      })
      .catch(() => {});
    return () => {
      live = false;
      made?.dispose();
      setSolid(null);
    };
  }, [meshUrl]);

  // The walk's view: the walk, each area where the layout put it, and the ones it couldn't place on their own beside them.
  const areaKeys = models.filter((m) => m.area !== "all" && clouds[m.key]).map((m) => `${m.key}@${m.place ? Object.values(m.place).join(",") : ""}`).join("|");
  const walkView = useMemo(() => {
    const areas = models.filter((m) => m.area !== "all" && clouds[m.key]);
    const placed = areas.filter((m) => m.place);
    const unplaced = areas.filter((m) => !m.place);
    const around = path || placed.length ? spanOf(path, placed.map((m) => ({ c: clouds[m.key], place: m.place }))) : null;
    const aside = besideWalk(around && { minX: around.min.x, maxX: around.max.x, minZ: around.min.z, maxZ: around.max.z }, unplaced.map((m) => boxOf(clouds[m.key])));
    const shown = [...placed.map((m) => ({ m, place: m.place })), ...unplaced.map((m, i) => ({ m, place: aside[i] }))];
    return { shown, bounds: spanOf(path, shown.map(({ m, place }) => ({ c: clouds[m.key], place }))) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, areaKeys]);
  const finalView = useMemo(() => (finalCloud ? { bounds: spanOf(final?.path ?? null, [{ c: finalCloud, place: null }]) } : null), [finalCloud, final?.path]);

  // The whole basement cross-fades in over the walk's view, which then goes.
  const [walkGone, setWalkGone] = useState(false);
  useEffect(() => {
    if (!finalCloud) return;
    const t = setTimeout(() => setWalkGone(true), still() ? 0 : CROSS_S * 1000);
    return () => clearTimeout(t);
  }, [Boolean(finalCloud)]);

  const bounds = (finalView ?? walkView).bounds;
  const colors = useMemo(() => ({ walk: cssVar("--color-mint"), grid: cssVar("--color-mint-line") }), []);
  const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;

  return (
    <Canvas className="assemble-canvas" camera={{ fov: 40, near: 0.05, far: 200 }} dpr={[1, phone ? 1.5 : 2]} gl={{ antialias: true, alpha: true }}>
      {/* Lambert divides light by π: these keep the photo's own brightness on the solid surface. */}
      <ambientLight intensity={2.6} />
      <directionalLight position={[3, 8, 4]} intensity={1.2} />
      <Rig min={bounds.min} max={bounds.max} tilted={Boolean(finalView) || walkView.shown.length > 0} />
      <gridHelper
        args={[40, 80, colors.grid, colors.grid]}
        position={[(bounds.min.x + bounds.max.x) / 2, bounds.floor, (bounds.min.z + bounds.max.z) / 2]}
        material-transparent
        material-opacity={0.16}
      />
      {!walkGone && (
        <>
          {path && <Walk key="walk" path={path} color={colors.walk} y={walkView.bounds.floor} hidden={Boolean(finalView)} />}
          {walkView.shown.map(({ m, place }) => (
            <Placed key={m.key} place={place}>
              <AreaPoints cloud={clouds[m.key]} hidden={Boolean(finalView)} />
            </Placed>
          ))}
        </>
      )}
      {finalView && finalCloud && final && (
        <group key={final.key}>
          {final.path && <Walk key="final-walk" path={final.path} color={colors.walk} y={finalView.bounds.floor} hidden={false} />}
          <AreaPoints cloud={finalCloud} hidden={Boolean(solid)} />
          {solid && <SolidSurface geometry={solid} cutY={finalCloud.cutY} />}
        </group>
      )}
    </Canvas>
  );
}
