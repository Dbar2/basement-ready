// "What it could look like", in 3D: the real room from the scan (its size, its windows, door and
// stairs where they are, its ceiling height) finished and furnished to the suggested layout.
// Furniture is real where a good modern piece exists (CC0 models from Poly Haven, see
// public/staging/CREDITS.txt) and modelled here for the rest; every surface has a real finish.
import { Clone, Environment, Html, Lightformer, OrbitControls, RoundedBox, useGLTF, useProgress, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, N8AO } from "@react-three/postprocessing";
import { createContext, Suspense, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { Layout, LayoutZone, Plan, PlanSide } from "../api";

const T = 0.12; // wall thickness
const DOOR_H = 2.03;
const MODEL = (id: string) => `/staging/models/${id}.glb`;
const TEX = (id: string) => `/staging/textures/${id}.webp`;
const MODELS = [
  "mid_century_lounge_chair",
  "modern_arm_chair_01",
  "modern_coffee_table_01",
  "modern_wooden_cabinet",
  "side_table_01",
  "modern_ceiling_lamp_01",
  "ceramic_vase_02",
  "ceramic_vase_04",
  "hanging_picture_frame_01",
  "standing_picture_frame_02",
] as const;
for (const id of MODELS) useGLTF.preload(MODEL(id));

// Finishes for the room. UI colours live in brand/tokens.css; these are paint, fabric and wood.
type Finish = {
  label: string;
  floor: "laminate_floor_02" | "wood_floor";
  wall: string;
  sofa: string;
  bedding: string;
  throw: string;
  cabinet: string | "oak";
  rug: string;
  swatch: [string, string];
};
const FINISHES: Record<"light" | "warm" | "deep", Finish> = {
  light: {
    label: "Light oak",
    floor: "laminate_floor_02",
    wall: "#F3F1EA",
    sofa: "#B4B9AB",
    bedding: "#EFEDE7",
    throw: "#8EA38C",
    cabinet: "#ECE9E2",
    rug: "#DDD6C9",
    swatch: ["#D9BE98", "#B4B9AB"],
  },
  warm: {
    label: "Warm wood",
    floor: "wood_floor",
    wall: "#EEE8DD",
    sofa: "#BDB29F",
    bedding: "#F4F0E8",
    throw: "#6E7D69",
    cabinet: "oak",
    rug: "#CEC3B1",
    swatch: ["#A87A4F", "#BDB29F"],
  },
  deep: {
    label: "Deep green",
    floor: "wood_floor",
    wall: "#E6E4DD",
    sofa: "#5D6A5B",
    bedding: "#ECE9E2",
    throw: "#2F3E34",
    cabinet: "#34473C",
    rug: "#BEB8AB",
    swatch: ["#34473C", "#A87A4F"],
  },
};
type FinishKey = keyof typeof FINISHES;

// How far each room wall is standing (1 = full height), so things hung on it can go when it's cut.
const CutCtx = createContext<{ current: Partial<Record<PlanSide, number>> } | null>(null);

type Mats = ReturnType<typeof makeMats>;
const MatsCtx = createContext<Mats | null>(null);
const useMats = () => useContext(MatsCtx)!;

function useMaps() {
  const t = useTexture({
    lightFloor: TEX("laminate_floor_02_diff"),
    lightFloorN: TEX("laminate_floor_02_nor"),
    lightFloorR: TEX("laminate_floor_02_rough"),
    warmFloor: TEX("wood_floor_diff"),
    warmFloorN: TEX("wood_floor_nor"),
    warmFloorR: TEX("wood_floor_rough"),
    oak: TEX("white_oak_veneer_diff"),
    oakR: TEX("white_oak_veneer_rough"),
    tile: TEX("long_white_tiles_diff"),
    tileN: TEX("long_white_tiles_nor"),
    tileR: TEX("long_white_tiles_rough"),
    linen: TEX("rough_linen_nor"),
    boucle: TEX("wool_boucle_nor"),
  });
  useMemo(() => {
    for (const [k, tex] of Object.entries(t)) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      if (k === "lightFloor" || k === "warmFloor" || k === "oak" || k === "tile") tex.colorSpace = THREE.SRGBColorSpace;
    }
    t.linen.repeat.set(4, 4);
    t.boucle.repeat.set(5, 5);
  }, [t]);
  return t;
}

function makeMats(f: Finish, t: ReturnType<typeof useMaps>) {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const fabric = (color: string, weave = t.linen) => std({ color, roughness: 0.95, normalMap: weave, normalScale: new THREE.Vector2(0.7, 0.7) });
  const oak = std({ map: t.oak, roughnessMap: t.oakR, roughness: 0.9, color: "#F4EEE6" });
  const wall = std({ color: f.wall, roughness: 0.95 });
  const cap = std({ color: "#33413A", roughness: 0.9 });
  return {
    wall,
    // Box faces are +x, -x, +y, -y, +z, -z: only the top is dark.
    walls: [wall, wall, cap, wall, wall, wall],
    wallCut: std({ color: "#DCDDD6", roughness: 0.95 }),
    ceiling: std({ color: "#F7F6F2", roughness: 1, side: THREE.FrontSide }),
    oak,
    sofa: fabric(f.sofa),
    bedding: fabric(f.bedding),
    sheet: fabric("#F8F7F3"),
    throw: fabric(f.throw, t.boucle),
    rug: fabric(f.rug, t.boucle),
    cabinet: f.cabinet === "oak" ? oak : std({ color: f.cabinet, roughness: 0.55 }),
    quartz: std({ color: "#EEEEEA", roughness: 0.22 }),
    ceramic: new THREE.MeshPhysicalMaterial({ color: "#F8F8F5", roughness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    black: std({ color: "#1C2220", roughness: 0.45, metalness: 0.5 }),
    steel: std({ color: "#D3D6D4", roughness: 0.22, metalness: 1 }),
    glassTop: std({ color: "#0C100F", roughness: 0.06, metalness: 0.2 }),
    mirror: std({ color: "#DCE4E5", roughness: 0.08, metalness: 0.6 }),
    window: new THREE.MeshPhysicalMaterial({ color: "#CFE3EC", roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.6 }),
    glow: std({ color: "#FFF6E6", emissive: "#FFE9C7", emissiveIntensity: 2.2 }),
    shade: std({ color: "#F6F1E7", emissive: "#FFE2B5", emissiveIntensity: 0.55, roughness: 1 }),
    service: std({ color: "#AEB4AF", roughness: 0.6, metalness: 0.3 }),
    tile: (rx: number, ry: number) => {
      const m = (x: THREE.Texture) => {
        const c = x.clone();
        c.repeat.set(rx, ry);
        c.needsUpdate = true;
        return c;
      };
      return std({ map: m(t.tile), normalMap: m(t.tileN), roughnessMap: m(t.tileR), roughness: 0.6 });
    },
  };
}

// ---------- building blocks ----------

type V3 = [number, number, number];
function B({ p, s, m, r = 0.006, rot }: { p: V3; s: V3; m: THREE.Material; r?: number; rot?: V3 }) {
  return (
    <RoundedBox
      args={s}
      radius={Math.min(r, ...s.map((x) => x / 2 - 0.0005))}
      smoothness={r > 0.02 ? 4 : 2}
      position={p}
      rotation={rot}
      material={m}
      castShadow
      receiveShadow
    />
  );
}

function Model({ id, p, yaw = 0, s = 1 }: { id: (typeof MODELS)[number]; p: V3; yaw?: number; s?: number }) {
  const { scene } = useGLTF(MODEL(id));
  return <Clone object={scene} position={p} rotation={[0, yaw, 0]} scale={s} castShadow receiveShadow />;
}

// ---------- the room shell ----------

// One wall of the room, with gaps for its doors and windows, cut low when it faces the camera.
function SideWall({ plan, side, h }: { plan: Plan; side: PlanSide; h: number }) {
  const mats = useMats();
  const b = plan.box;
  const alongX = side === "minZ" || side === "maxZ";
  const a0 = alongX ? b.minX : b.minZ;
  const a1 = alongX ? b.maxX : b.maxZ;
  const c = side === "minX" ? b.minX - T / 2 : side === "maxX" ? b.maxX + T / 2 : side === "minZ" ? b.minZ - T / 2 : b.maxZ + T / 2;
  const normal = useMemo(() => new THREE.Vector3(side === "minX" ? -1 : side === "maxX" ? 1 : 0, 0, side === "minZ" ? -1 : side === "maxZ" ? 1 : 0), [side]);
  const group = useRef<THREE.Group>(null);
  const cut = useContext(CutCtx);
  const { camera } = useThree();
  const centre = useMemo(() => new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2), [b]);
  // A dollhouse: the walls between you and the room drop to a low edge so you can see in.
  useFrame((_, dt) => {
    if (!group.current) return;
    const toCam = camera.position.clone().sub(centre).setY(0).normalize();
    const facing = toCam.dot(normal) > 0.25 && camera.position.y > 2.8;
    const target = facing ? 0.32 : 1;
    const k = 1 - Math.exp(-Math.min(dt, 0.25) * 10);
    group.current.scale.y += (target - group.current.scale.y) * k;
    if (Math.abs(target - group.current.scale.y) < 0.002) group.current.scale.y = target;
    if (cut) cut.current[side] = group.current.scale.y;
  });

  const openings = plan.openings
    .filter((o) => o.side === side)
    .map((o) => ({ ...o, from: a0 + o.atM - o.widthM / 2, to: a0 + o.atM + o.widthM / 2 }))
    .sort((x, y) => x.from - y.from);
  const pieces: ReactNode[] = [];
  const piece = (from: number, to: number, y0: number, y1: number, key: string) => {
    if (to - from < 0.01 || y1 - y0 < 0.01) return;
    const mid = (from + to) / 2,
      len = to - from,
      hy = (y0 + y1) / 2;
    pieces.push(
      <mesh key={key} position={alongX ? [mid, hy, c] : [c, hy, mid]} material={mats.walls} castShadow receiveShadow>
        <boxGeometry args={alongX ? [len, y1 - y0, T] : [T, y1 - y0, len]} />
      </mesh>,
    );
  };
  let at = a0;
  openings.forEach((o, i) => {
    piece(at, o.from, 0, h, `w${i}`);
    if (o.kind === "door") piece(o.from, o.to, Math.min(DOOR_H, h), h, `d${i}`);
    else {
      // Basement windows sit high: wall below and a little above, glass between.
      const sill = Math.max(0.9, h - 0.75),
        top = Math.min(h, sill + 0.5);
      piece(o.from, o.to, 0, sill, `ws${i}`);
      piece(o.from, o.to, top, h, `wt${i}`);
      const mid = (o.from + o.to) / 2;
      pieces.push(
        <mesh key={`g${i}`} position={alongX ? [mid, (sill + top) / 2, c] : [c, (sill + top) / 2, mid]} material={mats.window}>
          <boxGeometry args={alongX ? [o.to - o.from, top - sill, 0.02] : [0.02, top - sill, o.to - o.from]} />
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
  const mats = useMats();
  const alongX = Math.abs(w.x1 - w.x0) >= Math.abs(w.z1 - w.z0);
  const a0 = alongX ? Math.min(w.x0, w.x1) : Math.min(w.z0, w.z1);
  const a1 = alongX ? Math.max(w.x0, w.x1) : Math.max(w.z0, w.z1);
  const c = alongX ? w.z0 : w.x0;
  const door = doors.find((d) => (alongX ? Math.abs(d.z - c) < 0.05 && d.x > a0 && d.x < a1 : Math.abs(d.x - c) < 0.05 && d.z > a0 && d.z < a1));
  const at = door ? (alongX ? door.x : door.z) : 0;
  const segs: [number, number, number, number][] = door
    ? [
        [a0, at - door.widthM / 2, 0, h],
        [at - door.widthM / 2, at + door.widthM / 2, DOOR_H, h],
        [at + door.widthM / 2, a1, 0, h],
      ]
    : [[a0, a1, 0, h]];
  return (
    <>
      {segs.map(([f, t, y0, y1], i) =>
        t - f > 0.01 ? (
          <mesh key={i} position={alongX ? [(f + t) / 2, (y0 + y1) / 2, c] : [c, (y0 + y1) / 2, (f + t) / 2]} material={mats.walls} castShadow receiveShadow>
            <boxGeometry args={alongX ? [t - f, y1 - y0, 0.1] : [0.1, y1 - y0, t - f]} />
          </mesh>
        ) : null,
      )}
    </>
  );
}

function Floor({ plan, finish }: { plan: Plan; finish: Finish }) {
  const t = useMaps();
  const b = plan.box;
  const w = b.maxX - b.minX,
    d = b.maxZ - b.minZ;
  const mat = useMemo(() => {
    const light = finish.floor === "laminate_floor_02";
    const set = (x: THREE.Texture) => {
      const c = x.clone();
      // Planks run along the long side of the room; one texture covers about 1.8 m.
      c.rotation = w >= d ? 0 : Math.PI / 2;
      c.repeat.set(w / 1.8, d / 1.8);
      c.needsUpdate = true;
      return c;
    };
    return new THREE.MeshStandardMaterial({
      map: set(light ? t.lightFloor : t.warmFloor),
      normalMap: set(light ? t.lightFloorN : t.warmFloorN),
      roughnessMap: set(light ? t.lightFloorR : t.warmFloorR),
      roughness: 0.8,
    });
  }, [finish.floor, t, w, d]);
  return (
    <mesh position={[(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

// Seen only from inside (a plane facing down is invisible from above): ceiling and pot lights.
function Ceiling({ plan, h }: { plan: Plan; h: number }) {
  const mats = useMats();
  const b = plan.box;
  const lights: V3[] = [];
  for (let x = b.minX + 1; x < b.maxX - 0.5; x += 1.7) for (let z = b.minZ + 1; z < b.maxZ - 0.5; z += 1.7) lights.push([x, h - 0.002, z]);
  return (
    <>
      <mesh position={[(b.minX + b.maxX) / 2, h, (b.minZ + b.maxZ) / 2]} rotation={[Math.PI / 2, 0, 0]} material={mats.ceiling}>
        <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
      </mesh>
      {lights.map((p, i) => (
        <mesh key={i} position={p} rotation={[Math.PI / 2, 0, 0]} material={mats.glow}>
          <circleGeometry args={[0.06, 24]} />
        </mesh>
      ))}
    </>
  );
}

// ---------- placing things in a zone ----------

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

// Facing away from the back wall, for something whose front is +Z.
const YAW: Record<PlanSide, number> = { minZ: 0, maxZ: Math.PI, minX: Math.PI / 2, maxX: -Math.PI / 2 };

// A zone's own frame: u along its back wall, v out into the zone from it.
function zoneFrame(z: LayoutZone, back: PlanSide) {
  const alongX = back === "minZ" || back === "maxZ";
  const uMin = alongX ? z.x0 : z.z0,
    uMax = alongX ? z.x1 : z.z1;
  const vStart = back === "maxZ" ? z.z1 : back === "minZ" ? z.z0 : back === "maxX" ? z.x1 : z.x0;
  const dir = back.startsWith("max") ? -1 : 1;
  const depth = alongX ? z.z1 - z.z0 : z.x1 - z.x0;
  const at = (u: number, v: number): [number, number] => (alongX ? [u, vStart + dir * v] : [vStart + dir * v, u]);
  const p = (u: number, v: number, y = 0): V3 => {
    const [x, zz] = at(u, v);
    return [x, y, zz];
  };
  // The yaw that turns a +Z front from (u, v) towards (u2, v2).
  const face = (u: number, v: number, u2: number, v2: number) => {
    const [x, zz] = at(u, v),
      [x2, z2] = at(u2, v2);
    return Math.atan2(x2 - x, z2 - zz);
  };
  // A footprint in plan coordinates, for clash checks.
  const rect = (u0: number, u1: number, v0: number, v1: number) => {
    const [ax, az] = at(u0, v0),
      [bx, bz] = at(u1, v1);
    return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) };
  };
  return { uMin, uMax, uMid: (uMin + uMax) / 2, len: uMax - uMin, depth, at, p, face, rect, yaw: YAW[back], back };
}
type Frame = ReturnType<typeof zoneFrame>;
type Rect = { x0: number; x1: number; z0: number; z1: number };
const clash = (a: Rect, b: Rect) => a.x0 < b.x1 - 0.02 && a.x1 > b.x0 + 0.02 && a.z0 < b.z1 - 0.02 && a.z1 > b.z0 + 0.02;

// Where the living space's lounge and dining go: a lounge at one end (sofa, rug, chairs round a
// coffee table), dining as far from it as it fits, nudged across the band if the stairs are in the way.
function arrangeLiving(z: LayoutZone, layout: Layout, box: Plan["box"]) {
  const f = zoneFrame(z, backOf(z, box, null));
  const blocked = layout.zones.filter((o) => o !== z && o.kind !== "living").map((o) => ({ x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1 }));
  const clear = (r: Rect) => !blocked.some((b) => clash(r, b));
  const half = Math.min(1.3, f.len / 2);
  const lounge = (v0: number) => f.rect(f.uMid - half, f.uMid + half, v0, v0 + 3.0);
  let lv = 0;
  while (lv < f.depth - 3 && !clear(lounge(lv))) lv += 0.2;
  const dining = (u: number, v: number) => f.rect(u - 0.92, u + 0.92, v - 0.9, v + 0.9);
  const inBand = (u: number) => u - 0.92 >= f.uMin - 0.05 && u + 0.92 <= f.uMax + 0.05;
  let spot: { u: number; v: number } | null = null;
  for (let v = f.depth - 1.75; v >= lv + 3.5 && !spot; v -= 0.2) {
    for (const du of [0, 0.25, -0.25, 0.45, -0.45]) {
      if (inBand(f.uMid + du) && clear(dining(f.uMid + du, v))) {
        spot = { u: f.uMid + du, v };
        break;
      }
    }
  }
  const sideboard = spot !== null && f.len >= 2.0 && spot.v + 1.75 >= f.depth - 0.05 && clear(f.rect(f.uMid - 0.9, f.uMid + 0.9, f.depth - 0.45, f.depth));
  // Footprints of what stands on the floor, for keeping the camera out of the furniture.
  const taken = [lounge(lv), ...(spot ? [dining(spot.u, spot.v)] : []), ...(sideboard ? [f.rect(f.uMid - 0.9, f.uMid + 0.9, f.depth - 0.45, f.depth)] : [])];
  return { f, lv, wide: f.len >= 3.6, spot, sideboard, taken };
}

// Shelves, tiles, art: hung on a room wall, so hidden while the dollhouse has that wall cut down.
function OnWall({ side, children }: { side: PlanSide; children: ReactNode }) {
  const cut = useContext(CutCtx);
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (g.current) g.current.visible = (cut?.current[side] ?? 1) > 0.9;
  });
  return <group ref={g}>{children}</group>;
}

// Something placed at (u, v), turned by yaw; children are built front +Z around the origin.
function At({ f, u, v, yaw, y = 0, children }: { f: Frame; u: number; v: number; yaw?: number; y?: number; children: ReactNode }) {
  return (
    <group position={f.p(u, v, y)} rotation={[0, yaw ?? f.yaw, 0]}>
      {children}
    </group>
  );
}

// ---------- furniture modelled here ----------

function Bed() {
  const m = useMats();
  return (
    <>
      <B p={[0, 0.15, 0]} s={[1.66, 0.26, 2.12]} m={m.oak} r={0.02} />
      <B p={[0, 0.62, -1.03]} s={[1.72, 1.0, 0.1]} m={m.sofa} r={0.04} />
      <B p={[0, 0.39, 0.02]} s={[1.52, 0.22, 2.0]} m={m.sheet} r={0.07} />
      <B p={[0, 0.52, 0.32]} s={[1.6, 0.07, 1.42]} m={m.bedding} r={0.03} />
      <B p={[0, 0.57, 0.74]} s={[1.64, 0.08, 0.42]} m={m.throw} r={0.035} />
      {[-0.37, 0.37].map((x) => (
        <B key={x} p={[x, 0.57, -0.74]} s={[0.64, 0.15, 0.4]} m={m.sheet} r={0.07} rot={[-0.25, 0, 0]} />
      ))}
      <B p={[0.18, 0.6, -0.5]} s={[0.44, 0.3, 0.12]} m={m.throw} r={0.05} rot={[-0.35, 0, 0.06]} />
    </>
  );
}

function BedsideLamp() {
  const m = useMats();
  return (
    <>
      <mesh position={[0, 0.1, 0]} material={m.ceramic} castShadow>
        <sphereGeometry args={[0.09, 24, 16]} />
      </mesh>
      <mesh position={[0, 0.3, 0]} material={m.shade} castShadow>
        <cylinderGeometry args={[0.1, 0.13, 0.18, 32, 1, true]} />
      </mesh>
    </>
  );
}

function Sofa() {
  const m = useMats();
  return (
    <>
      <B p={[0, 0.2, 0]} s={[2.2, 0.22, 0.95]} m={m.sofa} r={0.04} />
      <B p={[0, 0.47, -0.39]} s={[2.2, 0.5, 0.17]} m={m.sofa} r={0.06} />
      {[-1.02, 1.02].map((x) => (
        <B key={x} p={[x, 0.37, 0]} s={[0.16, 0.5, 0.95]} m={m.sofa} r={0.06} />
      ))}
      {[-0.47, 0.47].map((x) => (
        <group key={x}>
          <B p={[x, 0.39, 0.07]} s={[0.92, 0.17, 0.74]} m={m.sofa} r={0.07} />
          <B p={[x, 0.66, -0.25]} s={[0.92, 0.42, 0.2]} m={m.sofa} r={0.09} rot={[-0.14, 0, 0]} />
        </group>
      ))}
      <B p={[-0.72, 0.65, -0.1]} s={[0.44, 0.42, 0.13]} m={m.throw} r={0.06} rot={[-0.2, 0.15, 0.06]} />
      <B p={[0.74, 0.64, -0.1]} s={[0.4, 0.38, 0.13]} m={m.bedding} r={0.06} rot={[-0.2, -0.12, -0.05]} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 1.0, 0.045, sz * 0.38]} material={m.black} castShadow>
            <cylinderGeometry args={[0.02, 0.015, 0.09, 12]} />
          </mesh>
        )),
      )}
    </>
  );
}

function DiningTable({ w, d }: { w: number; d: number }) {
  const m = useMats();
  return (
    <>
      <B p={[0, 0.735, 0]} s={[w, 0.035, d]} m={m.oak} r={0.012} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * (w / 2 - 0.1), 0.36, sz * (d / 2 - 0.1)]} rotation={[sz * 0.03, 0, -sx * 0.03]} material={m.oak} castShadow>
            <cylinderGeometry args={[0.025, 0.018, 0.72, 16]} />
          </mesh>
        )),
      )}
    </>
  );
}

function DiningChair() {
  const m = useMats();
  return (
    <>
      <B p={[0, 0.45, 0]} s={[0.44, 0.06, 0.42]} m={m.sofa} r={0.025} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 0.18, 0.21, sz * 0.17]} material={m.oak} castShadow>
            <cylinderGeometry args={[0.016, 0.014, 0.42, 10]} />
          </mesh>
        )),
      )}
      {[-0.18, 0.18].map((x) => (
        <mesh key={x} position={[x, 0.62, -0.19]} rotation={[-0.08, 0, 0]} material={m.oak} castShadow>
          <cylinderGeometry args={[0.014, 0.014, 0.34, 10]} />
        </mesh>
      ))}
      <B p={[0, 0.76, -0.2]} s={[0.42, 0.08, 0.025]} m={m.oak} r={0.01} rot={[-0.08, 0, 0]} />
    </>
  );
}

function Kitchen({ len, wall }: { len: number; wall: PlanSide }) {
  const m = useMats();
  const fridge = 0.75;
  const run = Math.max(1.2, len - fridge);
  const n = Math.max(2, Math.round(run / 0.6));
  const unit = run / n;
  const x0 = -len / 2;
  const tiles = useMemo(() => m.tile(run / 0.6, 0.7 / 0.6), [m, run]);
  const sinkAt = x0 + unit * 1,
    cookAt = x0 + unit * (n - 1.5);
  return (
    <>
      {/* base units, toe kick, fronts with slim black pulls */}
      <B p={[x0 + run / 2, 0.05, 0.27]} s={[run, 0.1, 0.5]} m={m.black} r={0.003} />
      {Array.from({ length: n }, (_, i) => (
        <group key={i}>
          <B p={[x0 + unit * (i + 0.5), 0.49, 0.3]} s={[unit - 0.006, 0.76, 0.6]} m={m.cabinet} r={0.006} />
          <B p={[x0 + unit * (i + 0.5), 0.84, 0.61]} s={[unit * 0.5, 0.015, 0.02]} m={m.black} r={0.005} />
        </group>
      ))}
      <B p={[x0 + run / 2, 0.9, 0.31]} s={[run + 0.02, 0.04, 0.64]} m={m.quartz} r={0.006} />
      {/* sink with a tall tap, induction hob */}
      <B p={[sinkAt, 0.905, 0.32]} s={[0.5, 0.035, 0.4]} m={m.steel} r={0.01} />
      <mesh position={[sinkAt, 1.08, 0.08]} material={m.black} castShadow>
        <cylinderGeometry args={[0.012, 0.014, 0.34, 12]} />
      </mesh>
      <mesh position={[sinkAt, 1.24, 0.15]} rotation={[Math.PI / 2, 0, 0]} material={m.black}>
        <torusGeometry args={[0.07, 0.011, 8, 16, Math.PI]} />
      </mesh>
      <B p={[cookAt, 0.924, 0.32]} s={[0.6, 0.008, 0.5]} m={m.glassTop} r={0.003} />
      {/* tiled backsplash, two open oak shelves with a few things on them, a light strip */}
      <OnWall side={wall}>
        <mesh position={[x0 + run / 2, 0.92 + 0.35, 0.006]} material={tiles} receiveShadow>
          <planeGeometry args={[run, 0.7]} />
        </mesh>
        {[1.5, 1.88].map((y) => (
          <B key={y} p={[x0 + run / 2, y, 0.14]} s={[run - 0.1, 0.035, 0.26]} m={m.oak} r={0.006} />
        ))}
        <mesh position={[x0 + run / 2, 1.478, 0.14]} rotation={[Math.PI / 2, 0, 0]} material={m.glow}>
          <planeGeometry args={[run - 0.2, 0.02]} />
        </mesh>
        <Model id="ceramic_vase_04" p={[x0 + run * 0.2, 1.52, 0.14]} s={0.7} />
        <Model id="ceramic_vase_02" p={[x0 + run * 0.72, 1.9, 0.14]} s={0.6} />
      </OnWall>
      {/* fridge behind a tall panel at the end */}
      <B p={[len / 2 - fridge / 2, 1.05, 0.31]} s={[fridge - 0.01, 2.1, 0.62]} m={m.cabinet} r={0.006} />
      <B p={[len / 2 - fridge + 0.08, 1.15, 0.63]} s={[0.018, 0.6, 0.02]} m={m.black} r={0.006} />
    </>
  );
}

function Tub() {
  const m = useMats();
  const w = 1.5,
    d = 0.75,
    h = 0.55,
    t = 0.07;
  return (
    <>
      <B p={[0, 0.03, 0]} s={[w, 0.06, d]} m={m.ceramic} r={0.02} />
      <B p={[0, h / 2, -d / 2 + t / 2]} s={[w, h, t]} m={m.ceramic} r={0.025} />
      <B p={[0, h / 2, d / 2 - t / 2]} s={[w, h, t]} m={m.ceramic} r={0.025} />
      <B p={[-w / 2 + t / 2, h / 2, 0]} s={[t, h, d]} m={m.ceramic} r={0.025} />
      <B p={[w / 2 - t / 2, h / 2, 0]} s={[t, h, d]} m={m.ceramic} r={0.025} />
      <mesh position={[-w / 2 + 0.2, 0.9, -d / 2 + 0.04]} rotation={[Math.PI / 2, 0, 0]} material={m.black}>
        <cylinderGeometry args={[0.012, 0.012, 0.1, 10]} />
      </mesh>
    </>
  );
}

function Toilet() {
  const m = useMats();
  return (
    <>
      <B p={[0, 0.62, -0.25]} s={[0.4, 0.36, 0.17]} m={m.ceramic} r={0.04} />
      <mesh position={[0, 0.2, 0.02]} scale={[1, 1, 1.3]} material={m.ceramic} castShadow receiveShadow>
        <cylinderGeometry args={[0.18, 0.13, 0.4, 32]} />
      </mesh>
      <mesh position={[0, 0.41, 0.02]} scale={[1, 1, 1.3]} material={m.ceramic} castShadow>
        <cylinderGeometry args={[0.185, 0.185, 0.025, 32]} />
      </mesh>
    </>
  );
}

function Vanity({ w, wall }: { w: number; wall: PlanSide }) {
  const m = useMats();
  return (
    <>
      <B p={[0, 0.62, 0.23]} s={[w, 0.32, 0.46]} m={m.oak} r={0.01} />
      <B p={[0, 0.82, 0.25]} s={[Math.min(0.48, w - 0.1), 0.1, 0.36]} m={m.ceramic} r={0.04} />
      <mesh position={[0, 0.98, 0.07]} material={m.black}>
        <cylinderGeometry args={[0.01, 0.012, 0.2, 10]} />
      </mesh>
      <OnWall side={wall}>
        <mesh position={[0, 1.45, 0.012]} material={m.mirror}>
          <circleGeometry args={[Math.min(0.32, w / 2), 48]} />
        </mesh>
      </OnWall>
    </>
  );
}

// ---------- each zone ----------

function Furniture({ z, layout, plan, h }: { z: LayoutZone; layout: Layout; plan: Plan; h: number }) {
  const m = useMats();
  const box = plan.box;
  const f = zoneFrame(z, backOf(z, box, z.kind === "bedroom" ? (layout.window?.side ?? null) : null));
  // Is this stretch of the zone's back wall free of windows and doors (for art)?
  const wallFree = (u0: number, u1: number) => {
    const [ax, az] = f.at(u0, 0),
      [bx, bz] = f.at(u1, 0);
    const side = f.back;
    const along = side === "minZ" || side === "maxZ";
    const a0 = Math.min(along ? ax : az, along ? bx : bz) - (along ? box.minX : box.minZ);
    const a1 = Math.max(along ? ax : az, along ? bx : bz) - (along ? box.minX : box.minZ);
    return !plan.openings.some((o) => o.side === side && o.atM + o.widthM / 2 > a0 && o.atM - o.widthM / 2 < a1);
  };

  if (z.kind === "bedroom") {
    const v = 1.1;
    return (
      <>
        <At f={f} u={f.uMid} v={v}>
          <Bed />
        </At>
        {[-1, 1].map((s) =>
          f.len >= 2.9 ? (
            <group key={s}>
              <Model id="side_table_01" p={f.p(f.uMid + s * 1.13, 0.27)} yaw={f.yaw} />
              <At f={f} u={f.uMid + s * 1.13} v={0.27} y={0.55}>
                {s < 0 ? <BedsideLamp /> : <Model id="standing_picture_frame_02" p={[0.08, 0, 0]} yaw={Math.PI / 2} s={0.9} />}
              </At>
            </group>
          ) : null,
        )}
        {f.depth >= 2.9 && (
          <At f={f} u={f.uMid} v={2.05}>
            <B p={[0, 0.006, 0]} s={[2.3, 0.012, 1.4]} m={m.rug} r={0.004} />
          </At>
        )}
      </>
    );
  }

  if (z.kind === "living") {
    const { lv, wide, spot, sideboard } = arrangeLiving(z, layout, box);
    const hasDining = spot !== null;
    const du = spot?.u ?? f.uMid,
      dv = spot?.v ?? 0;
    const table = { u: f.uMid, v: lv + 1.55 };
    return (
      <>
        <At f={f} u={f.uMid} v={lv + 0.5}>
          <Sofa />
        </At>
        <At f={f} u={f.uMid} v={lv + 1.6}>
          <B p={[0, 0.006, 0]} s={[2.6, 0.012, 1.8]} m={m.rug} r={0.004} />
        </At>
        <Model id="modern_coffee_table_01" p={f.p(table.u, table.v)} yaw={f.yaw + Math.PI / 2} />
        {wide ? (
          <>
            <Model id="mid_century_lounge_chair" p={f.p(f.uMid + 1.25, lv + 2.35)} yaw={f.face(f.uMid + 1.25, lv + 2.35, table.u, table.v)} />
            <Model id="modern_arm_chair_01" p={f.p(f.uMid - 1.25, lv + 2.35)} yaw={f.face(f.uMid - 1.25, lv + 2.35, table.u, table.v)} />
          </>
        ) : (
          <Model id="mid_century_lounge_chair" p={f.p(f.uMid, lv + 2.75)} yaw={f.face(f.uMid, lv + 2.75, table.u, table.v)} />
        )}
        {lv < 0.05 && wallFree(f.uMid - 0.4, f.uMid + 0.4) && (
          <OnWall side={f.back}>
            <Model id="hanging_picture_frame_01" p={f.p(f.uMid, 0.01, 1.45)} yaw={f.yaw} s={1.1} />
          </OnWall>
        )}
        {hasDining && (
          <>
            <At f={f} u={du} v={dv}>
              <DiningTable w={1.4} d={0.85} />
              {[-0.35, 0.35].flatMap((x) =>
                [-1, 1].map((s) => (
                  <group key={`${x}${s}`} position={[x, 0, s * 0.62]} rotation={[0, s > 0 ? Math.PI : 0, 0]}>
                    <DiningChair />
                  </group>
                )),
              )}
            </At>
            <Model id="modern_ceiling_lamp_01" p={f.p(du, dv, h - 1.17 * 0.85)} s={0.85} />
            {sideboard && (
              <>
                <Model id="modern_wooden_cabinet" p={f.p(f.uMid, f.depth - 0.22)} yaw={f.yaw + Math.PI} s={0.72} />
                <Model id="ceramic_vase_02" p={f.p(f.uMid - 0.5, f.depth - 0.2, 0.49)} />
                <Model id="ceramic_vase_04" p={f.p(f.uMid - 0.28, f.depth - 0.2, 0.49)} s={0.8} />
              </>
            )}
          </>
        )}
      </>
    );
  }

  if (z.kind === "kitchen") {
    return (
      <At f={f} u={f.uMid} v={0}>
        <Kitchen len={f.len} wall={f.back} />
      </At>
    );
  }

  if (z.kind === "bathroom") {
    const tiles = m.tile(f.len / 0.6, 1.9 / 0.6);
    const vanityW = Math.min(0.6, f.len - 1.6);
    return (
      <>
        <OnWall side={f.back}>
          <At f={f} u={f.uMid} v={0.005}>
            <mesh position={[0, 0.95, 0]} material={tiles} receiveShadow>
              <planeGeometry args={[f.len, 1.9]} />
            </mesh>
          </At>
        </OnWall>
        <At f={f} u={f.uMin + 0.76} v={0.385}>
          <Tub />
        </At>
        {vanityW >= 0.4 && (
          <At f={f} u={f.uMin + 1.55 + vanityW / 2 + 0.02} v={0}>
            <Vanity w={vanityW} wall={f.back} />
          </At>
        )}
        <At f={f} u={f.uMax - 0.32} v={Math.min(1.15, f.depth - 0.4)} yaw={f.face(f.uMax - 0.32, 1.15, f.uMin, 1.15)}>
          <Toilet />
        </At>
      </>
    );
  }

  if (z.kind === "stairs") {
    const steps = 12;
    const long = Math.max(z.x1 - z.x0, z.z1 - z.z0);
    const alongX = z.x1 - z.x0 >= z.z1 - z.z0;
    const width = Math.min(1, alongX ? z.z1 - z.z0 : z.x1 - z.x0);
    const run = long / steps;
    return (
      <>
        {Array.from({ length: steps }, (_, i) => {
          const y = (i + 1) * 0.19;
          const t = (i + 0.5) / steps;
          const c: V3 = alongX ? [z.x0 + t * long, 0, (z.z0 + z.z1) / 2] : [(z.x0 + z.x1) / 2, 0, z.z0 + t * long];
          const tread: V3 = alongX ? [run + 0.02, 0.035, width] : [width, 0.035, run + 0.02];
          const riser: V3 = alongX ? [0.02, 0.19, width] : [width, 0.19, 0.02];
          const back = alongX ? [c[0] - run / 2, y - 0.095, c[2]] : [c[0], y - 0.095, c[2] - run / 2];
          return (
            <group key={i}>
              <B p={[c[0], y - 0.017, c[2]]} s={tread} m={m.oak} r={0.006} />
              <mesh position={back as V3} material={m.wall} castShadow receiveShadow>
                <boxGeometry args={riser} />
              </mesh>
              <mesh position={alongX ? [c[0], (y - 0.19) / 2, c[2]] : [c[0], (y - 0.19) / 2, c[2]]} material={m.wall} receiveShadow>
                <boxGeometry args={alongX ? [run, Math.max(0.001, y - 0.19), width] : [width, Math.max(0.001, y - 0.19), run]} />
              </mesh>
            </group>
          );
        })}
      </>
    );
  }

  if (z.kind === "mechanical") {
    return (
      <mesh position={[(z.x0 + z.x1) / 2, 0.6, (z.z0 + z.z1) / 2]} material={m.service} castShadow receiveShadow>
        <boxGeometry args={[0.6, 1.2, 0.7]} />
      </mesh>
    );
  }
  return null;
}

function Zone({ z, showLabels }: { z: LayoutZone; showLabels: boolean }) {
  const m = useMats();
  const cx = (z.x0 + z.x1) / 2,
    cz = (z.z0 + z.z1) / 2;
  const w = z.x1 - z.x0,
    d = z.z1 - z.z0;
  const floor = useMemo(() => (z.kind === "bathroom" ? m.tile(w / 0.6, d / 0.6) : z.kind === "mechanical" ? m.wallCut : null), [m, z.kind, w, d]);
  return (
    <>
      {floor && (
        <mesh position={[cx, 0.004, cz]} rotation={[-Math.PI / 2, 0, 0]} material={floor} receiveShadow>
          <planeGeometry args={[w, d]} />
        </mesh>
      )}
      {/* The kitchen speaks for itself; stairs too. */}
      {showLabels && z.kind !== "stairs" && z.kind !== "kitchen" && (
        <Html position={[cx, 0.15, cz]} center zIndexRange={[10, 0]}>
          <span className="stage-tag">
            <b>{z.name}</b> {z.areaM2 >= 2 && <span>{z.areaM2.toFixed(1)} m²</span>}
          </span>
        </Html>
      )}
    </>
  );
}

// ---------- camera, light, scene ----------

type View = "dollhouse" | "top" | "inside";

function Rig({ plan, layout, view }: { plan: Plan; layout: Layout; view: View }) {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const b = plan.box;
  const cx = (b.minX + b.maxX) / 2,
    cz = (b.minZ + b.maxZ) / 2;
  // Step back on a tall phone screen so the whole room still fits across.
  const r = Math.max(plan.widthM, plan.depthM) * Math.max(1, 1.2 / (size.width / size.height));
  const goal = useMemo(() => {
    if (view === "top") return { pos: new THREE.Vector3(cx, r * 1.55, cz + 0.01), look: new THREE.Vector3(cx, 0, cz) };
    if (view === "inside") {
      // Like a listing photo: from a corner, a little below eye height, level, wide. Of the corners and
      // wall middles, take the one that's clear of furniture and walls and sees farthest into the suite.
      const living = layout.zones.find((z) => z.kind === "living");
      const bed = layout.zones.find((z) => z.kind === "bedroom");
      const taken: Rect[] = living ? arrangeLiving(living, layout, b).taken : [];
      if (bed) taken.push({ x0: bed.x0 + 0.3, x1: bed.x1 - 0.3, z0: bed.z0 + 0.3, z1: bed.z1 - 0.3 });
      const closed = layout.zones.filter(
        (z) =>
          z.kind === "bathroom" || z.kind === "kitchen" || z.kind === "stairs" || z.kind === "mechanical" || (z.kind === "bedroom" && layout.walls.length > 0),
      );
      const inside = (x: number, z: number, r: Rect, pad: number) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
      const crosses = (ax: number, az: number, bx: number, bz: number, w: Layout["walls"][number]) => {
        const d = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
        return d(ax, az, bx, bz, w.x0, w.z0) * d(ax, az, bx, bz, w.x1, w.z1) < 0 && d(w.x0, w.z0, w.x1, w.z1, ax, az) * d(w.x0, w.z0, w.x1, w.z1, bx, bz) < 0;
      };
      const focus = living ? { x: (living.x0 + living.x1) / 2, z: (living.z0 + living.z1) / 2 } : { x: cx, z: cz };
      const i = 0.45;
      const spots = [
        [b.minX + i, b.minZ + i],
        [b.maxX - i, b.minZ + i],
        [b.minX + i, b.maxZ - i],
        [b.maxX - i, b.maxZ - i],
        [cx, b.minZ + i],
        [cx, b.maxZ - i],
        [b.minX + i, cz],
        [b.maxX - i, cz],
      ]
        .filter(([x, z]) => !closed.some((r) => inside(x, z, r, 0.1)) && !taken.some((r) => inside(x, z, r, 0.25)))
        .filter(([x, z]) => !layout.walls.some((w) => crosses(x, z, focus.x, focus.z, w)))
        .sort((p, q) => Math.hypot(q[0] - focus.x, q[1] - focus.z) - Math.hypot(p[0] - focus.x, p[1] - focus.z));
      const [ex, ez] = spots[0] ?? [b.maxX - i, b.maxZ - i];
      const eye = new THREE.Vector3(ex, 1.4, ez);
      const far = new THREE.Vector3(focus.x, 1.3, focus.z);
      return { pos: eye, look: eye.clone().add(far.sub(eye).normalize().multiplyScalar(0.6)) };
    }
    return { pos: new THREE.Vector3(cx + r * 0.62, r * 0.85, cz + r * 0.78), look: new THREE.Vector3(cx, 0.6, cz) };
  }, [view, cx, cz, r, layout, b]);
  // Seconds of camera move left: the same one-second glide on a fast laptop or a slow phone.
  const moving = useRef(0);
  useEffect(() => {
    moving.current = 1.1;
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = view === "inside" ? 72 : 42;
    cam.updateProjectionMatrix();
  }, [goal, camera, view]);
  useFrame((_, dt) => {
    if (moving.current <= 0) return;
    moving.current -= dt;
    const k = moving.current <= 0 ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 7);
    camera.position.lerp(goal.pos, k);
    if (controls) {
      controls.target.lerp(goal.look, k);
      controls.update();
    } else camera.lookAt(goal.look);
  });
  return null;
}

function Scene({
  plan,
  layout,
  finish,
  labels,
  view,
  h,
  phone,
}: {
  plan: Plan;
  layout: Layout;
  finish: Finish;
  labels: boolean;
  view: View;
  h: number;
  phone: boolean;
}) {
  const maps = useMaps();
  const mats = useMemo(() => makeMats(finish, maps), [finish, maps]);
  const b = plan.box;
  const cx = (b.minX + b.maxX) / 2,
    cz = (b.minZ + b.maxZ) / 2;
  const sides: PlanSide[] = ["minX", "maxX", "minZ", "maxZ"];
  const lamps = layout.zones.filter((z) => z.kind === "living" || z.kind === "bedroom");
  const cut = useRef<Partial<Record<PlanSide, number>>>({});
  return (
    <CutCtx.Provider value={cut}>
      <MatsCtx.Provider value={mats}>
        {/* Soft daylight from above for the shadows, a bright ceiling and walls for reflections. */}
        <Environment resolution={256} frames={1} environmentIntensity={0.85}>
          <color attach="background" args={["#8E8C86"]} />
          <Lightformer form="rect" intensity={2.2} color="#FFF8EE" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
          <Lightformer form="rect" intensity={0.8} color="#F2F5F0" position={[-8, 3, 0]} rotation-y={Math.PI / 2} scale={[14, 4, 1]} />
          <Lightformer form="rect" intensity={0.6} color="#FFF1DE" position={[8, 3, 0]} rotation-y={-Math.PI / 2} scale={[14, 4, 1]} />
        </Environment>
        <hemisphereLight args={["#FFFFFF", "#D9D2C4", 0.3]} />
        <directionalLight
          position={[cx + 3.5, 9, cz + 2.5]}
          intensity={1.5}
          color="#FFF5E8"
          castShadow
          shadow-mapSize={[phone ? 1024 : 2048, phone ? 1024 : 2048]}
          shadow-bias={-0.0003}
          shadow-normalBias={0.025}
          shadow-camera-left={-9}
          shadow-camera-right={9}
          shadow-camera-top={9}
          shadow-camera-bottom={-9}
          shadow-camera-far={30}
        >
          <object3D attach="target" position={[cx, 0, cz]} />
        </directionalLight>
        {/* Warm pot-light glow inside the rooms. */}
        {lamps.map((z, i) => (
          <pointLight
            key={i}
            position={[(z.x0 + z.x1) / 2, h - 0.25, (z.z0 + z.z1) / 2]}
            intensity={view === "inside" ? 2.2 : 1.1}
            distance={6}
            decay={2}
            color="#FFE6C2"
          />
        ))}
        <Floor plan={plan} finish={finish} />
        <Ceiling plan={plan} h={h} />
        {sides.map((s) => (
          <SideWall key={s} plan={plan} side={s} h={h} />
        ))}
        {layout.walls.map((w, i) => (
          <Partition key={i} w={w} doors={layout.doors} h={h} />
        ))}
        {layout.zones.map((z, i) => (
          <group key={`${z.kind}${i}`}>
            <Zone z={z} showLabels={labels} />
            <Furniture z={z} layout={layout} plan={plan} h={h} />
          </group>
        ))}
        <EffectComposer multisampling={phone ? 0 : 4}>
          <N8AO aoRadius={0.5} distanceFalloff={0.6} intensity={phone ? 2.4 : 3} quality={phone ? "performance" : "medium"} halfRes={phone} />
        </EffectComposer>
      </MatsCtx.Provider>
    </CutCtx.Provider>
  );
}

// The suggested layout on its own: furniture and the new walls, lit, without the room's shell. It sits
// inside the real scan (src/three/RealScan.tsx), in the room's own frame.
export function StagedFurniture({ plan, layout, finishKey = "light" }: { plan: Plan; layout: Layout; finishKey?: FinishKey }) {
  const maps = useMaps();
  const mats = useMemo(() => makeMats(FINISHES[finishKey], maps), [finishKey, maps]);
  const cut = useRef<Partial<Record<PlanSide, number>>>({});
  const h = Math.min(2.6, Math.max(2.0, plan.ceilingHeightM ?? 2.3));
  const b = plan.box;
  return (
    <CutCtx.Provider value={cut}>
      <MatsCtx.Provider value={mats}>
        <Environment resolution={128} frames={1} environmentIntensity={0.9}>
          <Lightformer form="rect" intensity={2.2} color="#FFF8EE" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
          <Lightformer form="rect" intensity={0.8} color="#F2F5F0" position={[-8, 3, 0]} rotation-y={Math.PI / 2} scale={[14, 4, 1]} />
        </Environment>
        <hemisphereLight args={["#FFFFFF", "#D9D2C4", 0.5]} />
        <directionalLight position={[(b.minX + b.maxX) / 2 + 3, 8, (b.minZ + b.maxZ) / 2 + 2]} intensity={1.2} color="#FFF5E8" />
        {layout.walls.map((w, i) => (
          <Partition key={i} w={w} doors={layout.doors} h={h} />
        ))}
        {layout.zones.map((z, i) => (
          <Furniture key={`${z.kind}${i}`} z={z} layout={layout} plan={plan} h={h} />
        ))}
      </MatsCtx.Provider>
    </CutCtx.Provider>
  );
}

function Loading() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return <p className="stage-loading mono">Furnishing your basement… {Math.round(progress)}%</p>;
}

export function StagedBasement({ plan, layout }: { plan: Plan; layout: Layout }) {
  const [view, setView] = useState<View>("dollhouse");
  const [labels, setLabels] = useState(true);
  const [finishKey, setFinishKey] = useState<FinishKey>("light");
  const phone = useMemo(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches, []);
  const h = Math.min(2.6, Math.max(2.0, plan.ceilingHeightM ?? 2.3));
  const b = plan.box;
  return (
    <div className="stage">
      <Canvas
        shadows="soft"
        camera={{ fov: 42, near: 0.05, far: 200, position: [b.maxX + 6, 7, b.maxZ + 7] }}
        dpr={[1, phone ? 1.6 : 2]}
        gl={{ antialias: false, toneMappingExposure: 1.05 }}
      >
        <color attach="background" args={[getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim() || "#E6EBE4"]} />
        <Suspense fallback={null}>
          <Scene plan={plan} layout={layout} finish={FINISHES[finishKey]} labels={labels} view={view} h={h} phone={phone} />
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan
          target={[(b.minX + b.maxX) / 2, 0.6, (b.minZ + b.maxZ) / 2]}
          minDistance={0.5}
          maxDistance={40}
          maxPolarAngle={Math.PI * 0.49}
        />
        <Rig plan={plan} layout={layout} view={view} />
      </Canvas>
      <Loading />
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
      <div className="stage-finish" role="group" aria-label="Finish">
        {(Object.keys(FINISHES) as FinishKey[]).map((k) => (
          <button key={k} aria-pressed={finishKey === k} onClick={() => setFinishKey(k)} title={FINISHES[k].label}>
            <span className="stage-swatch" style={{ background: `linear-gradient(135deg, ${FINISHES[k].swatch[0]} 50%, ${FINISHES[k].swatch[1]} 50%)` }} />
            <span>{FINISHES[k].label}</span>
          </button>
        ))}
      </div>
      <p className="stage-note mono">
        <span className="stage-note-long">A starting layout in your real room · </span>drag to look around
      </p>
    </div>
  );
}
