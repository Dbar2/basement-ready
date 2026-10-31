// A fire separation, in section: the home upstairs, its floor joists, and under them the suite's ceiling
// of 5/8" Type X drywall (15 minutes); the rated wall around the shared stairs (30 minutes, drywall on
// both sides). Figures from server/model/checks.ts (separation-ceiling, separation-walls).
import { Leader, Sheet, Words } from "./parts";

const JOISTS = Array.from({ length: 12 }, (_, i) => 26 + i * 30);
const STEPS = Array.from({ length: 8 }, (_, i) => [36 + i * 13, 262 - i * 20.25] as const);

export function FireSeparation() {
  const steps = STEPS.map(([x, y]) => `L${x} ${y} L${x} ${y - 20.25} L${x + 13} ${y - 20.25}`).join(" ");
  return (
    <Sheet title="A fire separation, in section" label="Section through the house: the basement suite's ceiling is 5/8 inch Type X drywall rated 15 minutes, and the wall around the shared stairs is rated 30 minutes with drywall on both sides.">
      <Words at={[24, 56]} muted>
        The home upstairs
      </Words>
      <rect className="ex-line ex-surface" x={20} y={62} width={360} height={10} />
      {JOISTS.map((x) => (
        <rect key={x} className="ex-line" x={x} y={72} width={5} height={26} />
      ))}
      <path className="ex-line ex-draw" pathLength={1} d={`M24 262 ${steps}`} />
      <rect className="ex-key ex-stop ex-draw" pathLength={1} x={150} y={100} width={230} height={6} />
      <rect className="ex-key ex-stop ex-draw" pathLength={1} x={146} y={98} width={8} height={164} />
      <path className="ex-line ex-heavy" d="M20 262 H380" />
      <Words at={[84, 284]} muted anchor="middle">
        Shared stairs
      </Words>
      <Words at={[300, 196]} muted anchor="middle">
        Your basement suite
      </Words>
      <Leader from={[250, 106]} to={[268, 136]} label="Type X ceiling" figure="15 min" tone="stop" />
      <Leader from={[154, 214]} to={[182, 236]} label="Rated wall, both sides" figure="30 min" tone="stop" />
      <Words at={[380, 284]} muted anchor="end">
        Sealed at every edge
      </Words>
    </Sheet>
  );
}
