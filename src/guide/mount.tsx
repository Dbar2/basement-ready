// Where each visual and card kind gets drawn. The tracks build the components (C, D, E, F in
// ux-guide-build-spec.md) with these props; the shell track (A) wires them in here. Until a track lands,
// its kinds show a labelled stub, so the guide always has something in the pane.
import type { ComponentType } from "react";
import { BUILD_CARDS } from "./cards";
import { VisualStub } from "./stubs";
import type { CardRef, GuideAction, VisualRef } from "./types";
import { BuildersVisual, MoneyVisual, PermitVisual } from "./visuals/BuildVisuals";
import { PlanEdit } from "./visuals/PlanEdit";

export type VisualKind = VisualRef["kind"];
export type CardKind = CardRef["kind"];

// Every visual gets the scan, its own ref (narrowed to its kind) and a way to act, e.g. a tapped wall.
export type VisualProps<K extends VisualKind = VisualKind> = { scanId: string; visual: Extract<VisualRef, { kind: K }>; act: (action: GuideAction) => void };
// Every card gets the scan, its ref and a way to act, e.g. a saved tape number.
export type CardProps = { scanId: string; card: CardRef; act: (action: GuideAction) => void };

export const VISUAL_KINDS: VisualKind[] = ["video", "plan", "explain", "planEdit", "layouts", "beforeAfter", "permit", "money", "builders"];
export const CARD_KINDS: CardKind[] = ["tape", "window", "owner", "waterMeter", "upstairs", "designer", "moneyQuestion", "buildPath", "download"];

// Swap a stub for the real component as each track lands.
const VISUALS: { [K in VisualKind]: ComponentType<VisualProps<K>> } = {
  video: VisualStub,
  plan: VisualStub,
  explain: VisualStub,
  planEdit: PlanEdit, // track D: check the plan, editable
  layouts: VisualStub,
  beforeAfter: VisualStub,
  // The Build milestone (track F).
  permit: PermitVisual,
  money: MoneyVisual,
  builders: BuildersVisual,
};

// Every card kind is the Build milestone's (track F, src/guide/cards).
const CARDS: Record<CardKind, ComponentType<CardProps>> = BUILD_CARDS;

export function Visual({ scanId, visual, act }: { scanId: string; visual: VisualRef; act: (action: GuideAction) => void }) {
  const C = VISUALS[visual.kind] as ComponentType<VisualProps>;
  return <C scanId={scanId} visual={visual} act={act} />;
}

export function Card({ scanId, card, act }: CardProps) {
  const C = CARDS[card.kind];
  return <C scanId={scanId} card={card} act={act} />;
}
