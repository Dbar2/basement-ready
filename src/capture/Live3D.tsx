// The basement's 3D so far, while filming: the big map under the camera (a three-quarter view from
// above, cut away at waist height like a floor plan), and the full screen view it opens.
//
// The map draws only what helps: the room box with its filmed sides solid and the rest dashed, a
// dashed lid where the ceiling isn't filmed, the points below waist height in mint (the newest view's
// brighter: that's where the camera is now), the path walked, and the camera with its view cone.
import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Preview3d } from "./live";
import { bounds, edges, type LiveMap } from "./map";

// ---------- the full screen view ----------

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

export function Live3DFull({ preview, onClose }: { preview: Preview3d; onClose: () => void }) {
  const r = Math.max(2.5, preview.positions.length ? Math.max(preview.widthM ?? 4, preview.depthM ?? 4) : 4);
  return (
    <div className="cap-3d-full" role="dialog" aria-label="Your basement in 3D so far">
      <Canvas camera={{ fov: 45, position: [r * 0.9, r * 1.1, r * 1.1], near: 0.05, far: 100 }} dpr={[1, 2]} gl={{ alpha: true }}>
        <Cloud preview={preview} size={0.055} />
        <OrbitControls autoRotate autoRotateSpeed={1.2} enableZoom enableRotate enablePan={false} target={[0, 0.8, 0]} />
      </Canvas>
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

// ---------- the map ----------

// Brand colours, read from the tokens so the map matches the page.
function tokens() {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { mint: get("--color-mint", "#4BE38A"), paper: get("--color-card", "#FBFCFA"), ink: get("--color-ink", "#0F2A1E") };
}

// Points above this (metres over the floor) are left out, like a floor plan's cut: from above, the
// ceiling would hide everything under it.
const CUT_M = 1.4;
// Points this far outside the room box (through a doorway, a smear) are left out too: the map is
// about this space.
const BOX_MARGIN_M = 0.4;
const WALL_M = 0.9; // how tall the filmed walls stand on the map
const CONE_DEG = 56;
const VIEW_ELEV_DEG = 58;
const FOV_DEG = 36;

function MapCloud({ preview, mint, paper }: { preview: Preview3d; mint: string; paper: string }) {
  const [rest, newest] = useMemo(() => {
    const { positions, colors, pointViews } = preview;
    const map = preview.map;
    const latest = map?.newestView ?? -1;
    const [x0, , z0] = map?.box?.min ?? [-Infinity, 0, -Infinity];
    const [x1, , z1] = map?.box?.max ?? [Infinity, 0, Infinity];
    const m = new THREE.Color(mint);
    const out = { rest: { pos: [] as number[], col: [] as number[] }, newest: { pos: [] as number[], col: [] as number[] } };
    for (let i = 0; i < preview.count; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (y > CUT_M || y < -0.3 || x < x0 - BOX_MARGIN_M || x > x1 + BOX_MARGIN_M || z < z0 - BOX_MARGIN_M || z > z1 + BOX_MARGIN_M) continue;
      if (pointViews[i] === latest) {
        out.newest.pos.push(x, y, z);
        continue;
      }
      // Mint, lighter where the real surface is lighter, so walls and edges still read.
      const l = (0.2126 * colors[i * 3] + 0.7152 * colors[i * 3 + 1] + 0.0722 * colors[i * 3 + 2]) / 255;
      const k = 0.3 + 0.7 * l;
      out.rest.pos.push(x, y, z);
      out.rest.col.push(m.r * k, m.g * k, m.b * k);
    }
    const geometry = (pos: number[], col?: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      if (col) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      return g;
    };
    return [geometry(out.rest.pos, out.rest.col), geometry(out.newest.pos)];
  }, [preview, mint]);
  useEffect(
    () => () => {
      rest.dispose();
      newest.dispose();
    },
    [rest, newest],
  );
  return (
    <>
      <points geometry={rest}>
        <pointsMaterial size={0.035} vertexColors sizeAttenuation transparent opacity={0.6} depthWrite={false} />
      </points>
      {/* what the camera saw last: where the recording is now */}
      <points geometry={newest}>
        <pointsMaterial size={0.05} color={paper} sizeAttenuation transparent opacity={0.95} depthWrite={false} />
      </points>
    </>
  );
}

function Room({ map, ceilingGap, mint, paper }: { map: LiveMap; ceilingGap: boolean; mint: string; paper: string }) {
  if (!map.box) return null;
  const [x0, , z0] = map.box.min;
  const [x1, top, z1] = map.box.max;
  const lid: [number, number, number][] = [
    [x0, top, z0],
    [x1, top, z0],
    [x1, top, z1],
    [x0, top, z1],
    [x0, top, z0],
  ];
  return (
    <group>
      {/* the floor so far */}
      <mesh rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, 0.005, (z0 + z1) / 2]}>
        <planeGeometry args={[x1 - x0, z1 - z0]} />
        <meshBasicMaterial color={mint} transparent opacity={0.1} depthWrite={false} />
      </mesh>
      {edges(map).map((e) => {
        const a: [number, number, number] = [e.a[0], 0.02, e.a[1]];
        const b: [number, number, number] = [e.b[0], 0.02, e.b[1]];
        if (!e.filmed) return <Line key={e.side} points={[a, b]} color={paper} lineWidth={3} dashed dashSize={0.22} gapSize={0.16} />;
        const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
        return (
          <group key={e.side}>
            <mesh position={[(e.a[0] + e.b[0]) / 2, WALL_M / 2, (e.a[1] + e.b[1]) / 2]} rotation-y={-Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0])}>
              <planeGeometry args={[len, WALL_M]} />
              <meshBasicMaterial color={mint} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            <Line points={[a, b]} color={mint} lineWidth={4} />
            <Line points={[[a[0], WALL_M, a[2]], [b[0], WALL_M, b[2]]]} color={mint} lineWidth={2} />
          </group>
        );
      })}
      {/* no ceiling yet: the lid of the box, dashed, on four dashed posts so it reads as above the room */}
      {ceilingGap && (
        <>
          <Line points={lid} color={paper} lineWidth={2} dashed dashSize={0.18} gapSize={0.18} transparent opacity={0.7} />
          {lid.slice(0, 4).map(([x, , z]) => (
            <Line key={`${x},${z}`} points={[[x, WALL_M, z], [x, top, z]]} color={paper} lineWidth={1.5} dashed dashSize={0.12} gapSize={0.12} transparent opacity={0.5} />
          ))}
        </>
      )}
    </group>
  );
}

// The trail: the last few places the camera stood, inside the room. The whole walk, drawn through a
// handful of frames, zigzags across everything.
const TRAIL_POINTS = 4;
function Walked({ map, paper }: { map: LiveMap; paper: string }) {
  const [x0, , z0] = map.box?.min ?? [-Infinity, 0, -Infinity];
  const [x1, , z1] = map.box?.max ?? [Infinity, 0, Infinity];
  const trail = map.path
    .slice(-TRAIL_POINTS)
    .filter((p) => p.x >= x0 - BOX_MARGIN_M && p.x <= x1 + BOX_MARGIN_M && p.z >= z0 - BOX_MARGIN_M && p.z <= z1 + BOX_MARGIN_M);
  if (trail.length < 2) return null;
  return <Line points={trail.map((p) => [p.x, 0.03, p.z] as [number, number, number])} color={paper} lineWidth={2} transparent opacity={0.45} />;
}

// The camera: a dot where it stood, and a cone the way it faces now (yaw: degrees clockwise from the
// top of the map). `scale`: metres per marker unit, so it reads the same on a small room or a big one.
function Camera({ x, z, yaw, scale, mint, ink }: { x: number; z: number; yaw: number; scale: number; mint: string; ink: string }) {
  const cone = useMemo(() => {
    const s = new THREE.Shape();
    const half = (CONE_DEG / 2) * (Math.PI / 180);
    s.moveTo(0, 0);
    s.lineTo(-Math.sin(half) * 6, Math.cos(half) * 6);
    s.absarc(0, 0, 6, Math.PI / 2 + half, Math.PI / 2 - half, true);
    s.lineTo(0, 0);
    return new THREE.ShapeGeometry(s, 16);
  }, []);
  useEffect(() => () => cone.dispose(), [cone]);
  return (
    <group position={[x, 0.06, z]} rotation-y={(-yaw * Math.PI) / 180} scale={scale}>
      {/* the shape is drawn pointing up the screen (−Z) once laid flat; drawn over everything, so the
          walls never hide it */}
      <mesh geometry={cone} rotation-x={-Math.PI / 2} renderOrder={1}>
        <meshBasicMaterial color={mint} transparent opacity={0.45} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} renderOrder={2}>
        <circleGeometry args={[1.15, 32]} />
        <meshBasicMaterial color={ink} depthTest={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} renderOrder={3}>
        <circleGeometry args={[0.8, 32]} />
        <meshBasicMaterial color={mint} depthTest={false} />
      </mesh>
    </group>
  );
}

// Frames the whole box from a fixed three-quarter view; eases to a new framing when the box grows.
function Rig({ map, turns }: { map: LiveMap; turns: number }) {
  const { camera, size, invalidate } = useThree();
  const goal = useMemo(() => {
    const b = bounds(map, turns);
    const aspect = size.width / Math.max(1, size.height);
    const half = (FOV_DEG / 2) * (Math.PI / 180);
    // Fit the box's size in the narrower of the two directions, with a margin.
    // Aimed at the middle of the box's height, so the floor and a dashed lid both fit.
    const top = map.box?.max[1] ?? 2.4;
    const fit = (Math.max(b.size, top * 1.6) * 0.64) / Math.tan(half) / Math.min(1, aspect);
    const e = VIEW_ELEV_DEG * (Math.PI / 180);
    const at = new THREE.Vector3(b.cx, top * 0.45, b.cz);
    return { at, from: new THREE.Vector3(b.cx, at.y + fit * Math.sin(e), b.cz + fit * Math.cos(e)) };
  }, [map, turns, size.width, size.height]);
  const look = useRef<THREE.Vector3 | null>(null);
  useFrame(() => {
    if (!look.current) {
      look.current = goal.at.clone();
      camera.position.copy(goal.from);
    }
    camera.position.lerp(goal.from, 0.12);
    look.current.lerp(goal.at, 0.12);
    camera.lookAt(look.current);
    if (camera.position.distanceTo(goal.from) > 0.01) invalidate();
  });
  useEffect(() => invalidate(), [goal, invalidate]);
  return null;
}

// The map itself. `turns`: clockwise quarter turns to show the rebuild in (map.ts quarterTurns);
// `yaw`: which way the camera faces now, on the map.
export function LiveMap3D({ preview, turns, yaw, ceilingGap }: { preview: Preview3d; turns: number; yaw: number | null; ceilingGap: boolean }) {
  const colours = useMemo(tokens, []);
  const map = preview.map!;
  const marker = Math.max(0.2, bounds(map, turns).size * 0.032);
  return (
    <Canvas className="map-canvas" frameloop="demand" dpr={[1, 2]} gl={{ alpha: true, antialias: true }} camera={{ fov: FOV_DEG, near: 0.05, far: 200 }}>
      <Rig map={map} turns={turns} />
      <group rotation-y={(-turns * Math.PI) / 2}>
        <Room map={map} ceilingGap={ceilingGap} mint={colours.mint} paper={colours.paper} />
        <MapCloud preview={preview} mint={colours.mint} paper={colours.paper} />
        <Walked map={map} paper={colours.paper} />
        {map.newest && <Camera x={map.newest.x} z={map.newest.z} yaw={yaw ?? map.newest.yaw} scale={marker} mint={colours.mint} ink={colours.ink} />}
      </group>
    </Canvas>
  );
}
