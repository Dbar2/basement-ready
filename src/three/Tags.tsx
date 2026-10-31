// Labels pinned to points in a 3D scene, drawn as plain page elements over the canvas and moved every
// frame. drei's <Html> gives each label its own React root inside the canvas's container; leaving a tab
// tears the canvas down first, and those roots then throw as they clean up.
//
// <TagRoot> goes around the <Canvas>, <TagTracker /> inside it, and <Tag position> anywhere in the scene.
// Labels never pile up: where two would overlap, the one with the lower `priority` (then the farther
// one) is hidden until there's room for it.
import { useFrame, useThree } from "@react-three/fiber";
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import * as THREE from "three";

type Entry = { id: number; obj: THREE.Object3D; node: ReactNode; el: HTMLDivElement | null; priority: number };

class TagStore {
  entries = new Map<number, Entry>();
  layer: HTMLDivElement | null = null;
  private next = 1;
  private listeners = new Set<() => void>();
  private list: Entry[] = [];
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  snapshot = () => this.list;
  private changed() {
    this.list = [...this.entries.values()];
    this.listeners.forEach((fn) => fn());
  }
  add(obj: THREE.Object3D, node: ReactNode, priority = 0) {
    const id = this.next++;
    this.entries.set(id, { id, obj, node, el: null, priority });
    this.changed();
    return id;
  }
  update(id: number, node: ReactNode, priority = 0) {
    const e = this.entries.get(id);
    if (!e) return;
    e.priority = priority;
    if (e.node === node) return;
    e.node = node;
    this.changed();
  }
  remove(id: number) {
    if (this.entries.delete(id)) this.changed();
  }
}

const TagContext = createContext<TagStore | null>(null);

function TagLayer({ store }: { store: TagStore }) {
  const entries = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return (
    <div className="tag-layer" ref={(el) => void (store.layer = el)}>
      {entries.map((e) => (
        <div key={e.id} className="tag-pin" ref={(el) => void (e.el = el)}>
          {e.node}
        </div>
      ))}
    </div>
  );
}

export function TagRoot({ children }: { children: ReactNode }) {
  const [store] = useState(() => new TagStore());
  return (
    <TagContext.Provider value={store}>
      {children}
      <TagLayer store={store} />
    </TagContext.Provider>
  );
}

// Each frame: where every label's point lands on the canvas, nearer labels on top, none behind the camera,
// and none on top of a more important one.
export function TagTracker() {
  const store = useContext(TagContext);
  const { camera, gl } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!store?.layer) return;
    const c = gl.domElement.getBoundingClientRect(), l = store.layer.getBoundingClientRect();
    const shown: { e: Entry; x: number; y: number; z: number; w: number; h: number }[] = [];
    for (const e of store.entries.values()) {
      if (!e.el) continue;
      e.obj.getWorldPosition(v).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) {
        e.el.style.visibility = "hidden";
        continue;
      }
      const x = c.left - l.left + ((v.x + 1) / 2) * c.width, y = c.top - l.top + ((1 - v.y) / 2) * c.height;
      e.el.style.zIndex = String(Math.round((1 - v.z) * 1000));
      e.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      shown.push({ e, x, y, z: v.z, w: e.el.offsetWidth, h: e.el.offsetHeight });
    }
    // The most important first (then the nearest); a label that would overlap one already placed waits.
    shown.sort((a, b) => b.e.priority - a.e.priority || a.z - b.z);
    const placed: typeof shown = [];
    for (const t of shown) {
      const clash = placed.some((p) => Math.abs(p.x - t.x) * 2 < p.w + t.w + 4 && Math.abs(p.y - t.y) * 2 < p.h + t.h + 2);
      t.e.el!.style.visibility = clash ? "hidden" : "visible";
      if (!clash) placed.push(t);
    }
  });
  return null;
}

// `priority`: which label stays when two would overlap (higher wins; equal, the nearer).
export function Tag({ position, priority = 0, children }: { position: [number, number, number]; priority?: number; children: ReactNode }) {
  const store = useContext(TagContext);
  const ref = useRef<THREE.Group>(null);
  const id = useRef(0);
  useLayoutEffect(() => {
    if (!store || !ref.current) return;
    id.current = store.add(ref.current, children, priority);
    return () => store.remove(id.current);
    // The label's content follows below; registering again would reorder it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  useLayoutEffect(() => store?.update(id.current, children, priority));
  return <group ref={ref} position={position} />;
}
