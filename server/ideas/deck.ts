// "Swipe your style": a deck of their own basement restyled, and what their likes say. Pure, so the
// server plans the deck and the browser reads the board with the same code.
//
// A deck is planned from a few real views (server/ideas/cards.ts pickViews): every view meets every
// style once, the first round showing each style, so a handful of swipes already tells them apart.
// Each card's tags are the finishes it shows; the loved ones become the model's `mood`
// (server/model/types.ts Mood), the board's first card counting most.
import type { Finishes, Mood } from "../model/types";
import { DECK_STYLES, STYLES, tagsFor, USES, type StyleId, type Tags, type Use } from "./styles";

// A real view to restyle: the frame, and what SAM saw in it (a window makes it a bedroom; capped pipes
// in the floor, a bathroom).
export type View = { frame: number; title: string; window: boolean; pipes: boolean; aspect: number };

// One planned card, before its picture exists: shown as the original frame, blurred, until it lands.
// `aspect` is the frame's width over height, so the placeholder already has the picture's shape.
export type Slot = { n: number; frame: number; view: string; title: string; aspect: number; tags: Tags };

// One card that landed. `from` is the original frame (the placeholder), `url` the virtually staged one.
export type Card = Slot & { id: string; kept: true; checked: string; url: string; from: string };

// What the client polls: the plan, the cards so far, and the ones SAM turned down (skipped).
export type Deck = { status: "waiting" | "pending" | "done" | "failed"; slots: Slot[]; cards: Card[]; dropped: number[] };

export const MAX_CARDS = 20;

export const cardId = (n: number) => `c${n}`;

// What a view is restyled as, round by round: the window corner mostly a bedroom, the pipes a bathroom.
export function usesFor(v: Pick<View, "window" | "pipes">): Use[] {
  if (v.window && v.pipes) return ["bedroom", "bathroom", "bedroom", "bathroom"];
  if (v.window) return ["bedroom", "living", "bedroom", "kitchen"];
  if (v.pipes) return ["bathroom", "kitchen", "bathroom", "bathroom"];
  return ["living", "kitchen", "living", "kitchen"];
}

// "Bedroom corner, warm wood": the style's name kept as written past its first letter (Scandinavian).
export const cardTitle = (t: Pick<Tags, "use" | "style">) => `${USES[t.use].label}, ${STYLES[t.style].label.charAt(0).toLowerCase()}${STYLES[t.style].label.slice(1)}`;

// Every view meets every style once. Round r gives view i the style i + r, so neighbouring cards never
// share a view or a style, and each style's two floors and two wall colours both come round.
export function planDeck(views: View[], max = MAX_CARDS): Slot[] {
  const seen = new Map<StyleId, number>();
  const slots: Slot[] = [];
  for (let r = 0; r < DECK_STYLES.length; r++) {
    views.forEach((v, i) => {
      const style = DECK_STYLES[(i + r) % DECK_STYLES.length];
      const variant = seen.get(style) ?? 0;
      seen.set(style, variant + 1);
      const uses = usesFor(v);
      const tags = tagsFor(style, uses[r % uses.length], (i + r) % 2 ? "evening" : "day", variant);
      slots.push({ n: slots.length + 1, frame: v.frame, view: v.title, title: cardTitle(tags), aspect: v.aspect, tags });
    });
  }
  return slots.slice(0, max);
}

// Loved cards, in board order, as weights: the first counts double, then less and less.
const weight = (i: number) => 1 + 1 / (i + 1);

// The style and finishes their board reads. A pass counts half against; the board's order breaks ties.
export function moodFrom(cards: Pick<Card, "id" | "tags">[], liked: string[], disliked: string[] = []): Mood {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const loves = liked.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const passes = disliked.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const best = (value: (t: Tags) => string, only: (t: Tags) => boolean = () => true): string | null => {
    const score = new Map<string, number>();
    const first = new Map<string, number>();
    loves.forEach((c, i) => {
      if (!only(c.tags)) return;
      const v = value(c.tags);
      score.set(v, (score.get(v) ?? 0) + weight(i));
      if (!first.has(v)) first.set(v, i);
    });
    for (const c of passes) if (only(c.tags) && score.has(value(c.tags))) score.set(value(c.tags), score.get(value(c.tags))! - 0.5);
    const top = [...score.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || first.get(a[0])! - first.get(b[0])!)[0];
    return top?.[0] ?? null;
  };
  const style = best((t) => t.style) as StyleId | null;
  const finishes: Partial<Finishes> = {};
  if (style) {
    const s = STYLES[style];
    finishes.style = style;
    finishes.floor = best((t) => t.floor) ?? s.floors[0];
    finishes.walls = best((t) => t.walls) ?? s.walls[0];
    // A kitchen or bathroom they loved wins; otherwise the style's own.
    finishes.kitchen = best((t) => t.kitchen, (t) => t.use === "kitchen") ?? s.kitchen;
    finishes.bath = best((t) => t.bath, (t) => t.use === "bathroom") ?? s.bath;
  }
  return { liked: loves.map((c) => c.id), disliked: passes.map((c) => c.id), style, finishes };
}

// The board in one line: "Warm wood, light oak floor, cream walls".
export function moodWords(mood: Pick<Mood, "style" | "finishes">): string | null {
  if (!mood.style || !(mood.style in STYLES)) return null;
  const f = mood.finishes;
  return [STYLES[mood.style as StyleId].label, f.floor?.toLowerCase(), f.walls?.toLowerCase()].filter(Boolean).join(", ");
}

// ---- The deck as they swipe it ----

export type Verdict = "love" | "pass";

export type SwipeState = {
  order: string[]; // every card id, in the order they're shown
  done: Record<string, Verdict>;
  history: string[]; // swiped ids, newest last, for undo
  board: string[]; // loved ids in board order: first is the favourite
};

export type SwipeAction =
  | { type: "arrive"; ids: string[] }
  | { type: "drop"; ids: string[] } // SAM turned them down: never shown
  | { type: "swipe"; id: string; verdict: Verdict }
  | { type: "undo" }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; to: number };

export const emptySwipes: SwipeState = { order: [], done: {}, history: [], board: [] };

export function swipes(s: SwipeState, a: SwipeAction): SwipeState {
  switch (a.type) {
    case "arrive": {
      const fresh = a.ids.filter((id) => !s.order.includes(id));
      return fresh.length ? { ...s, order: [...s.order, ...fresh] } : s;
    }
    case "drop": {
      const gone = a.ids.filter((id) => s.order.includes(id) && !s.done[id]);
      return gone.length ? { ...s, order: s.order.filter((id) => !gone.includes(id)) } : s;
    }
    case "swipe": {
      if (s.done[a.id] || !s.order.includes(a.id)) return s;
      return {
        ...s,
        done: { ...s.done, [a.id]: a.verdict },
        history: [...s.history, a.id],
        board: a.verdict === "love" ? [...s.board, a.id] : s.board,
      };
    }
    case "undo": {
      const id = s.history.at(-1);
      if (!id) return s;
      const { [id]: _, ...done } = s.done;
      return { ...s, done, history: s.history.slice(0, -1), board: s.board.filter((b) => b !== id) };
    }
    case "remove": {
      // Off the board counts as "not for me" from now on.
      if (!s.board.includes(a.id)) return s;
      return { ...s, done: { ...s.done, [a.id]: "pass" }, board: s.board.filter((b) => b !== a.id) };
    }
    case "move": {
      const from = s.board.indexOf(a.id);
      if (from < 0) return s;
      const board = s.board.filter((b) => b !== a.id);
      board.splice(Math.max(0, Math.min(board.length, a.to)), 0, a.id);
      return { ...s, board };
    }
  }
}

// The cards still to swipe: in deck order, the ones that have landed first.
export function upNext(s: SwipeState, ready: (id: string) => boolean): string[] {
  const left = s.order.filter((id) => !s.done[id]);
  return [...left.filter(ready), ...left.filter((id) => !ready(id))];
}

export const liked = (s: SwipeState) => s.board;
export const disliked = (s: SwipeState) => Object.entries(s.done).filter(([id, v]) => v === "pass" && !s.board.includes(id)).map(([id]) => id);
