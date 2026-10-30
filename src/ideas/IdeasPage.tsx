// /scans/:id/ideas: swipe your style, watch the board build, then pick a layout. Standalone until the
// wait screen deals the deck itself and the layouts follow the plan check.
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../components/Logo";
import { frameSrc } from "./api";
import { LayoutPicker } from "./LayoutPicker";
import { MoodBoard } from "./MoodBoard";
import { SwipeDeck } from "./SwipeDeck";
import { useIdeas } from "./useIdeas";
import "./ideas.css";

export function IdeasPage() {
  const { scanId } = useParams({ from: "/scans/$scanId/ideas" });
  const ideas = useIdeas(scanId);
  const [layouts, setLayouts] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const swipedAll = ideas.state.order.length > 0 && ideas.state.history.length >= ideas.state.order.length && ideas.deck.status === "done";

  useEffect(() => {
    document.title = "Swipe your style | Basement Ready";
  }, []);
  useEffect(() => {
    if (layouts) picker.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, [layouts]);

  return (
    <main className="ideas-page">
      <div className="ideas-top">
        <Logo />
        <p className="ideas-steps mono">
          <b>1 Swipe your style</b> · {layouts ? <b>2 Pick a layout</b> : "2 Pick a layout"}
        </p>
      </div>
      <div className="ideas-intro">
        <h1>Swipe your style</h1>
        <p>Your own basement, restyled. Right if you love it, left if it's not for you. What you love builds your board, and your board sets the finishes.</p>
      </div>
      <div className="ideas-split">
        <SwipeDeck deck={ideas.deck} cards={ideas.cards} slots={ideas.slots} state={ideas.state} dispatch={ideas.dispatch} frameSrc={(f) => frameSrc(scanId, f)} error={ideas.error} />
        <div className="ideas-board">
          <MoodBoard cards={ideas.cards} state={ideas.state} dispatch={ideas.dispatch} mood={ideas.mood} />
          {!layouts && (
            <div className="ideas-next">
              <button type="button" className="btn btn-primary" onClick={() => setLayouts(true)}>
                Pick a layout <span className="arrow" aria-hidden="true">→</span>
              </button>
              <p>{swipedAll ? "That's every card." : ideas.state.board.length ? "Or keep swiping: the board keeps learning." : "Love a few first, or go straight on."}</p>
            </div>
          )}
        </div>
      </div>
      {layouts && (
        <div ref={picker}>
          <LayoutPicker scanId={scanId} mood={ideas.mood} cards={ideas.deck.cards} />
        </div>
      )}
    </main>
  );
}
