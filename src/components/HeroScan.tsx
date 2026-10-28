// The homepage hero: a real basement photo with a scan drawing itself over it.
// Coordinates are percentages of the (mirrored) photo, traced from hero-basement.jpg.
// When David's own footage replaces the placeholder, re-trace these points.
import { useMemo } from "react";

const ASPECT = 1126 / 2000; // photo height / width
type P = [number, number];

// Structural edges the scan "finds": walls, floor line, window, stairs, furnace.
const EDGES: P[][] = [
  [[100, 11.7], [53.3, 31.9]], // right wall, top
  [[100, 85], [53.3, 59.5]], // right wall, floor line
  [[53.3, 31.9], [53.3, 59.5]], // back corner
  [[53.3, 59.5], [22, 59]], // back wall, floor line
  [[53.3, 31.9], [22, 31.5]], // back wall, top
  [[83.9, 13.8], [98.5, 13.8], [98.5, 33.5], [83.9, 33.5], [83.9, 13.8]], // window
  [[19.6, 31.9], [19.6, 77.6]], // stair stringer
  [[19, 33], [1, 74]], // stair nosing
  [[33.6, 44.6], [38.1, 44.6], [38.1, 59], [33.6, 59], [33.6, 44.6]], // furnace
  [[43.8, 41.4], [47.7, 41.4], [47.7, 58.2], [43.8, 58.2], [43.8, 41.4]], // water heater
];

// Areas that get a sparse scatter of points: right wall and floor.
const AREAS: P[][] = [
  [[100, 11.7], [53.3, 31.9], [53.3, 59.5], [100, 85]],
  [[100, 85], [53.3, 59.5], [22, 59], [0, 80], [0, 100], [100, 100]],
];

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function inside(p: P, poly: P[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

type Dot = { x: number; y: number; r: number; delay: number; ink: boolean };

function buildDots(): Dot[] {
  const rand = rng(7);
  const dots: Dot[] = [];
  const sweep = (x: number) => 0.25 + ((100 - x) / 100) * 1.5 + rand() * 0.25; // right to left, like a phone pan
  for (const line of EDGES) {
    for (let s = 0; s < line.length - 1; s++) {
      const [a, b] = [line[s], line[s + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(4, Math.round(len / 0.55));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = a[0] + (b[0] - a[0]) * t + (rand() - 0.5) * 0.35;
        const y = a[1] + (b[1] - a[1]) * t + (rand() - 0.5) * 0.35;
        dots.push({ x, y, r: 0.16 + rand() * 0.08, delay: sweep(x), ink: false });
      }
    }
  }
  for (const poly of AREAS) {
    let placed = 0;
    while (placed < 260) {
      const p: P = [rand() * 100, rand() * 100];
      if (!inside(p, poly)) continue;
      dots.push({ x: p[0], y: p[1], r: 0.09 + rand() * 0.07, delay: sweep(p[0]) + 0.2, ink: rand() < 0.4 });
      placed++;
    }
  }
  return dots;
}

export function HeroScan() {
  const dots = useMemo(buildDots, []);
  const h = 100 * ASPECT;
  return (
    <div className="hero-media" aria-hidden>
      <img src="/img/hero-basement.jpg" alt="" style={{ transform: "scaleX(-1)" }} />
      <svg className="scan-overlay" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none">
        {dots.map((d, i) => (
          <circle
            key={i}
            className={`pt${d.ink ? " ink" : ""}`}
            cx={d.x}
            cy={(d.y / 100) * h}
            r={d.r}
            style={{ animationDelay: `${d.delay}s` }}
          />
        ))}
      </svg>

      <div className="callout" style={{ left: "64%", top: "17%", animationDelay: "1.5s" }}>
        <span className="tag">
          Window <b>0.28 m²</b>
          <em>Too small to escape</em>
        </span>
      </div>
      <div className="measure-line" style={{ left: "50%", top: "31.6%", height: "27.6%", animationDelay: "1.9s" }} />
      <div className="callout" style={{ left: "51.5%", top: "38%", animationDelay: "2.1s" }}>
        <span className="tag">
          Ceiling <b>2.10 m</b>
        </span>
      </div>
      <div className="callout" style={{ left: "26%", top: "62%", animationDelay: "2.5s" }}>
        <span className="tag">
          Furnace <b>shared</b>
        </span>
      </div>
    </div>
  );
}
