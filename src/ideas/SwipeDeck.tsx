// "Swipe your style": their own basement, restyled, one card at a time. Drag right to love it, left
// for not for me; tap to see it bigger. The buttons and the arrow keys do the same, and with reduced
// motion the buttons are the way (no drag, no fling). Cards still on their way show as the real frame,
// blurred, and sharpen when they land; the ones that have landed come first.
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { upNext, type SwipeAction, type SwipeState, type Verdict } from "../../server/ideas/deck";
import type { Card, Deck, Slot } from "./api";
import { CardDialog } from "./CardDialog";
import { Picture } from "./Picture";
import "./ideas.css";

type Props = {
  deck: Deck;
  cards: Map<string, Card>;
  slots: Map<string, Slot>;
  state: SwipeState;
  dispatch: (a: SwipeAction) => void;
  frameSrc: (frame: number) => string;
  error?: string | null;
  onRetry?: () => void; // deal the deck again after it failed
};

const FAR = 720; // px: off the card's side for good
const DECIDE = 110; // px, or a quick flick

export function SwipeDeck({ deck, cards, slots, state, dispatch, frameSrc, error, onRetry }: Props) {
  const reduced = useReducedMotion() ?? false;
  const queue = upNext(state, (id) => cards.has(id));
  const top = queue[0] ?? null;
  const topReady = top != null && cards.has(top);
  const [bigger, setBigger] = useState<string | null>(null);
  // The top card's fling, so a button or a key throws it the same way a drag does.
  const fling = useRef<((v: Verdict) => void) | null>(null);
  const back = useRef<{ id: string; verdict: Verdict } | null>(null);

  const decide = useCallback(
    (verdict: Verdict) => {
      if (!top || !topReady) return;
      back.current = null;
      if (fling.current && !reduced) fling.current(verdict);
      else dispatch({ type: "swipe", id: top, verdict });
    },
    [top, topReady, reduced, dispatch],
  );
  const undo = useCallback(() => {
    const id = state.history.at(-1);
    if (!id) return;
    back.current = { id, verdict: state.done[id] };
    dispatch({ type: "undo" });
  }, [state, dispatch]);

  // Arrow keys anywhere on the page, unless they're typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (bigger || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], dialog")) return;
      if (e.key === "ArrowRight") decide("love");
      else if (e.key === "ArrowLeft") decide("pass");
      else if (e.key === "u" || e.key === "U") undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bigger, decide, undo]);

  const total = state.order.length;
  const swiped = state.history.length;
  const left = queue.length;
  const shown = queue.slice(0, 3);
  const aspect = (id: string) => slots.get(id)?.aspect ?? 16 / 9;

  return (
    // A tall (portrait) take keeps the whole card on screen: the deck narrows instead.
    <section className="deck" aria-label="Swipe your style" style={{ maxWidth: `min(520px, ${Math.round(54 * (top ? aspect(top) : 16 / 9))}vh)` }}>
      <div className="deck-stack">
        {shown.length === 0 && <DeckEmpty status={deck.status} error={error ?? null} swiped={swiped} onRetry={onRetry} />}
        {[...shown].reverse().map((id) => {
          const depth = shown.indexOf(id);
          const slot = slots.get(id);
          if (!slot) return null;
          return (
            <DeckCard
              key={id}
              slot={slot}
              card={cards.get(id) ?? null}
              depth={depth}
              reduced={reduced}
              frameSrc={frameSrc}
              comeBack={back.current?.id === id ? back.current.verdict : null}
              register={depth === 0 ? (f) => (fling.current = f) : undefined}
              onDecide={(verdict) => {
                back.current = null;
                dispatch({ type: "swipe", id, verdict });
              }}
              onOpen={() => setBigger(id)}
            />
          );
        })}
      </div>

      {/* No buttons to press until there's a card (or a swipe to undo). */}
      <div className="deck-actions" hidden={shown.length === 0 && !swiped}>
        <button type="button" className="deck-btn" onClick={() => decide("pass")} disabled={!topReady} aria-keyshortcuts="ArrowLeft">
          <span aria-hidden="true">←</span> Not for me
        </button>
        <button type="button" className="deck-undo" onClick={undo} disabled={!swiped} aria-keyshortcuts="U">
          Undo
        </button>
        <button type="button" className="deck-btn deck-love" onClick={() => decide("love")} disabled={!topReady} aria-keyshortcuts="ArrowRight">
          Love it <span aria-hidden="true">→</span>
        </button>
      </div>
      <p className="deck-count" aria-live="polite">
        {total ? (
          <>
            <span className="mono">{Math.min(swiped + 1, total)} of {total}</span>
            {left && !topReady ? " · restyling" : ""} · <span className="mono">{state.board.length}</span> loved
          </>
        ) : (
          " "
        )}
      </p>

      {bigger && cards.get(bigger) && (
        <CardDialog
          card={cards.get(bigger)!}
          onClose={() => setBigger(null)}
          actions={
            bigger === top
              ? [
                  { label: "Not for me", onClick: () => (setBigger(null), dispatch({ type: "swipe", id: bigger, verdict: "pass" })) },
                  { label: "Love it", primary: true, onClick: () => (setBigger(null), dispatch({ type: "swipe", id: bigger, verdict: "love" })) },
                ]
              : []
          }
        />
      )}
    </section>
  );
}

function DeckEmpty({ status, error, swiped, onRetry }: { status: Deck["status"]; error: string | null; swiped: number; onRetry?: () => void }) {
  const stuck = Boolean(error) || status === "failed";
  const [title, note] = error
    ? ["The cards didn't start.", error]
    : status === "failed"
      ? ["The cards didn't come through this time.", "Your answer and your plan still do."]
      : status === "done" || swiped
        ? ["That's every card.", "Your board has what you loved."]
        : ["Your cards are on their way.", "They start as soon as your video's frames are in: your own basement, restyled."];
  return (
    <div className="deck-empty" role={stuck ? "alert" : undefined}>
      <p className="deck-empty-title">{title}</p>
      <p>{note}</p>
      {stuck && onRetry && (
        <button type="button" className="btn btn-ghost deck-retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

type CardProps = {
  slot: Slot;
  card: Card | null;
  depth: number;
  reduced: boolean;
  frameSrc: (frame: number) => string;
  comeBack: Verdict | null;
  register?: (fling: (v: Verdict) => void) => void;
  onDecide: (v: Verdict) => void;
  onOpen: () => void;
};

function DeckCard({ slot, card, depth, reduced, frameSrc, comeBack, register, onDecide, onOpen }: CardProps) {
  const top = depth === 0;
  const live = top && Boolean(card);
  // An undone card slides back in from the side it left by.
  const x = useMotionValue(comeBack && !reduced ? (comeBack === "love" ? FAR : -FAR) : 0);
  const rotate = useTransform(x, [-300, 0, 300], [-9, 0, 9]);
  const love = useTransform(x, [24, 130], [0, 1]);
  const pass = useTransform(x, [-130, -24], [1, 0]);
  const going = useRef(false);
  // A drag ends over the card it moved, which also reads as a tap: only a press that never dragged opens it.
  const dragged = useRef(false);

  const throwAway = useCallback(
    (v: Verdict) => {
      if (going.current) return;
      going.current = true;
      animate(x, v === "love" ? FAR : -FAR, { duration: 0.26, ease: [0.4, 0, 1, 1] }).then(() => onDecide(v));
    },
    [x, onDecide],
  );

  useEffect(() => {
    if (live && register) register(throwAway);
  }, [live, register, throwAway]);
  useEffect(() => {
    if (x.get() !== 0 && !going.current) animate(x, 0, { type: "spring", stiffness: 260, damping: 28 });
  }, [x]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > DECIDE || info.velocity.x > 650) throwAway("love");
    else if (info.offset.x < -DECIDE || info.velocity.x < -650) throwAway("pass");
    else animate(x, 0, { type: "spring", stiffness: 420, damping: 32 });
  };

  const t = slot.tags;
  return (
    <motion.article
      className="deck-card"
      data-top={top || undefined}
      data-waiting={!card || undefined}
      style={{ x, rotate, zIndex: 10 - depth }}
      initial={false}
      animate={{ y: depth * 12, scale: 1 - depth * 0.045, opacity: depth > 1 ? 0.7 : 1 }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
      drag={live && !reduced ? "x" : false}
      dragMomentum={false}
      onPointerDown={() => (dragged.current = false)}
      onDragStart={() => (dragged.current = true)}
      onDragEnd={onDragEnd}
      onTap={live ? () => !dragged.current && !going.current && onOpen() : undefined}
      tabIndex={live ? 0 : -1}
      aria-hidden={!top || undefined}
      aria-label={live ? `${slot.title}. ${t.floor}, ${t.walls}. Virtually staged. Press Enter to see it bigger.` : undefined}
      onKeyDown={live ? (e) => e.key === "Enter" && onOpen() : undefined}
    >
      <Picture from={frameSrc(slot.frame)} src={card?.url} aspect={slot.aspect} alt={`${slot.title}, virtually staged from your own video`} />
      <div className="deck-card-meta">
        <h3>{slot.title}</h3>
        <p>
          {card ? `${t.floor} · ${t.walls}` : "Restyling this view…"}
          <span className="deck-staged">Virtually staged · {slot.view}</span>
        </p>
      </div>
      {live && (
        <>
          <motion.span className="deck-verdict deck-verdict-love" style={{ opacity: love }} aria-hidden="true">
            Love it
          </motion.span>
          <motion.span className="deck-verdict deck-verdict-pass" style={{ opacity: pass }} aria-hidden="true">
            Not for me
          </motion.span>
        </>
      )}
    </motion.article>
  );
}
