// The studio's 3D: the design inside the basement as built (src/three/AsBuilt.tsx), or the raw scan
// when they ask for it (src/studio/DesignScene.tsx draws either), with labels
// drawn over the canvas (src/three/Tags.tsx), what's picked, a marker for a failing check and the grab
// handles. Walk it at eye height without passing through walls, or look from above and drag walls and
// doors. The canvas is mounted once: an edit changes what's in it, never remounts it.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { along, bounds, dot, floorArea, polygonArea, project, solidPieces, sub, wallNormal } from "../../server/model/geometry";
import type { Design, Existing, Pt, Wall } from "../../server/model/types";
import { useAtlas } from "../three/AsBuilt";
import { bestView, spotsOf, type Spot } from "../three/AsBuiltView";
import { parseMesh, type Solid } from "../three/RealScan";
import { Tag, TagRoot, TagTracker } from "../three/Tags";
import type { Picked } from "./PlanSvg";
import { css, DesignScene, wallHeight, WallBox, type Finish } from "./DesignScene";
import { mainRect, overheadTags, suiteArea, walkStep } from "./stage";

export type View = "walk" | "overview";

const EYE_M = 1.5;

export function meshUrls(scanId: string) {
  return scanId === "sample" ? ["/samples/sample/3d/mesh.bin"] : [`/api/scans/${scanId}/3d/mesh.bin?room=all`, `/api/scans/${scanId}/3d/mesh.bin`];
}

// Where they filmed from (the scan's camera spots), in plan metres, for where the walk starts.
function useSpots(scanId: string, k: number) {
  const [spots, setSpots] = useState<Spot[]>([]);
  useEffect(() => {
    let gone = false;
    fetch(scanId === "sample" ? "/samples/sample/3d/scan.json" : `/api/scans/${scanId}/3d/scan.json?room=all`)
      .then((r) => (r.ok ? r.json() : null))
      .then((scan) => !gone && setSpots(spotsOf(scan, k)))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [scanId, k]);
  return spots;
}

// The raw scan's solid surface, once `scanId` is given (it's big: only when they ask for it).
function useSolid(scanId: string | null) {
  const [solid, setSolid] = useState<Solid | null | "none">(null);
  useEffect(() => {
    if (!scanId) return;
    let gone = false;
    (async () => {
      for (const url of meshUrls(scanId)) {
        const res = await fetch(url).catch(() => null);
        if (!res?.ok) continue;
        try {
          const s = parseMesh(await res.arrayBuffer());
          if (!gone) setSolid(s);
          return;
        } catch {
          // Not a mesh file: try the next.
        }
      }
      if (!gone) setSolid("none");
    })();
    return () => {
      gone = true;
    };
  }, [scanId]);
  return solid;
}

export function Studio3D(props: {
  scanId: string;
  existing: Existing;
  design: Design;
  view: View;
  layer?: "built" | "scan"; // the basement as built (default), or the raw scan
  finish: Finish;
  selected: Picked;
  marker: Pt | null;
  reduced: boolean;
  canDragWall: (w: Wall) => boolean;
  onSelect: (p: Picked) => void;
  onWall: (id: string, a: Pt, b: Pt, done: boolean) => void;
  onOpening: (id: string, offsetM: number, done: boolean) => void;
}) {
  const { existing, design, view } = props;
  const wantScan = props.layer === "scan";
  const solid = useSolid(wantScan ? props.scanId : null);
  const { atlas } = useAtlas(props.scanId, existing);
  const spots = useSpots(props.scanId, existing.scale.factor ?? 1);
  const phone = useMemo(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches, []);
  const area = useMemo(() => suiteArea(existing, design), [existing, design]);
  const handles = useRef<THREE.Group>(null);
  // The as-built model stays up while the scan downloads, and when there's no scan to show.
  const scan = wantScan && solid && solid !== "none" ? solid : null;
  return (
    <TagRoot>
      <Canvas className="viewer-canvas" camera={{ fov: 62, near: 0.03, far: 100, position: [0, EYE_M, 0] }} dpr={[1, phone ? 1.5 : 2]} gl={{ antialias: true }}>
        <TagTracker />
        <color attach="background" args={[css("--color-surface", "#E6EBE4")]} />
        <DesignScene existing={existing} design={design} finish={props.finish} built={scan ? null : { atlas }} scan={scan} overview={view === "overview"} />
        <Overlay design={design} h={wallHeight(existing)} selected={props.selected} marker={props.marker} view={view} handles={handles} canDragWall={props.canDragWall} />
        {view === "walk" ? (
          <Walker design={design} existing={existing} start={area ? mainRect(area.polygon) : null} spots={spots} reduced={props.reduced} />
        ) : (
          <Overview existing={existing} reduced={props.reduced} />
        )}
        {view === "overview" && <Dragger handles={handles} design={design} onSelect={props.onSelect} onWall={props.onWall} onOpening={props.onOpening} />}
      </Canvas>
    </TagRoot>
  );
}

// Which label stays when two would overlap: what to fix, then rooms (the bigger first), then overhead finds.
const PRIORITY = { marker: 3, room: 2, overhead: 1 };

// What's picked, labels, a marker for a failing check, and the grab handles.
function Overlay({ design, h, selected, marker, view, handles, canDragWall }: { design: Design; h: number; selected: Picked; marker: Pt | null; view: View; handles: RefObject<THREE.Group | null>; canDragWall: (w: Wall) => boolean }) {
  const red = css("--color-stop", "#B42318");
  const mint = css("--color-mint", "#4BE38A");
  const { walls, openings, rooms, fixtures } = design.proposed;
  const sel = selected?.kind === "wall" ? walls.find((w) => w.id === selected.id) : null;
  const overview = view === "overview";
  return (
    <>
      {sel && (
        <WallBox w={sel} y={h / 2} height={h + 0.04} thick={0.18} extra={0.04}>
          <meshBasicMaterial color={mint} transparent opacity={0.35} depthWrite={false} />
        </WallBox>
      )}
      {marker && (
        <>
          <mesh position={[marker[0], 0.02, marker[1]]} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[0.32, 0.4, 40]} />
            <meshBasicMaterial color={red} />
          </mesh>
          <Tag position={[marker[0], 1.2, marker[1]]} priority={PRIORITY.marker}>
            <span className="viewer-tag studio-flag">To fix</span>
          </Tag>
        </>
      )}
      {overview &&
        rooms
          .filter((r) => r.unit === 2 || r.kind === "stairs" || r.kind === "mechanical")
          .map((r) => {
            const c = mainRect(r.polygon);
            return (
              <Tag key={r.id} position={[(c.x0 + c.x1) / 2, 0.3, (c.z0 + c.z1) / 2]} priority={PRIORITY.room + Math.min(0.99, polygonArea(r.polygon) / 1000)}>
                <span className="stage-tag">
                  <b>{r.name}</b> {floorArea(r, rooms) >= 2 && <span>{floorArea(r, rooms).toFixed(1)} m²</span>}
                </span>
              </Tag>
            );
          })}
      {overheadTags(fixtures).map((t) => (
        <Tag key={t.id} position={[t.at[0], Math.min(t.heightM, 2.2), t.at[1]]} priority={PRIORITY.overhead}>
          <span className="viewer-tag" data-kind="mechanical">
            <i /> {t.text}
          </span>
        </Tag>
      ))}
      {overview && (
        <group ref={handles}>
          {walls.filter(canDragWall).map((w) => (
            <WallBox key={w.id} w={w} y={h / 2} height={h} thick={0.3} userData={{ kind: "wall", id: w.id }}>
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </WallBox>
          ))}
          {openings.filter((o) => o.kind === "door" && walls.some((w) => w.id === o.wallId && canDragWall(w))).map((o) => {
            const w = walls.find((x) => x.id === o.wallId)!;
            const c = along(w, o.offsetM);
            return (
              <mesh key={o.id} position={[c[0], 2.2, c[1]]} userData={{ kind: "opening", id: o.id }}>
                <sphereGeometry args={[0.11, 20, 12]} />
                <meshBasicMaterial color={mint} />
              </mesh>
            );
          })}
        </group>
      )}
    </>
  );
}

// From above: drag a wall across, or a door's knob along its wall. A tap picks.
function Dragger({ handles, design, onSelect, onWall, onOpening }: { handles: RefObject<THREE.Group | null>; design: Design; onSelect: (p: Picked) => void; onWall: (id: string, a: Pt, b: Pt, done: boolean) => void; onOpening: (id: string, offsetM: number, done: boolean) => void }) {
  const { camera, gl, controls } = useThree();
  const latest = useRef({ design, onSelect, onWall, onOpening });
  latest.current = { design, onSelect, onWall, onOpening };
  useEffect(() => {
    const host = gl.domElement.parentElement ?? gl.domElement;
    const ray = new THREE.Raycaster();
    // The drag runs in a level plane at the height it was grabbed, so the wall follows the finger.
    const level = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onFloor = (e: PointerEvent): Pt | null => {
      ray.setFromCamera(ndc(e), camera);
      const hit = ray.ray.intersectPlane(level, new THREE.Vector3());
      return hit ? [hit.x, hit.z] : null;
    };
    let drag: { kind: "wall" | "opening"; id: string; start: Pt; x: number; y: number; moved: boolean; last: Pt } | null = null;
    const ctl = controls as unknown as { enabled: boolean } | null;
    const down = (e: PointerEvent) => {
      if (!handles.current) return;
      ray.setFromCamera(ndc(e), camera);
      const hit = ray.intersectObjects(handles.current.children, false)[0];
      const data = hit?.object.userData as { kind?: "wall" | "opening"; id?: string } | undefined;
      if (hit) level.constant = -hit.point.y;
      const start = onFloor(e);
      if (!data?.kind || !data.id || !start) return;
      // Ours, not the orbit's.
      e.stopPropagation();
      e.preventDefault();
      if (ctl) ctl.enabled = false;
      drag = { kind: data.kind, id: data.id, start, x: e.clientX, y: e.clientY, moved: false, last: start };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    };
    const apply = (p: Pt, done: boolean) => {
      if (!drag) return;
      const d = latest.current.design;
      if (drag.kind === "wall") {
        const w = d.proposed.walls.find((x) => x.id === drag!.id);
        if (!w) return;
        const n = wallNormal(w);
        const k = Math.round(dot(sub(p, drag.start), n) * 100) / 100;
        latest.current.onWall(w.id, [w.a[0] + n[0] * k, w.a[1] + n[1] * k], [w.b[0] + n[0] * k, w.b[1] + n[1] * k], done);
      } else {
        const o = d.proposed.openings.find((x) => x.id === drag!.id);
        const w = o && d.proposed.walls.find((x) => x.id === o.wallId);
        if (o && w) latest.current.onOpening(o.id, Math.round(project(w, p).t * 100) / 100, done);
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.moved = true;
      const p = onFloor(e);
      if (p) {
        drag.last = p;
        apply(p, false);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      if (ctl) ctl.enabled = true;
      if (!drag) return;
      if (drag.moved) apply(drag.last, true);
      else latest.current.onSelect({ kind: drag.kind, id: drag.id });
      drag = null;
    };
    // Capture, so a grab on a handle never starts the orbit underneath.
    host.addEventListener("pointerdown", down, { capture: true });
    return () => {
      host.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("pointermove", move);
      if (ctl) ctl.enabled = true;
    };
  }, [camera, gl, controls, handles]);
  return null;
}

function Overview({ existing, reduced }: { existing: Existing; reduced: boolean }) {
  const { camera, size } = useThree();
  const b = useMemo(() => bounds(existing.rooms.flatMap((r) => r.polygon)), [existing]);
  const center = useMemo(() => new THREE.Vector3((b.minX + b.maxX) / 2, 0.6, (b.minZ + b.maxZ) / 2), [b]);
  // Step back on a tall phone screen so the whole basement still fits across.
  const span = Math.max(4, b.maxX - b.minX, b.maxZ - b.minZ) * Math.max(1, 1.1 / (size.width / Math.max(1, size.height)));
  useEffect(() => {
    camera.position.set(center.x + span * 0.25, span * 1.05, center.z + span * 0.7);
    camera.lookAt(center);
    // Set when the view opens, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);
  return <OrbitControls makeDefault target={center} minDistance={1} maxDistance={span * 3} maxPolarAngle={Math.PI * 0.47} enableDamping={!reduced} />;
}

// Walking at eye height: drag to look, tap the floor to walk there, arrow keys or WASD to step. The
// design's walls stop you; doors let you through.
function Walker({ design, existing, start, spots, reduced }: { design: Design; existing: Existing; start: { x0: number; z0: number; x1: number; z1: number } | null; spots: Spot[]; reduced: boolean }) {
  const { camera, gl } = useThree();
  const look = useRef({ yaw: 0, pitch: -0.08 });
  const goal = useRef<THREE.Vector3 | null>(null);
  const keys = useRef(new Set<string>());
  // The walls to bump into, kept fresh as the design changes without restarting the walk.
  const solid = useRef<[Pt, Pt][]>([]);
  solid.current = useMemo(() => [...design.proposed.walls.flatMap((w) => solidPieces(w, design.proposed.openings)), ...existing.walls.filter((w) => !design.proposed.walls.some((x) => x.id === w.id)).map((w): [Pt, Pt] => [w.a, w.b])], [design, existing]);

  // Where the walk starts is set once, before they move; edits don't move you.
  const placed = useRef<"none" | "middle" | "spot">("none");
  useEffect(() => {
    // From where they filmed that looks furthest into the basement, once the spots are in. Doors count
    // as shut here: a long view through a doorway is a close-up of the door.
    const shut = [...design.proposed.walls, ...existing.walls.filter((w) => !design.proposed.walls.some((x) => x.id === w.id))].map((w): [Pt, Pt] => [w.a, w.b]);
    const view = bestView(spots, shut, existing.rooms.map((r) => r.polygon));
    if (view && placed.current !== "spot") {
      camera.position.set(view.at[0], EYE_M, view.at[1]);
      look.current = { yaw: Math.atan2(-view.dir[0], -view.dir[1]), pitch: -0.08 };
      placed.current = "spot";
      return;
    }
    if (placed.current !== "none") return;
    // Meanwhile (or for a scan without spots): the middle of the suite's main room, facing its longest view.
    const c: Pt = start ? [(start.x0 + start.x1) / 2, (start.z0 + start.z1) / 2] : [0, 0];
    camera.position.set(c[0], EYE_M, c[1]);
    const middle = bestView([0, 1, 2, 3].map((q): Spot => ({ at: c, dir: [Math.cos((q * Math.PI) / 2), Math.sin((q * Math.PI) / 2)] })), shut, []);
    if (middle) look.current.yaw = Math.atan2(-middle.dir[0], -middle.dir[1]);
    placed.current = "middle";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, spots]);

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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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

  const step = (dx: number, dz: number) => {
    const p = camera.position;
    const next = walkStep([p.x, p.z], [dx, dz], solid.current);
    if (!next) return false;
    p.set(next[0], EYE_M, next[1]);
    return true;
  };

  useFrame((_, dt) => {
    const { yaw, pitch } = look.current;
    const k = keys.current;
    const ahead = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const side = new THREE.Vector3(-ahead.z, 0, ahead.x);
    const fwd = (Number(k.has("w") || k.has("arrowup")) - Number(k.has("s") || k.has("arrowdown"))) * 1.4 * dt;
    const strafe = (Number(k.has("d") || k.has("arrowright")) - Number(k.has("a") || k.has("arrowleft"))) * 1.4 * dt;
    if (fwd || strafe) {
      step(ahead.x * fwd + side.x * strafe, ahead.z * fwd + side.z * strafe);
      goal.current = null;
    }
    if (goal.current) {
      const p = camera.position;
      const to = goal.current.clone().sub(p).setY(0);
      const d = to.length();
      // Reduced motion: no glide, small sure steps that still stop at walls.
      const speed = reduced ? d : Math.max(0.6, d * 3) * dt;
      let moved = d > 0.02;
      for (let walked = 0; moved && walked < Math.min(d, speed); walked += 0.05) {
        const s = Math.min(0.05, d - walked);
        moved = step((to.x / d) * s, (to.z / d) * s);
      }
      if (!moved || camera.position.distanceTo(goal.current) < 0.03) goal.current = null;
    }
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    camera.up.set(0, 1, 0);
    camera.lookAt(camera.position.clone().add(dir));
  });
  return null;
}
