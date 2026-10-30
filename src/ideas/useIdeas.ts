// The deck as it fills and as they swipe it: started once, read every 1.5 s until it's done, and the
// swipes kept in this tab so a refresh keeps the board. The example deals its shipped cards a few at a
// time, so it lands the way a real deck does.
import { useEffect, useMemo, useReducer, useState } from "react";
import { cardId, disliked, emptySwipes, moodFrom, swipes, type SwipeState } from "../../server/ideas/deck";
import { emptyDeck, readDeck, saveMood, startDeck, type Deck } from "./api";

const key = (scanId: string) => `br-swipes-${scanId}`;

function saved(scanId: string): SwipeState {
  try {
    return { ...emptySwipes, ...JSON.parse(sessionStorage.getItem(key(scanId)) ?? "null") };
  } catch {
    return emptySwipes;
  }
}

export function useIdeas(scanId: string) {
  const [deck, setDeck] = useState<Deck>(emptyDeck);
  const [error, setError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(swipes, scanId, saved);
  // Each "Try again" starts the deck once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    if (scanId === "sample") {
      startDeck(scanId).then((d) => {
        if (stopped || "error" in d) return;
        // Three to start, then one every 350 ms.
        let shown = 3;
        const deal = () => {
          if (stopped) return;
          setDeck({ ...d, status: shown >= d.cards.length ? d.status : "pending", cards: d.cards.slice(0, shown) });
          if (shown++ < d.cards.length) timer = window.setTimeout(deal, 350);
        };
        deal();
      });
    } else {
      const tick = async (first: boolean) => {
        const d = first ? await startDeck(scanId, attempt > 0).catch(() => ({ error: "The cards didn't start. Try again." })) : await readDeck(scanId).catch(() => null);
        if (stopped) return;
        if (d && "error" in d) return setError(d.error);
        if (d) setDeck(d);
        if (!d || (d.status !== "done" && d.status !== "failed")) timer = window.setTimeout(() => tick(false), 1500);
      };
      tick(true);
    }
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [scanId, attempt]);

  const retry = () => {
    setError(null);
    setDeck(emptyDeck);
    setAttempt((n) => n + 1);
  };

  // Planned cards join the deck at once (as placeholders); the ones SAM turned down leave it.
  useEffect(() => {
    dispatch({ type: "arrive", ids: deck.slots.filter((s) => !deck.dropped.includes(s.n)).map((s) => cardId(s.n)) });
    if (deck.dropped.length) dispatch({ type: "drop", ids: deck.dropped.map(cardId) });
  }, [deck.slots, deck.dropped]);

  useEffect(() => {
    try {
      sessionStorage.setItem(key(scanId), JSON.stringify(state));
    } catch {
      // Private mode: the board lasts as long as the page.
    }
  }, [scanId, state]);

  const cards = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck.cards]);
  const slots = useMemo(() => new Map(deck.slots.map((s) => [cardId(s.n), s])), [deck.slots]);
  const mood = useMemo(() => moodFrom(deck.cards, state.board, disliked(state)), [deck.cards, state]);
  // The board goes to the model a moment after it stops changing.
  const said = JSON.stringify(mood);
  useEffect(() => {
    if (!state.history.length) return;
    const t = window.setTimeout(() => saveMood(scanId, JSON.parse(said)), 1200);
    return () => clearTimeout(t);
  }, [scanId, said, state.history.length]);
  return { deck, cards, slots, state, dispatch, mood, error, retry };
}

export type Ideas = ReturnType<typeof useIdeas>;
