// Scores a photo's finds and Spark's reading against labels written by looking at the photo.
// Pure: no network, no files. scripts/practice/score.ts runs the photos; this decides right and wrong.

export type Box = [number, number, number, number]; // x, y, w, h, 0..1 of the photo

// One key per SAM concept (server/pipeline.ts CONCEPTS), by its label.
export const KEYS: Record<string, string> = {
  Window: "window",
  Stairs: "stairs",
  Duct: "duct",
  Beam: "beam",
  Furnace: "furnace",
  "Electrical panel": "panel",
  "Water heater": "heater",
  "Plumbing rough-in": "roughin",
  "Floor drain": "drain",
  Bulkhead: "bulkhead",
  Door: "door",
};

// What Spark should say about a rule from this photo alone.
//   fix / ok    that claim is due: the other claim is wrong, a hedge misses it
//   fix? / ok?  that claim or a hedge are both fine; the other claim is wrong
//   none        nothing in the photo settles it: any claim is wrong
export type Expect = "fix" | "ok" | "fix?" | "ok?" | "none";

// The rules a single photo can speak to, and the rule ids they score.
export const SPARK_RULES: Record<string, string[]> = {
  egress: ["egress_window_bedroom_area", "egress_window_min_dimension"],
  well: ["egress_window_well_clearance"],
  fire: ["fire_separation_between_units"],
  service: ["service_room_separation"],
  clearance: ["clearance_beams_ducts_suite"],
  ceiling: ["ceiling_height_suite"],
  exit: ["exit_from_suite"],
  plumbing: ["plumbing_fixtures_and_shutoff"],
};

export type Label = {
  file: string;
  keep: boolean;
  split?: "train" | "holdout";
  objects: Partial<Record<string, Box[]>>; // what is really in the photo, by key
  unsure?: string[]; // keys not scored for this photo (can't tell, or arguable)
  windows?: { type: string; escape: "no" | "maybe" | "yes"; well?: boolean }[];
  ceiling?: string; // joists, i-joists, drywall, drop, mixed
  low?: string[]; // what hangs near head height
  moisture?: string;
  light?: string;
  clutter?: string;
  spark?: Partial<Record<keyof typeof SPARK_RULES, Expect>>;
  note?: string;
};

export type Find = { key: string; box: Box; c: number | null };

const iou = (a: Box, b: Box) => {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = x * y;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
};

// Labels are drawn by eye, so a find counts when its centre lands in the label's box (grown by 5% of
// the photo) or the two overlap by a fifth.
export function matches(find: Box, label: Box): boolean {
  const cx = find[0] + find[2] / 2;
  const cy = find[1] + find[3] / 2;
  const pad = 0.05;
  const inside = cx >= label[0] - pad && cx <= label[0] + label[2] + pad && cy >= label[1] - pad && cy <= label[1] + label[3] + pad;
  return inside || iou(find, label) >= 0.2;
}

export type Tally = {
  photos: number; // photos where it's really there
  hit: number; // ...and at least one find landed on it
  miss: number; // ...and nothing landed on it
  falsePhotos: number; // photos where it isn't there but something was found
  tp: number; // label boxes found
  fn: number; // label boxes missed
  fp: number; // finds on nothing labelled
};

export const emptyTally = (): Tally => ({ photos: 0, hit: 0, miss: 0, falsePhotos: 0, tp: 0, fn: 0, fp: 0 });

// One photo, one key. Each label box is matched by at most one find, greedily by confidence.
export function scoreKey(label: Label, key: string, finds: Find[]): Tally | null {
  if (label.unsure?.includes(key)) return null;
  const truth = label.objects[key] ?? [];
  const mine = finds.filter((f) => f.key === key).sort((a, b) => (b.c ?? 1) - (a.c ?? 1));
  const used = new Set<number>();
  let fp = 0;
  for (const f of mine) {
    const i = truth.findIndex((t, k) => !used.has(k) && matches(f.box, t));
    if (i >= 0) used.add(i);
    // A second find on something already matched is a duplicate, not a false find of something else.
    else if (!truth.some((t) => matches(f.box, t))) fp++;
  }
  const t = emptyTally();
  t.tp = used.size;
  t.fn = truth.length - used.size;
  t.fp = fp;
  if (truth.length) {
    t.photos = 1;
    if (used.size) t.hit = 1;
    else t.miss = 1;
  } else if (mine.length) t.falsePhotos = 1;
  return t;
}

export function addTally(a: Tally, b: Tally) {
  for (const k of Object.keys(a) as (keyof Tally)[]) a[k] += b[k];
}

export type Grade = "right" | "hedge" | "wrong" | "missed";

// Spark's status for a rule, once the trust rule has run: a claim with no find behind it is a hedge.
export function sparkGrade(expect: Expect, status: string | undefined): Grade {
  const claim = status === "likely_fix" ? "fix" : status === "likely_ok" ? "ok" : null;
  if (expect === "none") return claim ? "wrong" : "right";
  const want = expect.replace("?", "") as "fix" | "ok";
  const soft = expect.endsWith("?");
  if (claim === want) return "right";
  if (claim) return "wrong";
  return soft ? "hedge" : "missed";
}

export const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
