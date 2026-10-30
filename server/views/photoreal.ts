// A 3D render of the design over a real frame (the guide, made in the browser by src/views/AngleRender.tsx)
// turned into a photo by Muse Image, then held to it by SAM 3.1: the windows, doors and stairs stay
// where the frame has them, nothing is added (a window, stairs or a fridge the design doesn't have), and
// every piece of furniture shows up where the render put it. One retry, told what went wrong;
// after that the render itself is the picture, labelled as one. Pictures are cached by angle and
// design (by what the angle shows of it: a change out of view keeps the picture as it is), so nothing
// is paid for twice, and every one is labelled "virtually staged".
import type { Finishes } from "../model/types";
import { finishWords } from "./finishWords";
import type { Anchor } from "./load";

type Box = { x: number; y: number; w: number; h: number };

// A piece as the render drew it: its screen box from the object-id image, and how much of the picture it fills.
export type DrawnItem = { id: string; kind: string; label: string; colour?: string; box: Box; share: number };

export type PictureMeta = {
  angleId: string;
  designHash: string; // the design it was made for (another design that looks the same from here reuses it)
  viewKey: string; // what the angle shows of the design: the cache key
  kind: "photo" | "render"; // a Muse Image photo, or the 3D render over the frame
  kept: boolean; // every check passed
  checked: string; // what was checked, in plain words
  attempts: number;
  at: string;
};

export type PictureWork = {
  cached: () => Promise<PictureMeta | null>;
  edit: (guide: Buffer, prompt: string, size: string) => Promise<Buffer>;
  resize: (img: Buffer, w: number, h: number) => Promise<Buffer>;
  boxes: (jpeg: Buffer, concept: string) => Promise<Box[]>;
  save: (jpeg: Buffer, meta: PictureMeta) => Promise<void>;
  canSpend: () => Promise<boolean>;
};

// What SAM is asked to find for each kind of piece.
const CONCEPT: Record<string, string> = {
  bed: "bed",
  sofa: "sofa",
  armchair: "armchair",
  desk: "desk",
  dining: "dining table",
  dresser: "dresser",
  tv: "television",
  shelf: "bookshelf",
  kitchen: "kitchen cabinets",
  shower: "bathtub",
  toilet: "toilet",
  vanity: "bathroom vanity",
  washer_dryer: "washing machine",
};
export const ANCHOR_CONCEPT: Record<Anchor["kind"], string> = { window: "basement window", door: "door", stairs: "staircase" };

// Pieces big enough in the picture to hold it to; at most three kinds, the biggest first. A piece cut
// off by the edge of the picture is left out unless it fills a lot of it: SAM can't outline half a bed.
const MIN_SHARE = 0.02;
const MAX_KINDS = 3;
const atEdge = (b: Box) => b.x < 0.01 || b.y < 0.01 || b.x + b.w > 0.99 || b.y + b.h > 0.99;

export function checkedItems(items: DrawnItem[]) {
  const big = items.filter((i) => CONCEPT[i.kind] && i.share >= MIN_SHARE && (!atEdge(i.box) || i.share >= 0.15)).sort((a, b) => b.share - a.share);
  const kinds = [...new Set(big.map((i) => i.kind))].slice(0, MAX_KINDS);
  return big.filter((i) => kinds.includes(i.kind));
}

const area = (b: Box) => b.w * b.h;
const inter = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// SAM found the piece where it was drawn: the boxes overlap by a third (IoU), or one sits almost
// wholly inside the other (a sofa SAM outlines with its cushions, a bed with its rug).
export function foundWhereDrawn(drawn: Box, found: Box[]) {
  return found.some((f) => {
    const i = inter(drawn, f);
    return i / (area(drawn) + area(f) - i || 1) >= 0.3 || i / Math.min(area(drawn), area(f) || 1) >= 0.7;
  });
}

// The same thing in two pictures: the boxes overlap by a fifth or more (IoU, as server/concepts.ts keptInPlace).
export function sameBox(a: Box, b: Box) {
  const i = inter(a, b);
  return i / (area(a) + area(b) - i || 1) >= 0.2;
}

// Every window, door and stair is still about where it was.
export function anchorsKept(anchors: Anchor[], found: Map<string, Box[]>) {
  return anchors.every((a) => (found.get(a.kind) ?? []).some((f) => sameBox(a.box, f)));
}

// Nothing was added: every window and stair in the picture was in the frame (the same box, or a part of
// one: the top of the stairs showing over a new wall). Muse Image sometimes turns a box on a cluttered
// wall into a window, or adds stairs; a window the basement doesn't have is a promise it can't keep.
// (A new door is fine: the design adds doors.)
export const ADDED_KINDS = ["window", "stairs"] as const;
export function nothingAdded(anchors: Anchor[], found: Map<string, Box[]>) {
  return ADDED_KINDS.every((k) => (found.get(k) ?? []).every((f) => anchors.some((a) => a.kind === k && (sameBox(a.box, f) || inter(f, a.box) / (area(f) || 1) >= 0.6))));
}

// Nor a piece the design doesn't have: Muse Image sometimes makes a tall new wall beside the kitchen
// into a fridge. A fridge is only where a kitchen (its fridge is at the end of the run) or a fridge is drawn.
export const ADDED_PIECES = [{ concept: "refrigerator", where: ["kitchen", "fridge"], what: "a fridge" }] as const;
export function piecesAdded(items: DrawnItem[], found: Map<string, Box[]>) {
  return ADDED_PIECES.filter((p) => (found.get(p.concept) ?? []).some((f) => !items.some((i) => (p.where as readonly string[]).includes(i.kind) && inter(f, i.box) / (area(f) || 1) >= 0.5))).map((p) => p.what);
}

const list = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

// What Muse Image is asked for: virtual staging of their own photo. Every angle of a design gets the
// same words for its floor, walls, ceiling, colours and light (server/views/finishWords.ts), so the
// angles agree with each other and with what was picked. The guide's new walls are drawn plain, so it
// says what they are; everything loose in the basement goes, and nothing is added that wasn't drawn.
export function picturePrompt(items: DrawnItem[], finishes: PictureInput["finishes"], again = "") {
  const f = finishWords(finishes);
  const pieces = [...new Map(items.filter((i) => i.share >= 0.005).map((i) => [i.id, i])).values()]
    .sort((a, b) => b.share - a.share)
    .slice(0, 6)
    .map((i) => {
      const colour = i.colour ?? f.colour(i.kind);
      return `the ${colour ? `${colour.toLowerCase()} ` : ""}${i.label.toLowerCase()}`;
    });
  return [
    "This is a real photo of an unfinished basement with a renovation design drawn into it in 3D.",
    "Make it one photorealistic photo of the same basement after the renovation, finished and furnished exactly as drawn, like a professional real estate photo.",
    "Keep the camera, the room's shape, the ceiling height and every window, door and stair exactly where they are and the same size. Add no window or stair, and no door that isn't drawn.",
    "The plain walls drawn in are new drywall walls, around the stairs or a room: keep each one a wall exactly where it is drawn (never a fridge, cabinet or furniture), finished from the floor to the ceiling with baseboards, and keep any door drawn in one as a closed painted door.",
    pieces.length ? `Keep ${list(pieces)} exactly where they are drawn, the same size, shape and colour, and make each one real.` : "",
    "Add no other furniture, rugs or appliances.",
    "Clear away everything loose, wherever it is: boxes, storage shelves, tools, exercise machines, laundry, things hanging from the ceiling and clutter.",
    "A furnace, water heater or electrical panel in view stays in view, in the open, exactly where it is, with the wall behind it finished like the rest: build no wall, niche, panel or closet around it.",
    `Floor: ${f.floor}, everywhere. Walls: every wall, old and new, smooth painted drywall, all the same ${f.walls}. Ceiling: ${f.ceiling}. Cover any bare studs, joists or wood framing in drywall too, but keep the stairs as they are.`,
    `Style: ${f.feel}.`,
    "Light: bright, even, warm-white light from the ceiling lights.",
    again,
  ]
    .filter(Boolean)
    .join(" ");
}

export type PictureInput = {
  angleId: string;
  designHash: string;
  viewKey: string;
  guide: Buffer; // JPEG, the frame's own size
  size: [number, number];
  items: DrawnItem[];
  anchors: Anchor[]; // the windows, doors and stairs the video tracked here: they must stay where they are
  known?: Anchor[]; // everything really in the frame (SAM on the frame itself): nothing else may appear
  hidden?: Box[]; // where the design's new walls stand: a real door behind one needn't show
  finishes: Partial<Pick<Finishes, "style" | "floor" | "walls">>;
};

// How much of `a` the boxes cover together, sampled on a 10 × 10 grid (a stair walled in on two sides
// is hidden by both walls, not by either alone).
export function coveredBy(a: Box, boxes: Box[]) {
  if (!boxes.length) return 0;
  let n = 0;
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++) {
      const x = a.x + ((i + 0.5) / 10) * a.w, y = a.y + ((j + 0.5) / 10) * a.h;
      if (boxes.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) n++;
    }
  return n / 100;
}

// One picture: cached, or made now. Never throws for a model failure: the render is the fallback.
export async function makePicture(input: PictureInput, work: PictureWork, now = () => new Date().toISOString()): Promise<PictureMeta> {
  // A picture skipped for the budget (attempts 0) is tried again; anything else is final.
  const hit = await work.cached();
  if (hit && hit.attempts > 0) return hit;
  const render = async (checked: string, attempts: number): Promise<PictureMeta> => {
    const meta: PictureMeta = { angleId: input.angleId, designHash: input.designHash, viewKey: input.viewKey, kind: "render", kept: false, checked, attempts, at: now() };
    await work.save(input.guide, meta);
    return meta;
  };
  if (!(await work.canSpend())) return render("The 3D design drawn over your frame (today's photo budget is used up)", 0);

  const [w, h] = input.size;
  const items = checkedItems(input.items);
  const kinds = [...new Set(items.map((i) => i.kind))];
  // What must stay: what the video saw here, less what the design's own new walls stand in front of.
  // A sliver cut off by the edge of the picture is too unsure to hold it to, as with the furniture.
  const keep = input.anchors.filter((a) => coveredBy(a.box, input.hidden ?? []) < 0.5 && !(atEdge(a.box) && area(a.box) < 0.05));
  const known = [...input.anchors, ...(input.known ?? [])];
  // SAM looks for every window and stair in the picture, not only the ones the frame had.
  const anchorKinds = [...new Set<Anchor["kind"]>([...ADDED_KINDS, ...keep.map((a) => a.kind)])];
  const keptKinds = [...new Set(keep.map((a) => a.kind))];
  let last = "", again = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1 && !(await work.canSpend())) break;
    let jpeg: Buffer;
    try {
      jpeg = await work.resize(await work.edit(input.guide, picturePrompt(input.items, input.finishes, again), `${w}x${h}`), w, h);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      console.error(`[views] ${input.angleId}: ${last}`);
      continue;
    }
    const [anchorBoxes, itemBoxes, pieceBoxes] = await Promise.all([
      Promise.all(anchorKinds.map(async (k) => [k, await work.boxes(jpeg, ANCHOR_CONCEPT[k]).catch(() => [])] as const)),
      Promise.all(kinds.map(async (k) => [k, await work.boxes(jpeg, CONCEPT[k]).catch(() => [])] as const)),
      Promise.all(ADDED_PIECES.map(async (p) => [p.concept, await work.boxes(jpeg, p.concept).catch(() => [])] as const)),
    ]);
    const anchorsOk = anchorsKept(keep, new Map(anchorBoxes));
    const added = !nothingAdded(known, new Map(anchorBoxes));
    const extra = piecesAdded(input.items, new Map(pieceBoxes));
    const found = new Map(itemBoxes);
    const missing = items.filter((i) => !foundWhereDrawn(i.box, found.get(i.kind) ?? []));
    if (anchorsOk && !added && !extra.length && !missing.length) {
      const what = [
        keptKinds.length ? `${list(keptKinds.map((k) => (k === "window" ? "windows" : k === "door" ? "doors" : "stairs")))} kept where they are` : "no windows or stairs added",
        items.length ? `${list([...new Set(items.map((i) => i.label.toLowerCase()))])} where the design puts ${items.length > 1 ? "them" : "it"}` : "",
      ].filter(Boolean);
      const meta: PictureMeta = {
        angleId: input.angleId,
        designHash: input.designHash,
        viewKey: input.viewKey,
        kind: "photo",
        kept: true,
        checked: what.length ? `${list(what)} · checked by SAM 3.1` : "Made by Muse Image from your frame",
        attempts: attempt,
        at: now(),
      };
      await work.save(jpeg, meta);
      return meta;
    }
    last = !anchorsOk
      ? "a window, door or the stairs moved"
      : added
        ? "a window or stairs appeared that aren't there"
        : extra.length
          ? `${list(extra)} appeared that isn't in the design`
          : `${list(missing.map((i) => i.label.toLowerCase()))} moved`;
    // The second try is told what went wrong with the first.
    again = !anchorsOk
      ? "Above all, keep every window, door and stair exactly where it is in the photo."
      : added
        ? "Above all, add no window and no stairs anywhere."
        : extra.length
          ? `Above all, add no ${list(extra.map((x) => x.replace(/^an? /, "")))}: the tall plain shapes drawn in are walls.`
          : `Above all, keep ${list(missing.map((i) => `the ${i.label.toLowerCase()}`))} exactly where drawn.`;
    console.log(`[views] ${input.angleId} attempt ${attempt}: ${last}`);
  }
  return render(last && !/Muse|Meta|fetch|timed? ?out/i.test(last) ? `The 3D design drawn over your frame (in the photo, ${last})` : "The 3D design drawn over your frame", 2);
}
