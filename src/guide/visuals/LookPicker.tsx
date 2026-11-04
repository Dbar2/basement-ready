// The four looks as drawn swatches (track E): each a little square of its walls over its floor, the
// same colours the 3D draws (src/three/StagedBasement.tsx FINISHES) and the pictures are asked for
// (server/views/finishWords.ts LOOK_FINISHES). "None of these" stays in the guide's thread: what they type
// then goes through `describe`.
import type { LookKey } from "../types";

export const LOOKS: { key: LookKey; name: string; walls: string; floor: string }[] = [
  { key: "light", name: "Light oak", walls: "#F2EFE8", floor: "#D8BE95" },
  { key: "warm", name: "Warm wood", walls: "#EFE6DA", floor: "#A9744A" },
  { key: "deep", name: "Deep green", walls: "#3F5A4C", floor: "#C9B28E" },
  { key: "plain", name: "Plain", walls: "#F4F4F1", floor: "#BFC3BE" },
];

export const lookName = (look: LookKey | "custom") => LOOKS.find((l) => l.key === look)?.name ?? "the look you described";

// `look`: the one showing ("custom" or null: none of these).
export function LookPicker({ look, onPick }: { look: LookKey | "custom" | null; onPick: (look: LookKey) => void }) {
  return (
    <div className="gs-chips gs-looks" role="group" aria-label="Looks">
      {LOOKS.map((l) => (
        <button key={l.key} type="button" className="gs-chip gs-look" aria-pressed={look === l.key} onClick={() => look !== l.key && onPick(l.key)}>
          <span className="gs-swatch" aria-hidden="true">
            <i style={{ background: l.walls }} />
            <i style={{ background: l.floor }} />
          </span>
          {l.name}
        </button>
      ))}
    </div>
  );
}
