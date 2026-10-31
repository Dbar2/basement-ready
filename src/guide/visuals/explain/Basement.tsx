// The basement under the house, in section: what the pane shows for a term with no drawing of its own,
// so it's never empty.
import { Sheet, Words } from "./parts";

export function Basement() {
  return (
    <Sheet title="Your basement, in section" label="Section through the house: the home upstairs above the basement, below the ground line.">
      <path className="ex-line" d="M96 128 V66 L200 30 L304 66 V128" />
      <Words at={[200, 104]} muted anchor="middle">
        The home upstairs
      </Words>
      <path className="ex-line ex-heavy" d="M20 128 H380" />
      <Words at={[376, 122]} muted anchor="end">
        Ground
      </Words>
      <rect className="ex-key ex-card ex-draw" pathLength={1} x={96} y={136} width={208} height={118} />
      <rect className="ex-line ex-card" x={262} y={150} width={42} height={24} />
      <Words at={[200, 204]} anchor="middle">
        Your basement
      </Words>
    </Sheet>
  );
}
