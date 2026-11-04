// The home page's scroll story in one canvas: the example's real scan becomes its clean 3D as you scroll.
// `progress` runs from 0 (the hero, where the example's video covers the canvas) to 6, and each step is
// finished by its whole number: 1 the path the phone walked, 2 the points rise, 3 the solid basement rises
// in their place, 4 the measured plan draws, 5 the finds light up, 6 the staged ideas rise in.
// The points are the scan's own (the landing's slimmed mesh, mesh-landing.bin), kept only inside the room so
// no stray ones float about. The solid basement is the as-built model the app shows (src/three/AsBuilt.tsx):
// straight walls, a level floor, the stairs and furnace, painted with the example's video.
// The camera frames the whole basement at every step, for any stage shape, so nothing is cut off.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { MotionValue } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { frames } from "../../public/samples/sample/3d/scan.json";
import type { Existing } from "../../server/model/types";
import { EXAMPLE } from "../marketing/example";
import existingJson from "../marketing/example-existing.json";
import { AsBuiltScene, type Atlas, type AtlasIndex } from "./AsBuilt";
import { parseMesh, type Solid } from "./RealScan";
import { Tag, TagRoot, TagTracker } from "./Tags";

const StagedFurniture = lazy(() => import("./StagedBasement").then((m) => ({ default: m.StagedFurniture })));

export const LANDING_MESH = "/samples/sample/3d/mesh-landing.bin";
const ATLAS_BASE = "/samples/sample/3d/asbuilt/";
// The example's plan as the app seeds it (scripts/landing-existing.ts writes it).
const EXISTING = existingJson as unknown as Existing;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x = clamp01(x)) * x * (3 - 2 * x);
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

type V3 = [number, number, number];

const CEILING = EXAMPLE.ceilingM;
const FOV = 42;
// The plan's box is centred on the room; the scan, and the as-built model, sit where the room was filmed.
const P = EXAMPLE.placement;
const PB = EXAMPLE.plan.box;
const ROOM = { minX: PB.minX + P.x, maxX: PB.maxX + P.x, minZ: PB.minZ + P.z, maxZ: PB.maxZ + P.z };
const MID: V3 = [(ROOM.minX + ROOM.maxX) / 2, CEILING * 0.35, (ROOM.minZ + ROOM.maxZ) / 2];

// What the camera keeps in frame: the room up to its ceiling, and a strip round the floor for the labels.
const PAD = 0.55;
const FIT: THREE.Vector3[] = [
  ...[ROOM.minX - PAD, ROOM.maxX + PAD].flatMap((x) => [ROOM.minZ - PAD, ROOM.maxZ + PAD].map((z) => new THREE.Vector3(x, 0, z))),
  ...[ROOM.minX, ROOM.maxX].flatMap((x) => [ROOM.minZ, ROOM.maxZ].map((z) => new THREE.Vector3(x, CEILING, z))),
];
// Where the camera looks from at the end of each step: degrees round from +z towards +x, and up from level.
// Mostly from the +x end, looking down the room's length: both long walls show their insides, so the door
// and stairs on one and the window on the other are never hidden behind a wall.
const SHOTS: { az: number; el: number }[] = [
  { az: 118, el: 62 },
  { az: 118, el: 62 },
  { az: 112, el: 40 },
  { az: 106, el: 36 },
  { az: 98, el: 62 },
  { az: 94, el: 48 },
  { az: 108, el: 42 },
];
// How much of the stage the basement may fill.
const MARGIN = 0.9;

// How far back the camera stands, looking along `-dir` at MID, for every FIT point to be in frame.
function fitDistance(dir: THREE.Vector3, aspect: number) {
  const fwd = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd);
  const tv = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * MARGIN, th = tv * aspect;
  const rel = new THREE.Vector3();
  let d = 0;
  for (const p of FIT) {
    rel.copy(p).sub(new THREE.Vector3(...MID));
    const along = rel.dot(dir);
    d = Math.max(d, Math.abs(rel.dot(right)) / th + along, Math.abs(rel.dot(up)) / tv + along);
  }
  return d;
}

// Room labels at different heights, so they don't sit on top of each other on a small stage.
const ZONE_Y: Record<string, number> = { bathroom: 2.1, bedroom: 1.5, living: 0.5 };

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

// The scan's points inside the room, up to its ceiling: what's outside the walls is noise.
function usePoints(solid: Solid) {
  return useMemo(() => {
    const keep: number[] = [];
    const m = 0.12;
    for (let i = 0; i < solid.pos.length; i += 3) {
      const [x, y, z] = [solid.pos[i] / 1000, solid.pos[i + 1] / 1000, solid.pos[i + 2] / 1000];
      if (x > ROOM.minX - m && x < ROOM.maxX + m && z > ROOM.minZ - m && z < ROOM.maxZ + m && y > -0.08 && y < CEILING + 0.08) keep.push(x, y, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
    return g;
  }, [solid]);
}

// The points rise out of the floor, swept across the room like a phone pan, in the scan's mint and
// forest. Points under `uBelow` are already solid basement.
function pointsMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRise: { value: 0 },
      uBelow: { value: -1 },
      uScale: { value: 800 },
      uMaxPx: { value: 5 },
      uMint: { value: new THREE.Color(css("--color-mint-line")) },
      uInk: { value: new THREE.Color(css("--color-ink")) },
    },
    vertexShader: /* glsl */ `
      uniform float uRise, uBelow, uScale, uMaxPx;
      uniform vec3 uMint, uInk;
      varying vec3 vColor;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 p = position;
        float h = hash(p);
        float d = clamp((p.x + 4.0) / 8.0, 0.0, 1.0) * 0.6 + h * 0.25;
        float r = clamp((uRise * 1.85 - d) / 0.4, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - r, 3.0);
        vec4 mv = modelViewMatrix * vec4(p.x, p.y * e, p.z, 1.0);
        gl_Position = projectionMatrix * mv;
        float shown = step(0.001, r) * step(uBelow, p.y);
        gl_PointSize = clamp(0.05 * uScale / max(-mv.z, 0.1), 1.5, uMaxPx) * shown;
        vColor = h < 0.4 ? uInk : uMint;
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

function Story({ solid, atlas, progress, onReady }: { solid: Solid; atlas: Atlas | null; progress: MotionValue<number>; onReady: () => void }) {
  const { camera, gl, size } = useThree();
  const points = usePoints(solid);
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
  // The solid basement rises from the floor up to this plane; everything is under it once it's in.
  const cut = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 99), []);
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
    return { curve, tube: new THREE.TubeGeometry(curve, 320, 0.034, 6, false), lenses, spots: spots.length };
  }, []);

  const builtRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const pathRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const lensRef = useRef<THREE.LineSegments>(null);
  const sheetRef = useRef<THREE.Mesh>(null);
  const planRef = useRef<THREE.Group>(null);
  const findsRef = useRef<THREE.Group>(null);
  const stagedRef = useRef<THREE.Group>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const t = useRef(progress.get());
  const [shown, setShown] = useState(() => phase(progress.get()));
  const ready = useRef(false);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const mid = useMemo(() => new THREE.Vector3(...MID), []);

  useEffect(() => {
    gl.localClippingEnabled = true;
    // One plane for the whole scene, always on: off is just far overhead, so no shader rebuilds mid-scroll.
    gl.clippingPlanes = [cut];
    return () => {
      gl.clippingPlanes = [];
    };
  }, [gl, cut]);
  useEffect(
    () => () => {
      points.dispose();
      dots.dispose();
      pathLine.dispose();
      lensLine.dispose();
      sheet.dispose();
      path.tube.dispose();
      path.lenses.dispose();
    },
    [points, dots, pathLine, lensLine, sheet, path],
  );

  const edges = useMemo(() => {
    const c: V3[] = [
      [PB.minX, 0.012, PB.minZ],
      [PB.maxX, 0.012, PB.minZ],
      [PB.maxX, 0.012, PB.maxZ],
      [PB.minX, 0.012, PB.maxZ],
    ];
    return c.map((p, i) => ({ from: p, to: c[(i + 1) % 4] }));
  }, []);

  useFrame((_, dt) => {
    const goal = progress.get();
    // Scroll jumps are eased out, so a flick still plays the build rather than cutting to its end.
    t.current += (goal - t.current) * (1 - Math.exp(-dt * 7));
    if (Math.abs(goal - t.current) < 0.0005) t.current = goal;
    const s = t.current;

    // Camera: between the two shots either side of where the story is, stepped back just far enough
    // that the whole basement fits the stage.
    const i = Math.min(SHOTS.length - 2, Math.floor(s));
    const f = ease(s - i);
    const [a, z] = [SHOTS[i], SHOTS[i + 1]];
    const az = THREE.MathUtils.degToRad(a.az + (z.az - a.az) * f), el = THREE.MathUtils.degToRad(a.el + (z.el - a.el) * f);
    dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    camera.position.copy(mid).addScaledVector(dir, fitDistance(dir, size.width / Math.max(1, size.height)));
    camera.lookAt(mid);

    // 1: the walk line draws over the floor's sheet, then fades as the points take over.
    const walk = span(s, 0.25, 1.0);
    const tube = pathRef.current!.geometry as THREE.TubeGeometry;
    tube.setDrawRange(0, Math.floor(walk * 320) * 36);
    pathLine.opacity = 1 - span(s, 1.6, 2.0);
    lensLine.opacity = pathLine.opacity * (1 - span(s, 1.3, 1.7));
    pathRef.current!.visible = walk > 0 && pathLine.opacity > 0;
    lensRef.current!.visible = walk > 0 && lensLine.opacity > 0;
    lensRef.current!.geometry.setDrawRange(0, Math.ceil(walk * path.spots) * 16);
    headRef.current!.visible = walk > 0 && walk < 0.995;
    headRef.current!.position.copy(path.curve.getPointAt(Math.max(0.0001, walk)));
    sheet.opacity = ease(span(s, 0.1, 0.6));

    // 2: points rise; 3: the solid basement rises from the floor, taking their place.
    const fill = ease(span(s, 2.05, 2.85));
    const height = -0.05 + (CEILING + 0.4) * fill;
    cut.constant = fill > 0 && fill < 1 ? height : 99;
    const u = dots.uniforms;
    u.uRise.value = span(s, 1.05, 1.9);
    u.uBelow.value = fill > 0 ? height : -1;
    u.uScale.value = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] * size.height * 0.5 * gl.getPixelRatio();
    u.uMaxPx.value = 5 * gl.getPixelRatio();
    pointsRef.current!.visible = s > 1.05 && fill < 1;
    builtRef.current!.visible = fill > 0;
    sheetRef.current!.visible = fill < 1 && sheet.opacity > 0;

    // 4: the plan draws itself on the floor, one wall at a time.
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

    // 6: the staged ideas rise in, and the light softens for the furniture.
    const staged = ease(span(s, 5.1, 5.85));
    if (stagedRef.current) {
      stagedRef.current.visible = staged > 0;
      stagedRef.current.scale.set(1, Math.max(0.001, staged), 1);
    }
    ambient.current!.intensity = 2.4 - 0.3 * staged;
    sun.current!.intensity = 1.1 - 0.6 * staged;

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
  // The plan's own frame, moved to where the room was filmed.
  const at = (x: number, y: number, z: number): V3 => [x + P.x, y, z + P.z];

  return (
    <>
      {/* The plain parts are Lambert, which divides light by π; the painted ones keep the video's own colours. */}
      <ambientLight ref={ambient} intensity={2.4} />
      <directionalLight ref={sun} position={[2, 6, -3]} intensity={1.1} />

      <mesh ref={sheetRef} position={at((PB.minX + PB.maxX) / 2, -0.08, (PB.minZ + PB.maxZ) / 2)} rotation-x={-Math.PI / 2} material={sheet} renderOrder={-1}>
        <planeGeometry args={[PB.maxX - PB.minX, PB.maxZ - PB.minZ]} />
      </mesh>

      <mesh ref={pathRef} geometry={path.tube} material={pathLine} frustumCulled={false} />
      <lineSegments ref={lensRef} geometry={path.lenses} material={lensLine} frustumCulled={false} />
      <mesh ref={headRef}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshBasicMaterial color={colours.ink} toneMapped={false} />
      </mesh>

      <points ref={pointsRef} geometry={points} material={dots} frustumCulled={false} />
      <group ref={builtRef} visible={false}>
        <AsBuiltScene existing={EXISTING} atlas={atlas} overview reveal={false} lights={false} />
      </group>

      <group position={[P.x, 0, P.z]}>
        <group ref={planRef}>
          {edges.map((_, k) => (
            <mesh key={k} visible={false} renderOrder={5}>
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
          <Tag position={at((PB.minX + PB.maxX) / 2, 0.05, PB.minZ - 0.45)}>{tag("measure", EXAMPLE.width)}</Tag>
          <Tag position={at(PB.maxX + 0.5, 0.05, (PB.minZ + PB.maxZ) / 2)}>{tag("measure", EXAMPLE.depth)}</Tag>
          <Tag position={at(PB.minX + 0.2, CEILING - 0.2, (PB.minZ + PB.maxZ) / 2)}>{tag("measure", "Ceiling", EXAMPLE.ceiling)}</Tag>
        </>
      )}
      {shown.finds &&
        EXAMPLE.openings.map((o, k) => (
          // A little into the room from its wall, so a label on the stage's edge isn't cut off on a phone.
          <Tag key={k} position={at(o.at[0], o.kind === "window" ? CEILING + 0.3 : 2.45, o.at[1] + (o.side === "maxZ" ? -0.6 : o.side === "minZ" ? 0.6 : 0))}>
            {tag(o.kind === "window" ? "window" : "exit", o.kind === "window" ? "Window" : "Door", `${o.width} wide`)}
          </Tag>
        ))}
      {shown.finds &&
        EXAMPLE.stairs.map((st, k) => (
          <Tag key={`s${k}`} position={at((st.x0 + st.x1) / 2, 0.05, st.z0 - 0.45)}>
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
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const phone = useMemo(() => window.matchMedia("(pointer: coarse)").matches, []);
  useEffect(() => {
    let gone = false;
    fetch(LANDING_MESH)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => !gone && setSolid(parseMesh(buf)))
      .catch(() => !gone && onFail());
    // The painting is a nicety: without it the basement is drawn in its measured plain colours.
    fetch(ATLAS_BASE + "index.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((index: AtlasIndex | null) => !gone && index && setAtlas({ index, base: ATLAS_BASE }))
      .catch(() => undefined);
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
        camera={{ fov: FOV, near: 0.05, far: 100, position: [MID[0] + 6, 10, MID[2] - 6] }}
        dpr={[1, phone ? 1.5 : 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", onFail)}
      >
        <color attach="background" args={[css("--color-surface")]} />
        <TagTracker />
        <Story solid={solid} atlas={atlas} progress={progress} onReady={onReady} />
      </Canvas>
    </TagRoot>
  );
}
