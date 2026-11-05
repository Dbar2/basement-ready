// The demo video's 3D hero clips, drawn from the example basement's real phone scan and its real plan and
// layout. Nothing here is a mock-up: the surface is the example's MapAnything mesh (public/samples/sample/3d),
// the finds sit where the plan put them (or, for the duct and the beam SAM saw, where its box in the video
// lands on that mesh), and the furnished rooms are the app's own StagedFurniture. The page draws one frame
// per window.__frame(i) call, on a fixed clock, so render.mjs can step it at 30 fps with no jitter.
import { useProgress } from "@react-three/drei";
import { advance, Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { frames as poses } from "../../public/samples/sample/3d/scan.json";
import { EXAMPLE } from "../../src/marketing/example";
import type { Existing } from "../../server/model/types";
import existingJson from "../../src/marketing/example-existing.json";
import { AsBuiltScene, type Atlas, type AtlasIndex } from "../../src/three/AsBuilt";
import { parseMesh, type Solid } from "../../src/three/RealScan";
import { StagedFurniture, useMaps } from "../../src/three/StagedBasement";

const FPS = 30;
const shot = Number(new URLSearchParams(location.search).get("shot") ?? 1);
const clock = { t: 0 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x = clamp01(x)) * x * (3 - 2 * x);
const easeInOut = (x: number) => ((x = clamp01(x)) < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const deg = THREE.MathUtils.degToRad;

type V3 = [number, number, number];

// brand/tokens.css
const C = {
  ink: "#0F2A1E",
  muted: "#4A5D52",
  mint: "#4BE38A",
  mintLine: "#2E9A5C",
  sheet: "#F4F6F2",
  card: "#FBFCFA",
  surface: "#E6EBE4",
  border: "#D5DDD4",
  night: "#05100A",
  window: "#2F6FDB",
  exit: "#0F8B8D",
  stairs: "#B58A00",
  duct: "#6B7A86",
  beam: "#8A5A3C",
  mechanical: "#C2417A",
};

const PLAN = EXAMPLE.plan;
const BOX = PLAN.box;
const CEIL = EXAMPLE.ceilingM;
const LID = CEIL - 0.12;
const MID = new THREE.Vector3((BOX.minX + BOX.maxX) / 2, 0, (BOX.minZ + BOX.maxZ) / 2);

// ---------- labels: plain DOM over the canvas, projected each frame ----------
type Label = { id: string; at: V3; text: string; value?: string; color?: string; cls?: string; stem?: number; alpha: (t: number) => number; el?: HTMLDivElement | null };

function LabelLayer({ labels }: { labels: Label[] }) {
  return (
    <div id="labels">
      {labels.map((l) => (
        <div key={l.id} className={`tag ${l.cls ?? ""}`} style={{ ["--c" as string]: l.color ?? C.ink, opacity: 0 }} ref={(el) => void (l.el = el)}>
          <div className="card" style={l.stem ? { bottom: l.stem + 6 } : undefined}>
            {!l.cls && <i />}
            {l.text}
            {l.value && <b>{l.value}</b>}
          </div>
          <div className="stem" style={l.stem ? { height: l.stem } : undefined} />
          <div className="dot" />
        </div>
      ))}
    </div>
  );
}

const pv = new THREE.Vector3();
function placeLabels(camera: THREE.Camera, labels: Label[]) {
  for (const l of labels) {
    if (!l.el) continue;
    const a = l.alpha(clock.t);
    pv.set(...l.at).project(camera);
    const x = ((pv.x + 1) / 2) * 1920, y = ((1 - pv.y) / 2) * 1080;
    l.el.style.opacity = a.toFixed(3);
    l.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    const card = l.el.firstElementChild as HTMLElement;
    const lift = (1 - a) * 14;
    card.style.transform = l.cls ? `translate(-50%, calc(-50% + ${lift.toFixed(2)}px))` : `translate(-50%, ${lift.toFixed(2)}px)`;
  }
}

function orbit(camera: THREE.Camera, look: THREE.Vector3, az: number, el: number, dist: number) {
  camera.position.set(look.x + dist * Math.cos(el) * Math.cos(az), look.y + dist * Math.sin(el), look.z + dist * Math.cos(el) * Math.sin(az));
  camera.lookAt(look);
}

// ---------- the real scan ----------
function useSolid() {
  const [solid, setSolid] = useState<Solid | null>(null);
  useEffect(() => {
    fetch("/samples/sample/3d/mesh.bin")
      .then((r) => r.arrayBuffer())
      .then((b) => setSolid(parseMesh(b)));
  }, []);
  return solid;
}

function useGeometry(solid: Solid) {
  return useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(solid.pos.length), col = new Float32Array(solid.color.length);
    const lin = new THREE.Color();
    for (let i = 0; i < pos.length; i++) pos[i] = solid.pos[i] / 1000;
    for (let i = 0; i < col.length; i += 3) {
      lin.setRGB(solid.color[i] / 255, solid.color[i + 1] / 255, solid.color[i + 2] / 255, THREE.SRGBColorSpace);
      col[i] = lin.r;
      col[i + 1] = lin.g;
      col[i + 2] = lin.b;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(solid.faces, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [solid]);
}

// The scan's points: they rise out of the dark in mint, swept across the room like the phone's pan, then
// take on the colours the camera saw. Points under `uBelow` have already fused into the solid surface.
function pointsMaterial() {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uRise: { value: 0 },
      uTrue: { value: 0 },
      uBelow: { value: -1 },
      uScale: { value: 2000 },
      uGlow: { value: 1 },
      uMint: { value: new THREE.Color(C.mint) },
      uPale: { value: new THREE.Color("#C9FBDD") },
    },
    vertexShader: /* glsl */ `
      uniform float uRise, uTrue, uBelow, uScale, uGlow;
      uniform vec3 uMint, uPale;
      varying vec3 vColor;
      varying float vAlpha;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 p = position;
        float h = hash(p);
        float d = clamp((p.x + 4.2) / 8.4, 0.0, 1.0) * 0.62 + h * 0.28;
        float r = clamp((uRise * 1.9 - d) / 0.42, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - r, 3.0);
        vec3 q = vec3(p.x, mix(-0.35 - h * 0.4, p.y, e), p.z);
        vec4 mv = modelViewMatrix * vec4(q, 1.0);
        gl_Position = projectionMatrix * mv;
        float shown = step(0.001, r) * step(uBelow, p.y);
        gl_PointSize = clamp(0.024 * uScale / max(-mv.z, 0.1), 1.5, 14.0) * shown * (1.0 + (1.0 - e) * 0.8);
        vec3 glow = (h < 0.25 ? uPale : uMint) * (1.0 + (1.0 - e) * 0.9 * uGlow);
        vColor = mix(glow, color * 1.05, uTrue);
        vAlpha = e;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        if (r > 0.5) discard;
        float a = smoothstep(0.5, 0.18, r) * vAlpha;
        gl_FragColor = vec4(vColor, a);
      }
    `,
  });
}

// The scan line: a glowing band on the surface where it is fusing.
function bandMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    uniforms: { uH: { value: 0 }, uW: { value: 0.07 }, uA: { value: 1 }, uColor: { value: new THREE.Color(C.mint) } },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vY = w.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uH, uW, uA;
      uniform vec3 uColor;
      varying float vY;
      void main() {
        float d = vY - uH;
        float a = exp(-d * d / (uW * uW)) + 0.35 * exp(-max(-d, 0.0) * 6.0) * step(d, 0.0) * 0.4;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * 1.6, a * uA);
      }
    `,
  });
}

// Thin bars along a box's 12 edges.
function EdgeBox({ size, color, k = 0.035, opacity = 1 }: { size: V3; color: string; k?: number; opacity?: number }) {
  const [x, y, z] = size.map((s) => s / 2);
  const bars: { p: V3; s: V3 }[] = [];
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) bars.push({ p: [0, sy * y, sz * z], s: [size[0] + k, k, k] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bars.push({ p: [sx * x, 0, sz * z], s: [k, size[1] + k, k] });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) bars.push({ p: [sx * x, sy * y, 0], s: [k, k, size[2] + k] });
  return (
    <>
      {bars.map((b, i) => (
        <mesh key={i} position={b.p} scale={b.s} renderOrder={10}>
          <boxGeometry />
          <meshBasicMaterial color={color} toneMapped={false} depthTest={false} transparent opacity={opacity} />
        </mesh>
      ))}
    </>
  );
}

// One thin bar from a to b.
function Seg3({ a, b, color, k = 0.035 }: { a: V3; b: V3; color: string; k?: number }) {
  const { pos, quat, len } = useMemo(() => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const d = B.clone().sub(A);
    return { pos: A.clone().add(B).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize()), len: d.length() };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={quat} scale={[len + k, k, k]} renderOrder={10}>
      <boxGeometry />
      <meshBasicMaterial color={color} toneMapped={false} depthTest={false} transparent />
    </mesh>
  );
}

// ---------- the clean as-built basement, and framing it ----------
// The as-built model the app shows (src/three/AsBuilt.tsx): straight walls, a level floor, the stairs,
// furnace, water heater and duct, painted with the example's video. It sits where the room was filmed,
// which is the plan's box moved by the placement.
const EXISTING = existingJson as unknown as Existing;
const P = EXAMPLE.placement;
const ROOM = { minX: BOX.minX + P.x, maxX: BOX.maxX + P.x, minZ: BOX.minZ + P.z, maxZ: BOX.maxZ + P.z };
const RMID = new THREE.Vector3((ROOM.minX + ROOM.maxX) / 2, CEIL * 0.35, (ROOM.minZ + ROOM.maxZ) / 2);
const FOV = 40;

// `xMax`: how far toward the camera's end the frame must reach (the near floor may run off the bottom).
function fitPoints(pad: number, top = CEIL, xMax = ROOM.maxX) {
  return [
    ...[ROOM.minX - pad, xMax + pad].flatMap((x) => [ROOM.minZ - pad, ROOM.maxZ + pad].map((z) => new THREE.Vector3(x, 0, z))),
    ...[ROOM.minX, xMax].flatMap((x) => [ROOM.minZ, ROOM.maxZ].map((z) => new THREE.Vector3(x, top, z))),
  ];
}
// How far back to stand, looking along -dir at `look`, for every point to sit inside `margin` of the frame.
function fitDistance(dir: THREE.Vector3, look: THREE.Vector3, pts: THREE.Vector3[], margin: number) {
  const fwd = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd);
  const tv = Math.tan(deg(FOV / 2)) * margin, th = tv * (1920 / 1080);
  const rel = new THREE.Vector3();
  let d = 0;
  for (const p of pts) {
    rel.copy(p).sub(look);
    const along = rel.dot(dir);
    d = Math.max(d, Math.abs(rel.dot(right)) / th + along, Math.abs(rel.dot(up)) / tv + along);
  }
  return d;
}
// `az`: degrees round from +z towards +x; `el`: up from level. The camera looks at `look` from as far
// back as it takes for the room to fill `margin` of the frame.
const fdir = new THREE.Vector3();
function frameRoom(camera: THREE.Camera, look: THREE.Vector3, azDeg: number, elDeg: number, margin: number, pts: THREE.Vector3[], pts2?: THREE.Vector3[], w = 0) {
  const az = deg(azDeg), el = deg(elDeg);
  fdir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const d = fitDistance(fdir, look, pts, margin);
  camera.position.copy(look).addScaledVector(fdir, pts2 ? lerp(d, fitDistance(fdir, look, pts2, margin), w) : d);
  camera.lookAt(look);
}

function useAtlas() {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  useEffect(() => {
    fetch("/samples/sample/3d/asbuilt/index.json")
      .then((r) => r.json())
      .then((index: AtlasIndex) => setAtlas({ index, base: "/samples/sample/3d/asbuilt/" }));
  }, []);
  return atlas;
}

// The near end wall (+x, where the camera stands) is cut away like a dollhouse's, so the room's inside
// shows from a low angle. Set on the model's own materials each frame: they're remade as the sharper
// painting loads.
const SECTION = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), ROOM.maxX - 0.12)];
// For a three-quarter view from the +x/−z corner: both near walls off.
const SECTION2 = [...SECTION, new THREE.Plane(new THREE.Vector3(0, 0, 1), -(ROOM.minZ + 0.12))];
function Built({ atlas, staged = 0, section = SECTION }: { atlas: Atlas; staged?: number; section?: THREE.Plane[] }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    group.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) if (mat.clippingPlanes !== section) (mat.clippingPlanes = section), (mat.needsUpdate = true);
    });
  });
  return (
    <group ref={group}>
      {/* The plain parts are Lambert, which divides light by π; the painted ones keep the video's colours.
          The scan's light steps back as the staged furniture, which brings its own, comes in. */}
      <ambientLight intensity={2.4 - 0.5 * staged} />
      <directionalLight position={[2, 6, -3]} intensity={1.1 - 0.8 * staged} />
      <AsBuiltScene existing={EXISTING} atlas={atlas} overview reveal={false} lights={false} />
    </group>
  );
}

// The scan's own points inside the room, up to its ceiling, in the colours the camera saw.
function useRoomPoints(solid: Solid) {
  return useMemo(() => {
    const pos: number[] = [], col: number[] = [];
    const lin = new THREE.Color();
    const m = 0.12;
    for (let i = 0; i < solid.pos.length; i += 3) {
      const x = solid.pos[i] / 1000, y = solid.pos[i + 1] / 1000, z = solid.pos[i + 2] / 1000;
      if (x > ROOM.minX - m && x < ROOM.maxX + m && z > ROOM.minZ - m && z < ROOM.maxZ + m && y > -0.08 && y < CEIL + 0.08) {
        pos.push(x, y, z);
        lin.setRGB(solid.color[i] / 255, solid.color[i + 1] / 255, solid.color[i + 2] / 255, THREE.SRGBColorSpace);
        col.push(lin.r, lin.g, lin.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [solid]);
}

// ---------- shot 1: the scan assembles ----------
function Assemble({ solid, atlas }: { solid: Solid; atlas: Atlas }) {
  const { camera, gl, scene, size } = useThree();
  const points = useRoomPoints(solid);
  const cut = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 99), []);
  const dots = useMemo(pointsMaterial, []);
  const sheetMat = useMemo(() => new THREE.MeshBasicMaterial({ color: C.mint, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(C.mint).multiplyScalar(1.6), transparent: true, toneMapped: false, depthWrite: false }), []);
  const bloom = useRef<{ intensity: number } | null>(null);
  const builtRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const planeRef = useRef<THREE.Group>(null);
  const bg = useMemo(() => new THREE.Color(), []);
  const night = useMemo(() => new THREE.Color(C.night), []);
  const day = useMemo(() => new THREE.Color(C.sheet), []);
  const pts = useMemo(() => fitPoints(0.3), []);
  const near = useMemo(() => fitPoints(0.15, CEIL, ROOM.maxX - 2.2), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    gl.localClippingEnabled = true;
    gl.clippingPlanes = [cut];
    scene.background = bg;
    return () => void (gl.clippingPlanes = []);
  }, [gl, scene, bg, cut]);

  const W = ROOM.maxX - 0.14 - ROOM.minX, D = ROOM.maxZ - ROOM.minZ;

  useFrame(() => {
    const t = clock.t;
    const k = easeInOut(t / 7);
    // A slow orbit and push-in that settles on a lower, longer view down the room.
    look.copy(RMID).setX(lerp(RMID.x, RMID.x - 0.9, k));
    frameRoom(camera, look, lerp(138, 100, k), lerp(52, 31, k), lerp(1.5, 0.8, k), pts, near, ease(span(t, 2.5, 6.5)));

    const fill = ease(span(t, 2.9, 5.0));
    const height = -0.05 + (CEIL + 0.45) * fill;
    cut.constant = fill > 0 && fill < 1 ? height : 99;
    const u = dots.uniforms;
    u.uRise.value = span(t, 0.15, 2.7);
    u.uTrue.value = ease(span(t, 2.5, 3.7));
    u.uBelow.value = fill > 0 ? height : -1;
    u.uScale.value = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] * size.height * 0.5 * gl.getPixelRatio();
    const lightUp = ease(span(t, 4.5, 5.8));
    u.uGlow.value = 1 - lightUp;
    pointsRef.current!.visible = t > 0.15 && fill < 1;
    builtRef.current!.visible = fill > 0;
    const sweeping = fill > 0 && fill < 1;
    planeRef.current!.visible = sweeping;
    planeRef.current!.position.y = height - 0.01;
    const edge = Math.min(1, fill * 8, (1 - fill) * 8);
    sheetMat.opacity = 0.05 * (1 - 0.6 * lightUp) * edge;
    ringMat.opacity = edge * (1 - 0.3 * lightUp);
    bg.lerpColors(night, day, lightUp);
    if (bloom.current) bloom.current.intensity = 1.25 * (1 - lightUp);
  });

  // The scan line: a glowing ring hugging the walls, and a faint sheet across the room, at the height the
  // basement has risen to.
  const k = 0.035;
  return (
    <>
      <points ref={pointsRef} geometry={points} material={dots} frustumCulled={false} />
      <group ref={builtRef} visible={false}>
        <Built atlas={atlas} />
      </group>
      <group ref={planeRef} position={[(ROOM.minX + ROOM.maxX - 0.14) / 2, 0, (ROOM.minZ + ROOM.maxZ) / 2]}>
        <mesh rotation-x={-Math.PI / 2} material={sheetMat}>
          <planeGeometry args={[W, D]} />
        </mesh>
        {[
          { p: [0, 0, -D / 2] as V3, s: [W + k, k, k] as V3 },
          { p: [0, 0, D / 2] as V3, s: [W + k, k, k] as V3 },
          { p: [-W / 2, 0, 0] as V3, s: [k, k, D] as V3 },
          { p: [W / 2, 0, 0] as V3, s: [k, k, D] as V3 },
        ].map((b, i) => (
          <mesh key={i} position={b.p} scale={b.s} material={ringMat}>
            <boxGeometry />
          </mesh>
        ))}
      </group>
      <EffectComposer multisampling={8}>
        <Bloom ref={bloom as never} intensity={1.25} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur radius={0.7} />
      </EffectComposer>
    </>
  );
}

// ---------- shot 2: what it found ----------
type Find = { id: string; text: string; value?: string; color: string; t0: number; center: V3; size?: V3; label: V3; stem?: number; wedge?: { x0: number; x1: number; z0: number; z1: number; top: number } };

// Every find where the as-built model has it (src/marketing/example-existing.json, the example's plan).
function useFinds(): Find[] {
  return useMemo(() => {
    const wall = (id: string) => EXISTING.walls.find((w) => w.id === id)!;
    const along = (wallId: string, off: number): [number, number] => {
      const w = wall(wallId);
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      return [w.a[0] + ((w.b[0] - w.a[0]) * off) / len, w.a[1] + ((w.b[1] - w.a[1]) * off) / len];
    };
    const op = (kind: string) => EXISTING.openings.find((o) => o.kind === kind)!;
    const fx = (kind: string) => EXISTING.fixtures.find((f) => f.kind === kind) as unknown as { at: [number, number]; sizeM: [number, number]; heightM?: number; bottom?: [number, number] };
    const win = op("window"), door = op("door");
    const wAt = along(win.wallId, win.offsetM + win.widthM / 2), dAt = along(door.wallId, door.offsetM + door.widthM / 2);
    const st = fx("stairs"), furnace = fx("furnace"), heater = fx("water_heater"), duct = fx("duct");
    const sx0 = st.at[0] - st.sizeM[0] / 2, sx1 = st.at[0] + st.sizeM[0] / 2, sz0 = st.at[1] - st.sizeM[1] / 2, sz1 = st.at[1] + st.sizeM[1] / 2;
    const out: Find[] = [];
    const inZ = (z: number) => (z > RMID.z ? -0.06 : 0.06);
    out.push({ id: "window", text: "Window", value: `${win.widthM.toFixed(2)} m`, color: C.window, t0: 0.7, center: [wAt[0], CEIL - 0.38, wAt[1] + inZ(wAt[1])], size: [win.widthM, 0.42, 0.12], label: [wAt[0], CEIL - 0.1, wAt[1] + inZ(wAt[1])] });
    out.push({ id: "stairs", text: "Stairs", color: C.stairs, t0: 1.55, center: [0, 0, 0], wedge: { x0: sx0, x1: sx1, z0: sz0, z1: sz1, top: CEIL }, label: [sx1 - 0.55, 0.62, (sz0 + sz1) / 2], stem: 30 });
    const dTop = CEIL, dBot = duct.heightM ?? CEIL - 0.4;
    const dx0 = Math.max(ROOM.minX + 0.05, duct.at[0] - duct.sizeM[0] / 2), dx1 = Math.min(ROOM.maxX - 0.16, duct.at[0] + duct.sizeM[0] / 2);
    out.push({ id: "duct", text: "Duct", color: C.duct, t0: 2.45, center: [(dx0 + dx1) / 2, (dTop + dBot) / 2, duct.at[1]], size: [dx1 - dx0, dTop - dBot, duct.sizeM[1]], label: [duct.at[0] + 1.8, dTop, duct.at[1]], stem: 36 });
    out.push({ id: "furnace", text: "Furnace", color: C.mechanical, t0: 3.35, center: [furnace.at[0], 0.72, furnace.at[1]], size: [furnace.sizeM[0], 1.44, furnace.sizeM[1]], label: [furnace.at[0], 1.44, furnace.at[1]], stem: 30 });
    out.push({ id: "heater", text: "Water heater", color: C.mechanical, t0: 4.1, center: [heater.at[0], 0.76, heater.at[1]], size: [heater.sizeM[0], 1.52, heater.sizeM[1]], label: [heater.at[0], 1.52, heater.at[1]], stem: 40 });
    out.push({ id: "door", text: "Door", value: `${door.widthM.toFixed(2)} m`, color: C.exit, t0: 4.85, center: [dAt[0], 1.0, dAt[1] + inZ(dAt[1])], size: [door.widthM, 2.0, 0.12], label: [dAt[0], 2.0, dAt[1] + inZ(dAt[1])], stem: 44 });
    return out;
  }, []);
}

function FindMark({ f }: { f: Find }) {
  const g = useRef<THREE.Group>(null);
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const a = ease(span(clock.t, f.t0, f.t0 + 0.45));
    const pulse = Math.exp(-Math.pow((clock.t - f.t0 - 0.35) / 0.22, 2));
    g.current!.visible = a > 0;
    g.current!.scale.setScalar(Math.max(0.001, 1.12 - 0.12 * a));
    g.current!.children.forEach((c) => {
      const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && m !== fill.current) m.opacity = a;
    });
    if (fill.current) fill.current.opacity = (0.14 + 0.3 * pulse) * a;
  });
  if (f.wedge) {
    const { x0, x1, z0, z1, top } = f.wedge;
    const segs: [V3, V3][] = [];
    for (const z of [z0, z1]) {
      segs.push([[x1, 0, z], [x0, 0, z]], [[x0, 0, z], [x0, top, z]], [[x0, top, z], [x1, 0, z]]);
    }
    segs.push([[x1, 0, z0], [x1, 0, z1]], [[x0, 0, z0], [x0, 0, z1]], [[x0, top, z0], [x0, top, z1]]);
    const run = Math.hypot(x1 - x0, top);
    return (
      <group ref={g}>
        {segs.map(([a, b], i) => (
          <Seg3 key={i} a={a} b={b} color={f.color} />
        ))}
        <mesh renderOrder={9} position={[(x0 + x1) / 2, top / 2, (z0 + z1) / 2]} rotation={[0, 0, Math.atan2(top, x0 - x1) + Math.PI]}>
          <boxGeometry args={[run, 0.01, z1 - z0]} />
          <meshBasicMaterial ref={fill} color={f.color} toneMapped={false} transparent opacity={0.15} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }
  if (!f.size) {
    // A point SAM saw, without a measured size: a ring on the surface.
    return (
      <group ref={g} position={f.center}>
        <mesh renderOrder={11}>
          <sphereGeometry args={[0.09, 24, 16]} />
          <meshBasicMaterial color={f.color} toneMapped={false} depthTest={false} transparent />
        </mesh>
        <mesh renderOrder={10}>
          <sphereGeometry args={[0.2, 24, 16]} />
          <meshBasicMaterial ref={fill} color={f.color} toneMapped={false} depthTest={false} transparent opacity={0.2} />
        </mesh>
      </group>
    );
  }
  return (
    <group ref={g} position={f.center}>
      <EdgeBox size={f.size} color={f.color} />
      <mesh renderOrder={9}>
        <boxGeometry args={f.size} />
        <meshBasicMaterial ref={fill} color={f.color} toneMapped={false} transparent opacity={0.15} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Finds({ atlas, setLabels }: { atlas: Atlas; setLabels: (l: Label[]) => void }) {
  const { camera } = useThree();
  const finds = useFinds();
  const labels = useMemo<Label[]>(
    () => finds.map((f) => ({ id: f.id, at: f.label, text: f.text, value: f.value, color: f.color, stem: f.stem, alpha: (t: number) => ease(span(t, f.t0 + 0.1, f.t0 + 0.5)) })),
    [finds],
  );
  useEffect(() => setLabels(labels), [labels, setLabels]);
  const pts = useMemo(() => fitPoints(0.2, CEIL + 0.5, ROOM.maxX - 2.0), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const k = easeInOut(clock.t / 8);
    look.copy(RMID).set(RMID.x - 0.9, lerp(0.85, 0.75, k), RMID.z);
    frameRoom(camera, look, lerp(118, 96, k), lerp(44, 30, k), lerp(0.92, 0.84, k), pts);
    placeLabels(camera, labels);
  });
  return (
    <>
      <color attach="background" args={[C.sheet]} />
      <Built atlas={atlas} />
      {finds.map((f) => (
        <FindMark key={f.id} f={f} />
      ))}
    </>
  );
}

// ---------- shot 3: the measured plan, then the rooms ----------
function Bar({ from, to, w, y = 0.01, color, draw }: { from: [number, number]; to: [number, number]; w: number; y?: number; color: string; draw: number }) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const q = clamp01(draw);
  return (
    <mesh
      visible={q > 0}
      position={[from[0] + ((to[0] - from[0]) * q) / 2, y, from[1] + ((to[1] - from[1]) * q) / 2]}
      rotation-y={-Math.atan2(to[1] - from[1], to[0] - from[0])}
      scale={[Math.max(0.001, len * q + (q > 0 ? w : 0)), 1, 1]}
    >
      <boxGeometry args={[1, 0.012, w]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function useTick() {
  const [, set] = useState(0);
  useFrame(() => set((n) => n + 1));
}

function PlanLines() {
  useTick();
  const t = clock.t;
  const { minX, maxX, minZ, maxZ } = BOX;
  const corners: [number, number][] = [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];
  const draw = span(t, 0.25, 1.9) * 4;
  const inner = span(t, 1.5, 2.3);
  const dims = ease(span(t, 1.9, 2.7));
  const fadeDims = 1 - ease(span(t, 3.3, 3.9));
  const win = EXAMPLE.openings.find((o) => o.kind === "window")!;
  const door = EXAMPLE.openings.find((o) => o.kind === "door")!;
  const st = PLAN.stairs[0];
  const treads = 9;
  const off = 0.62;
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  const showDims = dims > 0 && fadeDims > 0;
  const dimDraw = dims * fadeDims;
  return (
    <group>
      {corners.map((c, k) => (
        <Bar key={k} from={c} to={corners[(k + 1) % 4]} w={0.075} color={C.ink} draw={draw - k} y={0.014} />
      ))}
      {EXAMPLE.layout.walls.map((w, i) => (
        <Bar key={`w${i}`} from={[w.x0, w.z0]} to={[w.x1, w.z1]} w={0.05} color={C.ink} draw={inner * 1.4 - i * 0.2} y={0.014} />
      ))}
      <Bar from={[win.at[0] - win.widthM / 2, win.at[1]]} to={[win.at[0] + win.widthM / 2, win.at[1]]} w={0.12} color={C.window} draw={span(t, 1.9, 2.2)} y={0.02} />
      <Bar from={[door.at[0] - door.widthM / 2, door.at[1]]} to={[door.at[0] + door.widthM / 2, door.at[1]]} w={0.12} color={C.exit} draw={span(t, 2.0, 2.3)} y={0.02} />
      {Array.from({ length: treads }, (_, i) => {
        const x = st.x0 + ((st.x1 - st.x0) * (i + 0.5)) / treads;
        return <Bar key={`t${i}`} from={[x, st.z0]} to={[x, st.z1]} w={0.025} color={C.muted} draw={span(t, 2.0 + i * 0.04, 2.3 + i * 0.04)} y={0.016} />;
      })}
      <Bar from={[st.x0, st.z0]} to={[st.x1, st.z0]} w={0.03} color={C.muted} draw={span(t, 2.0, 2.4)} y={0.016} />
      <Bar from={[st.x0, st.z1]} to={[st.x1, st.z1]} w={0.03} color={C.muted} draw={span(t, 2.0, 2.4)} y={0.016} />
      {showDims && (
        <>
          {/* width, below the plan; depth, to its right: lines draw out from the middle, with end ticks */}
          <Bar from={[midX, minZ - off]} to={[minX, minZ - off]} w={0.022} color={C.mintLine} draw={dimDraw} />
          <Bar from={[midX, minZ - off]} to={[maxX, minZ - off]} w={0.022} color={C.mintLine} draw={dimDraw} />
          <Bar from={[minX, minZ - off - 0.16]} to={[minX, minZ - off + 0.16]} w={0.022} color={C.mintLine} draw={dimDraw} />
          <Bar from={[maxX, minZ - off - 0.16]} to={[maxX, minZ - off + 0.16]} w={0.022} color={C.mintLine} draw={dimDraw} />
          <Bar from={[maxX + off, midZ]} to={[maxX + off, minZ]} w={0.022} color={C.mintLine} draw={dimDraw} />
          <Bar from={[maxX + off, midZ]} to={[maxX + off, maxZ]} w={0.022} color={C.mintLine} draw={dimDraw} />
          <Bar from={[maxX + off - 0.16, minZ]} to={[maxX + off + 0.16, minZ]} w={0.022} color={C.mintLine} draw={dimDraw} />
          <Bar from={[maxX + off - 0.16, maxZ]} to={[maxX + off + 0.16, maxZ]} w={0.022} color={C.mintLine} draw={dimDraw} />
        </>
      )}
    </group>
  );
}

// The walls the scan measured (the plan's "wall" sides), with the window left open where it is.
function Shell({ rise, all = false }: { rise: number; all?: boolean }) {
  const h = Math.min(2.6, Math.max(2.0, CEIL));
  const T = 0.12;
  const { minX, maxX, minZ, maxZ } = BOX;
  const win = EXAMPLE.openings.find((o) => o.kind === "window")!;
  const door = EXAMPLE.openings.find((o) => o.kind === "door")!;
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#F1F0EB", roughness: 0.93 }), []);
  const capMat = useMemo(() => new THREE.MeshBasicMaterial({ color: C.ink, toneMapped: false }), []);
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: "#BFD3E6", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.55 }), []);
  type Seg = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; cap?: boolean };
  const segs: Seg[] = [];
  const wx0 = win.at[0] - win.widthM / 2, wx1 = win.at[0] + win.widthM / 2, sill = CEIL - 0.58, head = CEIL - 0.18;
  // maxZ wall, split around the window
  segs.push({ x0: minX - T / 2, x1: wx0, z0: maxZ, z1: maxZ + T, y0: 0, y1: h, cap: true });
  segs.push({ x0: wx1, x1: maxX + T / 2, z0: maxZ, z1: maxZ + T, y0: 0, y1: h, cap: true });
  segs.push({ x0: wx0, x1: wx1, z0: maxZ, z1: maxZ + T, y0: 0, y1: sill });
  segs.push({ x0: wx0, x1: wx1, z0: maxZ, z1: maxZ + T, y0: head, y1: h, cap: true });
  // minX wall
  segs.push({ x0: minX - T, x1: minX, z0: minZ - T / 2, z1: maxZ + T, y0: 0, y1: h, cap: true });
  if (all) {
    const dx0 = door.at[0] - door.widthM / 2, dx1 = door.at[0] + door.widthM / 2;
    segs.push({ x0: minX - T, x1: dx0, z0: minZ - T, z1: minZ, y0: 0, y1: h, cap: true });
    segs.push({ x0: dx1, x1: maxX + T, z0: minZ - T, z1: minZ, y0: 0, y1: h, cap: true });
    segs.push({ x0: dx0, x1: dx1, z0: minZ - T, z1: minZ, y0: 2.03, y1: h, cap: true });
    segs.push({ x0: maxX, x1: maxX + T, z0: minZ - T, z1: maxZ + T, y0: 0, y1: h, cap: true });
  }
  const s = Math.max(0.001, rise);
  return (
    <group scale={[1, s, 1]} visible={rise > 0}>
      {segs.map((g, i) => (
        <group key={i}>
          <mesh material={wallMat} position={[(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, (g.z0 + g.z1) / 2]} castShadow receiveShadow>
            <boxGeometry args={[g.x1 - g.x0, g.y1 - g.y0, g.z1 - g.z0]} />
          </mesh>
          {g.cap && (
            <mesh material={capMat} position={[(g.x0 + g.x1) / 2, g.y1 + 0.004, (g.z0 + g.z1) / 2]}>
              <boxGeometry args={[g.x1 - g.x0 + 0.002, 0.008, g.z1 - g.z0 + 0.002]} />
            </mesh>
          )}
        </group>
      ))}
      <mesh material={glass} position={[win.at[0], (sill + head) / 2, maxZ + T / 2]}>
        <boxGeometry args={[win.widthM, head - sill, 0.02]} />
      </mesh>
    </group>
  );
}

function Staged({ rise }: { rise: number }) {
  const P = EXAMPLE.placement;
  return (
    <group rotation-y={(-P.turn * Math.PI) / 2} position={[P.x, 0, P.z]} scale={[1, Math.max(0.001, rise), 1]} visible={rise > 0}>
      <StagedFurniture plan={EXAMPLE.plan} layout={EXAMPLE.layout} />
    </group>
  );
}

function Floor({ opacity = 1 }: { opacity?: number }) {
  const { minX, maxX, minZ, maxZ } = BOX;
  return (
    <>
      <mesh position={[MID.x, -0.02, MID.z]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[maxX - minX + 3.4, maxZ - minZ + 3.0]} />
        <meshBasicMaterial color={C.card} toneMapped={false} transparent opacity={opacity} />
      </mesh>
    </>
  );
}

const ZONE_LABELS = EXAMPLE.zones.map((z) => ({ ...z }));

function PlanTo3D({ atlas, setLabels }: { atlas: Atlas; setLabels: (l: Label[]) => void }) {
  const { camera, gl } = useThree();
  const [rise, setRise] = useState({ walls: 0, staged: 0 });
  const { minX, maxX, minZ, maxZ } = ROOM;
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  const labels = useMemo<Label[]>(() => {
    const dimA = (t: number) => ease(span(t, 2.3, 2.8)) * (1 - ease(span(t, 3.3, 3.8)));
    const zoneA = (t: number) => ease(span(t, 2.5, 3.0)) * (1 - ease(span(t, 3.4, 3.9)));
    return [
      { id: "w", at: [midX, 0.02, minZ - 0.62], text: EXAMPLE.width, cls: "dim", alpha: dimA },
      { id: "d", at: [maxX + 0.62, 0.02, midZ], text: EXAMPLE.depth, cls: "dim", alpha: dimA },
      ...ZONE_LABELS.map((z) => ({ id: z.name, at: [P.x + (z.x0 + z.x1) / 2, 0.02, P.z + (z.z0 + z.z1) / 2] as V3, text: `${z.name}`, value: z.area, cls: "flat", alpha: zoneA })),
    ];
  }, [midX, midZ, minZ, maxX]);
  useEffect(() => setLabels(labels), [labels, setLabels]);
  // The as-built basement rises from the floor up to this plane.
  const cut = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 99), []);
  useEffect(() => {
    gl.localClippingEnabled = true;
    gl.clippingPlanes = [cut];
    return () => void (gl.clippingPlanes = []);
  }, [gl, cut]);
  const look = useMemo(() => new THREE.Vector3(), []);
  const flat = useMemo(() => fitPoints(1.05, 0), []);
  // The floor, and the tops of the two walls that stand (the near ones are cut away).
  const solid = useMemo(
    () => [
      ...fitPoints(0.02, 0).slice(0, 4),
      new THREE.Vector3(ROOM.minX, CEIL, ROOM.minZ),
      new THREE.Vector3(ROOM.minX, CEIL, ROOM.maxZ),
      new THREE.Vector3(ROOM.maxX, CEIL, ROOM.maxZ),
    ],
    [],
  );
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = clock.t;
    const turn = easeInOut(span(t, 2.6, 8.0));
    const tilt = easeInOut(span(t, 2.7, 6.0));
    look.set(midX, lerp(0, RMID.y, tilt), midZ);
    const az = deg(lerp(180, 132, turn)), el = deg(lerp(89.5, 28, tilt));
    dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const d0 = fitDistance(dir, look, flat, lerp(0.95, 0.88, span(t, 0, 2.7)));
    const d1 = fitDistance(dir, look, solid, 0.98);
    camera.position.copy(look).addScaledVector(dir, lerp(d0, d1, tilt));
    camera.lookAt(look);
    placeLabels(camera, labels);
    const walls = ease(span(t, 3.4, 4.9)), staged = ease(span(t, 3.9, 5.5));
    cut.constant = walls > 0 && walls < 1 ? 0.025 + (CEIL + 0.45) * walls : 99;
    if (walls !== rise.walls || staged !== rise.staged) setRise({ walls, staged });
  });
  return (
    <>
      <color attach="background" args={[C.sheet]} />
      <Floor />
      <group position={[P.x, 0, P.z]}>
        <PlanLines />
      </group>
      <group visible={rise.walls > 0}>
        <Built atlas={atlas} staged={rise.staged} section={SECTION2} />
      </group>
      <Suspense fallback={null}>
        <Staged rise={rise.staged} />
      </Suspense>
    </>
  );
}

// ---------- shot 4: an eye-level glide through the furnished layout ----------
// The app's own laminate (StagedBasement's light finish), tiled across the room's floor.
function Laminate() {
  const maps = useMaps();
  const mat = useMemo(() => {
    const { minX, maxX, minZ, maxZ } = BOX;
    const rep = (tex: THREE.Texture) => {
      const t = tex.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set((maxX - minX) / 1.6, (maxZ - minZ) / 1.6);
      t.needsUpdate = true;
      return t;
    };
    return new THREE.MeshStandardMaterial({ map: rep(maps.lightFloor), normalMap: rep(maps.lightFloorN), roughnessMap: rep(maps.lightFloorR), roughness: 0.85 });
  }, [maps]);
  const { minX, maxX, minZ, maxZ } = BOX;
  return (
    <mesh position={[MID.x, -0.005, MID.z]} rotation-x={-Math.PI / 2} material={mat} receiveShadow>
      <planeGeometry args={[maxX - minX, maxZ - minZ]} />
    </mesh>
  );
}

function Flythrough() {
  const { camera } = useThree();
  const path = useMemo(
    () => new THREE.CatmullRomCurve3([new THREE.Vector3(3.45, 1.55, -1.8), new THREE.Vector3(2.7, 1.52, -1.55), new THREE.Vector3(2.15, 1.52, -1.4)], false, "centripetal"),
    [],
  );
  const looks = useMemo(
    () => new THREE.CatmullRomCurve3([new THREE.Vector3(-1.3, 0.85, 0.7), new THREE.Vector3(-0.9, 0.82, 1.1), new THREE.Vector3(-0.3, 0.8, 1.5)], false, "centripetal"),
    [],
  );
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const k = easeInOut(clock.t / 6);
    path.getPointAt(k, p);
    camera.position.copy(p);
    camera.lookAt(looks.getPointAt(k));
  });
  const { minX, maxX, minZ, maxZ } = BOX;
  return (
    <>
      <color attach="background" args={[C.sheet]} />
      <mesh position={[MID.x, CEIL, MID.z]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[maxX - minX + 0.3, maxZ - minZ + 0.3]} />
        <meshBasicMaterial color="#E4E3DD" toneMapped={false} />
      </mesh>
      <Shell rise={1} all />
      <Suspense fallback={null}>
        <Laminate />
        <Staged rise={1} />
      </Suspense>
    </>
  );
}

// ---------- the page ----------
function Director({ onReady }: { onReady: () => void }) {
  const fired = useRef(false);
  useFrame(() => {
    if (!fired.current) {
      fired.current = true;
      onReady();
    }
  });
  return null;
}

function Labels({ get }: { get: () => Label[] }) {
  const { camera } = useThree();
  useFrame(() => placeLabels(camera, get()), 0);
  return null;
}

function App() {
  const solid = useSolid();
  const atlas = useAtlas();
  const [labels, setLabels] = useState<Label[]>([]);
  const labelsRef = useRef<Label[]>([]);
  labelsRef.current = labels;
  if (shot === 1 && !solid) return null;
  if (shot <= 3 && !atlas) return null;
  let scene: ReactNode = null;
  if (shot === 1) scene = <Assemble solid={solid!} atlas={atlas!} />;
  if (shot === 2) scene = <Finds atlas={atlas!} setLabels={setLabels} />;
  if (shot === 3) scene = <PlanTo3D atlas={atlas!} setLabels={setLabels} />;
  if (shot === 4) scene = <Flythrough />;
  return (
    <>
      <Canvas
        frameloop="never"
        dpr={window.devicePixelRatio}
        shadows={shot >= 3 ? "soft" : false}
        camera={{ fov: shot === 4 ? 62 : 40, near: 0.05, far: 200, position: [8, 8, -8] }}
        gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance", toneMappingExposure: 1.0 }}
        style={{ position: "absolute", inset: 0, width: 1920, height: 1080 }}
      >
        {scene}
        {shot === 3 && <Labels get={() => labelsRef.current} />}
        <Director onReady={() => ((window as unknown as { __mounted: boolean }).__mounted = true)} />
      </Canvas>
      <LabelLayer labels={labels} />
    </>
  );
}

declare global {
  interface Window {
    __frame: (i: number) => void;
    __loading: () => boolean;
    __mounted: boolean;
    __duration: number;
  }
}
window.__duration = { 1: 7, 2: 8, 3: 8, 4: 6 }[shot] ?? 6;
window.__frame = (i: number) => {
  clock.t = i / FPS;
  advance(performance.now(), true);
};
window.__loading = () => useProgress.getState().active;

createRoot(document.getElementById("root")!).render(<App />);
