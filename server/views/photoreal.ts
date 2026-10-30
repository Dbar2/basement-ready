// A 3D render of the design over a real frame (the guide, made in the browser by src/views/AngleRender.tsx)
// turned into a photo by Muse Image, then held to it by SAM 3.1: the windows, doors and stairs stay
// where the frame has them, and every piece of furniture shows up where the render put it. One retry;
// after that the render itself is the picture, labelled as one. Pictures are cached by angle and
// design (by what the angle shows of it: a change out of view keeps the picture as it is), so nothing
// is paid for twice, and every one is labelled "virtually staged".
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
const ANCHOR_CONCEPT: Record<Anchor["kind"], string> = { window: "basement window", door: "door", stairs: "staircase" };

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

// Every window, door and stair is still about where it was (as server/concepts.ts keptInPlace).
export function anchorsKept(anchors: Anchor[], found: Map<string, Box[]>) {
  return anchors.every((a) => (found.get(a.kind) ?? []).some((f) => {
    const i = inter(a.box, f);
    return i / (area(a.box) + area(f) - i || 1) >= 0.2;
  }));
}

const list = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

export function picturePrompt(items: DrawnItem[], finishes: { style?: string; floor?: string; walls?: string }) {
  const pieces = [...new Map(items.filter((i) => i.share >= 0.005).map((i) => [i.id, i])).values()]
    .sort((a, b) => b.share - a.share)
    .slice(0, 6)
    .map((i) => `${i.colour ? `the ${i.colour} ` : "the "}${i.label.toLowerCase()}`);
  return [
    "This is a real photo of a basement with a 3D design drawn into it.",
    "Turn it into one photorealistic interior photo of the finished room.",
    "Keep the camera, the room's shape, the ceiling height and every window, door and stair exactly where they are and the same size.",
    pieces.length ? `Keep ${list(pieces)} exactly where they are drawn, the same size, shape and colour, and make each one real.` : "",
    "Do not add or move any big furniture.",
    `Finish the floor in ${finishes.floor || "light oak vinyl plank"} and the walls and ceiling in smooth ${finishes.walls || "warm white"} drywall with slim recessed lights. Clear away boxes, tools and clutter.`,
    `Style: ${finishes.style || "bright, calm and uncluttered"}.`,
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
  anchors: Anchor[];
  finishes: { style?: string; floor?: string; walls?: string };
};

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
  const anchorKinds = [...new Set(input.anchors.map((a) => a.kind))];
  const prompt = picturePrompt(input.items, input.finishes);
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1 && !(await work.canSpend())) break;
    let jpeg: Buffer;
    try {
      jpeg = await work.resize(await work.edit(input.guide, prompt, `${w}x${h}`), w, h);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      console.error(`[views] ${input.angleId}: ${last}`);
      continue;
    }
    const [anchorBoxes, itemBoxes] = await Promise.all([
      Promise.all(anchorKinds.map(async (k) => [k, await work.boxes(jpeg, ANCHOR_CONCEPT[k]).catch(() => [])] as const)),
      Promise.all(kinds.map(async (k) => [k, await work.boxes(jpeg, CONCEPT[k]).catch(() => [])] as const)),
    ]);
    const anchorsOk = anchorsKept(input.anchors, new Map(anchorBoxes));
    const found = new Map(itemBoxes);
    const missing = items.filter((i) => !foundWhereDrawn(i.box, found.get(i.kind) ?? []));
    if (anchorsOk && !missing.length) {
      const what = [
        anchorKinds.length ? `${list(anchorKinds.map((k) => (k === "window" ? "windows" : k === "door" ? "doors" : "stairs")))} kept where they are` : "",
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
    last = !anchorsOk ? "a window, door or the stairs moved" : `${list(missing.map((i) => i.label.toLowerCase()))} moved`;
    console.log(`[views] ${input.angleId} attempt ${attempt}: ${last}`);
  }
  return render(last && !/Muse|Meta|fetch|timed? ?out/i.test(last) ? `The 3D design drawn over your frame (in the photo, ${last})` : "The 3D design drawn over your frame", 2);
}
