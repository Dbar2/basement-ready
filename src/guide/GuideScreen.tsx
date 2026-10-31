// The one screen after the upload (ux-guide-build-spec.md): the logo and the three milestones on top, the
// basement in the visual pane, the guide's thread under it (beside it on a computer), and the ask bar.
// GuideScreen draws a state; GuideRoute loads it for /scans/:id/guide.
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Mark } from "../components/Logo";
import { Card, Visual } from "./mount";
import { isMilestone, MILESTONES } from "./progress";
import type { GuideAction, GuideMessage, GuideState } from "./types";
import { useGuide } from "./useGuide";
import "./guide.css";

type Props = {
  scanId: string;
  state: GuideState;
  busy?: boolean;
  error?: string | null;
  act: (action: GuideAction, label?: string) => void;
};

export function GuideScreen({ scanId, state, busy = false, error = null, act }: Props) {
  const log = useRef<HTMLDivElement>(null);
  // The newest message sits just above the ask bar.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [state.messages.length, busy]);

  return (
    <div className="gs" data-milestone={state.milestone}>
      <header className="gs-top">
        <a className="gs-home" href={`/scans/${scanId}`} aria-label="Your basement">
          <Mark title="Your basement" />
        </a>
        <nav aria-label="Milestones">
          <ol className="gs-milestones">
            {MILESTONES.map((m) => (
              <li key={m.id} data-state={state.done[m.id] ? "done" : m.id === state.milestone ? "now" : "todo"} aria-current={m.id === state.milestone ? "step" : undefined}>
                {m.label}
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <section className="gs-visual" data-visual={state.visual.kind} aria-label="Your basement">
        <Visual scanId={scanId} visual={state.visual} act={act} />
      </section>

      <div className="gs-thread" ref={log} role="log" aria-live="polite" aria-label="Your guide">
        {state.messages.map((m, i) => (
          <Message key={m.id} scanId={scanId} m={m} live={i === state.messages.length - 1} busy={busy} act={act} />
        ))}
        {busy && <p className="gs-typing">Thinking…</p>}
        {error && (
          <p className="gs-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <AskBar busy={busy} onAsk={(text) => act({ type: "ask", text })} />
    </div>
  );
}

// One message: the guide's (with its why, its card and its choices while it's the newest) or theirs.
function Message({ scanId, m, live, busy, act }: { scanId: string; m: GuideMessage; live: boolean; busy: boolean; act: Props["act"] }) {
  if (m.from === "you") return <p className="gs-you">{m.text}</p>;
  return (
    <div className="gs-msg">
      <span className="gs-msg-mark" aria-hidden>
        <Mark title="" />
      </span>
      <div className="gs-msg-body">
        <p>{m.text}</p>
        {m.why && <p className="gs-why">{m.why}</p>}
        {m.card && <Card scanId={scanId} card={m.card} act={act} />}
        {live && m.choices && m.choices.length > 0 && (
          <div className="gs-choices">
            {m.choices.map((c) => (
              <button key={c.label} type="button" className={c.primary ? "btn btn-primary" : "gs-choice"} disabled={busy} onClick={() => act(c.action, c.label)}>
                {c.label}
                {c.primary && <span className="arrow" aria-hidden> →</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AskBar({ busy, onAsk }: { busy: boolean; onAsk: (text: string) => void }) {
  const [text, setText] = useState("");
  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    onAsk(t);
    setText("");
  };
  return (
    <form className="gs-ask" onSubmit={send}>
      <label className="visually-hidden" htmlFor="guide-ask-input">
        Ask anything about your basement
      </label>
      <input id="guide-ask-input" className="input" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} placeholder="Ask anything about your basement" autoComplete="off" />
      <button type="submit" className="gs-send" disabled={busy || !text.trim()}>
        Send
      </button>
    </form>
  );
}

export function GuideRoute() {
  const { scanId } = useParams({ from: "/scans/$scanId/guide" });
  const { state, busy, error, act } = useGuide(scanId);
  useEffect(() => {
    document.title = "Your guide | Basement Ready";
  }, []);
  // ?at=design (a Continue on the home base, an older link): once the thread loads, the guide moves to
  // that milestone if it isn't there already, and the address drops the ?at so a refresh resumes.
  const moved = useRef(false);
  useEffect(() => {
    if (!state || moved.current) return;
    moved.current = true;
    const url = new URL(window.location.href);
    const at = url.searchParams.get("at");
    if (!at) return;
    url.searchParams.delete("at");
    window.history.replaceState(window.history.state, "", url);
    if (isMilestone(at) && at !== state.milestone) act({ type: "go", to: at });
  }, [state, act]);
  if (!state)
    return (
      <div className="gs gs-loading" aria-busy={!error}>
        {error ? <p className="gs-error">{error}</p> : <p className="viewer-empty">Opening your guide…</p>}
      </div>
    );
  return <GuideScreen scanId={scanId} state={state} busy={busy} error={error} act={act} />;
}
