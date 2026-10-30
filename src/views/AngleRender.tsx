// The design drawn from a real camera angle, in the browser: a hidden canvas with that camera's own
// lens (focal length and centre, from the 3D) and pose, the real scan's surface drawn depth-only so the
// real walls hide what's behind them, and the design's floor, walls and furniture lit on top. That is
// laid over the real frame (the guide, sent to Muse Image), and drawn again with each piece in a flat
// colour that names it (the object-id image, for tap-to-change). The real frame, not the as-built
// model (src/three/AsBuilt.tsx): Muse Image keeps a real window, the stairs and the furnace where they
// are from a real frame, and loses or paints over them from the as-built's painting.
import { Environment, Lightformer } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { lookOf, SPECS, designHash } from "../../server/model/furniture";
import type { Design } from "../../server/model/types";
import type { Angle } from "../../server/views/angles";
import type { DrawnItem } from "../../server/views/photoreal";
import type { Solid } from "../three/RealScan";
import { DesignScene, newDoors, roomBoxes, type FloorBox } from "./DesignScene";
import { flipRows, idAt, idBoxes, idColour, type IdImage } from "./objectId";

export type AngleView = Angle & { frameUrl: string; group: "design" | number };
// `hash`: the design's. `view`: what this angle shows of it (its visible pieces, walls, rooms and
// finishes): two designs that look the same from here share one picture. `walls`: where the design's
// new walls stand in the picture, hiding whatever real door or window is behind them.
// `doors`: each new door that shows, whole, in the picture: the photo must still have a door there, or
// Muse Image took its wall away.
export type Rendered = { hash: string; view: string; guide: Blob; url: string; ids: IdImage; items: DrawnItem[]; walls: DrawnItem["box"][]; doors: DrawnItem["box"][] };
export type Snap = (angle: AngleView, frame: CanvasImageSource) => Promise<Rendered>;

// A camera from OpenCV intrinsics (pixels) and a camera-to-basement pose (OpenCV axes).
export function cameraFor(angle: Pick<Angle, "intrinsics" | "pose">, near = 0.05, far = 80) {
  const cam = new THREE.PerspectiveCamera();
  const { fx, fy, cx, cy, width: W, height: H } = angle.intrinsics;
  cam.projectionMatrix.set(2 * fx / W, 0, 1 - (2 * cx) / W, 0, 0, (2 * fy) / H, (2 * cy) / H - 1, 0, 0, 0, -(far + near) / (far - near), (-2 * far * near) / (far - near), 0, 0, -1, 0);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  // three.js cameras look down −z with +y up: flip the OpenCV y and z axes.
  const P = angle.pose;
  cam.matrixAutoUpdate = false;
  cam.matrix.set(P[0][0], -P[0][1], -P[0][2], P[0][3], P[1][0], -P[1][1], -P[1][2], P[1][3], P[2][0], -P[2][1], -P[2][2], P[2][3], 0, 0, 0, 1);
  cam.updateMatrixWorld(true);
  return cam;
}

// The real scan as an invisible wall: everything but the floor, less whatever stands inside the rooms
// being furnished (boxes and clutter there go; the design replaces them). Its walls hide the design.
export function occluderGeometry(solid: Solid, rooms: FloorBox[], inset = 0.3) {
  const boxes = rooms.map((r) => [r.x0 + inset, r.x1 - inset, r.z0 + inset, r.z1 - inset]);
  const P = solid.pos, F = solid.faces;
  const keep: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  for (let f = 0; f < F.length / 3; f++) {
    const [i, j, k] = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]];
    a.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    b.set(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]);
    c.set(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
    n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
    const x = (a.x + b.x + c.x) / 3000, y = (a.y + b.y + c.y) / 3000, z = (a.z + b.z + c.z) / 3000;
    if (Math.abs(n.y) > 0.6 && y < 0.15) continue; // floor
    if (boxes.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1)) continue;
    keep.push(i, j, k);
  }
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(P.length);
  for (let i = 0; i < P.length; i++) pos[i] = P[i] / 1000;
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(keep);
  return g;
}

function Occluder({ solid, rooms }: { solid: Solid; rooms: FloorBox[] }) {
  const geometry = useMemo(() => occluderGeometry(solid, rooms), [solid, rooms]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={material} renderOrder={-1} frustumCulled={false} />;
}

const idMaterials = new Map<number, THREE.MeshBasicMaterial>();
function idMaterial(i: number) {
  let m = idMaterials.get(i);
  if (!m) {
    const [r, g, b] = idColour(i);
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace), toneMapped: false, side: THREE.DoubleSide });
    idMaterials.set(i, m);
  }
  return m;
}

// Lives inside the canvas, after the design: once everything has loaded it hands out `snap`.
function Snapper({ design, root, onReady }: { design: Design; root: React.RefObject<THREE.Group | null>; onReady: (snap: Snap | null, hash: string) => void }) {
  const { gl, scene, advance } = useThree();
  const hash = useMemo(() => designHash(design), [design]);
  useEffect(() => {
    const target = new THREE.WebGLRenderTarget(1, 1);
    let warm = false;
    const snap: Snap = async (angle, frame) => {
      const { width: W, height: H } = angle.intrinsics;
      // The environment light is made on the first frame.
      if (!warm) {
        advance(performance.now());
        advance(performance.now() + 16);
        warm = true;
      }
      gl.setPixelRatio(1);
      gl.setSize(W, H, false);
      const cam = cameraFor(angle);
      const background = scene.background;
      scene.background = null;

      // The design, lit, over the real frame.
      gl.setRenderTarget(null);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(scene, cam);
      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      const ctx = out.getContext("2d")!;
      ctx.drawImage(frame, 0, 0, W, H);
      ctx.drawImage(gl.domElement, 0, 0, W, H);

      // Again, every piece one flat colour, into a target with no smoothing, so each pixel names one thing.
      const ids = [""];
      const index = new Map<string, number>();
      const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
      root.current?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        let p: THREE.Object3D | null = mesh;
        let id: string | undefined;
        while (p && !(id = p.userData?.objectId)) p = p.parent;
        if (!id) return;
        if (!index.has(id)) {
          index.set(id, ids.length);
          ids.push(id);
        }
        swapped.push([mesh, mesh.material]);
        mesh.material = idMaterial(index.get(id)!);
      });
      target.setSize(W, H);
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(scene, cam);
      const raw = new Uint8Array(W * H * 4);
      gl.readRenderTargetPixels(target, 0, 0, W, H, raw);
      gl.setRenderTarget(null);
      for (const [mesh, mat] of swapped) mesh.material = mat;
      scene.background = background;

      const img: IdImage = { width: W, height: H, data: flipRows(raw, W, H), ids };
      const byId = new Map(design.proposed.furniture.map((f) => [f.id, f]));
      const items: DrawnItem[] = [...idBoxes(img)].flatMap(([id, { box, share }]) => {
        const f = byId.get(id);
        if (!f) return [];
        return [{ id, kind: f.kind, label: SPECS[lookOf(f)].label, ...(f.colour ? { colour: f.colour } : {}), box, share }];
      });
      const guide = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("no picture"))), "image/jpeg", 0.9));
      const shown = new Set(items.map((i) => i.id));
      const view = designHash({ finishes: design.finishes, proposed: { ...design.proposed, furniture: design.proposed.furniture.filter((f) => shown.has(f.id)) } });
      const walls = [...idBoxes(img)].filter(([id, { share }]) => id.startsWith("wall:") && share > 0.002).map(([, { box }]) => box);
      return { hash, view, guide, url: URL.createObjectURL(guide), ids: img, items, walls, doors: doorsShown(design, cam, img) };
    };
    onReady(snap, hash);
    return () => {
      onReady(null, hash);
      target.dispose();
    };
  }, [gl, scene, advance, root, design, hash, onReady]);
  return null;
}

// The new doors that show in the picture: inside it, big enough, and not hidden (most of the leaf is its
// wall in the object-id image, not a piece of furniture or the real room in front).
export function doorsShown(design: Design, cam: THREE.Camera, img: IdImage): DrawnItem["box"][] {
  const v = new THREE.Vector3();
  return newDoors(design).flatMap((d) => {
    const pts = d.corners.map(([x, y, z]) => v.set(x, y, z).project(cam).clone());
    if (pts.some((p) => p.z > 1)) return []; // behind the camera
    const xs = pts.map((p) => (p.x + 1) / 2), ys = pts.map((p) => (1 - p.y) / 2);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (box.x < 0 || box.y < -0.02 || box.x + box.w > 1 || box.y + box.h > 1.02 || box.w * box.h < 0.004) return [];
    let seen = 0;
    for (let i = 1; i <= 3; i++)
      for (let j = 1; j <= 3; j++) if (idAt(img, (box.x + (box.w * i) / 4) * img.width, (box.y + (box.h * j) / 4) * img.height, 1) === `wall:${d.wallId}`) seen++;
    return seen >= 7 ? [box] : [];
  });
}

// Somewhere for the light to come from: soft daylight from above, warm pot lights, a little shadow.
function Lights({ design }: { design: Design }) {
  const c = useMemo(() => {
    const pts = design.proposed.rooms.flatMap((r) => r.polygon);
    if (!pts.length) return [0, 0] as const;
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] as const;
  }, [design]);
  return (
    <>
      <Environment resolution={128} frames={1} environmentIntensity={0.9}>
        <Lightformer form="rect" intensity={2.2} color="#FFF8EE" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#F2F5F0" position={[-8, 3, 0]} rotation-y={Math.PI / 2} scale={[14, 4, 1]} />
      </Environment>
      <hemisphereLight args={["#FFFFFF", "#D9D2C4", 0.55]} />
      <directionalLight
        position={[c[0] + 2.5, 7, c[1] + 1.5]}
        intensity={1.3}
        color="#FFF5E8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-far={25}
      >
        <object3D attach="target" position={[c[0], 0, c[1]]} />
      </directionalLight>
    </>
  );
}

// The hidden canvas. `onReady` gets a snap function once the design (and its models and textures) is
// in the scene, and again whenever the design changes; null while it isn't ready.
export function AngleRenderer({ design, solid, ceilingM, size, onReady }: { design: Design; solid: Solid | null; ceilingM: number; size: [number, number]; onReady: (snap: Snap | null, hash: string) => void }) {
  const root = useRef<THREE.Group>(null);
  // Only the rooms' outlines matter here: furniture moving doesn't rebuild the invisible walls.
  const outline = JSON.stringify(roomBoxes(design));
  const rooms = useMemo(() => JSON.parse(outline) as FloorBox[], [outline]);
  return (
    <div aria-hidden style={{ position: "fixed", left: -10 - size[0], top: 0, width: size[0], height: size[1], opacity: 0, pointerEvents: "none" }}>
      <Canvas frameloop="never" dpr={1} shadows gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }} camera={{ position: [0, 1.5, 0] }}>
        <Suspense fallback={null}>
          <Lights design={design} />
          {solid && <Occluder solid={solid} rooms={rooms} />}
          <group ref={root}>
            <DesignScene design={design} ceilingM={ceilingM} />
          </group>
          <Snapper design={design} root={root} onReady={onReady} />
        </Suspense>
      </Canvas>
    </div>
  );
}
