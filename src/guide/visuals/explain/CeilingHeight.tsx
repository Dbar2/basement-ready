// Ceiling height, in section: a person under the finished ceiling (1.95 m or more) and under a duct or
// beam (1.85 m or more), measured after the drywall goes up. Figures from server/model/checks.ts
// (LIMITS.ceilingM, underM).
import { Dim, Sheet, Words } from "./parts";

const JOISTS = Array.from({ length: 12 }, (_, i) => 30 + i * 30);

export function CeilingHeight() {
  return (
    <Sheet title="Ceiling height" label="Section through a room: at least 1.95 metres from the floor to the finished ceiling, and at least 1.85 metres under a duct or beam.">
      {JOISTS.map((x) => (
        <rect key={x} className="ex-line" x={x} y={52} width={5} height={24} />
      ))}
      <path className="ex-key ex-draw" pathLength={1} d="M24 78 H376" />
      <rect className="ex-line ex-surface" x={232} y={78} width={112} height={28} />
      <Words at={[288, 97]} muted anchor="middle">
        Duct or beam
      </Words>
      {/* Someone about 1.75 m tall, for scale. */}
      <g className="ex-thin">
        <circle cx={128} cy={120} r={10} />
        <path d="M128 130 V192 M128 192 L116 250 M128 192 L140 250 M128 146 L112 178 M128 146 L144 178" />
      </g>
      <path className="ex-line ex-heavy" d="M24 250 H376" />
      <Dim a={[56, 250]} b={[56, 78]} label="1.95 m+" />
      <Dim a={[300, 250]} b={[300, 106]} label="1.85 m+" />
      <Words at={[200, 280]} muted anchor="middle">
        Measured to the finished ceiling, after drywall
      </Words>
    </Sheet>
  );
}
