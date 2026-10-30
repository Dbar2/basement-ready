import { describe, expect, it } from "vitest";
import { checkedItems, foundWhereDrawn, makePicture, picturePrompt, type DrawnItem, type PictureMeta, type PictureWork } from "../../server/views/photoreal";
import { decodeId, flipRows, idAt, idAtTap, idBoxes, idColour, type IdImage } from "../../src/views/objectId";

// A 40 × 20 picture: a sofa (id 1) on the left, a bed (id 2) on the right, the real room between.
function picture(): IdImage {
  const width = 40, height = 20;
  const data = new Uint8Array(width * height * 4);
  const paint = (x0: number, y0: number, x1: number, y1: number, i: number) => {
    const [r, g, b] = idColour(i);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([r, g, b, 255], (y * width + x) * 4);
  };
  paint(2, 10, 14, 18, 1);
  paint(24, 6, 38, 18, 2);
  return { width, height, data, ids: ["", "living-1-sofa-1", "bedroom-1-bed-1"] };
}

describe("the object-id image", () => {
  it("round-trips every id through a colour, even a couple of levels off", () => {
    for (const i of [1, 2, 15, 16, 255, 256, 1000, 4095]) {
      const [r, g, b] = idColour(i);
      expect(decodeId(r, g, b)).toBe(i);
      expect(decodeId(r + 3, g - 3, b + 2)).toBe(i);
    }
    expect(decodeId(0, 0, 0)).toBe(0);
  });

  it("says what was tapped, and nothing on the real room", () => {
    const img = picture();
    expect(idAt(img, 8, 14)).toBe("living-1-sofa-1");
    expect(idAt(img, 30, 10)).toBe("bedroom-1-bed-1");
    expect(idAt(img, 19, 3)).toBeNull();
    // Just off the sofa's edge still finds it.
    expect(idAt(img, 15, 14, 2)).toBe("living-1-sofa-1");
    // A tap on the picture shown at another size.
    expect(idAtTap(img, { x: 300, y: 120 }, { width: 400, height: 200 })).toBe("bedroom-1-bed-1");
  });

  it("boxes each thing and measures how much of the picture it fills", () => {
    const boxes = idBoxes(picture());
    expect(boxes.get("living-1-sofa-1")!.box).toEqual({ x: 2 / 40, y: 10 / 20, w: 12 / 40, h: 8 / 20 });
    expect(boxes.get("bedroom-1-bed-1")!.share).toBeCloseTo((14 * 12) / 800, 6);
  });

  it("puts WebGL's bottom-up rows the right way up", () => {
    const rows = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2]);
    expect([...flipRows(rows, 1, 2)]).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
  });
});

const bed: DrawnItem = { id: "bed", kind: "bed", label: "Bed", colour: "sage", box: { x: 0.5, y: 0.5, w: 0.4, h: 0.3 }, share: 0.1 };
const sofa: DrawnItem = { id: "sofa", kind: "sofa", label: "Sofa", box: { x: 0.05, y: 0.6, w: 0.3, h: 0.2 }, share: 0.05 };

function work(over: Partial<PictureWork> & { found?: Record<string, { x: number; y: number; w: number; h: number }[]> } = {}) {
  const saved: { jpeg: string; meta: PictureMeta }[] = [];
  let edits = 0;
  const w: PictureWork & { saved: typeof saved; edits: () => number } = {
    cached: async () => null,
    edit: async () => {
      edits++;
      return Buffer.from(`photo-${edits}`);
    },
    resize: async (img) => img,
    boxes: async (_jpeg, concept) => over.found?.[concept] ?? [],
    save: async (jpeg, meta) => {
      saved.push({ jpeg: jpeg.toString(), meta });
    },
    canSpend: async () => true,
    ...over,
    saved,
    edits: () => edits,
  };
  return w;
}

const input = { angleId: "1-0186", designHash: "abc", viewKey: "def", guide: Buffer.from("render"), size: [720, 1280] as [number, number], items: [bed, sofa], anchors: [{ kind: "window" as const, box: { x: 0.4, y: 0.1, w: 0.2, h: 0.1 } }], finishes: { style: "calm", floor: "light oak", walls: "warm white" } };

describe("the photo of an angle", () => {
  it("keeps a Muse Image photo when SAM finds the window and every piece where it was drawn", async () => {
    const w = work({ found: { "basement window": [{ x: 0.41, y: 0.1, w: 0.2, h: 0.1 }], bed: [{ x: 0.52, y: 0.48, w: 0.38, h: 0.33 }], sofa: [{ x: 0.06, y: 0.58, w: 0.3, h: 0.22 }] } });
    const m = await makePicture(input, w);
    expect(m.kind).toBe("photo");
    expect(m.kept).toBe(true);
    expect(m.attempts).toBe(1);
    expect(m.checked).toMatch(/windows kept/);
    expect(m.checked).toMatch(/bed and sofa where the design puts them/);
    expect(w.saved[0].jpeg).toBe("photo-1");
  });

  it("tries once more when a piece moved, then falls back to the render, labelled", async () => {
    const w = work({ found: { "basement window": [{ x: 0.4, y: 0.1, w: 0.2, h: 0.1 }], bed: [{ x: 0.0, y: 0.0, w: 0.2, h: 0.2 }], sofa: [{ x: 0.05, y: 0.6, w: 0.3, h: 0.2 }] } });
    const m = await makePicture(input, w);
    expect(w.edits()).toBe(2);
    expect(m.kind).toBe("render");
    expect(m.checked).toMatch(/3D design drawn over your frame.*bed moved/);
    expect(w.saved.at(-1)!.jpeg).toBe("render");
  });

  it("never pays twice for a picture it has, but tries again one the budget skipped", async () => {
    const done: PictureMeta = { angleId: "1-0186", designHash: "abc", viewKey: "def", kind: "photo", kept: true, checked: "ok", attempts: 1, at: "x" };
    const hit = work({ cached: async () => done });
    expect(await makePicture(input, hit)).toBe(done);
    expect(hit.edits()).toBe(0);
    const skipped = work({ cached: async () => ({ ...done, kind: "render", attempts: 0 }), found: { "basement window": [input.anchors[0].box], bed: [bed.box], sofa: [sofa.box] } });
    expect((await makePicture(input, skipped)).kind).toBe("photo");
  });

  it("turns down a photo that grew a window or stairs the frame doesn't have, then falls back to the render", async () => {
    // Muse Image made a box on a cluttered wall into a second window.
    const w = work({ found: { "basement window": [{ x: 0.41, y: 0.1, w: 0.2, h: 0.1 }, { x: 0.75, y: 0.15, w: 0.15, h: 0.1 }], bed: [bed.box], sofa: [sofa.box] } });
    const m = await makePicture(input, w);
    expect(w.edits()).toBe(2);
    expect(m.kind).toBe("render");
    expect(m.checked).toMatch(/a window or stairs appeared that aren't there/);
    // Stairs where the frame has none.
    const stairs = work({ found: { "basement window": [input.anchors[0].box], staircase: [{ x: 0.1, y: 0.2, w: 0.2, h: 0.5 }], bed: [bed.box], sofa: [sofa.box] } });
    expect((await makePicture(input, stairs)).kind).toBe("render");
    // A frame with no window: any window in the photo was added.
    const none = work({ found: { "basement window": [input.anchors[0].box], bed: [bed.box] } });
    expect((await makePicture({ ...input, anchors: [], items: [bed] }, none)).kind).toBe("render");
    // Nothing added: kept, and it says it looked.
    const clean = work({ found: { bed: [bed.box] } });
    const kept = await makePicture({ ...input, anchors: [], items: [bed] }, clean);
    expect(kept.kind).toBe("photo");
    expect(kept.checked).toMatch(/no windows or stairs added/);
  });

  it("doesn't ask for a door the design's new wall stands in front of, and allows a window SAM saw in the frame", async () => {
    const door = { kind: "door" as const, box: { x: 0.7, y: 0.3, w: 0.1, h: 0.4 } };
    const wall = { x: 0.6, y: 0.2, w: 0.3, h: 0.7 };
    // The video tracked a door there; the design walls it in, so the photo can't show it.
    const behind = work({ found: { "basement window": [input.anchors[0].box], bed: [bed.box], sofa: [sofa.box] } });
    expect((await makePicture({ ...input, anchors: [...input.anchors, door], hidden: [wall] }, behind)).kind).toBe("photo");
    expect((await makePicture({ ...input, anchors: [...input.anchors, door] }, work({ found: { "basement window": [input.anchors[0].box], bed: [bed.box], sofa: [sofa.box] } }))).kind).toBe("render");
    // A second window the video missed but SAM sees in the frame itself is real, so it may show.
    const second = { kind: "window" as const, box: { x: 0.75, y: 0.15, w: 0.15, h: 0.1 } };
    const real = work({ found: { "basement window": [input.anchors[0].box, second.box], bed: [bed.box], sofa: [sofa.box] } });
    expect((await makePicture({ ...input, known: [second] }, real)).kind).toBe("photo");
  });

  it("accepts the top of the real stairs over a new wall, and doesn't hold it to a door cut off at the edge", async () => {
    const stairs = { kind: "stairs" as const, box: { x: 0.79, y: 0.13, w: 0.21, h: 0.87 } };
    const sliver = { kind: "door" as const, box: { x: 0.785, y: 0, w: 0.06, h: 0.136 } };
    const w = work({ found: { "basement window": [input.anchors[0].box], staircase: [{ x: 0.79, y: 0.14, w: 0.2, h: 0.11 }], bed: [bed.box], sofa: [sofa.box] } });
    const m = await makePicture({ ...input, anchors: [...input.anchors, sliver], known: [stairs] }, w);
    expect(m.kind).toBe("photo");
  });

  it("turns down a fridge the design doesn't have, telling the second try, but not the kitchen's own", async () => {
    // Muse Image made the tall new wall beside the kitchen into a fridge.
    const prompts: string[] = [];
    const ok = { "basement window": [input.anchors[0].box], bed: [bed.box], sofa: [sofa.box] };
    const fridge = { x: 0.5, y: 0.1, w: 0.45, h: 0.85 };
    const w = work({
      found: { ...ok, refrigerator: [fridge] },
      edit: async (_g, prompt) => {
        prompts.push(prompt);
        return Buffer.from("photo");
      },
    });
    const m = await makePicture(input, w);
    expect(m.kind).toBe("render");
    expect(m.checked).toMatch(/a fridge appeared that isn't in the design/);
    expect(prompts[0]).not.toMatch(/Above all/);
    expect(prompts[1]).toMatch(/Above all, add no fridge: the tall plain shapes drawn in are walls\./);
    // Where the kitchen is drawn, its fridge is the design's.
    const kitchen: DrawnItem = { id: "k", kind: "kitchen", label: "Kitchen", box: { x: 0.45, y: 0.05, w: 0.55, h: 0.95 }, share: 0.3 };
    const withKitchen = work({ found: { ...ok, "kitchen cabinets": [kitchen.box], refrigerator: [fridge] } });
    expect((await makePicture({ ...input, items: [bed, sofa, kitchen] }, withKitchen)).kind).toBe("photo");
  });

  it("shows the render without spending when the day's budget is used up", async () => {
    const w = work({ canSpend: async () => false });
    const m = await makePicture(input, w);
    expect(w.edits()).toBe(0);
    expect(m).toMatchObject({ kind: "render", attempts: 0 });
  });

  it("holds the photo to the big pieces only, and not to one cut off by the edge", () => {
    const speck = { ...sofa, id: "s2", share: 0.005 };
    const cut = { ...bed, id: "b2", box: { x: 0.8, y: 0.5, w: 0.2, h: 0.3 }, share: 0.06 };
    const rug = { ...sofa, id: "r", kind: "rug", share: 0.2 };
    expect(checkedItems([bed, sofa, speck, cut, rug]).map((i) => i.id)).toEqual(["bed", "sofa"]);
    expect(foundWhereDrawn(bed.box, [{ x: 0.55, y: 0.55, w: 0.3, h: 0.2 }])).toBe(true); // inside it
    expect(foundWhereDrawn(bed.box, [{ x: 0, y: 0, w: 0.3, h: 0.3 }])).toBe(false);
  });

  it("asks Muse Image to keep the room and each piece, in its colour", () => {
    const p = picturePrompt([bed, sofa], input.finishes);
    expect(p).toMatch(/Keep the camera/);
    // A piece with no colour of its own is asked for in the colour the 3D draws it.
    expect(p).toMatch(/the sage bed and the pale sage-grey linen sofa exactly where they are drawn/);
    expect(p).toMatch(/Floor: light oak, everywhere/);
  });

  it("says what the plain walls are, clears the clutter, and finishes the ceiling", () => {
    const p = picturePrompt([bed], input.finishes);
    expect(p).toMatch(/plain walls drawn in are new drywall walls/);
    expect(p).toMatch(/floor to the ceiling with baseboards/);
    expect(p).toMatch(/exercise machines/);
    expect(p).toMatch(/flat, smooth white drywall ceiling/);
    expect(p).toMatch(/Add no window or stair/);
  });

  it("asks every angle of a design for the same finishes, in the words the homeowner picked", () => {
    // The same design from two angles, different pieces in view: the finish words are the same.
    const finish = (p: string) => p.slice(p.indexOf("Floor:"));
    const studio = { style: "warm", floor: "Light oak laminate", walls: "Warm white" };
    expect(finish(picturePrompt([bed], studio))).toBe(finish(picturePrompt([sofa], studio)));
    // Warm wood picked in the studio after the light oak default: the warm floor the 3D draws.
    expect(picturePrompt([], studio)).toMatch(/Floor: warm honey oak plank/);
    expect(picturePrompt([], { style: "light", floor: "Light oak laminate", walls: "Warm white" })).toMatch(/Floor: light oak laminate,.*all the same warm white\./);
    // A board's pick: its floor, walls and feel, and its open ceiling.
    const board = picturePrompt([], { style: "industrial", floor: "Polished concrete floor", walls: "White painted brick wall" });
    expect(board).toMatch(/Floor: polished concrete,/);
    expect(board).toMatch(/soft white, with one white painted brick feature wall/);
    expect(board).toMatch(/joists, ducts and pipes all painted one dark charcoal/);
    expect(picturePrompt([], { style: "green", floor: "Light oak floor", walls: "Sage walls" })).toMatch(/Floor: light oak,.*all the same sage\..*deep green accent wall/);
  });
});
