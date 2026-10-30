import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { db, migrateDb, schema } from "../../server/db";
import { pickAngles, shotsFrom, type Shot } from "../../server/ideas/angles";
import { anglePicks, cardsSoFar, checkedWords, makeDeck, pickViews, runCards, sharpen, type CardWork } from "../../server/ideas/cards";
import { cardId, colourFurniture, disliked, emptySwipes, moodFrom, moodWords, planDeck, swipes, upNext, type Card, type Deck, type SwipeState, type View } from "../../server/ideas/deck";
import { cameras, designFrom, frameFacing, layoutOptions, withCorners } from "../../server/ideas/layouts";
import { cardPrompt, COLOURS, DECK_STYLES, furnitureOf, STYLES, tagsFor } from "../../server/ideas/styles";

beforeAll(async () => {
  await migrateDb();
});

type Track = [number, number, number, number, number];
const det = (kind: string, label: string, frame: number, framesSeen = 10, w = 0.15, h = 0.1, track?: Track[]) => ({
  kind,
  label,
  frame,
  framesSeen,
  box: { x: 0.2, y: 0.2, w, h },
  track: track ?? Array.from({ length: framesSeen }, (_, i): Track => [frame - Math.floor(framesSeen / 2) + i, 0.2, 0.2, w, h]),
});

describe("idea cards: which real views", () => {
  it("picks distinct views across the take: the window, the wide shot, the pipes, then the rest", () => {
    const views = pickViews({
      frameCount: 600,
      detections: [det("window", "Window", 120, 30), det("mechanical", "Plumbing rough-in", 470, 12, 0.08, 0.06), det("stairs", "Stairs", 300, 8)],
      household: "renter",
      wideAt: 40, // seconds: frame 200
    });
    expect(views.length).toBe(5);
    const frames = views.map((v) => v.frame);
    for (const a of frames) for (const b of frames) if (a !== b) expect(Math.abs(a - b)).toBeGreaterThanOrEqual(25);
    expect(views[0]).toMatchObject({ title: "By the window" });
    expect(Math.abs(views[0].frame - 120)).toBeLessThan(20);
    expect(views.find((v) => v.title === "The wide view")!.frame).toBeGreaterThanOrEqual(192);
    expect(views.find((v) => v.title === "On your pipes")!.frame).toBeGreaterThan(455);
  });

  it("never picks the furnace corner or a close-up to fill", () => {
    const furnace = det("mechanical", "Furnace", 300, 200, 0.2, 0.2);
    const views = pickViews({ frameCount: 600, detections: [furnace], household: "unsure" });
    expect(views.some((v) => v.frame >= 200 && v.frame < 400)).toBe(false);
    expect(views.length).toBeGreaterThanOrEqual(3);
  });

  it("before SAM has read the video, spreads views over the take and takes the sharpest frame in each stretch", () => {
    const detail = new Map(Array.from({ length: 60 }, (_, i) => [i * 10, i * 10 === 130 ? 900_000 : 100_000]));
    const views = pickViews({ frameCount: 600, detections: [], detail });
    expect(views.length).toBe(5);
    expect(views.map((v) => v.frame)).toContain(130);
    expect(views.every((v) => detail.has(v.frame))).toBe(true);
  });

  it("snaps to the frames there are (the example ships six)", () => {
    const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
    const frames = [0, 21, 34, 44, 49, 59];
    const views = pickViews({ frameCount: sample.frameCount, detections: sample.detections, household: sample.household, candidates: frames }, 4);
    expect(views.every((v) => frames.includes(v.frame))).toBe(true);
    expect(new Set(views.map((v) => v.frame)).size).toBe(views.length);
    expect(views[0].frame).toBe(0); // the window
  });
});

// A camera in a 6 × 4 m room: where it stands, which way it looks on the floor (degrees, 0 = +z),
// how far it tips down, how high it is.
function pose(x: number, z: number, yawDeg: number, down = 0.1, height = 1.5): number[][] {
  const yaw = (yawDeg * Math.PI) / 180;
  const f = [Math.sin(yaw) * Math.sqrt(1 - down * down), -down, Math.cos(yaw) * Math.sqrt(1 - down * down)];
  return [
    [0, 0, f[0], x],
    [0, 0, f[1], height],
    [0, 0, f[2], z],
    [0, 0, 0, 1],
  ];
}
const room = { floor: { heightM: 0 }, box: { min: [-3, 0, -2], max: [3, 2.4, 2] } };

describe("idea cards: the best angles from the 3D", () => {
  it("measures how far each frame sees to the wall ahead, and how level and high the camera is", () => {
    const [s] = shotsFrom({ room, frames: [{ name: "0120.jpg", sharpness: 300, pose: pose(-2.5, 0, 90) }] }, null, 0);
    expect(s).toMatchObject({ frame: 120, room: 0, heightM: 1.5 });
    expect(s.aheadM).toBeCloseTo(5.5, 1); // looking along the room to the far wall
    expect(s.tilt).toBeCloseTo(0.1);
  });

  it("never picks a frame looking down, held too low, or facing a wall close up", () => {
    const shots = shotsFrom(
      {
        room,
        frames: [
          { name: "0010.jpg", sharpness: 500, pose: pose(-2.5, 0, 90, 0.7) }, // at the floor
          { name: "0030.jpg", sharpness: 500, pose: pose(-2.5, 0, 90, 0.1, 0.6) }, // knee height
          { name: "0050.jpg", sharpness: 500, pose: pose(2.4, 0, 90) }, // 0.6 m from the wall
          { name: "0070.jpg", sharpness: 100, pose: pose(-2.5, 0.5, 80) }, // the one good view
        ],
      },
      null,
      0,
    );
    expect(pickAngles(shots).map((s) => s.frame)).toEqual([70]);
  });

  it("prefers the sharper of two wide views, and spreads around: every room, then other directions", () => {
    const a = shotsFrom({ room, frames: [
      { name: "0100.jpg", sharpness: 50, pose: pose(-2.5, 0, 90) },
      { name: "0110.jpg", sharpness: 400, pose: pose(-2.5, 0.2, 92) },
      { name: "0150.jpg", sharpness: 300, pose: pose(2.5, 0, -90) },
    ] }, null, 0);
    const b = shotsFrom({ room, frames: [{ name: "0300.jpg", sharpness: 200, pose: pose(0, -1.8, 0) }] }, null, 1);
    const picks = pickAngles([...a, ...b]);
    expect(picks[0].frame).toBe(110); // sharp and wide
    expect(picks.map((p) => p.room).slice(0, 2).sort()).toEqual([0, 1]); // both rooms before a second of either
    expect(picks.map((p) => p.frame)).toContain(150); // the same room, looking the other way
    expect(picks.map((p) => p.frame)).not.toContain(100); // too close in direction to 110
  });

  it("keeps the window corner in the deck when the video saw one, and names views by room", () => {
    const shots: Shot[] = shotsFrom({ room, frames: [
      { name: "0100.jpg", sharpness: 400, pose: pose(-2.5, 0, 90) },
      { name: "0200.jpg", sharpness: 100, pose: pose(0, -1.8, 0) },
    ] }, null, 0);
    const window = det("window", "Window", 200, 3);
    const picks = anglePicks(shots, [window], new Map([[0, "Room 1"]]), 1);
    expect(picks).toEqual([{ frame: 200, title: "By the window" }]);
    expect(anglePicks(shots, [], new Map([[0, "Room 1"]]))[0]).toEqual({ frame: 100, title: "Room 1" });
  });
});

const view = (frame: number, window = false, pipes = false): View => ({ frame, title: `View ${frame}`, window, pipes, aspect: 16 / 9 });

describe("idea cards: the deck", () => {
  it("meets every view with every style once, the first round showing all four", () => {
    const slots = planDeck([view(0, true), view(100), view(200), view(300, false, true), view(400)]);
    expect(slots.length).toBe(20);
    expect(new Set(slots.slice(0, 4).map((s) => s.tags.style)).size).toBe(4);
    const pairs = new Set(slots.map((s) => `${s.frame}-${s.tags.style}`));
    expect(pairs.size).toBe(20);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].frame).not.toBe(slots[i - 1].frame);
      expect(slots[i].tags.style).not.toBe(slots[i - 1].tags.style);
    }
    // The window corner is mostly a bedroom, the pipes mostly a bathroom.
    expect(slots.filter((s) => s.frame === 0 && s.tags.use === "bedroom").length).toBe(2);
    expect(slots.filter((s) => s.frame === 300 && s.tags.use === "bathroom").length).toBe(3);
    expect(slots.some((s) => s.tags.use === "kitchen")).toBe(true);
    // Each style's two floors both come round.
    for (const style of DECK_STYLES) expect(new Set(slots.filter((s) => s.tags.style === style).map((s) => s.tags.floor)).size).toBe(2);
  });

  it("keeps to the cap and numbers cards in deck order", () => {
    const slots = planDeck([view(0), view(50), view(100), view(150), view(200), view(250)], 18);
    expect(slots.map((s) => s.n)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("asks Muse Image to keep the room, its windows, doors and stairs, in the card's finishes", () => {
    const p = cardPrompt(tagsFor("industrial", "kitchen", "evening", 1));
    expect(p).toMatch(/Do not add, remove or move any window, door or stair/);
    expect(p).toMatch(/dark oak floor/);
    expect(p).toMatch(/black metal and oak kitchen/);
    expect(p).toMatch(/warm lamps/);
  });

  it("says what SAM checked in plain words", () => {
    expect(checkedWords(["window", "stairs", "door"])).toBe("Windows, stairs and doors kept where they are · checked by SAM 3.1");
    expect(checkedWords([])).toBe("Room shape kept");
  });
});

const card = (n: number, style: keyof typeof STYLES, use: "bedroom" | "living" | "kitchen" | "bathroom" = "living", variant = 0): Card => ({
  n,
  id: cardId(n),
  frame: n * 10,
  view: "View",
  title: "",
  aspect: 16 / 9,
  tags: tagsFor(style, use, "day", variant),
  kept: true,
  checked: "",
  url: "",
  from: "",
});

describe("idea cards: likes into finishes", () => {
  const cards = [card(1, "warm"), card(2, "warm", "living", 1), card(3, "modern"), card(4, "bright", "kitchen"), card(5, "industrial", "bathroom"), card(6, "modern", "living", 2)];

  it("reads the style and finishes the loved cards share", () => {
    const mood = moodFrom(cards, ["c1", "c2", "c4"]);
    expect(mood.style).toBe("warm");
    expect(mood.finishes).toMatchObject({ style: "warm", floor: "Warm oak floor", walls: "Cream walls" });
    // A loved kitchen card sets the kitchen even in another style; no bathroom loved: the style's own.
    expect(mood.finishes.kitchen).toBe(STYLES.bright.kitchen);
    expect(mood.finishes.bath).toBe(STYLES.warm.bath);
    expect(moodWords(mood)).toBe("Warm wood, warm oak floor, cream walls");
  });

  it("counts the board's first card most, so reordering changes the read", () => {
    expect(moodFrom(cards, ["c1", "c3"]).style).toBe("warm");
    expect(moodFrom(cards, ["c3", "c1"]).style).toBe("modern");
  });

  it("counts a pass half against", () => {
    expect(moodFrom(cards, ["c3", "c1", "c2"], ["c6"]).style).toBe("warm");
  });

  it("colours the furniture from the board: each piece in the style loved most for its room", () => {
    const mood = moodFrom([card(1, "industrial", "living"), card(2, "warm", "bedroom"), card(3, "bright", "kitchen")], ["c1", "c2", "c3"]);
    expect(mood.colours.sofa).toBe(STYLES.industrial.furniture.sofa);
    expect(mood.colours.bed).toBe(STYLES.warm.furniture.bed);
    expect(mood.colours.dining).toBe(STYLES.bright.furniture.dining);
    // Nothing loved for the bathroom: the board's own style.
    expect(mood.colours.vanity).toBe(furnitureOf(mood.style as "industrial").vanity);
    for (const name of Object.values(mood.colours)) expect(COLOURS[name!]).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("paints a design's furniture from the board, never over a colour they picked", () => {
    const colours = { sofa: "Charcoal", bed: "Oat linen" };
    const out = colourFurniture(
      [
        { id: "f1", kind: "sofa", at: [0, 0], rotDeg: 0, sizeM: [2, 0.9] },
        { id: "f2", kind: "bed", at: [1, 1], rotDeg: 0, sizeM: [1.5, 2], colour: "Forest velvet" },
        { id: "f3", kind: "lamp" as never, at: [0, 1], rotDeg: 0, sizeM: [0.3, 0.3] },
      ],
      colours,
    );
    expect(out.map((f) => f.colour)).toEqual(["Charcoal", "Forest velvet", undefined]);
  });

  it("reads nothing until something is loved", () => {
    const mood = moodFrom(cards, [], ["c1"]);
    expect(mood).toMatchObject({ style: null, finishes: {}, liked: [], colours: {} });
    expect(moodWords(mood)).toBeNull();
  });
});

describe("idea cards: swiping", () => {
  const ids = ["c1", "c2", "c3", "c4"];
  const run = (...actions: Parameters<typeof swipes>[1][]) => actions.reduce(swipes, emptySwipes);

  it("loves and passes in order, and undoes the last", () => {
    let s = run({ type: "arrive", ids }, { type: "swipe", id: "c1", verdict: "love" }, { type: "swipe", id: "c2", verdict: "pass" }, { type: "swipe", id: "c3", verdict: "love" });
    expect(s.board).toEqual(["c1", "c3"]);
    expect(disliked(s)).toEqual(["c2"]);
    expect(upNext(s, () => true)).toEqual(["c4"]);
    s = swipes(s, { type: "undo" });
    expect(s.board).toEqual(["c1"]);
    expect(upNext(s, () => true)).toEqual(["c3", "c4"]);
  });

  it("never swipes a card twice or one that isn't in the deck", () => {
    const s = run({ type: "arrive", ids }, { type: "swipe", id: "c1", verdict: "love" }, { type: "swipe", id: "c1", verdict: "pass" }, { type: "swipe", id: "c9", verdict: "love" });
    expect(s.board).toEqual(["c1"]);
    expect(s.history).toEqual(["c1"]);
  });

  it("deals the cards that have landed first, and leaves out the ones SAM turned down", () => {
    let s = run({ type: "arrive", ids }, { type: "arrive", ids: ["c3", "c5"] });
    expect(s.order).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(upNext(s, (id) => id === "c4" || id === "c2")).toEqual(["c2", "c4", "c1", "c3", "c5"]);
    s = swipes(s, { type: "drop", ids: ["c3"] });
    expect(s.order).not.toContain("c3");
  });

  it("reorders the board and takes cards off it", () => {
    let s: SwipeState = run({ type: "arrive", ids }, ...ids.map((id) => ({ type: "swipe" as const, id, verdict: "love" as const })));
    s = swipes(s, { type: "move", id: "c3", to: 0 });
    expect(s.board).toEqual(["c3", "c1", "c2", "c4"]);
    s = swipes(s, { type: "move", id: "c3", to: 9 });
    expect(s.board).toEqual(["c1", "c2", "c4", "c3"]);
    s = swipes(s, { type: "remove", id: "c2" });
    expect(s.board).toEqual(["c1", "c4", "c3"]);
    expect(disliked(s)).toEqual(["c2"]);
  });
});

// Muse Image and SAM, faked: the window is in frame 0 only; a restyle keeps it unless told to lose it,
// and adds one where there was none when told to.
const fakeJpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
function fakeWork(opts: { lose?: (frame: number) => boolean; add?: (frame: number) => boolean; overCapAfter?: number; editMs?: (frame: number) => number } = {}) {
  const log = { edits: 0, running: 0, maxRunning: 0, landed: [] as number[], dropped: [] as number[], planned: 0, editsOf: new Map<number, number>() };
  const original = new Map<Buffer, number>();
  const edited = new Map<Buffer, number>();
  const work: CardWork = {
    frame: async (n) => {
      const b = fakeJpeg(1280, 720);
      original.set(b, n);
      return b;
    },
    edit: async (frame) => {
      log.edits++;
      log.editsOf.set(original.get(frame)!, (log.editsOf.get(original.get(frame)!) ?? 0) + 1);
      log.running++;
      log.maxRunning = Math.max(log.maxRunning, log.running);
      await new Promise((r) => setTimeout(r, opts.editMs?.(original.get(frame)!) ?? 5));
      log.running--;
      const out = Buffer.from(`edit ${log.edits}`);
      edited.set(out, original.get(frame)!);
      return out;
    },
    resize: async (img) => img,
    boxes: async (jpeg, concept) => {
      if (concept !== "basement window") return [];
      const fromFrame = original.get(jpeg);
      if (fromFrame != null) return fromFrame === 0 ? [{ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }] : [];
      const frame = edited.get(jpeg)!;
      if (frame === 0) return opts.lose?.(frame) ? [] : [{ x: 0.11, y: 0.1, w: 0.2, h: 0.1 }];
      return opts.add?.(frame) ? [{ x: 0.6, y: 0.1, w: 0.2, h: 0.1 }] : [];
    },
    save: async () => {},
    planned: async () => void log.planned++,
    landed: async (c) => void log.landed.push(c.n),
    dropped: async (n) => void log.dropped.push(n),
    overCap: async () => opts.overCapAfter != null && log.edits >= opts.overCapAfter,
    url: (n) => `/cards/${n}.jpg`,
    from: (f) => `/frames/${f}`,
  };
  return { work, log };
}

describe("idea cards: making them", () => {
  const picks = [0, 100, 200, 300].map((frame) => ({ frame, title: "Another angle" }));

  it("keeps a card only when SAM finds the window where it was, many at once", async () => {
    const { work, log } = fakeWork({ lose: (frame) => frame === 0 });
    const deck = await makeDeck("t", picks, work);
    expect(deck.slots.length).toBe(16);
    // The window view's four cards each tried twice and were left out; the rest landed.
    expect(deck.dropped).toEqual(deck.slots.filter((s) => s.frame === 0).map((s) => s.n));
    expect(deck.cards.length).toBe(12);
    // Each turned-down card tried twice; once two of a view are turned down, its others aren't tried.
    expect(log.edits).toBeGreaterThanOrEqual(12 + 2 * 2);
    expect(log.edits).toBeLessThanOrEqual(12 + 4 * 2);
    expect(log.maxRunning).toBeGreaterThan(1);
    expect(log.maxRunning).toBeLessThanOrEqual(6);
    // SAM's window made the view the window corner.
    expect(deck.slots.find((s) => s.frame === 0)!.view).toBe("By the window");
    expect(deck.cards.find((c) => c.frame === 100)!.checked).toBe("Room shape kept");
  });

  it("stops trying a view once two of its cards are turned down", async () => {
    // The bad view's tries come back fast, the rest slowly: its first two are turned down before its
    // last two would start, so those two are never tried.
    const { work, log } = fakeWork({ add: (frame) => frame === 200, editMs: (frame) => (frame === 200 ? 1 : 40) });
    const deck = await makeDeck("t", picks, work);
    expect(deck.dropped).toEqual(deck.slots.filter((s) => s.frame === 200).map((s) => s.n));
    expect(log.editsOf.get(200)).toBe(2 * 2);
    expect(deck.cards.length).toBe(12);
  });

  it("leaves out a card that grew a window the basement doesn't have", async () => {
    const { work } = fakeWork({ add: (frame) => frame === 200 });
    const deck = await makeDeck("t", picks, work);
    expect(deck.dropped).toEqual(deck.slots.filter((s) => s.frame === 200).map((s) => s.n));
    expect(deck.cards.every((c) => c.frame !== 200)).toBe(true);
  });

  it("moves each view to the sharpest frame within a second", async () => {
    const sizes = new Map([[98, 500], [100, 300], [103, 900], [107, 2000]]);
    const work = { frame: async (n: number) => Buffer.alloc(sizes.get(n) ?? 100) };
    expect(await sharpen([{ frame: 100, title: "A" }], 600, work)).toEqual([{ frame: 103, title: "A" }]);
  });

  it("stops dealing once the day's money is spent", async () => {
    const { work, log } = fakeWork({ overCapAfter: 3 });
    const deck = await makeDeck("t", picks, work);
    expect(log.edits).toBeLessThanOrEqual(3 + 5);
    expect(deck.cards.length + deck.dropped.length).toBe(16);
  });
});

describe("idea cards: the job", () => {
  it("waits for the frames, then streams the plan and each card as scan events", async () => {
    const [basement] = await db.insert(schema.basements).values({ claimToken: "t", household: "renter", municipality: "waterloo-on", address: "" }).returning();
    const [scan] = await db.insert(schema.scans).values({ basementId: basement.id, startedAt: new Date() }).returning();
    await db.insert(schema.scanEvents).values({ scanId: scan.id, at: 1, type: "log", text: "Reading 300 frames", data: { frameCount: 300 } });
    const { work } = fakeWork();
    // Only the model calls are faked; the fake reads every frame, so they're all "stored".
    const { planned: _p, landed: _l, dropped: _d, ...models } = work;
    await runCards(scan.id, { lastAttempt: true, work: models, waitMs: 2000 });
    const deck: Deck = await cardsSoFar(scan.id);
    expect(deck.status).toBe("done");
    expect(deck.slots.length).toBeGreaterThanOrEqual(12);
    expect(deck.cards.length).toBe(deck.slots.length);
    expect(deck.cards.every((c) => c.id === cardId(c.n) && c.url.startsWith("/cards/"))).toBe(true);
  });
});

describe("the example's deck", () => {
  const dir = "public/samples/sample/cards";
  const deck: Deck = JSON.parse(readFileSync(`${dir}/deck.json`, "utf8"));

  it("ships whole, so it deals with no keys and no server", () => {
    expect(deck.status).toBe("done");
    expect(deck.cards.length).toBeGreaterThanOrEqual(12);
    expect(deck.cards.length).toBeLessThanOrEqual(24);
    for (const c of deck.cards) {
      expect(c.url).toBe(`/samples/sample/cards/${c.n}.jpg`);
      expect(existsSync(`public${c.url}`)).toBe(true);
      expect(existsSync(`public${c.from}`)).toBe(true);
      expect(c.kept).toBe(true);
      expect(c.tags.style in STYLES).toBe(true);
    }
    expect(new Set(deck.cards.map((c) => c.id)).size).toBe(deck.cards.length);
    expect(new Set(deck.slots.map((s) => s.frame)).size).toBeGreaterThanOrEqual(4);
  });

  it("reads into a mood like a live deck", () => {
    const loved = deck.cards.filter((c) => c.tags.style === "warm").map((c) => c.id);
    expect(moodFrom(deck.cards, loved).style).toBe("warm");
  });
});

describe("pick a layout", () => {
  const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
  const scan = JSON.parse(readFileSync("public/samples/sample/3d/scan.json", "utf8"));

  it("offers three or four layouts that differ, the bedroom on the window among them", () => {
    const options = layoutOptions(sample.plan);
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.length).toBeLessThanOrEqual(4);
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
    expect(new Set(options.map((o) => o.name)).size).toBe(options.length);
    expect(options.map((o) => o.kind)).toContain("studio");
    expect(options.find((o) => o.name === "One bedroom on the window")?.checks.passed).toBeGreaterThan(0);
  });

  it("finds the real frame that looks at the window corner", () => {
    // The example's window is on its far wall at x ≈ 1.4; its first frame looks straight at it.
    const frame = frameFacing(cameras(scan), [1.4, 2.5]);
    expect(frame).not.toBeNull();
    expect(frame!).toBeLessThan(10);
    const options = withCorners(layoutOptions(sample.plan), cameras(scan), 16 / 9, [0, 21, 44, 59]);
    for (const o of options) expect([0, 21, 44, 59]).toContain(o.corner!.frame);
    expect(options.find((o) => o.name === "One bedroom on the window")!.corner!.frame).toBe(0);
  });

  it("saves the pick as a design in the model, with its doors on its walls", () => {
    const o = layoutOptions(sample.plan).find((x) => x.kind === "one_bedroom")!;
    const d = designFrom(o, { style: "warm", floor: "Walnut floor" });
    expect(d).toMatchObject({ id: o.id, layout: "one_bedroom", chosen: true, finishes: { style: "warm", floor: "Walnut floor", walls: "Cream walls" } });
    expect(d.proposed.walls.length).toBe(o.layout.walls.length);
    expect(d.proposed.openings.length).toBe(o.layout.doors.length);
    for (const op of d.proposed.openings) expect(d.proposed.walls.some((w) => w.id === op.wallId)).toBe(true);
    expect(d.proposed.rooms.find((r) => r.kind === "bedroom")?.unit).toBe(2);
  });
});
