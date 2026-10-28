// Builds a point cloud for the scan reveal. Today it samples the sample
// basement's surfaces; later the same attributes get filled from a real
// MapAnything scan (positions + colours + per-point SAM labels).
import * as THREE from "three";
import { objects, room, type Box, type FindKind } from "../data/sampleBasement";

export const FIND_KINDS: FindKind[] = ["window", "exit", "stairs", "duct", "beam", "mechanical"];

// Read the brand's find colours from CSS so 3D and UI never drift apart.
export function findColors(): THREE.Color[] {
  const css = getComputedStyle(document.documentElement);
  return FIND_KINDS.map((k) => new THREE.Color(css.getPropertyValue(`--find-${k}`).trim() || "#888"));
}

type Surface = {
  // Point on the plane, two edge vectors, and a base colour (linear-ish greys).
  origin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  color: [number, number, number];
  find: number; // index into FIND_KINDS, or -1
  objectId?: string;
  density?: number; // multiplier, so the floor doesn't drown the walls
};

function boxSurfaces(b: Box, color: [number, number, number], find: number): Surface[] {
  const [cx, cy, cz] = b.center;
  const [sx, sy, sz] = b.size;
  const x0 = cx - sx / 2, y0 = cy - sy / 2, z0 = cz - sz / 2;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const faces: Surface[] = [
    { origin: V(x0, y0 + sy, z0), u: V(sx, 0, 0), v: V(0, 0, sz), color, find }, // top
    { origin: V(x0, y0, z0), u: V(sx, 0, 0), v: V(0, sy, 0), color, find }, // back
    { origin: V(x0, y0, z0 + sz), u: V(sx, 0, 0), v: V(0, sy, 0), color, find }, // front
    { origin: V(x0, y0, z0), u: V(0, 0, sz), v: V(0, sy, 0), color, find }, // left
    { origin: V(x0 + sx, y0, z0), u: V(0, 0, sz), v: V(0, sy, 0), color, find }, // right
  ];
  return faces.map((f) => ({ ...f, objectId: b.id }));
}

const FIND_INDEX = Object.fromEntries(FIND_KINDS.map((k, i) => [k, i])) as Record<FindKind, number>;

export function buildSampleCloud(density = 900) {
  const W = room.width / 2, D = room.depth / 2, H = room.height;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Darker than the real materials on purpose: on plaster the scan reads
  // like a stippled ink drawing.
  const concrete: [number, number, number] = [0.42, 0.5, 0.45];
  const foundation: [number, number, number] = [0.12, 0.25, 0.18];
  const joist: [number, number, number] = [0.42, 0.3, 0.2];

  const surfaces: Surface[] = [
    { origin: V(-W, 0, -D), u: V(room.width, 0, 0), v: V(0, 0, room.depth), color: concrete, find: -1, density: 0.4 }, // floor
    { origin: V(-W, 0, -D), u: V(room.width, 0, 0), v: V(0, H, 0), color: foundation, find: -1 }, // back wall
    { origin: V(W, 0, -D), u: V(0, 0, room.depth), v: V(0, H, 0), color: foundation, find: -1 }, // right wall
    { origin: V(-W, 0, -D), u: V(0, 0, room.depth), v: V(0, H, 0), color: foundation, find: -1 }, // left wall
    { origin: V(-W, H, -D), u: V(room.width, 0, 0), v: V(0, 0, room.depth), color: joist, find: -1 }, // joists
  ];
  for (const o of objects) {
    const base: [number, number, number] =
      o.kind === "window" ? [0.45, 0.5, 0.55] :
      o.kind === "beam" ? [0.4, 0.28, 0.18] :
      o.kind === "duct" ? [0.38, 0.4, 0.42] :
      o.kind === "stairs" ? [0.42, 0.32, 0.22] : [0.3, 0.31, 0.3];
    surfaces.push(...boxSurfaces(o, base, FIND_INDEX[o.kind as FindKind] ?? -1));
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const finds: number[] = [];
  const order: number[] = [];

  for (const s of surfaces) {
    const area = s.u.length() * s.v.length();
    const n = Math.max(40, Math.round(area * density * (s.density ?? 1) * (s.find >= 0 ? 2.2 : 1)));
    for (let i = 0; i < n; i++) {
      const a = Math.random(), b = Math.random();
      const p = s.origin.clone().addScaledVector(s.u, a).addScaledVector(s.v, b);
      // A little noise so it reads as a real capture, not a CAD model.
      p.x += (Math.random() - 0.5) * 0.012;
      p.y += (Math.random() - 0.5) * 0.012;
      p.z += (Math.random() - 0.5) * 0.012;
      positions.push(p.x, p.y, p.z);
      const shade = 0.88 + Math.random() * 0.2;
      colors.push(s.color[0] * shade, s.color[1] * shade, s.color[2] * shade);
      finds.push(s.find);
      // Reveal order sweeps around the room like a walking camera, plus jitter.
      const angle = (Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2);
      order.push(Math.min(1, Math.max(0, angle * 0.85 + Math.random() * 0.15)));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aFind", new THREE.Float32BufferAttribute(finds, 1));
  geometry.setAttribute("aOrder", new THREE.Float32BufferAttribute(order, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// Points rise into place as the sweep passes, then each found object
// takes on its brand colour when its highlight switches on.
export function makeScanMaterial(colors: THREE.Color[]) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uReveal: { value: 0 },
      uHighlight: { value: new Array(FIND_KINDS.length).fill(0) },
      uFindColors: { value: colors },
      uSize: { value: 2.0 },
      // Fades the ceiling out when the camera rises above it (dollhouse view).
      uClipY: { value: room.height - 0.03 },
      uCeilingFade: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute float aFind;
      attribute float aOrder;
      uniform float uReveal;
      uniform float uHighlight[${FIND_KINDS.length}];
      uniform vec3 uFindColors[${FIND_KINDS.length}];
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uClipY;
      uniform float uCeilingFade;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float t = clamp((uReveal - aOrder) / 0.08, 0.0, 1.0);
        float ease = 1.0 - pow(1.0 - t, 3.0);
        vec3 p = position;
        p.y += (1.0 - ease) * 0.6;
        vec3 c = color;
        float h = 0.0;
        int k = int(aFind + 0.5);
        for (int i = 0; i < ${FIND_KINDS.length}; i++) {
          if (i == k && aFind >= 0.0) { h = uHighlight[i]; c = mix(c, uFindColors[i], h); }
        }
        vColor = c;
        vAlpha = ease * (position.y > uClipY ? 1.0 - uCeilingFade : 1.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPixelRatio * (1.0 + h * 0.8) * clamp(9.0 / -mv.z, 0.75, 2.2);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25 || vAlpha < 0.02) discard;
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
    vertexColors: true,
  });
}
