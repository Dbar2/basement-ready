// Your basement as it really is: every surface point MapAnything measured, in its own colour, drawn
// as a soft disc sized to the patch of wall it covers, so surfaces close up like a photo. Walk it
// at eye height (drag to look, tap the floor to go there), jump to the spots where you filmed, or
// step back for an overview with the ceiling lifted off.
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

const EYE_M = 1.5;
const REVEAL_S = 2.6;
const GROW = 1.7; // discs a little larger than their patch, so neighbours overlap and close gaps

export type ScanLabel = { text: string; kind: "window" | "exit" | "stairs" | "mechanical"; at: [number, number, number] };

export type Surfels = { count: number; pos: Int16Array; color: Uint8Array; size: Uint8Array; frame: Uint16Array };
type Viewpoint = { position: THREE.Vector3; forward: THREE.Vector3 };

// "BRS1", uint32 count, positions int16 x3 (mm), colours uint8 x3, footprint uint8 (mm), frame uint16
// (services/scan3d/scan3d/export.py surfel_bytes).
export function parseSurfels(buf: ArrayBuffer): Surfels {
  const head = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== "BRS1") throw new Error("not a surfels file");
  const n = head.getUint32(4, true);
  let o = 8;
  const pos = new Int16Array(buf, o, n * 3);
  o += n * 6;
  const color = new Uint8Array(buf, o, n * 3);
  o += n * 3;
  const size = new Uint8Array(buf, o, n);
  o += n;
  const frame = new Uint16Array(buf.slice(o, o + n * 2));
  return { count: n, pos, color, size, frame };
}

function makeMaterial(frames: number) {
  return new THREE.ShaderMaterial({
    alphaToCoverage: true,
    depthWrite: true,
    uniforms: {
      uScale: { value: 400 },
      uReveal: { value: 0 },
      uFrames: { value: Math.max(1, frames) },
      uClipY: { value: 9 },
      uCut: { value: 0 },
      uExposure: { value: 1.12 },
      uMaxPx: { value: 14 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aFrame;
      uniform float uScale, uReveal, uFrames, uClipY, uCut, uExposure, uMaxPx;
      varying vec3 vColor;
      void main() {
        vec3 p = aPos * 0.001;
        float shown = clamp((uReveal - aFrame / uFrames) / 0.06, 0.0, 1.0);
        float cut = p.y > uClipY ? uCut : 0.0;
        vColor = min(aColor * uExposure, vec3(1.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = aSize * 0.001 * ${GROW.toFixed(2)} * uScale / max(-mv.z, 0.05);
        // Right in front of the lens a point is a blur, not a surface: hide it.
        float near = smoothstep(0.25, 0.45, -mv.z);
        // Close up, a disc never grows past a few pixels: crisp surfaces, not bubbles.
        gl_PointSize = clamp(px, 1.0, uMaxPx) * shown * (1.0 - cut) * near;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        gl_FragColor = vec4(vColor, 1.0 - smoothstep(0.14, 0.25, r2));
      }
    `,
  });
}

function Cloud({ surfels, ceilingY, overview }: { surfels: Surfels; ceilingY: number; overview: boolean }) {
  const frames = useMemo(() => surfels.frame.reduce((m, f) => (f > m ? f : m), 0), [surfels]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("aPos", new THREE.Int16BufferAttribute(surfels.pos, 3));
    g.setAttribute("aColor", new THREE.Uint8BufferAttribute(surfels.color, 3, true));
    g.setAttribute("aSize", new THREE.Uint8BufferAttribute(surfels.size, 1));
    g.setAttribute("aFrame", new THREE.Uint16BufferAttribute(surfels.frame, 1));
    g.setDrawRange(0, surfels.count);
    return g;
  }, [surfels]);
  const material = useMemo(() => makeMaterial(frames), [frames]);
  const { size, gl } = useThree();
  const started = useRef(-1);
  useFrame(({ clock, camera }) => {
    if (started.current < 0) started.current = clock.elapsedTime;
    const u = material.uniforms;
    u.uReveal.value = Math.min(1.1, (clock.elapsedTime - started.current) / REVEAL_S);
    // Pixels per metre at 1 m away: the projection's focal length times half the canvas height.
    u.uScale.value = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] * size.height * 0.5 * gl.getPixelRatio();
    u.uMaxPx.value = 14 * gl.getPixelRatio();
    u.uClipY.value = ceilingY - 0.1;
    u.uCut.value += ((overview && camera.position.y > ceilingY ? 1 : 0) - u.uCut.value) * 0.1;
  });
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

// Walking: drag to look, tap the floor to walk there, arrow keys or WASD to step.
function Walker({ target, onArrive }: { target: Viewpoint | null; onArrive: () => void }) {
  const { camera, gl } = useThree();
  const look = useRef({ yaw: 0, pitch: -0.1 });
  const goal = useRef<THREE.Vector3 | null>(null);
  const keys = useRef(new Set<string>());

  useEffect(() => {
    if (!target) return;
    camera.position.copy(target.position);
    const f = target.forward;
    look.current = { yaw: Math.atan2(-f.x, -f.z), pitch: Math.asin(THREE.MathUtils.clamp(f.y, -0.9, 0.9)) };
    goal.current = null;
    onArrive();
  }, [target, camera, onArrive]);

  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number; t: number; yaw: number; pitch: number } | null = null;
    const ray = new THREE.Raycaster();
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), ...look.current };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const k = 3 / el.clientHeight;
      look.current.yaw = down.yaw + (e.clientX - down.x) * k;
      look.current.pitch = THREE.MathUtils.clamp(down.pitch + (e.clientY - down.y) * k, -1.2, 1.2);
    };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 350) {
        const r = el.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        const hit = ray.ray.intersectPlane(floor, new THREE.Vector3());
        if (hit && hit.distanceTo(camera.position) < 12) goal.current = new THREE.Vector3(hit.x, EYE_M, hit.z);
      }
      down = null;
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) return;
      if (e.type === "keydown") keys.current.add(k);
      else keys.current.delete(k);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [camera, gl]);

  useFrame((_, dt) => {
    const { yaw, pitch } = look.current;
    const k = keys.current;
    const ahead = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const side = new THREE.Vector3(-ahead.z, 0, ahead.x);
    const step = (Number(k.has("w") || k.has("arrowup")) - Number(k.has("s") || k.has("arrowdown"))) * 1.4 * dt;
    const strafe = (Number(k.has("d") || k.has("arrowright")) - Number(k.has("a") || k.has("arrowleft"))) * 1.4 * dt;
    if (step || strafe) {
      camera.position.addScaledVector(ahead, step).addScaledVector(side, strafe);
      goal.current = null;
    }
    if (goal.current) {
      camera.position.lerp(goal.current, Math.min(1, dt * 3));
      if (camera.position.distanceTo(goal.current) < 0.02) goal.current = null;
    }
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    camera.up.set(0, 1, 0);
    camera.lookAt(camera.position.clone().add(dir));
  });
  return null;
}

function Overview({ center, span }: { center: THREE.Vector3; span: number }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(center.x + span * 0.35, span * 0.75, center.z + span * 0.55);
    camera.lookAt(center);
  }, [camera, center, span]);
  return <OrbitControls makeDefault target={center} minDistance={0.5} maxDistance={span * 3} maxPolarAngle={Math.PI * 0.49} />;
}

// Where they stood while filming: about 12 spread over the take, each looking where the phone looked.
function viewpoints(scan: any): Viewpoint[] {
  const frames: { pose: number[][] }[] = scan?.frames ?? [];
  if (!frames.length) return [];
  const pick = Math.max(1, Math.round(frames.length / 12));
  return frames
    .filter((_, i) => i % pick === 0)
    .map((f) => {
      const P = f.pose;
      // Camera-to-room with OpenCV axes: column 2 is where the lens points.
      return { position: new THREE.Vector3(P[0][3], P[1][3], P[2][3]), forward: new THREE.Vector3(P[0][2], P[1][2], P[2][2]).normalize() };
    });
}

// `ideas`: the suggested layout's furniture and walls, placed in the scan, behind an "Ideas" toggle.
// `labels`: what SAM found, tagged where it sits.
// `liteUrl`: a phone-sized file; without one, phones ask the server for `?lite=1`.
export function RealScan(props: { surfelsUrl: string; liteUrl?: string; scanUrl: string; ceilingHeightM: number | null; fallback?: ReactNode; ideas?: ReactNode; labels?: ScanLabel[] }) {
  const phone = useMemo(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches, []);
  const [surfels, setSurfels] = useState<Surfels | null>(null);
  const [scan, setScan] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<"walk" | "overview">("walk");
  const [spot, setSpot] = useState(0);
  const [jump, setJump] = useState<Viewpoint | null>(null);
  const [ideas, setIdeas] = useState(false);

  useEffect(() => {
    let gone = false;
    const url = !phone ? props.surfelsUrl : (props.liteUrl ?? `${props.surfelsUrl}${props.surfelsUrl.includes("?") ? "&" : "?"}lite=1`);
    Promise.all([
      fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))),
      fetch(props.scanUrl).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([buf, json]) => {
        if (gone) return;
        setSurfels(parseSurfels(buf));
        setScan(json);
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [props.surfelsUrl, props.liteUrl, props.scanUrl, phone]);

  const spots = useMemo(() => viewpoints(scan), [scan]);
  // The overview frames where most of the basement is, not its stray far points.
  const { center, span } = useMemo(() => {
    if (!surfels) return { center: new THREE.Vector3(), span: 8 };
    const xs: number[] = [], zs: number[] = [];
    for (let i = 0; i < surfels.count; i += 53) {
      xs.push(surfels.pos[i * 3] / 1000);
      zs.push(surfels.pos[i * 3 + 2] / 1000);
    }
    const pct = (a: number[], q: number) => a.sort((m, n) => m - n)[Math.floor(q * (a.length - 1))];
    const [x0, x1, z0, z1] = [pct(xs, 0.03), pct(xs, 0.97), pct(zs, 0.03), pct(zs, 0.97)];
    return { center: new THREE.Vector3((x0 + x1) / 2, 0.8, (z0 + z1) / 2), span: Math.max(4, x1 - x0, z1 - z0) };
  }, [surfels]);

  // Start walking from the first place they filmed.
  useEffect(() => {
    if (spots.length) setJump(spots[0]);
  }, [spots]);
  const arrived = useCallback(() => setJump(null), []);

  if (failed) return <>{props.fallback ?? <p className="viewer-empty mono">The 3D scan isn't available for this one.</p>}</>;
  if (!surfels) return <p className="viewer-empty mono">Loading your basement in 3D…</p>;

  const go = (i: number) => {
    const n = (i + spots.length) % spots.length;
    setSpot(n);
    setMode("walk");
    setJump(spots[n]);
  };
  const ceiling = props.ceilingHeightM ?? 2.4;

  return (
    <>
      <Canvas className="viewer-canvas" camera={{ fov: 70, near: 0.03, far: 100, position: [0, EYE_M, 0] }} dpr={[1, phone ? 1.5 : 2]} gl={{ antialias: true }}>
        <color attach="background" args={[getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim() || "#0F2A1E"]} />
        <Cloud surfels={surfels} ceilingY={ceiling} overview={mode === "overview"} />
        {ideas && <Suspense fallback={null}>{props.ideas}</Suspense>}
        {props.labels?.map((l, i) => (
          <Html key={i} position={l.at} center zIndexRange={[10, 0]}>
            <span className="viewer-tag" data-kind={l.kind}>
              <i /> {l.text}
            </span>
          </Html>
        ))}
        {mode === "walk" ? <Walker target={jump} onArrive={arrived} /> : <Overview center={center} span={span} />}
      </Canvas>
      <div className="stage-tools">
        <div className="segmented small" role="group" aria-label="View">
          <button aria-pressed={mode === "walk"} onClick={() => go(spot)}>
            Walk
          </button>
          <button aria-pressed={mode === "overview"} onClick={() => setMode("overview")}>
            Overview
          </button>
        </div>
        {spots.length > 1 && (
          <div className="scan-spots" role="group" aria-label="Where you filmed">
            <button onClick={() => go(spot - 1)} aria-label="Previous spot">
              ‹
            </button>
            <span className="mono">
              Spot {spot + 1} of {spots.length}
            </span>
            <button onClick={() => go(spot + 1)} aria-label="Next spot">
              ›
            </button>
          </div>
        )}
      </div>
      {props.ideas && (
        <div className="stage-finish" role="group" aria-label="Show">
          <button aria-pressed={!ideas} onClick={() => setIdeas(false)}>
            As it is
          </button>
          <button aria-pressed={ideas} onClick={() => setIdeas(true)}>
            With the ideas
          </button>
        </div>
      )}
      <p className="viewer-hint mono">{mode === "walk" ? "Drag to look · tap the floor to walk there" : "Drag to turn · pinch or scroll to zoom"}</p>
    </>
  );
}
