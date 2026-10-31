// /dev/guide on a dev server: the guide's screen with every visual kind one tap away, and every card kind in
// a thread, mounted exactly as the guide mounts them (src/guide/mount.tsx). Each track checks its piece
// here, at phone and computer sizes, before the script reaches it.
import { useEffect, useState } from "react";
import { GuideScreen } from "../guide/GuideScreen";
import { CARD_KINDS, VISUAL_KINDS, type CardKind, type VisualKind } from "../guide/mount";
import type { GuideAction, GuideMessage, GuideState, VisualRef } from "../guide/types";
import "../guide/guide.css";
import "./guide-reference.css";

const at = "2026-10-31T12:00:00.000Z";

// A sample ref per kind, with the example basement's ids where a kind needs one.
const SAMPLE_VISUAL: Record<VisualKind, VisualRef> = {
  video: { kind: "video" },
  plan: { kind: "plan", mark: "fire_separation" },
  explain: { kind: "explain", term: "fire_separation" },
  planEdit: { kind: "planEdit" },
  layouts: { kind: "layouts", designId: "one-bedroom" },
  beforeAfter: { kind: "beforeAfter", designId: "one-bedroom", look: "light" },
  permit: { kind: "permit" },
  money: { kind: "money" },
  builders: { kind: "builders" },
};

// Each card kind with an id from the example (track F's src/guide/cards). The example has no open money
// question, so its money card is the applications.
const SAMPLE_CARD: Record<CardKind, string> = {
  tape: "tape",
  window: "window-2",
  owner: "owner",
  waterMeter: "water",
  upstairs: "upstairs",
  designer: "designer",
  moneyQuestion: "apply",
  buildPath: "path",
  download: "review",
};

function thread(visual: VisualRef): GuideState {
  const messages: GuideMessage[] = [
    ...CARD_KINDS.map((kind): GuideMessage => ({ id: `card-${kind}`, from: "guide", text: `A ${kind} card, as it sits under a message.`, card: { kind, id: SAMPLE_CARD[kind] }, at })),
    { id: "you-1", from: "you", text: "What's a fire separation?", at },
    {
      id: "guide-last",
      from: "guide",
      text: "Fire-rated drywall on the basement ceiling and around the stairs, so smoke stays out of the home upstairs for 30 minutes.",
      why: "it's the one fix between your basement and a second home.",
      choices: [
        { label: "Can I do it myself?", action: { type: "ask", text: "Can I do it myself?" } },
        { label: "Show me the design", action: { type: "go", to: "design" }, primary: true },
      ],
      at,
    },
  ];
  return { step: "dev", milestone: "design", done: { answer: true, design: false, build: false }, messages, visual };
}

export function GuideReference() {
  const [kind, setKind] = useState<VisualKind>("plan");
  const [state, setState] = useState<GuideState>(() => thread(SAMPLE_VISUAL.plan));
  useEffect(() => {
    document.title = "Guide reference | Basement Ready";
  }, []);
  useEffect(() => setState((s) => ({ ...s, visual: SAMPLE_VISUAL[kind] })), [kind]);
  // Taps show as their message here; the server's script answers them in the real guide.
  const act = (action: GuideAction, label?: string) => {
    const text = label ?? (action.type === "ask" || action.type === "describe" ? action.text : action.type);
    setState((s) => ({ ...s, messages: [...s.messages, { id: `you-${Date.now()}`, from: "you", text, at: new Date().toISOString() }] }));
  };

  return (
    <main className="gref">
      <header className="gref-head">
        <h1>The guide</h1>
        <p className="muted">Every visual and card kind, mounted as the guide mounts them. Stubs mark the kinds a track hasn't delivered.</p>
        <div className="chips" role="radiogroup" aria-label="Visual">
          {VISUAL_KINDS.map((k) => (
            <button key={k} type="button" className="chip" role="radio" aria-checked={k === kind} aria-pressed={k === kind} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
      </header>
      <div className="gref-frames">
        <figure className="gref-phone">
          <GuideScreen scanId="sample" state={state} act={act} />
          <figcaption>Phone, 390 × 780</figcaption>
        </figure>
        <figure className="gref-desk">
          <GuideScreen scanId="sample" state={state} act={act} />
          <figcaption>Computer, 1280 wide</figcaption>
        </figure>
      </div>
    </main>
  );
}
