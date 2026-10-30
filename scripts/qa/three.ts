// Fixed cameras for any three.js view, without touching the app. three.js announces every renderer and
// scene to window.__THREE_DEVTOOLS__ when it exists, so an init script can wrap each renderer's render():
// while a pose is set, every perspective camera it draws with is put at that pose first (so the post
// effects and the HTML labels follow it), and a cut plane can lift the ceiling off.
import type { Page } from "playwright";
import type { Camera } from "./plan";

// Runs in the page before any app code (page.addInitScript). Plain JS: it's serialized as is.
export function installThreeHook() {
  type R = { render: (s: unknown, c: unknown) => void; domElement: HTMLCanvasElement; clippingPlanes: unknown[] };
  const qa = {
    renderers: [] as R[],
    state: new WeakMap<object, { renders: number; scene: unknown; camera: unknown; orig: (s: unknown, c: unknown) => void }>(),
    pose: null as null | { canvas: HTMLCanvasElement; position: number[]; target: number[]; up: number[]; fov: number; near: number; far: number; cut: number | null },
  };
  (window as unknown as { __qa3d: typeof qa }).__qa3d = qa;
  const hub = new EventTarget();
  hub.addEventListener("observe", (e) => {
    const o = (e as CustomEvent).detail;
    if (!o || !o.isWebGLRenderer || qa.state.has(o)) return;
    const r = o as R;
    const orig = r.render.bind(r);
    const st = { renders: 0, scene: null as unknown, camera: null as unknown, orig };
    qa.state.set(r, st);
    qa.renderers.push(r);
    r.render = (scene: unknown, camera: unknown) => {
      const cam = camera as { isPerspectiveCamera?: boolean };
      const p = qa.pose;
      if (p && p.canvas === r.domElement && cam?.isPerspectiveCamera) {
        const c = camera as any;
        c.position.set(p.position[0], p.position[1], p.position[2]);
        c.up.set(p.up[0], p.up[1], p.up[2]);
        c.lookAt(p.target[0], p.target[1], p.target[2]);
        c.fov = p.fov;
        c.near = p.near;
        c.far = p.far;
        c.updateProjectionMatrix();
        c.updateMatrixWorld(true);
      }
      if (cam?.isPerspectiveCamera) {
        st.scene = scene;
        st.camera = camera;
      }
      st.renders++;
      return orig(scene, camera);
    };
  });
  (window as unknown as { __THREE_DEVTOOLS__: EventTarget }).__THREE_DEVTOOLS__ = hub;
}

export type Bounds = { min: [number, number, number]; max: [number, number, number]; objects: number };
export type Pose = { position: number[]; target: number[]; up: number[]; fov: number; near: number; far: number; cut: number | null };

// The largest visible three.js canvas on the page (inside `within` when given): its index among the
// hooked renderers, and its box on screen. With none visible, the largest hidden one (an off-screen
// render canvas like the pictures page's) with hidden: true, to be grabbed with grab().
export type CanvasRef = { index: number; box: { x: number; y: number; width: number; height: number }; hidden: boolean };
export async function mainCanvas(page: Page, within?: string): Promise<CanvasRef | null> {
  return page.evaluate((within) => {
    const qa = (window as any).__qa3d;
    if (!qa) return null;
    const scope = within ? document.querySelector(within) : null;
    if (within && !scope) return null;
    const shown = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      }
      const b = el.getBoundingClientRect();
      return b.right > 0 && b.left < innerWidth;
    };
    const all: { index: number; box: { x: number; y: number; width: number; height: number }; area: number; hidden: boolean }[] = [];
    qa.renderers.forEach((r: any, index: number) => {
      const el = r.domElement as HTMLCanvasElement;
      if (!el.isConnected || (scope && !scope.contains(el))) return;
      const b = el.getBoundingClientRect();
      const area = b.width * b.height;
      if (area < 120 * 120) return;
      all.push({ index, box: { x: b.x, y: b.y, width: b.width, height: b.height }, area, hidden: !shown(el) });
    });
    all.sort((a, b) => Number(a.hidden) - Number(b.hidden) || b.area - a.area);
    const best = all[0];
    return best ? { index: best.index, box: best.box, hidden: best.hidden } : null;
  }, within ?? null);
}

// What the scene holds, from its meshes and points: big flat helpers (ground, sky) are left out.
export async function sceneBounds(page: Page, index: number): Promise<Bounds | null> {
  return page.evaluate((i) => {
    const qa = (window as any).__qa3d;
    const r = qa?.renderers[i];
    const st = r && qa.state.get(r);
    const scene = st?.scene;
    if (!scene) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let objects = 0;
    const V = st.camera.position.constructor;
    const p = new V();
    scene.updateMatrixWorld(true);
    scene.traverse((o: any) => {
      if (!o.visible || !(o.isMesh || o.isPoints) || !o.geometry) return;
      let hidden = false;
      for (let q = o.parent; q; q = q.parent) if (q.visible === false) hidden = true;
      if (hidden) return;
      const g = o.geometry;
      if (o.isInstancedMesh) o.computeBoundingBox?.();
      else if (!g.boundingBox) g.computeBoundingBox();
      const bb = o.isInstancedMesh ? o.boundingBox : g.boundingBox;
      if (!bb || !isFinite(bb.min.x)) return;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 8; k++) {
        p.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld);
        const v = [p.x, p.y, p.z];
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], v[a]);
          hi[a] = Math.max(hi[a], v[a]);
        }
      }
      if (hi[0] - lo[0] > 60 || hi[2] - lo[2] > 60 || hi[1] - lo[1] > 30) return;
      objects++;
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], lo[a]);
        max[a] = Math.max(max[a], hi[a]);
      }
    });
    return objects ? { min, max, objects } : null;
  }, index) as Promise<Bounds | null>;
}

// The three fixed cameras for a room with these bounds. Plan bounds (x/z from the confirmed plan) win
// over the scene's when given, so the cameras frame the basement rather than the whole stage.
export function cameraPose(camera: Camera, b: { min: number[]; max: number[] }, aspect: number): Pose {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const d = z1 - z0;
  const h = Math.max(1.8, y1 - y0);
  const floor = y0;
  // Cut below the ceiling for the views from above; the eye stays inside the room with it on.
  const cut = floor + Math.min(h - 0.15, Math.max(1.6, h * 0.82));
  if (camera === "eye") {
    const inset = Math.min(0.7, Math.min(w, d) * 0.15);
    return { position: [x0 + inset, floor + 1.5, z1 - inset], target: [x1 - inset, floor + 1.1, z0 + inset], up: [0, 1, 0], fov: 72, near: 0.05, far: 200, cut: null };
  }
  if (camera === "above") {
    // Framed at the cut, the nearest part of the room to the camera, with a margin.
    const fov = 40;
    const t = Math.tan(((fov / 2) * Math.PI) / 180);
    const dist = (Math.max(d, w / Math.max(aspect, 0.3)) / 2 / t) * 1.25;
    return { position: [cx, cut + dist, cz + 0.001], target: [cx, floor, cz], up: [0, 0, -1], fov, near: 0.1, far: cut + dist + 50, cut };
  }
  const span = Math.hypot(w, d);
  return { position: [x1 + span * 0.45, floor + span * 0.75, z1 + span * 0.55], target: [cx, floor + 0.4, cz], up: [0, 1, 0], fov: 45, near: 0.1, far: span * 6 + 50, cut };
}

// Places to stand at eye level: near each corner looking at the opposite one, and the middle of each
// short side looking down the long axis. The capture keeps the one that sees the most (a pose that
// lands in a partition wall sees one flat colour).
export function eyeCandidates(b: { min: number[]; max: number[] }): Pose[] {
  const [x0, y0, z0] = b.min;
  const [x1, , z1] = b.max;
  const w = x1 - x0;
  const d = z1 - z0;
  const inset = Math.min(0.7, Math.min(w, d) * 0.15);
  const eye = y0 + 1.5;
  const look = y0 + 1.1;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const pose = (from: number[], to: number[]): Pose => ({ position: [from[0], eye, from[1]], target: [to[0], look, to[1]], up: [0, 1, 0], fov: 72, near: 0.05, far: 200, cut: null });
  const corners = [
    [x0 + inset, z1 - inset, x1 - inset, z0 + inset],
    [x1 - inset, z0 + inset, x0 + inset, z1 - inset],
    [x0 + inset, z0 + inset, x1 - inset, z1 - inset],
    [x1 - inset, z1 - inset, x0 + inset, z0 + inset],
  ].map(([a, b2, c, e]) => pose([a, b2], [c, e]));
  const sides = w >= d ? [pose([x0 + inset, cz], [x1, cz]), pose([x1 - inset, cz], [x0, cz])] : [pose([cx, z0 + inset], [cx, z1]), pose([cx, z1 - inset], [cx, z0])];
  return [...corners, ...sides];
}

// Puts the canvas's camera at a pose (and the cut plane on), waits for it to draw, and returns whether
// it drew. A view that only draws on demand is drawn once by hand.
export async function setPose(page: Page, index: number, pose: Pose | null): Promise<boolean> {
  return page.evaluate(
    async ({ i, pose }) => {
      const qa = (window as any).__qa3d;
      const r = qa?.renderers[i];
      const st = r && qa.state.get(r);
      if (!st) return false;
      const frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
      if (!pose) {
        qa.pose = null;
        if (r.__qaPlanes !== undefined) {
          r.clippingPlanes = r.__qaPlanes;
          delete r.__qaPlanes;
        }
        if (r.__qaCam) {
          const c = st.camera;
          const s = r.__qaCam;
          c.position.copy(s.position);
          c.quaternion.copy(s.quaternion);
          c.up.copy(s.up);
          c.fov = s.fov;
          c.near = s.near;
          c.far = s.far;
          c.updateProjectionMatrix();
          delete r.__qaCam;
        }
        return true;
      }
      if (!r.__qaCam && st.camera) {
        const c = st.camera;
        r.__qaCam = { position: c.position.clone(), quaternion: c.quaternion.clone(), up: c.up.clone(), fov: c.fov, near: c.near, far: c.far };
      }
      if (r.__qaPlanes === undefined) r.__qaPlanes = r.clippingPlanes;
      const V = st.camera.position.constructor;
      // A plain {normal, constant} is all three's clipping reads: points above `cut` are dropped.
      r.clippingPlanes = pose.cut == null ? [] : [{ normal: new V(0, -1, 0), constant: pose.cut }];
      qa.pose = { canvas: r.domElement, ...pose };
      const before = st.renders;
      for (let k = 0; k < 6; k++) await frame();
      // Drew fewer than twice on its own (frameloop "demand" or "never"): draw with the pose by hand.
      if (st.renders - before < 2 && st.scene) r.render(st.scene, st.camera);
      // Let the HTML labels catch up with the new camera.
      for (let k = 0; k < 3; k++) await frame();
      return true;
    },
    { i: index, pose },
  );
}

// Projects world points (x, y, z) to page pixels with the canvas's current camera.
export async function project(page: Page, index: number, points: number[][]): Promise<(number[] | null)[]> {
  return page.evaluate(
    ({ i, points }) => {
      const qa = (window as any).__qa3d;
      const r = qa?.renderers[i];
      const st = r && qa.state.get(r);
      if (!st?.camera) return points.map(() => null);
      const c = st.camera;
      c.updateMatrixWorld(true);
      const V = c.position.constructor;
      const b = r.domElement.getBoundingClientRect();
      return points.map(([x, y, z]) => {
        const v = new V(x, y, z).project(c);
        if (v.z > 1) return null;
        return [b.x + ((v.x + 1) / 2) * b.width, b.y + ((1 - v.y) / 2) * b.height];
      });
    },
    { i: index, points },
  );
}

// Draws one frame from a pose straight into the canvas and reads it back as a PNG (base64), for a canvas
// that isn't on screen. HTML labels aren't in it.
export async function grab(page: Page, index: number, pose: Pose): Promise<Buffer | null> {
  const b64 = await page.evaluate(
    ({ i, pose }) => {
      const qa = (window as any).__qa3d;
      const r = qa?.renderers[i];
      const st = r && qa.state.get(r);
      if (!st?.scene || !st.camera) return null;
      const V = st.camera.position.constructor;
      const planes = r.clippingPlanes;
      const c = st.camera;
      const saved = { position: c.position.clone(), quaternion: c.quaternion.clone(), up: c.up.clone(), fov: c.fov, near: c.near, far: c.far };
      r.clippingPlanes = pose.cut == null ? [] : [{ normal: new V(0, -1, 0), constant: pose.cut }];
      qa.pose = { canvas: r.domElement, ...pose };
      r.render(st.scene, st.camera);
      const url = r.domElement.toDataURL("image/png");
      qa.pose = null;
      r.clippingPlanes = planes;
      c.position.copy(saved.position);
      c.quaternion.copy(saved.quaternion);
      c.up.copy(saved.up);
      Object.assign(c, { fov: saved.fov, near: saved.near, far: saved.far });
      c.updateProjectionMatrix();
      return url.split(",")[1] ?? null;
    },
    { i: index, pose },
  );
  return b64 ? Buffer.from(b64, "base64") : null;
}
