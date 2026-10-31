// A design's finishes in the words every picture of it is asked for, and the 3D finish that draws
// them. Pure, so the browser's guide and the server's prompt read the same: every angle of a design
// is asked for the same floor, walls, ceiling, colours and light, which is what keeps the angles alike.
import type { Finishes, FurnitureKind } from "../model/types";
import { STYLES, type StyleId } from "../ideas/styles";

// The studio's three finishes (src/three/StagedBasement.tsx FINISHES), which the 3D draws.
export type FinishKey = "light" | "warm" | "deep";

// The 3D finish for a design's floor and style.
export function finishKeyFor(f: Partial<Pick<Finishes, "floor" | "style">>): FinishKey {
  const t = `${f.floor ?? ""} ${f.style ?? ""}`.toLowerCase();
  if (/green|deep|dark/.test(t)) return "deep";
  if (/warm|walnut|wood floor|hardwood|brown/.test(t)) return "warm";
  return "light";
}

// What each 3D finish looks like, in words: its floor, its feel, and the colour of a piece the
// homeowner didn't colour (the 3D's own fabric and cabinet colours).
const KEY_WORDS: Record<FinishKey, { floor: string; feel: string; colours: Partial<Record<FurnitureKind, string>> }> = {
  light: {
    floor: "light natural oak laminate plank",
    feel: "bright and calm: light oak, soft white walls, pale sage-grey linen",
    colours: { sofa: "pale sage-grey linen", armchair: "pale sage-grey linen", bed: "white linen", kitchen: "white flat-front", vanity: "white" },
  },
  warm: {
    floor: "warm honey oak plank",
    feel: "warm and cosy: honey oak, cream walls, taupe linen, brass lamps",
    colours: { sofa: "taupe linen", armchair: "taupe linen", bed: "cream linen", kitchen: "natural oak flat-front", vanity: "oak" },
  },
  deep: {
    floor: "warm honey oak plank",
    feel: "rich and calm: deep green cabinets, grey-green linen, oak and black metal",
    colours: { sofa: "grey-green linen", armchair: "grey-green linen", bed: "white linen", kitchen: "deep green flat-front", vanity: "deep green" },
  },
};

const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();

const STUDIO = new Set<string>(["light", "warm", "deep"]);

// The words for a design's finishes. The floor is the one they picked: on their board, or in the
// studio (whose finish brings its own floor, unless the one they have already goes with it).
export function finishWords(f: Partial<Finishes>) {
  const key = finishKeyFor(f);
  const style = f.style && f.style in STYLES ? STYLES[f.style as StyleId] : null;
  const fromBoard = !!style && !STUDIO.has(f.style!);
  const floor = f.floor && (fromBoard || finishKeyFor({ floor: f.floor }) === key) ? lower(f.floor).replace(/ floor$/, "") : KEY_WORDS[key].floor;
  // An accent or brick wall is one wall: the rest are soft white.
  const picked = lower(f.walls).replace(/ walls?$/, "");
  const walls = /accent|brick/.test(picked) ? `soft white, with one ${picked.replace(/ accent$/, "")} feature wall` : picked || "warm white";
  // A style with an open ceiling keeps it, painted; every other finishes it in drywall.
  const openCeiling = /open ceiling/.test(style?.feel ?? "");
  return {
    key,
    floor,
    // Which of the 3D's two floors looks most like it.
    floorTone: /light|white|pale|grey|gray|concrete/.test(floor) ? ("light" as const) : ("warm" as const),
    walls,
    ceiling: openCeiling
      ? "the open ceiling's joists, ducts and pipes all painted one dark charcoal, with black pendant lights"
      : "a flat, smooth white drywall ceiling, closed everywhere with no openings or hatches, with slim recessed pot lights only, no hanging lights; ducts, pipes and beams boxed into smooth white drywall bulkheads",
    feel: style?.feel ?? KEY_WORDS[key].feel,
    colour: (kind: string) => KEY_WORDS[key].colours[kind as FurnitureKind] ?? null,
  };
}

// The paint colour of a wall finish, for the 3D: the new walls in the guide are painted what the
// homeowner picked, so the picture's walls and its prompt agree. Null: the finish's own white.
const WALL_PAINT: [RegExp, string][] = [
  [/deep green/, "#3E5A48"],
  [/sage/, "#C9D2C1"],
  [/blue/, "#D3DDE4"],
  [/greige|beige/, "#DDD6CA"],
  [/cream/, "#EFE7D8"],
  [/warm grey|warm gray/, "#D2CFC9"],
  [/grey|gray/, "#DADCDB"],
  [/white/, "#F3F1EA"],
];
export function wallPaint(walls: string | undefined): string | null {
  const t = lower(walls);
  if (/accent|brick/.test(t)) return null;
  return WALL_PAINT.find(([re]) => re.test(t))?.[1] ?? null;
}
