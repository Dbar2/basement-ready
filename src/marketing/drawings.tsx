// Line drawings for the marketing pages, in the brand's cutaway style: forest
// structure lines, mint scan points, mono measurements. Strokes marked
// data-s draw themselves when their parent gets data-in (see marketing.css).
import { useId, useMemo, type CSSProperties } from "react";

const d = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function Hatch({ id }: { id: string }) {
  return (
    <pattern id={id} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="9" className="mk-hatch" />
    </pattern>
  );
}

function Grass({ from, to, y }: { from: number; to: number; y: number }) {
  const rand = rng(from + to);
  let p = "";
  for (let x = from + 3; x < to; x += 7) p += `M${x} ${y}l${(rand() - 0.5) * 3} ${-4 - rand() * 4}`;
  return <path d={p} className="mk-grass" />;
}

// ---------- How it works: a basement, scanned ----------

const STAIR = (() => {
  let p = "M552 86";
  for (let i = 0; i < 8; i++) p += `H${552 - 15 * (i + 1)}V${86 + 24.25 * (i + 1)}`;
  return p;
})();

export function ScanSection() {
  const hatch = useId().replace(/:/g, "");
  const dots = useMemo(() => {
    const rand = rng(11);
    const edges: [number, number, number, number][] = [
      [72, 86, 568, 86], // joists
      [72, 86, 72, 280], // left wall
      [568, 86, 568, 280], // right wall
      [72, 280, 568, 280], // floor
      [180, 104, 430, 104], // duct
      [300, 196, 344, 196], // furnace
      [58, 90, 58, 118], // window
      [432, 280, 552, 86], // stair line
    ];
    const out: { x: number; y: number; r: number; t: number }[] = [];
    for (const [x1, y1, x2, y2] of edges) {
      const n = Math.round(Math.hypot(x2 - x1, y2 - y1) / 9);
      for (let i = 0; i <= n; i++) {
        const x = x1 + ((x2 - x1) * i) / n + (rand() - 0.5) * 3;
        const y = y1 + ((y2 - y1) * i) / n + (rand() - 0.5) * 3;
        out.push({ x, y, r: 1.4 + rand() * 0.9, t: 1.1 + ((640 - x) / 640) * 1.3 + rand() * 0.15 });
      }
    }
    return out;
  }, []);

  return (
    <svg className="mk-art mk-scan" viewBox="0 0 640 320" role="img" aria-label="A drawing of a basement in cross-section. Scan points trace the walls, floor, duct, furnace, stairs and window. The ceiling measures 2.10 m and the clearance under the duct 1.88 m.">
      <defs>
        <Hatch id={hatch} />
      </defs>
      <rect x="0" y="66" width="58" height="254" fill={`url(#${hatch})`} />
      <rect x="582" y="66" width="58" height="254" fill={`url(#${hatch})`} />
      <rect x="58" y="294" width="524" height="26" fill={`url(#${hatch})`} />
      <Grass from={0} to={58} y={64} />
      <Grass from={582} to={640} y={64} />

      <g className="mk-line">
        <path data-s pathLength={1} style={d(0)} d="M0 64H640" />
        <path data-s pathLength={1} style={d(0.1)} d="M72 0V64M568 0V64" />
        <path data-s pathLength={1} style={d(0.2)} d="M60 64V292H580V64M72 64V280H568V64" />
        <path data-s pathLength={1} style={d(0.35)} d="M72 72H568M72 86H568" />
        <path data-s pathLength={1} style={d(0.5)} d="M28 64V126H58M58 90H74V118H58Z" />
        <path data-s pathLength={1} style={d(0.6)} d="M180 86H430V104H180Z" />
        <path data-s pathLength={1} style={d(0.7)} d={STAIR} />
        <path data-s pathLength={1} style={d(0.8)} d="M300 196H344V280H300ZM308 206H336" />
        <path data-s pathLength={1} style={d(0.85)} d="M356 222a12 12 0 0 1 24 0V280H356Z" />
      </g>
      <g className="mk-ticks">
        {Array.from({ length: 21 }, (_, i) => (
          <line key={i} x1={84 + i * 23.6} y1="72" x2={84 + i * 23.6} y2="86" />
        ))}
      </g>

      <g className="mk-points">
        {dots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.r} style={d(p.t)} />
        ))}
      </g>

      <g className="mk-dim" style={d(2.6)}>
        <path d="M136 86V280M130 86H142M130 280H142" />
        <text x="146" y="188">2.10 m</text>
      </g>
      <g className="mk-dim" style={d(2.85)}>
        <path d="M244 104V280M238 104H250M238 280H250" />
        <text x="254" y="212">1.88 m</text>
      </g>
      <g className="mk-dim" style={d(3.1)}>
        <path d="M74 104H96" />
        <text x="100" y="108">0.28 m²</text>
      </g>
    </svg>
  );
}

// ---------- How it works: one small drawing per step ----------

export type StepGlyph = "film" | "scan" | "answer" | "model" | "money" | "build";

export function StepArt({ kind }: { kind: StepGlyph }) {
  return (
    <svg className="mk-art mk-glyph" viewBox="0 0 64 64" aria-hidden>
      <g className="mk-line">{GLYPHS[kind]}</g>
    </svg>
  );
}

const GLYPHS: Record<StepGlyph, React.ReactNode> = {
  film: (
    <>
      <rect data-s pathLength={1} style={d(0)} x="20" y="8" width="24" height="48" rx="4" />
      <path data-s pathLength={1} style={d(0.2)} d="M28 14H36" />
      <circle className="mk-fill-mint" cx="32" cy="34" r="5" />
      <path data-s pathLength={1} style={d(0.35)} d="M50 24a14 14 0 0 1 0 20M55 19a21 21 0 0 1 0 30" />
    </>
  ),
  scan: (
    <>
      <path data-s pathLength={1} style={d(0)} d="M10 22L32 10L54 22V46L32 58L10 46Z" />
      <path data-s pathLength={1} style={d(0.25)} d="M10 22L32 34L54 22M32 34V58" />
      {[[10, 22], [32, 10], [54, 22], [54, 46], [32, 58], [10, 46], [32, 34]].map(([x, y]) => (
        <circle key={`${x}-${y}`} className="mk-fill-mint" cx={x} cy={y} r="2.6" />
      ))}
    </>
  ),
  answer: (
    <>
      <rect data-s pathLength={1} style={d(0)} x="10" y="8" width="44" height="48" rx="4" />
      <path data-s pathLength={1} style={d(0.2)} d="M18 20H24M30 20H46M18 32H24M30 32H42M18 44H24M30 44H46" />
    </>
  ),
  model: (
    <>
      <path data-s pathLength={1} style={d(0)} d="M8 40L32 52L56 40L32 28Z" />
      <path data-s pathLength={1} style={d(0.25)} d="M8 40V18L32 6V28M56 40V18L32 6" />
      <path data-s pathLength={1} style={d(0.45)} d="M22 40L32 45L42 40L32 35Z" />
    </>
  ),
  money: (
    <>
      <ellipse data-s pathLength={1} style={d(0)} cx="32" cy="16" rx="18" ry="6" />
      <path data-s pathLength={1} style={d(0.2)} d="M14 16V28c0 3.3 8 6 18 6s18-2.7 18-6V16M14 28V40c0 3.3 8 6 18 6s18-2.7 18-6V28M14 40V48c0 3.3 8 6 18 6s18-2.7 18-6V40" />
    </>
  ),
  build: (
    <>
      <path data-s pathLength={1} style={d(0)} d="M10 56V30L32 12L54 30V56Z" />
      <path data-s pathLength={1} style={d(0.25)} d="M27 56V40H37V56" />
      <path data-s pathLength={1} style={d(0.4)} d="M4 56H60" />
    </>
  ),
};

// ---------- Cities: how many homes a lot can hold ----------
// Slots fill in order: basement, main floor, upper floor, backyard building.

export function UnitsArt({ units, label }: { units: number; label: string }) {
  const slots = [
    { x: 24, y: 98, w: 82, h: 26 }, // basement
    { x: 24, y: 68, w: 82, h: 26 }, // main
    { x: 24, y: 40, w: 82, h: 24 }, // upper
    { x: 132, y: 70, w: 36, h: 24 }, // backyard
  ];
  return (
    <svg className="mk-art mk-units" viewBox="0 0 180 132" role="img" aria-label={label}>
      <g className="mk-line">
        <path data-s pathLength={1} style={d(0)} d="M0 96H180" />
        <path data-s pathLength={1} style={d(0.1)} d="M20 96V36L65 8L110 36V96M20 96V128H110V96" />
        <path data-s pathLength={1} style={d(0.25)} d="M128 96V66L150 52L172 66V96" />
      </g>
      {slots.map((s, i) => (
        <rect
          key={i}
          className={i >= units ? "mk-slot mk-slot-empty" : i === 0 ? "mk-slot mk-slot-focus" : "mk-slot"}
          style={d(0.5 + i * 0.18)}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx="3"
        />
      ))}
    </svg>
  );
}

// ---------- About: the home inside the basement ----------

export function HomeInside() {
  const hatch = useId().replace(/:/g, "");
  return (
    <svg className="mk-art mk-home" viewBox="0 0 520 300" role="img" aria-label="A drawing of a house in cross-section. Below the grass line, inside the basement, the outline of a second home with its own door.">
      <defs>
        <Hatch id={hatch} />
      </defs>
      <rect x="0" y="152" width="70" height="148" fill={`url(#${hatch})`} />
      <rect x="450" y="152" width="70" height="148" fill={`url(#${hatch})`} />
      <rect x="70" y="282" width="380" height="18" fill={`url(#${hatch})`} />
      <Grass from={0} to={70} y={150} />
      <Grass from={450} to={520} y={150} />
      <g className="mk-line">
        <path data-s pathLength={1} style={d(0)} d="M0 150H520" />
        <path data-s pathLength={1} style={d(0.2)} d="M82 150V64L260 6L438 64V150" />
        <path data-s pathLength={1} style={d(0.45)} d="M70 150V282H450V150M82 150V270H438V150" />
        <path data-s pathLength={1} style={d(0.6)} d="M82 158H438" />
        <path data-s pathLength={1} style={d(0.7)} d="M120 80H170V120H120ZM350 80H400V120H350ZM236 150V96H284V150" />
      </g>
      <path className="mk-inner" style={d(1.4)} d="M170 270V214L260 168L350 214V270Z" />
      <path className="mk-inner-door" style={d(1.8)} d="M245 270V232H275V270" />
    </svg>
  );
}
