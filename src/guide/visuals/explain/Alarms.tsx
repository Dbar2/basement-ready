// Smoke and CO alarms, in plan: a smoke alarm in the bedroom and one outside it, a CO alarm beside where
// they sleep, and every alarm wired to the main floor's so one sets them all off. From
// server/model/checks.ts (smoke-alarms, co-alarms, alarms-linked).
import { Sheet, Words } from "./parts";

function Smoke({ x, y }: { x: number; y: number }) {
  return (
    <g className="ex-alarm">
      <circle className="ex-line ex-card" cx={x} cy={y} r={10} />
      <circle className="ex-fill-ink" cx={x} cy={y} r={3} />
    </g>
  );
}

function Co({ x, y }: { x: number; y: number }) {
  return (
    <g className="ex-alarm">
      <circle className="ex-line ex-card" cx={x} cy={y} r={11} />
      <text className="ex-plan" x={x} y={y + 3.5} textAnchor="middle">
        CO
      </text>
    </g>
  );
}

export function Alarms() {
  return (
    <Sheet title="Smoke and CO alarms" label="Plan of the suite: a smoke alarm in the bedroom and one outside it, a carbon monoxide alarm beside the bedroom, all wired to the alarms upstairs so one sets them all off.">
      <path className="ex-line ex-walls" d="M40 64 H360 V236 H40 Z" />
      <path className="ex-line ex-walls" d="M244 64 V126 M244 160 V176 H360" />
      <Words at={[302, 130]} muted anchor="middle">
        Bedroom
      </Words>
      <Words at={[120, 200]} muted anchor="middle">
        Living
      </Words>
      <path className="ex-wire" d="M302 96 H176 M176 150 V46 M222 150 H176" />
      <Words at={[184, 50]}>To the alarms upstairs</Words>
      <path className="ex-thin" d="M176 46 L171 54 M176 46 L181 54" />
      <Smoke x={302} y={96} />
      <Smoke x={176} y={110} />
      <Co x={222} y={150} />
      {/* The key, under the plan. */}
      <Smoke x={52} y={268} />
      <Words at={[68, 272]}>Smoke</Words>
      <Co x={142} y={268} />
      <Words at={[160, 272]}>CO</Words>
      <path className="ex-wire" d="M210 268 H244" />
      <Words at={[252, 272]}>Wired together</Words>
    </Sheet>
  );
}
