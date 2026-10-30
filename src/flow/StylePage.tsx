// Step 1 once the scan is done, /scans/:id/style: the swipe deck and the mood board, as on the wait
// screen. Their board finishes the designs; swiping is optional, so the way on is always open.
import { useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import StyleDeck from "../ideas/StyleDeck";
import { FlowFoot, FlowHead } from "./FlowNav";
import "../ideas/ideas.css";

export function StylePage() {
  const { scanId } = useParams({ from: "/scans/$scanId/style" });
  useEffect(() => {
    document.title = "Swipe your style | Basement Ready";
  }, []);
  return (
    <div className="flow-page">
      <FlowHead scanId={scanId} step="style" />
      <main className="ideas-page">
        <div className="ideas-intro">
          <h1>Swipe your style</h1>
          <p>Your own basement, restyled. Right if you love it, left if it's not for you. What you love builds your board, and your board finishes your design.</p>
        </div>
        <StyleDeck scanId={scanId} />
      </main>
      <FlowFoot scanId={scanId} step="style" />
    </div>
  );
}
