// Their board: the cards they loved, building as they swipe, the favourite first and biggest. They can
// move a card earlier or later (the first ones count most) or take it off, and the board says in one
// line what it reads: "Warm wood, light oak floor, cream walls".
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { moodWords, type SwipeAction, type SwipeState } from "../../server/ideas/deck";
import { COLOURS, STYLES, type StyleId } from "../../server/ideas/styles";
import type { Card, Mood } from "./api";
import { CardDialog } from "./CardDialog";
import "./ideas.css";

export function MoodBoard({ cards, state, dispatch, mood }: { cards: Map<string, Card>; state: SwipeState; dispatch: (a: SwipeAction) => void; mood: Mood }) {
  const reduced = useReducedMotion() ?? false;
  const [bigger, setBigger] = useState<string | null>(null);
  const words = moodWords(mood);
  const board = state.board.filter((id) => cards.has(id));
  const f = mood.finishes;

  return (
    <section className="board" aria-labelledby="board-title">
      <div className="board-head">
        <h2 id="board-title">Your board</h2>
        <p className="board-reads" aria-live="polite">
          {words ? (
            <>
              Reads as <strong>{words}</strong>
            </>
          ) : (
            "Love a few cards and your style shows here."
          )}
        </p>
      </div>

      {board.length === 0 ? (
        <div className="board-empty" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <ul className="board-grid">
          <AnimatePresence initial={false}>
            {board.map((id, i) => {
              const c = cards.get(id)!;
              return (
                <motion.li
                  key={id}
                  // Position only: a tile changing size (the favourite spans the row) would stretch its text.
                  layout={reduced ? false : "position"}
                  className="board-tile"
                  data-first={i === 0 || undefined}
                  initial={reduced ? false : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduced ? undefined : { opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
                  transition={{ type: "spring", stiffness: 320, damping: 32 }}
                >
                  <button type="button" className="board-pic" onClick={() => setBigger(id)} aria-label={`See ${c.title} bigger`}>
                    <img src={c.url} alt={`${c.title}, virtually staged`} style={{ aspectRatio: String(c.aspect) }} draggable={false} />
                  </button>
                  <div className="board-tile-bar">
                    <span className="aside">{i === 0 ? "Favourite · virtually staged" : "Virtually staged"}</span>
                    <span className="board-tools">
                      <button type="button" onClick={() => dispatch({ type: "move", id, to: i - 1 })} disabled={i === 0} aria-label={`Move ${c.title} earlier`} title="Earlier">
                        ←
                      </button>
                      <button type="button" onClick={() => dispatch({ type: "move", id, to: i + 1 })} disabled={i === board.length - 1} aria-label={`Move ${c.title} later`} title="Later">
                        →
                      </button>
                      <button type="button" onClick={() => dispatch({ type: "remove", id })} aria-label={`Take ${c.title} off the board`} title="Take off">
                        ×
                      </button>
                    </span>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {mood.style && (
        <dl className="board-finishes">
          <dt>Style</dt>
          <dd>{STYLES[mood.style as StyleId].label}</dd>
          <dt>Floor</dt>
          <dd>{f.floor}</dd>
          <dt>Walls</dt>
          <dd>{f.walls}</dd>
          <dt>Kitchen</dt>
          <dd>{f.kitchen}</dd>
          <dt>Bathroom</dt>
          <dd>{f.bath}</dd>
          <dt>Furniture</dt>
          <dd className="board-colours">
            {(["sofa", "bed", "dining"] as const)
              .filter((k) => mood.colours[k])
              .map((k) => (
                <span key={k}>
                  <i style={{ background: COLOURS[mood.colours[k]!] }} aria-hidden="true" />
                  {mood.colours[k]} {k === "dining" ? "table" : k}
                </span>
              ))}
          </dd>
        </dl>
      )}

      {bigger && cards.get(bigger) && (
        <CardDialog
          card={cards.get(bigger)!}
          onClose={() => setBigger(null)}
          actions={[
            { label: "Make it the favourite", onClick: () => (setBigger(null), dispatch({ type: "move", id: bigger, to: 0 })) },
            { label: "Take it off", onClick: () => (setBigger(null), dispatch({ type: "remove", id: bigger })) },
          ]}
        />
      )}
    </section>
  );
}
