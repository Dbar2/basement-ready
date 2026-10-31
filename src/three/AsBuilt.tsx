// The basement as built, in 3D: drawn from the plan (src/three/AsBuiltModel.ts), so its walls are
// straight, its floor flat and everything stands exactly on the plan, and painted with the real
// video (services/scan3d/scan3d/texture.py), so it looks like their basement. Mount <AsBuiltScene>
// inside any <Canvas>: the walk-through and the overview do (src/three/RealScan.tsx), the studio can
// put its design on it, and the pictures render it behind the design (src/views/AngleRender.tsx).
//
// Five draws at most: the painted shell and its ceilings (one atlas texture between them), the same
// two plain where nothing is painted yet, and every plain block (wall edges, fixtures) in one.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Design, Existing, Pt } from "../../server/model/types";
import { buildAsBuilt, pointAt, type AsBuilt, type Block, type Surface } from "./AsBuiltModel";
import { Tag } from "./Tags";

// services/scan3d/scan3d/texture.py `paint`: where each surface sits in the atlas.
export type AtlasEntry = { key: string; rect: [number, number, number, number]; coverage: number; frames?: number[]; shiftM?: number };
export type AtlasIndex = {
  version: 1;
  page: number;
  ppm: number;
  levels: Record<string, string>; // atlas size -> file
  surfaces: Record<string, AtlasEntry>;
  stairTop?: Pt | null; // the hint the surfaces were built with (where filming started)
  floorY?: number;
  tones?: Partial<Record<"wall" | "floor" | "ceiling" | "stairs", string>>; // each kind's own colour, for what isn't painted
};
// `base`: the folder the index and its files are in, ending in "/".
export type Atlas = { index: AtlasIndex; base: string };

const REVEAL_S = 2.2;
// Plain colours for whatever isn't painted (yet): the surfaces' usual colours in a basement.
const PLAIN: Record<Surface["kind"], string> = { wall: "#D8D6CF", floor: "#B9B3A8", ceiling: "#E7E5DF", pane: "#C9D4D8", stairs: "#A8987F", side: "#BDB4A4" };
// A painted surface is used only if it hasn't moved since it was painted, or moved little: then
// the old paint stretches until the new arrives.
const STRETCH = 0.15;
// Below this share seen, a surface is all guesswork: plain is more honest than a smear.
const MIN_COVERAGE = 0.05;

function entryFor(s: Surface, atlas: AtlasIndex | undefined): AtlasEntry | null {
  const e = atlas?.surfaces[s.id];
  if (!e || e.coverage < MIN_COVERAGE) return null;
  if (e.key === s.key) return e;
  const [w, h] = [e.rect[2] * atlas!.page / atlas!.ppm, e.rect[3] * atlas!.page / atlas!.ppm];
  return Math.abs(w - s.size[0]) <= STRETCH * s.size[0] + 0.05 && Math.abs(h - s.size[1]) <= STRETCH * s.size[1] + 0.05 ? e : null;
}

type Bufs = { pos: number[]; nrm: number[]; uv: number[]; col: number[] };
const bufs = (): Bufs => ({ pos: [], nrm: [], uv: [], col: [] });

function toGeometry(b: Bufs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
  if (b.uv.length) g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
  if (b.col.length) g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.computeBoundingSphere();
  return g;
}

// One surface into triangles: (s, t) on it -> the basement frame, and -> its rectangle in the atlas.
function addSurface(out: Bufs, s: Surface, e: AtlasEntry | null, colour: THREE.Color) {
  const uv = (ss: number, tt: number): [number, number] => {
    if (!e) return [0, 0];
    const [x, y, w, h] = e.rect;
    return [x + (ss / s.size[0]) * w, 1 - y - (1 - tt / s.size[1]) * h];
  };
  // A hair in front of the plain core behind it.
  const lift = 0.0005;
  const push = (ss: number, tt: number, n: readonly number[]) => {
    const p = pointAt(s, ss, tt);
    out.pos.push(p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift);
    out.nrm.push(n[0], n[1], n[2]);
    out.uv.push(...uv(ss, tt));
    out.col.push(colour.r, colour.g, colour.b);
  };
  if (s.kind === "stairs" && s.steps) {
    const { count, rise, tread } = s.steps;
    const back = [-s.v[0], 0, -s.v[2]], up = [0, 1, 0];
    for (let k = 0; k < count; k++) {
      const t0 = k * (rise + tread);
      for (const [a, b, n] of [[t0, t0 + rise - 1e-4, back], [t0 + rise + 1e-4, t0 + rise + tread, up]] as const) {
        const quad: [number, number][] = [[0, a], [s.size[0], a], [s.size[0], b], [0, a], [s.size[0], b], [0, b]];
        for (const [ss, tt] of quad) push(ss, tt, n);
      }
    }
    return;
  }
  const outline = s.outline ?? [[0, 0], [s.size[0], 0], [s.size[0], s.size[1]], [0, s.size[1]]];
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of s.holes ?? []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ShapeGeometry(shape).toNonIndexed();
  const p = g.getAttribute("position");
  // ShapeGeometry winds counter-clockwise about +z; (u, v, n) is right-handed, so n is the front.
  for (let i = 0; i < p.count; i++) push(p.getX(i), p.getY(i), s.n);
  g.dispose();
}

function addBlock(out: Bufs, b: Block) {
  const g = b.shape === "cylinder" ? new THREE.CylinderGeometry(b.size[0] / 2, b.size[0] / 2, b.size[1], 20).toNonIndexed() : new THREE.BoxGeometry(...b.size).toNonIndexed();
  g.rotateY(b.rotY);
  g.translate(...b.center);
  const side = new THREE.Color(b.colour), top = new THREE.Color(b.cap ?? b.colour);
  const p = g.getAttribute("position"), n = g.getAttribute("normal");
  for (let i = 0; i < p.count; i++) {
    out.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    out.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    const c = n.getY(i) > 0.5 ? top : side;
    out.col.push(c.r, c.g, c.b);
  }
  g.dispose();
}

export type ShellGeometry = { painted: THREE.BufferGeometry; paintedCeilings: THREE.BufferGeometry; plain: THREE.BufferGeometry; plainCeilings: THREE.BufferGeometry; blocks: THREE.BufferGeometry; well: THREE.BufferGeometry };

export function shellGeometry(model: AsBuilt, atlas: AtlasIndex | undefined, painted: boolean): ShellGeometry {
  const parts = { painted: bufs(), paintedCeilings: bufs(), plain: bufs(), plainCeilings: bufs(), blocks: bufs(), well: bufs() };
  const white = new THREE.Color(1, 1, 1);
  for (const s of model.surfaces) {
    const e = painted ? entryFor(s, atlas) : null;
    const ceiling = s.kind === "ceiling";
    // Unpainted: this basement's own colour for its kind, when the painter measured one.
    const tone = atlas?.tones?.[s.kind === "pane" ? "wall" : s.kind === "side" ? "stairs" : s.kind];
    if (e) addSurface(ceiling ? parts.paintedCeilings : parts.painted, s, e, white);
    else addSurface(ceiling ? parts.plainCeilings : parts.plain, s, null, new THREE.Color(tone ?? PLAIN[s.kind]));
  }
  for (const b of model.blocks) addBlock(b.kind === "well" ? parts.well : parts.blocks, b);
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, toGeometry(v)])) as ShellGeometry;
}

// The atlas, smallest first: a phone gets 1024 then 2048, a desktop 1024 then the full size.
export function useAtlasTexture(atlas: Atlas | null, onLoaded?: (size: number) => void) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const { gl } = useThree();
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  useEffect(() => {
    if (!atlas) return;
    let gone = false;
    const phone = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    const cap = Math.min(phone ? 2048 : 4096, gl.capabilities.maxTextureSize);
    const sizes = Object.keys(atlas.index.levels).map(Number).sort((a, b) => a - b);
    const first = sizes.find((s) => s >= 1024) ?? sizes[sizes.length - 1];
    const last = sizes.filter((s) => s <= cap).pop() ?? first;
    const order = first === last ? [first] : [first, last];
    const loader = new THREE.TextureLoader();
    let current: THREE.Texture | null = null;
    (async () => {
      for (const size of order) {
        const url = atlas.base + atlas.index.levels[String(size)];
        const tex = await loader.loadAsync(url).catch(() => null);
        if (gone || !tex) {
          tex?.dispose();
          continue;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        current?.dispose();
        current = tex;
        setTexture(tex);
        loaded.current?.(size);
      }
    })();
    return () => {
      gone = true;
      current?.dispose();
      setTexture(null);
    };
  }, [atlas, gl]);
  return texture;
}

// Where a walk through the as-built model starts: eye height, a third of the way along the biggest
// room, looking down its long side.
export const EYE_M = 1.5;
export function homeView(existing: Existing): { at: [number, number, number]; look: [number, number, number] } | null {
  const area = (p: Pt[]) => Math.abs(p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)) / 2;
  const room = [...existing.rooms].sort((a, b) => area(b.polygon) - area(a.polygon))[0];
  if (!room) return null;
  const xs = room.polygon.map((p) => p[0]), zs = room.polygon.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const wide = x1 - x0 >= z1 - z0;
  const at: [number, number, number] = wide ? [x0 + (x1 - x0) / 3, EYE_M, (z0 + z1) / 2] : [(x0 + x1) / 2, EYE_M, z0 + (z1 - z0) / 3];
  return { at, look: wide ? [x1, EYE_M - 0.35, at[2]] : [at[0], EYE_M - 0.35, z1] };
}

export function asBuiltOf(existing: Existing, design: Design | null | undefined, atlas: Atlas | null, newWalls = true) {
  return buildAsBuilt(existing, { design, newWalls, floorY: atlas?.index.floorY ?? 0, stairTop: atlas?.index.stairTop ?? null });
}

// The as-built basement inside a <Canvas>. `design`: walls it removes are gone, its openings cut, its
// new walls drawn plain (`newWalls={false}` when the caller draws them). `overview`: looking down, the
// ceilings lift off. `reveal`: rise from the floor up when it first appears. `lights`: soft light for
// the plain parts and anything drawn with it (furniture); off when the parent lights the scene.
export function AsBuiltScene({
  existing,
  design = null,
  newWalls = true,
  atlas = null,
  overview = false,
  reveal = true,
  lights = true,
  labels = false,
  onLoaded,
}: {
  existing: Existing;
  design?: Design | null;
  newWalls?: boolean;
  atlas?: Atlas | null;
  overview?: boolean;
  reveal?: boolean;
  lights?: boolean;
  labels?: boolean; // name the beams, ducts and bulkheads and the headroom under each (inside a <TagRoot>)
  onLoaded?: (size: number) => void; // each time a sharper atlas is on
}) {
  // Rebuilt only when the design changes the house itself (a wall gone, an opening cut, or its new
  // walls when it draws them): not on every drag of a new wall or a sofa.
  const latest = useRef(design);
  latest.current = design;
  const designKey = useMemo(() => {
    if (!design) return "";
    const own = new Set(existing.walls.map((w) => w.id));
    const p = design.proposed;
    return JSON.stringify([p.walls.filter((w) => own.has(w.id)).map((w) => w.id), p.openings.filter((o) => own.has(o.wallId)), newWalls ? p.walls.filter((w) => w.kind === "new") : null]);
  }, [design, existing, newWalls]);
  const model = useMemo(() => asBuiltOf(existing, latest.current, atlas, newWalls), [existing, designKey, atlas, newWalls]); // eslint-disable-line react-hooks/exhaustive-deps
  const { gl } = useThree();
  const texture = useAtlasTexture(atlas, (size) => {
    // Which atlas is on, for tests and screenshots: <canvas data-atlas="2048">.
    gl.domElement.dataset.atlas = String(size);
    onLoaded?.(size);
  });
  const geo = useMemo(() => shellGeometry(model, atlas?.index, Boolean(texture)), [model, atlas, texture]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const cut = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 99), []);
  const mats = useMemo(() => {
    const common = { clippingPlanes: [cut], side: THREE.FrontSide };
    const painted = new THREE.MeshBasicMaterial({ ...common, map: texture, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const plain = new THREE.MeshLambertMaterial({ ...common, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const blocks = new THREE.MeshLambertMaterial({ clippingPlanes: [cut], vertexColors: true });
    return { painted, plain, blocks };
  }, [texture, cut]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  const ceilings = useRef<THREE.Group>(null);
  const started = useRef(-1);
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useFrame(({ clock, camera }) => {
    if (started.current < 0) started.current = clock.elapsedTime;
    const t = !reveal || still ? 1 : Math.min(1, (clock.elapsedTime - started.current) / REVEAL_S);
    cut.constant = t < 1 ? model.floorY - 0.1 + (model.ceilingM + 1.2) * (1 - (1 - t) ** 3) : 99;
    // Looking down from above: the ceilings and the stairwell come off, like a model with its lid lifted.
    if (ceilings.current) ceilings.current.visible = !(overview && camera.position.y > model.floorY + model.ceilingM - 0.05);
  });
  return (
    <>
      {lights && (
        <>
          <hemisphereLight args={["#ffffff", "#8f8a80", 1.1]} />
          <ambientLight intensity={1.6} />
          <directionalLight position={[3, 7, 4]} intensity={1.1} />
        </>
      )}
      <mesh geometry={geo.painted} material={mats.painted} frustumCulled={false} />
      <mesh geometry={geo.plain} material={mats.plain} frustumCulled={false} />
      <mesh geometry={geo.blocks} material={mats.blocks} frustumCulled={false} />
      <group ref={ceilings}>
        <mesh geometry={geo.paintedCeilings} material={mats.painted} frustumCulled={false} />
        <mesh geometry={geo.plainCeilings} material={mats.plain} frustumCulled={false} />
        <mesh geometry={geo.well} material={mats.blocks} frustumCulled={false} />
      </group>
      {labels &&
        model.blocks
          .filter((b) => b.label)
          .map((b) => (
            <Tag key={b.id} position={[b.center[0], b.center[1] - b.size[1] / 2 - 0.08, b.center[2]]} priority={1}>
              <span className="viewer-tag" data-kind="mechanical">
                <i /> {b.label}
              </span>
            </Tag>
          ))}
    </>
  );
}

// The atlas for a scan: the example's is in the repo; a real scan's comes from the server, which
// paints it after the scan and again whenever the plan changes (server/asBuilt.ts).
export function useAtlas(scanId: string | null, existing: Existing | null): { atlas: Atlas | null; status: "none" | "loading" | "painting" | "ready" } {
  const [state, setState] = useState<{ atlas: Atlas | null; status: "none" | "loading" | "painting" | "ready" }>({ atlas: null, status: scanId ? "loading" : "none" });
  const key = useMemo(() => (existing ? JSON.stringify(existing.walls.map((w) => [w.a, w.b])) + JSON.stringify(existing.rooms.map((r) => [r.polygon, r.ceilingM])) : ""), [existing]);
  useEffect(() => {
    if (!scanId) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async (tries: number) => {
      const url = scanId === "sample" ? "/samples/sample/3d/asbuilt/index.json" : `/api/scans/${scanId}/asbuilt`;
      const res = await fetch(url).catch(() => null);
      if (gone) return;
      if (!res?.ok) return setState({ atlas: null, status: "none" });
      const body = await res.json();
      if (gone) return;
      if (scanId === "sample") return setState({ atlas: { index: body, base: "/samples/sample/3d/asbuilt/" }, status: "ready" });
      const atlas = body.index ? { index: body.index as AtlasIndex, base: body.base as string } : null;
      setState({ atlas, status: body.status === "painting" ? "painting" : atlas ? "ready" : "none" });
      // Still painting: look again in a few seconds, for a few minutes.
      if (body.status === "painting" && tries < 40) timer = setTimeout(() => load(tries + 1), 5000);
    };
    load(0);
    return () => {
      gone = true;
      if (timer) clearTimeout(timer);
    };
  }, [scanId, key]);
  return state;
}
