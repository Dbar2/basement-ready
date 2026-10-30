// The idea cards: their own basement, restyled while it measures. As soon as the scan's frames are
// stored, a few distinct real views are picked (the window corner, the wide shot, the other rooms,
// the capped pipes), SAM 3.1 marks what must stay put in each, and Muse Image restyles them across
// styles, uses and light, many at once. A card is kept only when SAM finds every window, stair and
// door where it was; it's announced the moment it lands as a `card` scan event, so the wait screen
// (and GET /api/scans/:id/cards) can deal it. Every card is labelled "virtually staged".
//
// About 20 cards at $0.01 each, plus SAM's checks at $0.0025 a picture: roughly $0.30 a deck, counted
// toward the daily cap like every other paid call.
import { and, eq, inArray } from "drizzle-orm";
import { frameViews, jpegSize, keptInPlace, pickFrames, type FrameView } from "../concepts";
import { db, schema } from "../db";
import { enqueueOnce } from "../jobs";
import { overSpend } from "../limits";
import { museEdit } from "../meta";
import type { Detection } from "../pipeline";
import { photoInputs } from "../photos";
import { MAX_ROOMS } from "../rooms";
import { photoSpaces, type PhotoSpaces } from "../plans";
import type { Household } from "../rules";
import { keys, storage } from "../storage";
import { cardId, planDeck, type Card, type Deck, type Slot, type View } from "./deck";
import { pickAngles, storedShots, type Shot } from "./angles";
import { boxes, toJpeg, type Box } from "./looks";
import { cardPrompt } from "./styles";

const FPS = 5;
export const MAX_VIEWS = 5;
const LEVEL = 0.35; // |forward.y| under this: a level photo (server/concepts.ts)
const CARD_PX = 960; // long side: sharp on a phone, light to send
const AT_ONCE = 6;

export const cardKey = (scanId: string, n: number) => `scans/${scanId}/cards/${n}.jpg`;
export const cardUrl = (scanId: string, n: number, v: string) => `/api/scans/${scanId}/cards/${n}.jpg?v=${v}`;
export const frameUrl = (scanId: string, frame: number) => `/api/scans/${scanId}/frames/${frame}`;

// The daily cap (server/limits.ts): a deck stops dealing once the day's money is spent. Every Muse
// Image and SAM call here is counted by server/meta.ts.
export const spendGate = { over: overSpend };

// ---- Which views ----

type Find = Pick<Detection, "kind" | "label" | "frame" | "framesSeen" | "box" | "track">;
export type ViewInputs = {
  frameCount: number;
  detections: Find[]; // empty while SAM is still reading the video
  vision?: { rooms: { room: string; atSeconds: number | null }[] } | null;
  household?: string;
  mainRoom?: { startS: number; endS: number } | null;
  views?: Map<number, FrameView> | null; // from the 3D, once an area is measured
  wideAt?: number | null; // seconds: the still wide shot from a corner
  spaces?: PhotoSpaces;
  candidates?: number[]; // the frames there are, when not every one (the example ships six)
  detail?: Map<number, number>; // a spread of frames' JPEG sizes: blurred and blank frames are small
};

export type ViewPick = { frame: number; title: string };

const nearest = (frames: number[], f: number) => frames.reduce((best, x) => (Math.abs(x - f) < Math.abs(best - f) ? x : best), frames[0]);

// Up to five distinct views, as far apart as the take allows. The photos' own picks first (where they
// said what they want, the window, the wide shot, the other room: server/concepts.ts pickFrames), then
// the capped pipes, then the sharpest level frame in each stretch of the take nothing covers yet.
export function pickViews(f: ViewInputs, max = MAX_VIEWS): ViewPick[] {
  const all = f.candidates?.length ? [...f.candidates].sort((a, b) => a - b) : Array.from({ length: f.frameCount }, (_, i) => i);
  if (!all.length) return [];
  // The stretches are filled from the frames whose sharpness is known, when it is.
  const fills = f.detail?.size ? all.filter((x) => f.detail!.has(x)) : all;
  const gap = Math.max(3, Math.min(25, Math.floor(f.frameCount / (2 * max))));
  const picks: ViewPick[] = [];
  const clear = (frame: number) => picks.every((p) => Math.abs(p.frame - frame) >= gap);
  const add = (frame: number, title: string) => {
    const at = nearest(all, frame);
    if (picks.length < max && clear(at)) picks.push({ frame: at, title });
  };

  const spaces = f.spaces ?? photoSpaces(null, (f.household ?? "unsure") as Household);
  const photos = pickFrames(f.detections as Detection[], f.vision, f.household ?? "unsure", f.frameCount, f.mainRoom ?? null, f.views ?? null, f.wideAt ?? null, spaces);
  for (const p of photos) add(p.frame, p.space === spaces.bedroom.space ? "By the window" : p.space === spaces.living.space && p.title !== "Another angle" ? "The wide view" : p.title);

  // Capped pipes in the floor: the frame that shows them whole from farthest back.
  const pipes = f.detections.filter((d) => /rough-in|drain/i.test(d.label)).sort((a, b) => b.framesSeen - a.framesSeen)[0];
  if (pipes) {
    const whole = pipes.track.filter((t) => t[1] > 0.01 && t[2] > 0.01 && t[1] + t[3] < 0.99 && t[2] + t[4] < 0.99 && t[3] > 0.03);
    const frame = [...whole].sort((a, b) => a[3] * a[4] - b[3] * b[4]).find((t) => clear(nearest(all, t[0])))?.[0] ?? pipes.frame;
    add(frame, "On your pipes");
  }

  // The furnace corner and close-ups don't make a room picture; the stairs at one side still do.
  const busy = new Set<number>();
  for (const d of f.detections) for (const t of d.track) if (d.kind === "mechanical" || t[3] * t[4] > 0.4) busy.add(t[0]);
  const level = (frame: number) => (f.views?.get(frame)?.tilt ?? 0) < LEVEL;
  const score = (frame: number) => (f.detail?.get(frame) ?? 0) + (f.views?.get(frame)?.depthM ?? 0) * 1e4;
  // Fill stretch by stretch, the emptiest first, until there are enough or nothing more is clear.
  for (let round = 0; round < max && picks.length < max; round++) {
    const span = f.frameCount / max;
    const open = Array.from({ length: max }, (_, i) => i)
      .map((i) => ({ i, from: i * span, to: (i + 1) * span }))
      .map((s) => ({ ...s, frames: fills.filter((x) => x >= s.from && x < s.to && clear(x) && !busy.has(x) && level(x)) }))
      .filter((s) => s.frames.length && !picks.some((p) => p.frame >= s.from && p.frame < s.to))
      .sort((a, b) => b.frames.length - a.frames.length);
    const s = open[0];
    if (!s) break;
    const mid = (s.from + s.to) / 2;
    const best = [...s.frames].sort((a, b) => score(b) - score(a) || Math.abs(a - mid) - Math.abs(b - mid))[0];
    add(best, "Another angle");
  }
  return picks;
}

// The views from the 3D's best angles (server/ideas/angles.ts), keeping the window corner and the pipes
// in the deck when the video saw them. Named by room when the rooms are known.
export function anglePicks(shots: Shot[], detections: Find[], names: Map<number, string> = new Map(), max = MAX_VIEWS): ViewPick[] {
  const chosen: { shot: Shot; title: string | null }[] = pickAngles(shots, max).map((shot) => ({ shot, title: null }));
  const must: [string, (d: Find) => boolean][] = [
    ["By the window", (d) => d.kind === "window"],
    ["On your pipes", (d) => /rough-in|drain/i.test(d.label)],
  ];
  for (const [title, is] of must) {
    const d = detections.filter(is).sort((a, b) => b.framesSeen - a.framesSeen)[0];
    if (!d) continue;
    const seen = new Set(d.track.map((t) => t[0]));
    const already = chosen.find((c) => seen.has(c.shot.frame) && !c.title);
    if (already) {
      already.title = title;
      continue;
    }
    const alt = pickAngles(shots.filter((s) => seen.has(s.frame) && chosen.every((c) => c.shot.frame !== s.frame)), 1)[0];
    if (!alt) continue;
    const spare = [...chosen].reverse().find((c) => !c.title);
    if (chosen.length >= max && spare) chosen.splice(chosen.indexOf(spare), 1);
    if (chosen.length < max) chosen.push({ shot: alt, title });
  }
  const first = chosen[0]?.shot.room;
  return chosen.map((c, i) => ({
    frame: c.shot.frame,
    title: c.title ?? names.get(c.shot.room) ?? (i === 0 ? "The wide view" : c.shot.room === first ? "Another angle" : "The other room"),
  }));
}

// Each view moved to the sharpest frame within a second of it, by JPEG size: a camera mid-sweep blurs,
// and Muse Image fills blur with things that aren't there.
export async function sharpen(picks: ViewPick[], frameCount: number, work: Pick<CardWork, "frame">, reach = 5): Promise<ViewPick[]> {
  return Promise.all(
    picks.map(async (p) => {
      const near = Array.from({ length: 2 * reach + 1 }, (_, i) => p.frame - reach + i).filter((f) => f >= 0 && f < frameCount);
      const sizes = await Promise.all(near.map(async (f) => [f, (await work.frame(f))?.length ?? 0] as const));
      const best = [...sizes].sort((a, b) => b[1] - a[1])[0];
      return best && best[1] > 0 ? { ...p, frame: best[0] } : p;
    }),
  );
}

// ---- Making the cards ----

const LOOK_FOR = { window: "basement window", stairs: "staircase", door: "door", pipes: "plumbing rough-in" } as const;
type Anchor = { kind: "window" | "stairs" | "door"; box: Box };

export type CardWork = {
  frame: (n: number) => Promise<Buffer | null>;
  edit: (frame: Buffer, prompt: string, size: string) => Promise<Buffer>;
  resize: (img: Buffer, w: number, h: number) => Promise<Buffer>;
  boxes: (jpeg: Buffer, concept: string) => Promise<Box[]>;
  save: (n: number, jpeg: Buffer) => Promise<void>;
  planned: (slots: Slot[]) => Promise<void>;
  landed: (c: Card) => Promise<void>;
  dropped: (n: number) => Promise<void>;
  overCap: () => Promise<boolean>;
  url: (n: number) => string;
  from: (frame: number) => string;
};

// A card's size: the frame's own shape, CARD_PX on its long side.
export function cardSize(frame: Buffer): [number, number] {
  const [w, h] = jpegSize(frame) ?? [1280, 720];
  const k = Math.min(1, CARD_PX / Math.max(w, h));
  return [Math.round((w * k) / 2) * 2, Math.round((h * k) / 2) * 2];
}

// What SAM sees in a view before anything changes: what must stay put, and whether it's the window
// corner or the pipes.
async function lookAt(frame: Buffer, work: CardWork): Promise<{ anchors: Anchor[]; window: boolean; pipes: boolean }> {
  const [windows, stairs, doors, pipes] = await Promise.all(
    (["window", "stairs", "door", "pipes"] as const).map((k) => work.boxes(frame, LOOK_FOR[k]).catch(() => [] as Box[])),
  );
  const anchors: Anchor[] = [
    ...windows.map((box) => ({ kind: "window" as const, box })),
    ...stairs.map((box) => ({ kind: "stairs" as const, box })),
    ...doors.map((box) => ({ kind: "door" as const, box })),
  ];
  return { anchors, window: windows.length > 0, pipes: pipes.length > 0 };
}

// What a view is called once SAM has said: these stay as they are.
const NAMED = new Set(["By the window", "On your pipes"]);

const NAMES = { window: "windows", stairs: "stairs", door: "doors" } as const;

// "Windows, stairs and doors kept where they are · checked by SAM 3.1"
export function checkedWords(kinds: (keyof typeof NAMES)[]) {
  if (!kinds.length) return "Room shape kept";
  const list = kinds.map((k) => NAMES[k]).join(", ").replace(/, ([^,]*)$/, " and $1");
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} kept where they are · checked by SAM 3.1`;
}

// One card: up to two tries until SAM finds every window, stair and door that was there, and no window
// or stair that wasn't (a window the basement doesn't have is a promise it can't keep; a new door is
// fine: the furnace gets one). Otherwise it's left out.
async function makeCard(scanId: string, slot: Slot, frame: Buffer, anchors: Anchor[], work: CardWork): Promise<Card | null> {
  const [w, h] = cardSize(frame);
  const kinds = [...new Set(anchors.map((a) => a.kind))];
  const look = [...new Set<Anchor["kind"]>(["window", "stairs", ...kinds])];
  const was = (k: Anchor["kind"]) => anchors.filter((a) => a.kind === k).map((a) => a.box);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await work.overCap()) return null;
    const jpeg = await work.resize(await work.edit(frame, cardPrompt(slot.tags), `${w}x${h}`), w, h);
    const found = new Map(await Promise.all(look.map(async (k) => [k, await work.boxes(jpeg, LOOK_FOR[k]).catch(() => [] as Box[])] as const)));
    const kept = kinds.every((k) => keptInPlace(was(k), found.get(k)!));
    const added = (["window", "stairs"] as const).some((k) => !keptInPlace(found.get(k)!, was(k)));
    if (!kept || added) continue;
    await work.save(slot.n, jpeg);
    return {
      ...slot,
      id: cardId(slot.n),
      kept: true,
      checked: checkedWords(kinds),
      url: work.url(slot.n),
      from: work.from(slot.frame),
    };
  }
  return null;
}

// The whole deck: look at each view, plan the cards, then deal them AT_ONCE at a time in deck order, so
// the first ones land first. One card failing never costs the others.
export async function makeDeck(scanId: string, picks: ViewPick[], work: CardWork): Promise<{ slots: Slot[]; cards: Card[]; dropped: number[] }> {
  const looked = await Promise.all(
    picks.map(async (p) => {
      const frame = await work.frame(p.frame);
      return frame ? { p, frame, ...(await lookAt(frame, work)) } : null;
    }),
  );
  const seen = looked.filter((x): x is NonNullable<typeof x> => x !== null);
  // What SAM saw names the view when the pick couldn't.
  const views: View[] = seen.map(({ p, frame, window, pipes }) => ({
    frame: p.frame,
    title: NAMED.has(p.title)
      ? p.title
      : pipes && !seen.some((s) => s.p.title === "On your pipes")
        ? "On your pipes"
        : window && !seen.some((s) => s.p.title === "By the window")
          ? "By the window"
          : p.title,
    window,
    pipes,
    aspect: Math.round((cardSize(frame)[0] / cardSize(frame)[1]) * 1000) / 1000,
  }));
  const slots = planDeck(views);
  await work.planned(slots);
  const byFrame = new Map(seen.map((s) => [s.p.frame, s]));
  const cards: Card[] = [];
  const dropped: number[] = [];
  const queue = [...slots];
  // A cluttered view Muse Image keeps reinventing (a window where a box hangs, stairs that aren't
  // there): after two cards turned down and none kept, its other cards aren't tried.
  const tally = new Map<number, { kept: number; lost: number }>();
  const hopeless = (frame: number) => (tally.get(frame)?.lost ?? 0) >= 2 && !tally.get(frame)?.kept;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, queue.length) }, async () => {
      for (let slot = queue.shift(); slot; slot = queue.shift()) {
        const view = byFrame.get(slot.frame)!;
        const card = hopeless(slot.frame)
          ? null
          : await makeCard(scanId, slot, view.frame, view.anchors, work).catch((err) => {
              console.error(`[cards] ${scanId} card ${slot!.n}: ${err instanceof Error ? err.message : err}`);
              return null;
            });
        const t = tally.get(slot.frame) ?? { kept: 0, lost: 0 };
        tally.set(slot.frame, card ? { ...t, kept: t.kept + 1 } : { ...t, lost: t.lost + 1 });
        if (card) {
          cards.push(card);
          await work.landed(card);
        } else {
          dropped.push(slot.n);
          await work.dropped(slot.n);
        }
      }
    }),
  );
  if (slots.length && !cards.length && !(await work.overCap())) throw new Error("No card survived");
  return { slots, cards: cards.sort((a, b) => a.n - b.n), dropped: dropped.sort((a, b) => a - b) };
}

// ---- The job ----

async function read(key: string) {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

async function event(scanId: string, startedAt: Date | null, type: "card" | "cards", text: string, data: unknown) {
  await db.insert(schema.scanEvents).values({ scanId, at: startedAt ? (Date.now() - startedAt.getTime()) / 1000 : 0, type, text, data });
}

export const realCardWork = (scanId: string, startedAt: Date | null): CardWork => {
  const v = Date.now().toString(36);
  return {
    frame: (n) => read(keys.frame(scanId, n)),
    edit: (frame, prompt, size) => museEdit(frame, "image/jpeg", prompt, size),
    resize: toJpeg,
    boxes,
    save: (n, jpeg) => storage.put(cardKey(scanId, n), jpeg, "image/jpeg"),
    planned: (slots) => event(scanId, startedAt, "cards", `${slots.length} cards on the way`, { status: "pending", slots }),
    landed: (c) => event(scanId, startedAt, "card", c.title, c),
    dropped: (n) => event(scanId, startedAt, "card", "Left out", { n, dropped: true }),
    overCap: () => spendGate.over(),
    url: (n) => cardUrl(scanId, n, v),
    from: (frame) => frameUrl(scanId, frame),
  };
};

// The deck so far, from the scan's events.
export async function cardsSoFar(scanId: string): Promise<Deck> {
  const rows = await db
    .select()
    .from(schema.scanEvents)
    .where(and(eq(schema.scanEvents.scanId, scanId), inArray(schema.scanEvents.type, ["card", "cards"])))
    .orderBy(schema.scanEvents.id);
  const decks = rows.filter((e) => e.type === "cards").map((e) => e.data as { status: Deck["status"]; slots: Slot[] });
  const plan = decks.find((d) => d.slots?.length) ?? null;
  const final = decks.at(-1);
  const each = rows.filter((e) => e.type === "card").map((e) => e.data as Card | { n: number; dropped: true });
  return {
    status: final?.status ?? "waiting",
    slots: plan?.slots ?? [],
    cards: each.filter((c): c is Card => !("dropped" in c)).sort((a, b) => a.n - b.n),
    dropped: each.filter((c) => "dropped" in c).map((c) => c.n),
  };
}

// Queued once per scan attempt, when the deck first opens.
export async function enqueueCards(scanId: string) {
  const [scan] = await db.select({ startedAt: schema.scans.startedAt }).from(schema.scans).where(eq(schema.scans.id, scanId));
  return enqueueOnce("cards", { scanId }, scan?.startedAt ?? new Date(0));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The sharpness of a spread of frames, by JPEG size: about sixty reads whatever the take's length.
async function detailOf(scanId: string, frameCount: number, work: CardWork) {
  const step = Math.max(1, Math.floor(frameCount / 60));
  const frames = Array.from({ length: Math.ceil(frameCount / step) }, (_, i) => i * step);
  const detail = new Map<number, number>();
  for (let i = 0; i < frames.length; i += 8) {
    await Promise.all(frames.slice(i, i + 8).map(async (n) => {
      const b = await work.frame(n);
      if (b) detail.set(n, b.length);
    }));
  }
  return detail;
}

// `work` swaps out the model calls (tests); the events are always the scan's own.
// Whether this scan's 3D is still to come: the service is on, the scan isn't over, and it hasn't said
// it's checking without the 3D.
async function threeDComing(scanId: string) {
  if (!process.env.SCAN3D_URL) return false;
  const [scan] = await db.select({ status: schema.scans.status }).from(schema.scans).where(eq(schema.scans.id, scanId));
  if (!scan || scan.status === "done" || scan.status === "error") return false;
  const logs = await db.select({ text: schema.scanEvents.text }).from(schema.scanEvents).where(and(eq(schema.scanEvents.scanId, scanId), eq(schema.scanEvents.type, "log")));
  return !logs.some((l) => /3D scan unavailable/.test(l.text));
}

export async function runCards(scanId: string, opts: { lastAttempt: boolean; work?: Partial<Omit<CardWork, "planned" | "landed" | "dropped">>; waitMs?: number; wait3dMs?: number }) {
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId));
  if (!scan) return;
  const work: CardWork = { ...realCardWork(scanId, scan.startedAt), ...opts.work };
  // The frames come first: wait for the scan to count them, then for the last one to be stored.
  const until = Date.now() + (opts.waitMs ?? 120_000);
  let f = await photoInputs(scanId);
  while (f && !f.frameCount && Date.now() < until) {
    await sleep(1000);
    f = await photoInputs(scanId);
  }
  if (!f?.frameCount) {
    if (opts.lastAttempt) await event(scanId, scan.startedAt, "cards", "No frames to restyle", { status: "failed", slots: [] });
    throw new Error("No frames yet");
  }
  while (!(await work.frame(f.frameCount - 1)) && Date.now() < until) await sleep(1000);

  // A fresh deck replaces any earlier one.
  await db.delete(schema.scanEvents).where(and(eq(schema.scanEvents.scanId, scanId), inArray(schema.scanEvents.type, ["card", "cards"])));
  // The best angles come from the 3D. Its first area lands about a minute in: worth the wait, unless
  // there's no 3D this time.
  const rooms = (f.rooms ?? []).filter((r) => r.has3d).map((r) => r.index);
  const wait3d = Date.now() + (opts.wait3dMs ?? 60_000);
  let shots = await storedShots(scanId, rooms, MAX_ROOMS);
  while (!shots.length && Date.now() < wait3d && (await threeDComing(scanId))) {
    await sleep(2000);
    shots = await storedShots(scanId, rooms, MAX_ROOMS);
  }
  const names = new Map(((scan.result as { rooms?: { index: number; name: string }[] } | null)?.rooms ?? []).map((r) => [r.index, r.name]));
  const angled = shots.length ? anglePicks(shots, f.detections, names) : [];
  // Without the 3D (or too little of it), the frames themselves: the sharpest in each stretch.
  const detail = angled.length >= 3 ? new Map<number, number>() : await detailOf(scanId, f.frameCount, work);
  const views = await frameViews(scanId, f.rooms).catch(() => null);
  const byFrames = angled.length >= 3 ? [] : await sharpen(pickViews({
    frameCount: f.frameCount,
    detections: f.detections,
    vision: f.vision,
    household: f.household,
    mainRoom: f.mainRoom,
    views,
    wideAt: f.wideAt,
    spaces: photoSpaces(f.plans, f.household),
    detail,
  }), f.frameCount, work);
  const picks = [...angled, ...byFrames.filter((p) => angled.every((a) => Math.abs(a.frame - p.frame) >= 25))].slice(0, MAX_VIEWS);
  try {
    const deck = await makeDeck(scanId, picks, work);
    await event(scanId, scan.startedAt, "cards", `${deck.cards.length} cards`, { status: "done", slots: deck.slots });
  } catch (err) {
    console.error(`[cards] ${scanId}: ${err instanceof Error ? err.message : err}`);
    if (!opts.lastAttempt) throw err;
    await event(scanId, scan.startedAt, "cards", "Cards failed", { status: "failed", slots: [] });
  }
}

// ---- A layout's real corner, finished the way their board reads ----

export const cornerKey = (scanId: string, hash: string) => `scans/${scanId}/corners/${hash}.jpg`;

// The same check as a card: up to two tries, kept only when SAM finds the windows, stairs and doors
// where they were. Null when it never passes: the layout card then shows the real frame, unstaged.
export async function makeCorner(scanId: string, frameN: number, tags: Slot["tags"], hash: string, work = realCardWork(scanId, null)): Promise<{ kept: boolean; checked: string } | null> {
  const frame = await work.frame(frameN);
  if (!frame) return null;
  const { anchors } = await lookAt(frame, work);
  const slot: Slot = { n: 0, frame: frameN, view: "", title: "", aspect: 1, tags };
  const card = await makeCard(scanId, slot, frame, anchors, { ...work, save: (_n, jpeg) => storage.put(cornerKey(scanId, hash), jpeg, "image/jpeg") });
  return card ? { kept: true, checked: card.checked } : null;
}

// ---- The example's deck, made once and shipped (scripts/sample-cards.ts) ----

export const SAMPLE_CARDS = "public/samples/sample/cards";
