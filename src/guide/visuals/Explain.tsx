// The visual pane's explainer: a Drawing Set line drawing for the term the guide is explaining ("what's a
// fire separation?"). Drawn in code, never an AI picture. A term without its own drawing shows the
// basement in section, so the pane is never empty.
import type { ComponentType } from "react";
import "../../styles/ask.css";
import { Alarms } from "./explain/Alarms";
import { Basement } from "./explain/Basement";
import { CeilingHeight } from "./explain/CeilingHeight";
import { EgressWindow } from "./explain/EgressWindow";
import { FireSeparation } from "./explain/FireSeparation";
import { SeparateEntrance } from "./explain/SeparateEntrance";

const DRAWINGS: Record<string, ComponentType> = {
  fire_separation: FireSeparation,
  egress_window: EgressWindow,
  ceiling_height: CeilingHeight,
  separate_entrance: SeparateEntrance,
  smoke_co_alarms: Alarms,
};

export const EXPLAINED_TERMS = Object.keys(DRAWINGS);

export function Explain({ term }: { term: string }) {
  const Drawing = DRAWINGS[term] ?? Basement;
  return (
    <div className="explain" data-term={term}>
      <Drawing />
    </div>
  );
}
