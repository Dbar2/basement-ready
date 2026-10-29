// "What it could look like", in 3D: the real room from the scan (its size, its windows, door and
// stairs where they are, its ceiling height) finished and furnished to the suggested layout.
// Built from simple shapes, like an architect's model: honest about being a proposal, light to load.
import { Html, OrbitControls, ContactShadows } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { Layout, LayoutZone, Plan, PlanSide } from "../api";

// Materials for the model. UI colours live in brand/tokens.css; these are the finishes in the room.
const MAT = {
  wall: "#F2F1EC",
  wallCut: "#E4E7E1",
  floor: "#C9A57B",
  tile: "#DADDD8",
  oak: "#B88B5A",
  linen: "#F7F5EF",
  fabric: "#C9C4BA",
  fabricDark: "#9C978C",
  mint: "#8FD9AE",
  ink: "#0F2A1E",
  counter: "#3B4A42",
  white: "#FBFBF8",
  glass: "#BFD9E6",
  steel: "#9AA19C",
} as const;

const T = 0.12; // wall thickness
const DOOR_H = 2.03;

function Box({ p, s, c, r = 0.85, cast = true }: { p: [number, number, number]; s: [number, number, number]; c: string; r?: number; cast?: boolean }) {
  return (
    <mesh position={p} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={r} />
    </mesh>
  );
}

// One wall of the room, with gaps for its doors and windows, cut low when it faces the camera.
function SideWall({ plan, side, h }: { plan: Plan; side: PlanSide; h: number }) {
  const b = plan.box;
  const alongX = side === "minZ" || side === "maxZ";
  const a0 = alongX ? b.minX : b.minZ;
  const a1 = alongX ? b.maxX : b.maxZ;
  const c = side === "minX" ? b.minX - T / 2 : side === "maxX" ? b.maxX + T / 2 : side === "minZ" ? b.minZ - T / 2 : b.maxZ + T / 2;
  const normal = useMemo(() => new THREE.Vector3(side === "minX" ? -1 : side === "maxX" ? 1 : 0, 0, side === "minZ" ? -1 : side === "maxZ" ? 1 : 0), [side]);
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const centre = useMemo(() => new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2), [b]);
  // A dollhouse: the walls between you and the room drop to a low edge so you can see in.
  useFrame(() => {
    if (!group.current) return;
    const toCam = camera.position.clone().sub(centre).setY(0).normalize();
    const facing = toCam.dot(normal) > 0.25 && camera.position.y > 2.8;
    const target = facing ? 0.32 : 1;
    group.current.scale.y += (target - group.current.scale.y) * 0.15;
  });

  // Pieces of wall between and around the openings, in "along" metres.
  const openings = plan.openings.filter((o) => o.side === side).map((o) => ({ ...o, from: a0 + o.atM - o.widthM / 2, to: a0 + o.atM + o.widthM / 2 })).sort((x, y) => x.from - y.from);
  const pieces: ReactNode[] = [];
  const piece = (from: number, to: number, y0: number, y1: number, key: string, color: string = MAT.wall) => {
    if (to - from < 0.01 || y1 - y0 < 0.01) return;
    const mid = (from + to) / 2, len = to - from, hy = (y0 + y1) / 2;
    pieces.push(<Box key={key} p={alongX ? [mid, hy, c] : [c, hy, mid]} s={alongX ? [len, y1 - y0, T] : [T, y1 - y0, len]} c={color} />);
  };
  let at = a0;
  openings.forEach((o, i) => {
    piece(at, o.from, 0, h, `w${i}`);
    if (o.kind === "door") piece(o.from, o.to, Math.min(DOOR_H, h), h, `d${i}`);
    else {
      // Basement windows sit high: wall below and a little above, glass between.
      const sill = Math.max(0.9, h - 0.75), top = Math.min(h, sill + 0.5);
      piece(o.from, o.to, 0, sill, `ws${i}`);
      piece(o.from, o.to, top, h, `wt${i}`);
      const mid = (o.from + o.to) / 2;
      pieces.push(
        <mesh key={`g${i}`} position={alongX ? [mid, (sill + top) / 2, c] : [c, (sill + top) / 2, mid]}>
          <boxGeometry args={alongX ? [o.to - o.from, top - sill, 0.02] : [0.02, top - sill, o.to - o.from]} />
          <meshStandardMaterial color={MAT.glass} roughness={0.1} metalness={0.1} transparent opacity={0.55} />
        </mesh>,
      );
    }
    at = o.to;
  });
  piece(at, a1, 0, h, "wend");
  return <group ref={group}>{pieces}</group>;
}

// A new partition wall, with a door gap where the layout puts one.
function Partition({ w, doors, h }: { w: Layout["walls"][number]; doors: Layout["doors"]; h: number }) {
  const alongX = Math.abs(w.x1 - w.x0) >= Math.abs(w.z1 - w.z0);
  const a0 = alongX ? Math.min(w.x0, w.x1) : Math.min(w.z0, w.z1);
  const a1 = alongX ? Math.max(w.x0, w.x1) : Math.max(w.z0, w.z1);
  const c = alongX ? w.z0 : w.x0;
  const door = doors.find((d) => (alongX ? Math.abs(d.z - c) < 0.05 && d.x > a0 && d.x < a1 : Math.abs(d.x - c) < 0.05 && d.z > a0 && d.z < a1));
  const segs: [number, number, number, number][] = door
    ? [
        [a0, (alongX ? door.x : door.z) - door.widthM / 2, 0, h],
        [(alongX ? door.x : door.z) - door.widthM / 2, (alongX ? door.x : door.z) + door.widthM / 2, DOOR_H, h],
        [(alongX ? door.x : door.z) + door.widthM / 2, a1, 0, h],
      ]
    : [[a0, a1, 0, h]];
  return (
    <>
      {segs.map(([f, t, y0, y1], i) =>
        t - f > 0.01 ? (
          <Box key={i} p={alongX ? [(f + t) / 2, (y0 + y1) / 2, c] : [c, (y0 + y1) / 2, (f + t) / 2]} s={alongX ? [t - f, y1 - y0, 0.1] : [0.1, y1 - y0, t - f]} c={MAT.wall} />
        ) : null,
      )}
    </>
  );
}

// Which edge of a zone is against the room's wall: furniture backs onto it.
function backOf(z: LayoutZone, box: Plan["box"], prefer: PlanSide | null) {
  const edges: { side: PlanSide; touch: boolean }[] = [
    { side: "maxZ", touch: Math.abs(z.z1 - box.maxZ) < 0.05 },
    { side: "minZ", touch: Math.abs(z.z0 - box.minZ) < 0.05 },
    { side: "maxX", touch: Math.abs(z.x1 - box.maxX) < 0.05 },
    { side: "minX", touch: Math.abs(z.x0 - box.minX) < 0.05 },
  ];
  return (prefer && edges.find((e) => e.side === prefer && e.touch)?.side) || edges.find((e) => e.touch)?.side || "maxZ";
}

// Place things in a zone's own frame: u along its back wall, v out into the zone from it.
function zoneFrame(z: LayoutZone, back: PlanSide) {
  const alongX = back === "minZ" || back === "maxZ";
  const uMin = alongX ? z.x0 : z.z0, uMax = alongX ? z.x1 : z.z1;
  const vStart = back === "maxZ" ? z.z1 : back === "minZ" ? z.z0 : back === "maxX" ? z.x1 : z.x0;
  const dir = back.startsWith("max") ? -1 : 1;
  const depth = alongX ? z.z1 - z.z0 : z.x1 - z.x0;
  const at = (u: number, v: number): [number, number] => (alongX ? [u, vStart + dir * v] : [vStart + dir * v, u]);
  const size = (su: number, sv: number): [number, number] => (alongX ? [su, sv] : [sv, su]);
  return { uMin, uMax, uMid: (uMin + uMax) / 2, len: uMax - uMin, depth, at, size };
}

function Furniture({ z, box, prefer }: { z: LayoutZone; box: Plan["box"]; prefer: PlanSide | null }) {
  const f = zoneFrame(z, backOf(z, box, prefer));
  const put = (u: number, v: number, su: number, sv: number, y0: number, h: number, c: string, key: string, r?: number) => {
    const [x, zz] = f.at(u, v);
    const [sx, sz] = f.size(su, sv);
    return <Box key={key} p={[x, y0 + h / 2, zz]} s={[sx, h, sz]} c={c} r={r} />;
  };
  const items: ReactNode[] = [];
  if (z.kind === "bedroom") {
    const u = f.uMid;
    items.push(put(u, 1.05, 1.6, 2.1, 0, 0.3, MAT.oak, "frame"));
    items.push(put(u, 1.05, 1.52, 2.0, 0.3, 0.22, MAT.linen, "mattress"));
    items.push(put(u, 1.35, 1.56, 1.35, 0.5, 0.06, MAT.mint, "duvet"));
    items.push(put(u - 0.38, 0.28, 0.6, 0.35, 0.52, 0.14, MAT.white, "pillowL"));
    items.push(put(u + 0.38, 0.28, 0.6, 0.35, 0.52, 0.14, MAT.white, "pillowR"));
    items.push(put(u, 0.04, 1.7, 0.08, 0, 1.1, MAT.oak, "headboard"));
    for (const s of [-1, 1]) {
      items.push(put(u + s * 1.1, 0.25, 0.45, 0.45, 0, 0.5, MAT.oak, `night${s}`));
      items.push(put(u + s * 1.1, 0.25, 0.18, 0.18, 0.5, 0.35, MAT.linen, `lamp${s}`));
    }
    if (f.depth > 3) items.push(put(u, 2.6, 1.9, 1.3, 0, 0.012, MAT.fabric, "rug"));
  } else if (z.kind === "bathroom") {
    items.push(put(f.uMin + 0.8, 0.4, 1.5, 0.75, 0, 0.55, MAT.white, "tub"));
    items.push(put(f.uMin + 1.85, 0.25, 0.38, 0.5, 0, 0.42, MAT.white, "toilet"));
    if (f.len > 2.3) items.push(put(f.uMax - 0.35, 0.25, 0.6, 0.45, 0, 0.85, MAT.oak, "vanity"));
  } else if (z.kind === "kitchen") {
    const len = Math.max(1.2, f.len - 0.8);
    items.push(put(f.uMin + len / 2, 0.31, len, 0.62, 0, 0.88, MAT.white, "base"));
    items.push(put(f.uMin + len / 2, 0.32, len + 0.02, 0.64, 0.88, 0.04, MAT.counter, "top", 0.4));
    items.push(put(f.uMin + len / 2, 0.18, len, 0.35, 1.45, 0.7, MAT.white, "uppers"));
    items.push(put(f.uMin + len * 0.3, 0.32, 0.55, 0.42, 0.921, 0.005, MAT.steel, "sink", 0.3));
    items.push(put(f.uMin + len * 0.72, 0.32, 0.6, 0.5, 0.921, 0.005, MAT.ink, "cooktop", 0.3));
    items.push(put(f.uMax - 0.4, 0.36, 0.72, 0.7, 0, 1.8, MAT.steel, "fridge", 0.35));
  } else if (z.kind === "living") {
    // Sofa and rug in one half, a table for four nearer the kitchen.
    const sofaV = Math.min(1.2, f.depth * 0.3);
    items.push(put(f.uMid - f.len * 0.18, sofaV + 1.1, 2.6, 1.8, 0, 0.012, MAT.fabric, "rug"));
    items.push(put(f.uMid - f.len * 0.18, sofaV, 2.1, 0.9, 0, 0.42, MAT.fabricDark, "sofa"));
    items.push(put(f.uMid - f.len * 0.18, sofaV - 0.35, 2.1, 0.2, 0.42, 0.42, MAT.fabricDark, "sofaBack"));
    items.push(put(f.uMid - f.len * 0.18, sofaV + 1.15, 1.0, 0.55, 0, 0.4, MAT.oak, "coffee"));
    if (f.depth > 3.2) {
      const tv = Math.max(sofaV + 2.2, f.depth - 1.3);
      items.push(put(f.uMid + f.len * 0.2, tv, 1.3, 0.85, 0, 0.74, MAT.oak, "table"));
      for (const [du, dv] of [[-0.4, -0.65], [0.4, -0.65], [-0.4, 0.65], [0.4, 0.65]]) {
        items.push(put(f.uMid + f.len * 0.2 + du, tv + dv, 0.42, 0.42, 0, 0.45, MAT.linen, `chair${du}${dv}`));
      }
    }
  } else if (z.kind === "stairs") {
    const steps = 12;
    const long = Math.max(z.x1 - z.x0, z.z1 - z.z0);
    const alongX = z.x1 - z.x0 >= z.z1 - z.z0;
    for (let i = 0; i < steps; i++) {
      const h = (i + 1) * 0.19;
      const t = (i + 0.5) / steps;
      const p: [number, number, number] = alongX ? [z.x0 + t * long, h / 2, (z.z0 + z.z1) / 2] : [(z.x0 + z.x1) / 2, h / 2, z.z0 + t * long];
      const s: [number, number, number] = alongX ? [long / steps, h, Math.min(1, z.z1 - z.z0)] : [Math.min(1, z.x1 - z.x0), h, long / steps];
      items.push(<Box key={`s${i}`} p={p} s={s} c={MAT.oak} />);
    }
  } else if (z.kind === "mechanical") {
    items.push(<Box key="furnace" p={[(z.x0 + z.x1) / 2, 0.6, (z.z0 + z.z1) / 2]} s={[0.6, 1.2, 0.7]} c={MAT.steel} />);
  }
  return <>{items}</>;
}

function Zone({ z, showLabels }: { z: LayoutZone; showLabels: boolean }) {
  const cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2;
  const floor = z.kind === "bathroom" ? MAT.tile : z.kind === "mechanical" ? MAT.wallCut : null;
  return (
    <>
      {floor && (
        <mesh position={[cx, 0.004, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[z.x1 - z.x0, z.z1 - z.z0]} />
          <meshStandardMaterial color={floor} roughness={0.6} />
        </mesh>
      )}
      {showLabels && z.kind !== "stairs" && (
        <Html position={[cx, 0.15, cz]} center zIndexRange={[10, 0]}>
          <span className="stage-tag">
            <b>{z.name}</b> {z.areaM2 >= 2 && <span>{z.areaM2.toFixed(1)} m²</span>}
          </span>
        </Html>
      )}
    </>
  );
}

type View = "dollhouse" | "top" | "inside";

function Rig({ plan, layout, view }: { plan: Plan; layout: Layout; view: View }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const b = plan.box;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const r = Math.max(plan.widthM, plan.depthM);
  const goal = useMemo(() => {
    if (view === "top") return { pos: new THREE.Vector3(cx, r * 1.55, cz + 0.01), look: new THREE.Vector3(cx, 0, cz) };
    if (view === "inside") {
      // Standing in the corner of the living space farthest from the bedroom, looking across the suite.
      const living = layout.zones.find((z) => z.kind === "living");
      const bed = layout.zones.find((z) => z.kind === "bedroom");
      const bx = bed ? (bed.x0 + bed.x1) / 2 : cx, bz = bed ? (bed.z0 + bed.z1) / 2 : cz;
      const zone = living ?? { x0: b.minX, x1: b.maxX, z0: b.minZ, z1: b.maxZ };
      const corners = [
        [zone.x0 + 0.6, zone.z0 + 0.6],
        [zone.x1 - 0.6, zone.z0 + 0.6],
        [zone.x0 + 0.6, zone.z1 - 0.6],
        [zone.x1 - 0.6, zone.z1 - 0.6],
      ].sort((p, q) => Math.hypot(q[0] - bx, q[1] - bz) - Math.hypot(p[0] - bx, p[1] - bz));
      return { pos: new THREE.Vector3(corners[0][0], 1.6, corners[0][1]), look: new THREE.Vector3(cx, 1.0, cz) };
    }
    return { pos: new THREE.Vector3(cx + r * 0.62, r * 0.85, cz + r * 0.78), look: new THREE.Vector3(cx, 0.6, cz) };
  }, [view, cx, cz, r, layout]);
  const moving = useRef(0);
  useEffect(() => {
    moving.current = 60;
  }, [goal]);
  useFrame(() => {
    if (moving.current <= 0) return;
    moving.current--;
    camera.position.lerp(goal.pos, 0.12);
    if (controls) {
      controls.target.lerp(goal.look, 0.12);
      controls.update();
    } else camera.lookAt(goal.look);
  });
  return null;
}

export function StagedBasement({ plan, layout }: { plan: Plan; layout: Layout }) {
  const [view, setView] = useState<View>("dollhouse");
  const [labels, setLabels] = useState(true);
  const h = Math.min(2.6, Math.max(2.0, plan.ceilingHeightM ?? 2.3));
  const b = plan.box;
  const prefer = layout.window?.side ?? null;
  const sides: PlanSide[] = ["minX", "maxX", "minZ", "maxZ"];
  return (
    <div className="stage">
      <Canvas shadows camera={{ fov: 42, near: 0.05, far: 200, position: [b.maxX + 6, 7, b.maxZ + 7] }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={[getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim() || "#E6EBE4"]} />
        <hemisphereLight args={["#ffffff", "#e6dfd2", 1.25]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[b.maxX + 4, 9, b.maxZ + 3]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
        <mesh position={[(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
          <meshStandardMaterial color={MAT.floor} roughness={0.7} />
        </mesh>
        {sides.map((s) => (
          <SideWall key={s} plan={plan} side={s} h={h} />
        ))}
        {layout.walls.map((w, i) => (
          <Partition key={i} w={w} doors={layout.doors} h={h} />
        ))}
        {layout.zones.map((z, i) => (
          <group key={`${z.kind}${i}`}>
            <Zone z={z} showLabels={labels} />
            <Furniture z={z} box={b} prefer={z.kind === "bedroom" ? prefer : null} />
          </group>
        ))}
        <ContactShadows position={[(b.minX + b.maxX) / 2, 0.002, (b.minZ + b.maxZ) / 2]} scale={Math.max(plan.widthM, plan.depthM) * 1.4} opacity={0.35} blur={2.4} far={2.5} />
        <OrbitControls makeDefault enablePan target={[(b.minX + b.maxX) / 2, 0.6, (b.minZ + b.maxZ) / 2]} minDistance={0.5} maxDistance={40} maxPolarAngle={Math.PI * 0.49} />
        <Rig plan={plan} layout={layout} view={view} />
      </Canvas>
      <div className="stage-tools">
        <div className="segmented small" role="group" aria-label="View">
          {(["dollhouse", "top", "inside"] as View[]).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "dollhouse" ? "Dollhouse" : v === "top" ? "From above" : "Inside"}
            </button>
          ))}
        </div>
        <button className="link-quiet" onClick={() => setLabels((l) => !l)}>
          {labels ? "Hide labels" : "Show labels"}
        </button>
      </div>
      <p className="stage-note mono">A starting layout in your real room · drag to look around</p>
    </div>
  );
}
