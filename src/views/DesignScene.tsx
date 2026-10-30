// A design from the model, drawn in 3D in the basement frame: its new walls (with their doorways), the
// new floor in each room and every piece of furniture where the model put it. The pictures draw this
// from real camera angles (AngleRender.tsx); the studio can draw it too. Every piece carries its id
// (userData.objectId), so a second render can say which piece each pixel is.
import { useGLTF } from "@react-three/drei";
import { useContext, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { lookOf, SPECS } from "../../server/model/furniture";
import { colourHex } from "./fabrics";
import type { Design, Furniture, Wall } from "../../server/model/types";
import { B, Bed, BedsideLamp, DiningChair, DiningTable, FINISHES, Kitchen, makeMats, MatsCtx, Model, Sofa, Toilet, Tub, useMaps, Vanity, type FinishKey, type Mats } from "../three/StagedBasement";

const DOOR_H = 2.03;
const WALL_T = 0.1;
const useMats = () => useContext(MatsCtx)!;

// The design's floor finish -> one of the staging finishes.
export function finishKeyFor(design: Pick<Design, "finishes">): FinishKey {
  const f = `${design.finishes.floor} ${design.finishes.style}`.toLowerCase();
  if (/green|deep|dark/.test(f)) return "deep";
  if (/warm|walnut|wood floor|hardwood|brown/.test(f)) return "warm";
  return "light";
}


// The shared finishes with one fabric swapped for this piece's colour.
function useTinted(mats: Mats, colour: string | undefined, maps: ReturnType<typeof useMaps>) {
  return useMemo(() => {
    const hex = colourHex(colour);
    if (!hex) return mats;
    const fabric = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95, normalMap: maps.linen, normalScale: new THREE.Vector2(0.7, 0.7) });
    const rug = new THREE.MeshStandardMaterial({ color: hex, roughness: 1, normalMap: maps.boucle, normalScale: new THREE.Vector2(0.7, 0.7) });
    return { ...mats, sofa: fabric, throw: fabric, rug };
  }, [mats, colour, maps]);
}

// A GLB piece, its fabric tinted when the homeowner picked a colour.
function TintedModel({ id, p = [0, 0, 0], yaw = 0, s = 1, colour, fabric }: { id: string; p?: [number, number, number]; yaw?: number; s?: number; colour?: string; fabric: RegExp }) {
  const { scene } = useGLTF(`/staging/models/${id}.glb`);
  const object = useMemo(() => {
    const hex = colourHex(colour);
    const o = scene.clone(true);
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      if (!hex) return;
      const tint = (mat: THREE.Material) => {
        if (!fabric.test(mat.name) || !(mat as THREE.MeshStandardMaterial).color) return mat;
        const c = (mat as THREE.MeshStandardMaterial).clone();
        c.color.set(hex);
        c.map = null;
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
    });
    return o;
  }, [scene, colour, fabric]);
  return <primitive object={object} position={p} rotation={[0, yaw, 0]} scale={s} />;
}

function Desk({ w, d }: { w: number; d: number }) {
  const m = useMats();
  return (
    <>
      <B p={[0, 0.74, 0]} s={[w, 0.03, d]} m={m.oak} r={0.008} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * (w / 2 - 0.05), 0.365, sz * (d / 2 - 0.05)]} material={m.black} castShadow>
            <boxGeometry args={[0.03, 0.73, 0.03]} />
          </mesh>
        )),
      )}
      <group position={[0.1, 0, d / 2 + 0.12]} rotation={[0, Math.PI + 0.2, 0]}>
        <DiningChair />
      </group>
    </>
  );
}

function Dresser({ w, d }: { w: number; d: number }) {
  const m = useMats();
  return (
    <>
      <B p={[0, 0.43, 0]} s={[w, 0.78, d]} m={m.cabinet} r={0.01} />
      {[0.22, 0.47, 0.72].map((y) => (
        <B key={y} p={[0, y, d / 2 + 0.006]} s={[w * 0.3, 0.015, 0.012]} m={m.black} r={0.004} />
      ))}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (w / 2 - 0.06), 0.02, 0]} material={m.black}>
          <boxGeometry args={[0.04, 0.04, d - 0.08]} />
        </mesh>
      ))}
    </>
  );
}

function Shelf({ w, d }: { w: number; d: number }) {
  const m = useMats();
  const books = ["#7C8A7A", "#C9BBA4", "#34405A", "#E3DED3", "#4A4F4C"];
  return (
    <>
      {[-1, 1].map((sx) => (
        <B key={sx} p={[sx * (w / 2 - 0.012), 0.9, 0]} s={[0.024, 1.8, d]} m={m.oak} r={0.004} />
      ))}
      {[0.02, 0.45, 0.9, 1.35, 1.78].map((y, i) => (
        <group key={y}>
          <B p={[0, y, 0]} s={[w - 0.04, 0.025, d]} m={m.oak} r={0.004} />
          {i < 4 &&
            Array.from({ length: 6 }, (_, k) => (
              <mesh key={k} position={[-w / 2 + 0.1 + k * ((w - 0.25) / 6), y + 0.13, 0]} castShadow>
                <boxGeometry args={[0.035 + (k % 3) * 0.01, 0.22 + ((k * 7) % 5) * 0.02, d * 0.75]} />
                <meshStandardMaterial color={books[(k + i) % books.length]} roughness={0.8} />
              </mesh>
            ))}
        </group>
      ))}
    </>
  );
}

function Tv({ d }: { d: number }) {
  const m = useMats();
  return (
    <>
      <Model id="modern_wooden_cabinet" p={[0, 0, 0.005]} s={0.72} />
      <B p={[0, 1.05, -d / 2 + 0.05]} s={[1.25, 0.72, 0.035]} m={m.glassTop} r={0.006} />
    </>
  );
}

function WasherDryer({ w, d }: { w: number; d: number }) {
  const m = useMats();
  return (
    <>
      <B p={[0, 0.43, 0]} s={[w, 0.85, d]} m={m.ceramic} r={0.02} />
      <mesh position={[0, 0.45, d / 2 + 0.005]} material={m.black}>
        <circleGeometry args={[0.18, 32]} />
      </mesh>
    </>
  );
}

// One piece of furniture from the model, at its spot and turned, sized to its footprint. Pieces are
// built facing +z around their footprint's centre.
export function FurnitureMesh({ f }: { f: Furniture }) {
  const maps = useMaps();
  const base = useMats();
  const mats = useTinted(base, f.colour, maps);
  const [w, d] = f.sizeM;
  const look = lookOf(f);
  let body: ReactNode = null;
  if (look === "bed") body = <group scale={[w / 1.72, 1, d / 2.17]}><Bed /></group>;
  else if (look === "sofa") body = <group scale={[w / 2.2, 1, d / 0.95]}><Sofa /></group>;
  else if (look === "armchair") body = <TintedModel id="modern_arm_chair_01" p={[0, 0, 0.082]} colour={f.colour} fabric={/pillow/i} />;
  else if (look === "desk") body = <Desk w={w} d={d} />;
  else if (look === "dining") {
    const tw = w, td = w >= 1.2 ? 0.85 : 0.8;
    const xs = w >= 1.2 ? [-0.35, 0.35] : [0];
    body = (
      <>
        <DiningTable w={tw} d={td} />
        {xs.flatMap((x) =>
          [-1, 1].map((s) => (
            <group key={`${x}${s}`} position={[x, 0, s * (td / 2 + 0.2)]} rotation={[0, s > 0 ? Math.PI : 0, 0]}>
              <DiningChair />
            </group>
          )),
        )}
      </>
    );
  } else if (look === "dresser") body = <Dresser w={w} d={d} />;
  else if (look === "tv") body = <Tv d={d} />;
  else if (look === "rug") body = <B p={[0, 0.006, 0]} s={[w, 0.012, d]} m={mats.rug} r={0.004} />;
  else if (look === "shelf") body = <Shelf w={w} d={d} />;
  else if (look === "kitchen") body = <group position={[0, 0, -d / 2]}><Kitchen len={w} wall="maxZ" /></group>;
  else if (look === "fridge") body = <B p={[0, 0.9, 0]} s={[w, 1.8, d]} m={mats.steel} r={0.01} />;
  else if (look === "vanity") body = <group position={[0, 0, -d / 2]}><Vanity w={w} wall="maxZ" /></group>;
  else if (look === "toilet") body = <Toilet />;
  else if (look === "shower") body = <group scale={[w / 1.5, 1, d / 0.75]}><Tub /></group>;
  else if (look === "washer_dryer") body = <WasherDryer w={w} d={d} />;
  else if (look === "coffee_table") body = <Model id="modern_coffee_table_01" p={[0, 0, 0]} yaw={Math.PI / 2} />;
  else if (look === "nightstand") {
    body = (
      <>
        <Model id="side_table_01" p={[0, 0, 0]} s={0.92} />
        <group position={[0.08, 0.5, 0]}>
          <BedsideLamp />
        </group>
      </>
    );
  } else body = <B p={[0, SPECS.other.heightM / 2, 0]} s={[w, SPECS.other.heightM, d]} m={mats.cabinet} r={0.01} />;
  return (
    <group position={[f.at[0], 0, f.at[1]]} rotation={[0, (f.rotDeg * Math.PI) / 180, 0]} userData={{ objectId: f.id }}>
      <MatsCtx.Provider value={mats}>{body}</MatsCtx.Provider>
    </group>
  );
}

// A new wall, with gaps for its doors.
function NewWall({ w, design, h }: { w: Wall; design: Design; h: number }) {
  const mats = useMats();
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const yaw = Math.atan2(-(w.b[1] - w.a[1]), w.b[0] - w.a[0]);
  const doors = design.proposed.openings.filter((o) => o.wallId === w.id && o.kind === "door").sort((a, b) => a.offsetM - b.offsetM);
  const pieces: [number, number, number, number][] = [];
  let t = 0;
  for (const o of doors) {
    pieces.push([t, o.offsetM - o.widthM / 2, 0, h]);
    pieces.push([o.offsetM - o.widthM / 2, o.offsetM + o.widthM / 2, Math.min(DOOR_H, h), h]);
    t = o.offsetM + o.widthM / 2;
  }
  pieces.push([t, len, 0, h]);
  return (
    <group position={[w.a[0], 0, w.a[1]]} rotation={[0, yaw, 0]} userData={{ objectId: `wall:${w.id}` }}>
      {pieces.map(([t0, t1, y0, y1], i) =>
        t1 - t0 > 0.01 && y1 - y0 > 0.01 ? (
          <mesh key={i} position={[(t0 + t1) / 2, (y0 + y1) / 2, 0]} material={mats.walls} castShadow receiveShadow>
            <boxGeometry args={[t1 - t0, y1 - y0, WALL_T]} />
          </mesh>
        ) : null,
      )}
    </group>
  );
}

export type FloorBox = { x0: number; x1: number; z0: number; z1: number };
const NO_FLOOR = new Set(["stairs", "mechanical"]);

// The real room each of the design's rooms sits in: from its centre out to the nearest existing wall
// each way (a studio's sleeping corner, kitchen and living space all sit in one). The new floor covers
// these, and the scan's clutter inside them is left out of what hides the design.
export function roomBoxes(design: Pick<Design, "proposed">): FloorBox[] {
  const walls = design.proposed.walls.filter((w) => w.kind !== "new");
  const out: FloorBox[] = [];
  for (const r of design.proposed.rooms.filter((x) => !NO_FLOOR.has(x.kind))) {
    const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
    const own = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    const c = [(own.x0 + own.x1) / 2, (own.z0 + own.z1) / 2];
    // The nearest wall crossed by a ray from the centre along +x, −x, +z or −z.
    const reach = (axis: 0 | 1, dir: 1 | -1, fallback: number) => {
      let best = Infinity;
      for (const w of walls) {
        const [a, b] = [w.a, w.b];
        const o = 1 - axis; // the other axis
        if ((a[o] - c[o]) * (b[o] - c[o]) > 0 || Math.abs(a[o] - b[o]) < 1e-6) continue;
        const t = (c[o] - a[o]) / (b[o] - a[o]);
        const hit = a[axis] + t * (b[axis] - a[axis]);
        const dist = (hit - c[axis]) * dir;
        if (dist > -0.05 && dist < best) best = dist;
      }
      return Number.isFinite(best) && best < 25 ? c[axis] + dir * best : fallback;
    };
    const box = { x0: Math.min(own.x0, reach(0, -1, own.x0)), x1: Math.max(own.x1, reach(0, 1, own.x1)), z0: Math.min(own.z0, reach(1, -1, own.z0)), z1: Math.max(own.z1, reach(1, 1, own.z1)) };
    if (!out.some((b) => Math.abs(b.x0 - box.x0) < 0.05 && Math.abs(b.x1 - box.x1) < 0.05 && Math.abs(b.z0 - box.z0) < 0.05 && Math.abs(b.z1 - box.z1) < 0.05)) out.push(box);
  }
  return out;
}

// The new floor: planks running along the room's long side.
function RoomFloor({ box, finishKey, id }: { box: FloorBox; finishKey: FinishKey; id: string }) {
  const t = useMaps();
  const { x0, x1, z0, z1 } = box;
  const w = x1 - x0, d = z1 - z0;
  const mat = useMemo(() => {
    const light = FINISHES[finishKey].floor === "laminate_floor_02";
    const set = (x: THREE.Texture) => {
      const c = x.clone();
      c.rotation = w >= d ? 0 : Math.PI / 2;
      c.repeat.set(w / 1.8, d / 1.8);
      c.offset.set(x0 / 1.8, z0 / 1.8);
      c.needsUpdate = true;
      return c;
    };
    return new THREE.MeshStandardMaterial({ map: set(light ? t.lightFloor : t.warmFloor), normalMap: set(light ? t.lightFloorN : t.warmFloorN), roughnessMap: set(light ? t.lightFloorR : t.warmFloorR), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 });
  }, [finishKey, t, w, d, x0, z0]);
  return (
    <mesh position={[(x0 + x1) / 2, 0.003, (z0 + z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow userData={{ objectId: `floor:${id}` }}>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

// The whole design. `floors`: draw the new floor in its rooms (the pictures do; the studio may not).
export function DesignScene({ design, ceilingM = 2.3, floors = true }: { design: Design; ceilingM?: number; floors?: boolean }) {
  const maps = useMaps();
  const finishKey = finishKeyFor(design);
  const mats = useMemo(() => makeMats(FINISHES[finishKey], maps), [finishKey, maps]);
  const h = Math.min(2.6, Math.max(2.0, ceilingM));
  const boxes = useMemo(() => roomBoxes(design), [design]);
  return (
    <MatsCtx.Provider value={mats}>
      {floors && boxes.map((b, i) => <RoomFloor key={i} box={b} finishKey={finishKey} id={String(i + 1)} />)}
      {design.proposed.walls.filter((w) => w.kind === "new").map((w) => <NewWall key={w.id} w={w} design={design} h={h} />)}
      {design.proposed.furniture.map((f) => <FurnitureMesh key={f.id} f={f} />)}
    </MatsCtx.Provider>
  );
}
