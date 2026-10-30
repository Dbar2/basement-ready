// The deck and the board together, for the wait screen: their own basement restyled while it
// measures, the board building beside it. Opening it starts the deck, so it's only shown to the person
// who filmed it (or on the example). `onSwiped` says how many they've swiped, so the screen doesn't
// move on while they're in the middle of it.
import { useEffect } from "react";
import { frameSrc } from "./api";
import { MoodBoard } from "./MoodBoard";
import { SwipeDeck } from "./SwipeDeck";
import { useIdeas } from "./useIdeas";
import "./ideas.css";

export function StyleDeck({ scanId, onSwiped }: { scanId: string; onSwiped?: (n: number) => void }) {
  const ideas = useIdeas(scanId);
  const n = ideas.state.history.length;
  useEffect(() => onSwiped?.(n), [n, onSwiped]);
  return (
    <div className="ideas-split">
      <SwipeDeck deck={ideas.deck} cards={ideas.cards} slots={ideas.slots} state={ideas.state} dispatch={ideas.dispatch} frameSrc={(f) => frameSrc(scanId, f)} error={ideas.error} />
      <MoodBoard cards={ideas.cards} state={ideas.state} dispatch={ideas.dispatch} mood={ideas.mood} />
    </div>
  );
}

export default StyleDeck;
