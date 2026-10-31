// An escape window: from inside the bedroom, the clear opening (0.35 m² or more, no side under 380 mm);
// beside it, a section through the window well with 550 mm clear in front. Figures from
// server/model/checks.ts (LIMITS.egressM2, egressSideM) and the rules pack's window-well rule.
import { Dim, Sheet, Words } from "./parts";

export function EgressWindow() {
  return (
    <Sheet title="An escape window" label="An escape window seen from inside: a clear opening of at least 0.35 square metres with no side under 380 millimetres. Beside it, a window well with at least 550 millimetres clear in front of the window.">
      {/* From inside: the wall, the frame, the clear opening. */}
      <rect className="ex-line ex-surface" x={28} y={56} width={186} height={170} />
      <rect className="ex-line ex-card" x={62} y={76} width={118} height={94} />
      <rect className="ex-key ex-card ex-draw" pathLength={1} x={72} y={86} width={98} height={74} />
      <text className="ex-figure ex-big" x={121} y={127} textAnchor="middle">
        0.35 m²
      </text>
      <Words at={[121, 143]} muted anchor="middle">
        clear, or more
      </Words>
      <Dim a={[72, 160]} b={[170, 160]} label="380 mm+" off={24} />
      <Dim a={[72, 86]} b={[72, 160]} label="380 mm+" off={24} />
      <path className="ex-line ex-heavy" d="M28 226 H214" />
      <Words at={[28, 246]} muted>
        From inside the bedroom
      </Words>

      {/* In section: the foundation wall, the window, the well outside. */}
      <path className="ex-line" d="M246 120 H286" />
      <rect className="ex-line ex-surface" x={286} y={64} width={12} height={198} />
      <rect className="ex-key ex-card" x={286} y={150} width={12} height={46} />
      <path className="ex-line" d="M298 120 H312 M368 120 H388" />
      <path className="ex-line ex-draw" pathLength={1} d="M368 120 V214 H298" />
      <Dim a={[298, 202]} b={[368, 202]} label="550 mm" off={-16} />
      <Words at={[262, 112]} muted anchor="middle">
        Inside
      </Words>
      <Words at={[386, 112]} muted anchor="end">
        Ground
      </Words>
      <Words at={[333, 232]} muted anchor="middle">
        Window well
      </Words>
      <Words at={[200, 284]} anchor="middle">
        Opens from inside, with no keys or tools
      </Words>
    </Sheet>
  );
}
