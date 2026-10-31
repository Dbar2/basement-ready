// A way in and out of its own, in plan: the suite with its own door outside (810 mm or wider), or the
// shared stairs through a rated door that closes itself. From server/model/checks.ts (way-out, doors,
// separation-doors).
import { Leader, Sheet, Words } from "./parts";

const TREADS = Array.from({ length: 8 }, (_, i) => 52 + i * 11);

export function SeparateEntrance() {
  return (
    <Sheet title="A way in and out of its own" label="Plan of the basement suite: either its own door to the outside, at least 810 millimetres wide, or a way through the shared stairs with a rated door that closes itself.">
      {/* The basement, the stair in its rated enclosure, the two doors. */}
      <path className="ex-line ex-walls" d="M360 168 V56 H40 V250 H360 V204" />
      {TREADS.map((x) => (
        <path key={x} className="ex-thin" d={`M${x} 60 V122`} />
      ))}
      <text className="ex-plan" x={92} y={142} textAnchor="middle">
        UP
      </text>
      <path className="ex-key ex-draw" pathLength={1} d="M142 56 V92 M142 126 V152 H40" />
      <path className="ex-line" d="M142 126 L174 126" />
      <path className="ex-thin" d="M174 126 A32 32 0 0 0 142 94" />
      <path className="ex-line" d="M360 204 L328 204" />
      <path className="ex-thin" d="M328 204 A36 36 0 0 1 360 168" />
      <Words at={[250, 212]} muted anchor="middle">
        Your basement suite
      </Words>
      <Leader from={[160, 120]} to={[196, 92]} label="Rated door, closes itself" />
      <Leader from={[352, 186]} to={[318, 150]} label="Its own door outside" figure="810 mm+" left />
      <Words at={[200, 284]} muted anchor="middle">
        Its own way out, or the stairs through a rated door
      </Words>
    </Sheet>
  );
}
