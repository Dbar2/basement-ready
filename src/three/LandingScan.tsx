// The home page's scroll story in one canvas: the example's real scan puts itself together as you scroll.
// `progress` runs from 0 (the hero, where the example's video covers the canvas) to 6, and each step is
// finished by its whole number: 1 the path the phone walked, 2 the points rise, 3 the solid surface fills
// in, 4 the ceiling lifts and the measured plan draws, 5 the finds light up, 6 the staged ideas rise in.
// The points and the solid surface are one geometry: the landing's slimmed mesh (mesh-landing.bin).
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { MotionValue } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { frames } from "../../public/samples/sample/3d/scan.json";
import { EXAMPLE } from "../marketing/example";
import { parseMesh, type Solid } from "./RealScan";
import { Tag, TagRoot, TagTracker } from "./Tags";

const StagedFurniture = lazy(() => import("./StagedBasement").then((m) => ({ default: m.StagedFurniture })));

export const LANDING_MESH = "/samples/sample/3d/mesh-landing.bin";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x = clamp01(x)) * x * (3 - 2 * x);
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

type V3 = [number, number, number];

// Where the camera sits at the end of each step, and what it looks at.
const SHOTS: { at: V3; look: V3 }[] = [
  { at: [3.3, 5.2, -2.9], look: [2.3, 1.9, -0.3] },
  { at: [3.3, 5.2, -2.9], look: [2.3, 1.9, -0.3] },
  { at: [6.4, 6.0, -6.6], look: [-1.3, 0.8, 0.1] },
  { at: [5.6, 4.0, -6.0], look: [-1.9, 0.9, 0.3] },
  { at: [1.6, 10.2, -6.4], look: [-0.5, 0, 0.5] },
  { at: [5.0, 7.8, -7.0], look: [-0.4, 0.6, 0.5] },
  { at: [6.0, 6.4, -6.4], look: [-0.4, 0.5, 0.3] },
];
// Room labels at different heights, so they don't sit on top of each other on a small stage.
const ZONE_Y: Record<string, number> = { bathroom: 2.1, bedroom: 1.5, living: 0.5 };

const CEILING = EXAMPLE.ceilingM;
const LID = CEILING - 0.12;

// What's shown at a given point of the story; the canvas only re-renders React when one of these flips.
function phase(t: number) {
  return {
    plan: t > 3.75 && t < 4.6,
    finds: t > 4.55 && t < 5.45,
    staged: t > 4.6,
    zones: t > 5.7,
  };
}
type Phase = ReturnType<typeof phase>;
const same = (a: Phase, b: Phase) => a.plan === b.plan && a.finds === b.finds && a.staged === b.staged && a.zones === b.zones;

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
    return g;
  }, [solid]);
}

// The points rise out of the floor, swept across the room like a phone pan, in the scan's mint and
// forest first, then in the colours the camera saw. Points under `uBelow` are already solid surface.
function pointsMaterial() {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      uRise: { value: 0 },
      uTrue: { value: 0 },
      uBelow: { value: -1 },
      uScale: { value: 800 },
      uMaxPx: { value: 6 },
      uMint: { value: new THREE.Color(css("--color-mint-line")) },
      uInk: { value: new THREE.Color(css("--color-ink")) },
    },
    vertexShader: /* glsl */ `
      uniform float uRise, uTrue, uBelow, uScale, uMaxPx;
      uniform vec3 uMint, uInk;
      varying vec3 vColor;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 p = position;
        float h = hash(p);
        float d = clamp((p.x + 4.6) / 8.2, 0.0, 1.0) * 0.6 + h * 0.25;
        float r = clamp((uRise * 1.85 - d) / 0.4, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - r, 3.0);
        vec4 mv = modelViewMatrix * vec4(p.x, p.y * e, p.z, 1.0);
        gl_Position = projectionMatrix * mv;
        float shown = step(0.001, r) * step(uBelow, p.y);
        gl_PointSize = clamp(0.04 * uScale / max(-mv.z, 0.1), 1.0, uMaxPx) * shown;
        vColor = mix(h < 0.4 ? uInk : uMint, color, uTrue);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = linearToOutputTexel(vec4(vColor, 1.0));
      }
    `,
  });
}

// A thin outline: a rectangle standing on a wall (`facing` "x" or "z") or lying on the floor ("y").
function Outline({ center, w, h, facing, color }: { center: V3; w: number; h: number; facing: "x" | "y" | "z"; color: THREE.Color }) {
  const k = 0.05;
  const bars: { p: V3; s: V3 }[] =
    facing === "y"
      ? [
          { p: [0, 0, -h / 2], s: [w + k, k, k] },
          { p: [0, 0, h / 2], s: [w + k, k, k] },
          { p: [-w / 2, 0, 0], s: [k, k, h] },
          { p: [w / 2, 0, 0], s: [k, k, h] },
        ]
      : facing === "z"
        ? [
            { p: [0, -h / 2, 0], s: [w + k, k, k] },
            { p: [0, h / 2, 0], s: [w + k, k, k] },
            { p: [-w / 2, 0, 0], s: [k, h, k] },
            { p: [w / 2, 0, 0], s: [k, h, k] },
          ]
        : [
            { p: [0, -h / 2, 0], s: [k, k, w + k] },
            { p: [0, h / 2, 0], s: [k, k, w + k] },
            { p: [0, 0, -w / 2], s: [k, h, k] },
            { p: [0, 0, w / 2], s: [k, h, k] },
          ];
  return (
    <group position={center}>
      {bars.map((b, i) => (
        <mesh key={i} position={b.p} scale={b.s} renderOrder={10}>
          <boxGeometry />
          <meshBasicMaterial color={color} toneMapped={false} depthTest={false} transparent />
        </mesh>
      ))}
    </group>
  );
}

function Story({ solid, progress, onReady }: { solid: Solid; progress: MotionValue<number>; onReady: () => void }) {
  const { camera, gl, size } = useThree();
  const geometry = useGeometry(solid);
  const colours = useMemo(
    () => ({
      ink: new THREE.Color(css("--color-ink")),
      line: new THREE.Color(css("--color-mint-line")),
      window: new THREE.Color(css("--find-window")),
      exit: new THREE.Color(css("--find-exit")),
      stairs: new THREE.Color(css("--find-stairs")),
    }),
    [],
  );
  const cut = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), -0.2), []);
  const surface = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: [cut], toneMapped: false }), [cut]);
  const dots = useMemo(pointsMaterial, []);
  const pathLine = useMemo(() => new THREE.MeshBasicMaterial({ color: colours.line, toneMapped: false, transparent: true }), [colours]);
  const sheet = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(css("--color-card")), toneMapped: false, transparent: true, opacity: 0 }), []);
  const lensLine = useMemo(() => new THREE.LineBasicMaterial({ color: colours.ink, toneMapped: false, transparent: true }), [colours]);

  // The phone's path while filming, from the example's camera poses.
  const path = useMemo(() => {
    const pts = frames.map((f) => new THREE.Vector3(f.pose[0][3], f.pose[1][3], f.pose[2][3]));
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    // Where the phone looked from, a few times along the way: OpenCV axes, column 2 is where the lens points.
    // A new spot once the phone has moved 30 cm or turned 40°, so a long pan doesn't stack them up.
    const spots: (typeof frames)[number][] = [];
    for (const fr of frames) {
      const last = spots.at(-1)?.pose;
      const P = fr.pose;
      if (!last || Math.hypot(P[0][3] - last[0][3], P[2][3] - last[2][3]) > 0.3 || P[0][2] * last[0][2] + P[1][2] * last[1][2] + P[2][2] * last[2][2] < 0.77) spots.push(fr);
    }
    const v: number[] = [];
    for (const { pose: P } of spots) {
      const c = new THREE.Vector3(P[0][3], P[1][3], P[2][3]);
      const ax = (j: number) => new THREE.Vector3(P[0][j], P[1][j], P[2][j]).normalize();
      const [r, d, f] = [ax(0).multiplyScalar(0.2), ax(1).multiplyScalar(0.14), ax(2).multiplyScalar(0.32)];
      const corner = (a: number, b2: number) => c.clone().add(f).addScaledVector(r, a).addScaledVector(d, b2);
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      q.forEach((k, j) => v.push(...c.toArray(), ...k.toArray(), ...k.toArray(), ...q[(j + 1) % 4].toArray()));
    }
    const lenses = new THREE.BufferGeometry();
    lenses.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    return { curve, tube: new THREE.TubeGeometry(curve, 320, 0.022, 6, false), lenses, spots: spots.length };
  }, []);

  const meshRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const pathRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const lensRef = useRef<THREE.LineSegments>(null);
  const planRef = useRef<THREE.Group>(null);
  const findsRef = useRef<THREE.Group>(null);
  const stagedRef = useRef<THREE.Group>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const t = useRef(progress.get());
  const [shown, setShown] = useState(() => phase(progress.get()));
  const ready = useRef(false);
  const look = useMemo(() => new THREE.Vector3(), []);
  const at = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  useEffect(
    () => () => {
      geometry.dispose();
      surface.dispose();
      dots.dispose();
      pathLine.dispose();
      lensLine.dispose();
      sheet.dispose();
      path.tube.dispose();
      path.lenses.dispose();
    },
    [geometry, surface, dots, pathLine, lensLine, sheet, path],
  );

  const b = EXAMPLE.plan.box;
  const edges = useMemo(() => {
    const c: V3[] = [
      [b.minX, 0.012, b.minZ],
      [b.maxX, 0.012, b.minZ],
      [b.maxX, 0.012, b.maxZ],
      [b.minX, 0.012, b.maxZ],
    ];
    return c.map((p, i) => ({ from: p, to: c[(i + 1) % 4] }));
  }, [b]);

  useFrame((_, dt) => {
    const goal = progress.get();
    // Scroll jumps are eased out, so a flick still plays the build rather than cutting to its end.
    t.current += (goal - t.current) * (1 - Math.exp(-dt * 7));
    if (Math.abs(goal - t.current) < 0.0005) t.current = goal;
    const s = t.current;

    // Camera: between the two shots either side of where the story is.
    const i = Math.min(SHOTS.length - 2, Math.floor(s));
    const f = ease(s - i);
    const [a, z] = [SHOTS[i], SHOTS[i + 1]];
    look.set(...a.look).lerp(tmp.set(...z.look), f);
    at.set(...a.at).lerp(tmp.set(...z.at), f);
    // A narrow stage steps back so the whole basement still fits.
    const back = THREE.MathUtils.clamp(1.4 / (size.width / size.height), 1.2, 2);
    camera.position.copy(look).addScaledVector(at.sub(look), back);
    camera.lookAt(look);

    // 1: the walk line draws, then fades once the surface is in.
    const walk = span(s, 0.25, 1.0);
    const tube = pathRef.current!.geometry as THREE.TubeGeometry;
    tube.setDrawRange(0, Math.floor(walk * 320) * 36);
    pathLine.opacity = 1 - span(s, 2.3, 2.9);
    lensLine.opacity = pathLine.opacity * (1 - span(s, 1.4, 2.0));
    pathRef.current!.visible = walk > 0 && pathLine.opacity > 0;
    lensRef.current!.visible = walk > 0 && lensLine.opacity > 0;
    lensRef.current!.geometry.setDrawRange(0, Math.ceil(walk * path.spots) * 16);
    headRef.current!.visible = walk > 0 && walk < 0.995;
    headRef.current!.position.copy(path.curve.getPointAt(Math.max(0.0001, walk)));

    // 2: points rise; 3: the solid surface fills in from the floor, taking their place.
    const fill = ease(span(s, 2.05, 2.9));
    const lid = ease(span(s, 3.05, 3.7));
    const height = fill < 1 ? -0.2 + (CEILING + 0.8) * fill : CEILING + 0.6 + (LID - CEILING - 0.6) * lid;
    cut.constant = height;
    const u = dots.uniforms;
    u.uRise.value = span(s, 1.05, 1.9);
    u.uTrue.value = span(s, 2.0, 2.6);
    u.uBelow.value = fill > 0 ? height : -1;
    u.uScale.value = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] * size.height * 0.5 * gl.getPixelRatio();
    u.uMaxPx.value = 6 * gl.getPixelRatio();
    pointsRef.current!.visible = s > 1.05 && fill < 1;
    meshRef.current!.visible = fill > 0;

    // 4: the plan draws itself on the floor, one wall at a time, over a sheet the furniture later stands on.
    sheet.opacity = ease(span(s, 3.2, 3.7));
    const draw = span(s, 3.3, 3.95) * 4;
    planRef.current!.children.forEach((bar, k) => {
      const e = edges[k];
      const len = Math.hypot(e.to[0] - e.from[0], e.to[2] - e.from[2]);
      const q = clamp01(draw - k);
      bar.visible = q > 0 && s < 5.45;
      bar.position.set(e.from[0] + ((e.to[0] - e.from[0]) * q) / 2, 0.012, e.from[2] + ((e.to[2] - e.from[2]) * q) / 2);
      bar.scale.set(Math.max(0.001, len * q), 1, 1);
      bar.rotation.y = -Math.atan2(e.to[2] - e.from[2], e.to[0] - e.from[0]);
    });

    // 5: the finds light up.
    const finds = ease(span(s, 4.1, 4.6)) * (1 - span(s, 5.2, 5.45));
    findsRef.current!.visible = finds > 0;
    findsRef.current!.children.forEach((c) => c.scale.setScalar(Math.max(0.001, 0.6 + 0.4 * finds)));

    // 6: the staged ideas rise in, and the scan's own light steps back for the furniture's.
    const staged = ease(span(s, 5.1, 5.85));
    if (stagedRef.current) {
      stagedRef.current.visible = staged > 0;
      stagedRef.current.scale.set(1, Math.max(0.001, staged), 1);
    }
    ambient.current!.intensity = 2.6 - 0.5 * staged;
    sun.current!.intensity = 1.2 - 0.9 * staged;

    const next = phase(s);
    if (!same(next, shown)) setShown(next);
    if (!ready.current) {
      ready.current = true;
      requestAnimationFrame(onReady);
    }
  });

  const tag = (kind: string, text: string, value?: string) => (
    <span className="lp-tag" data-kind={kind}>
      <i />
      {text}
      {value && <b>{value}</b>}
    </span>
  );
  const P = EXAMPLE.placement;

  return (
    <>
      {/* Lambert divides light by π: these keep the photo's own brightness, with a little shape on top. */}
      <ambientLight ref={ambient} intensity={2.6} />
      <directionalLight ref={sun} position={[2, 6, 3]} intensity={1.2} />

      <mesh ref={pathRef} geometry={path.tube} material={pathLine} frustumCulled={false} />
      <lineSegments ref={lensRef} geometry={path.lenses} material={lensLine} frustumCulled={false} />
      <mesh ref={headRef}>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshBasicMaterial color={colours.ink} toneMapped={false} />
      </mesh>

      <points ref={pointsRef} geometry={geometry} material={dots} frustumCulled={false} />
      <mesh ref={meshRef} geometry={geometry} material={surface} frustumCulled={false} />

      <mesh position={[(b.minX + b.maxX) / 2, -0.06, (b.minZ + b.maxZ) / 2]} rotation-x={-Math.PI / 2} material={sheet} renderOrder={-1}>
        <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
      </mesh>
      <group ref={planRef}>
        {edges.map((_, k) => (
          <mesh key={k} visible={false}>
            <boxGeometry args={[1, 0.02, 0.05]} />
            <meshBasicMaterial color={colours.ink} toneMapped={false} />
          </mesh>
        ))}
      </group>

      <group ref={findsRef} visible={false}>
        {EXAMPLE.openings.map((o, k) => {
          const window = o.kind === "window";
          const h = window ? 0.4 : 2.0;
          const y = window ? CEILING - 0.38 : 1.0;
          const inset = o.side === "minZ" || o.side === "minX" ? 0.03 : -0.03;
          const center: V3 = o.side.endsWith("Z") ? [o.at[0], y, o.at[1] + inset] : [o.at[0] + inset, y, o.at[1]];
          return <Outline key={k} center={center} w={o.widthM} h={h} facing={o.side.endsWith("Z") ? "z" : "x"} color={window ? colours.window : colours.exit} />;
        })}
        {EXAMPLE.stairs.map((st, k) => (
          <Outline key={`s${k}`} center={[(st.x0 + st.x1) / 2, 0.03, (st.z0 + st.z1) / 2]} w={st.x1 - st.x0} h={st.z1 - st.z0} facing="y" color={colours.stairs} />
        ))}
      </group>

      {shown.staged && (
        <group ref={stagedRef} visible={false} rotation-y={(-P.turn * Math.PI) / 2} position={[P.x, 0, P.z]}>
          <Suspense fallback={null}>
            <StagedFurniture plan={EXAMPLE.plan} layout={EXAMPLE.layout} />
          </Suspense>
        </group>
      )}

      {shown.plan && (
        <>
          <Tag position={[(b.minX + b.maxX) / 2, 0.05, b.minZ - 0.45]}>{tag("measure", EXAMPLE.width)}</Tag>
          <Tag position={[b.maxX + 0.5, 0.05, (b.minZ + b.maxZ) / 2]}>{tag("measure", EXAMPLE.depth)}</Tag>
          <Tag position={[b.minX + 0.2, LID - 0.1, (b.minZ + b.maxZ) / 2]}>{tag("measure", "Ceiling", EXAMPLE.ceiling)}</Tag>
        </>
      )}
      {shown.finds &&
        EXAMPLE.openings.map((o, k) => (
          <Tag key={k} position={[o.at[0], o.kind === "window" ? CEILING + 0.3 : 2.45, o.at[1]]}>
            {tag(o.kind === "window" ? "window" : "exit", o.kind === "window" ? "Window" : "Door", `${o.width} wide`)}
          </Tag>
        ))}
      {shown.finds &&
        EXAMPLE.stairs.map((st, k) => (
          <Tag key={`s${k}`} position={[(st.x0 + st.x1) / 2, 0.05, st.z0 - 0.45]}>
            {tag("stairs", "Stairs")}
          </Tag>
        ))}
      {shown.zones &&
        EXAMPLE.zones.map((z) => (
          <Tag key={z.name} position={[P.x + (z.x0 + z.x1) / 2, ZONE_Y[z.kind] ?? 1.3, P.z + (z.z0 + z.z1) / 2]}>
            {tag("zone", z.name, z.area)}
          </Tag>
        ))}
    </>
  );
}

// `active`: render frames only while the stage is on screen.
export function LandingScan({ progress, active, onReady, onFail }: { progress: MotionValue<number>; active: boolean; onReady: () => void; onFail: () => void }) {
  const [solid, setSolid] = useState<Solid | null>(null);
  const phone = useMemo(() => window.matchMedia("(pointer: coarse)").matches, []);
  useEffect(() => {
    let gone = false;
    fetch(LANDING_MESH)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => !gone && setSolid(parseMesh(buf)))
      .catch(() => !gone && onFail());
    return () => {
      gone = true;
    };
  }, [onFail]);
  if (!solid) return null;
  return (
    <TagRoot>
      <Canvas
        className="lp-canvas"
        frameloop={active ? "always" : "never"}
        camera={{ fov: 42, near: 0.05, far: 100, position: SHOTS[0].at }}
        dpr={[1, phone ? 1.5 : 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", onFail)}
      >
        <color attach="background" args={[css("--color-surface")]} />
        <TagTracker />
        <Story solid={solid} progress={progress} onReady={onReady} />
      </Canvas>
    </TagRoot>
  );
}
