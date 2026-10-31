// The one screen after the upload (ux-guide-build-spec.md): the logo and the three milestones on top, the
// basement in the visual pane, the guide's thread under it (beside it on a computer), and the ask bar.
// GuideScreen draws a state; GuideRoute loads it for /scans/:id/guide.
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Mark } from "../components/Logo";
import { AskBar } from "./AskBar";
import { Card, Visual } from "./mount";
import { isMilestone, MILESTONES } from "./progress";
import { rich } from "./Thread";
import type { GuideAction, GuideMessage, GuideState } from "./types";
import { useGuide } from "./useGuide";
import "./guide.css";

type Props = {
  scanId: string;
  state: GuideState;
  busy?: boolean;
  error?: string | null;
  act: (action: GuideAction, label?: string) => void;
  placeholder?: string; // what the ask bar suggests at this step (useGuide)
};

export function GuideScreen({ scanId, state, busy = false, error = null, act, placeholder }: Props) {
  const log = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // The newest message sits just above the ask bar. While they're at the bottom, the thread follows it as
  // messages arrive and cards fill in with their data; once they scroll up to read, it stays put.
  const pinned = useRef(true);
  useEffect(() => {
    const el = log.current;
    if (!el || !body.current) return;
    const follow = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    const grows = new ResizeObserver(follow);
    grows.observe(body.current);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      grows.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
  // Something new in the thread, theirs or the guide's, brings it back to the bottom.
  useEffect(() => {
    pinned.current = true;
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [state.messages.length, busy]);
  // The newest guide message is the one asking: only its buttons are live, even under their own reply.
  const asking = state.messages.findLast((m) => m.from === "guide")?.id;

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

      <div className="gs-thread" ref={log} role="log" aria-live="polite" aria-label="Your guide" aria-busy={busy}>
        <div className="gs-thread-in" ref={body}>
          {state.messages.map((m) => (
            <Message key={m.id} scanId={scanId} m={m} live={m.id === asking} busy={busy} act={act} />
          ))}
          {busy && <p className="gs-typing">Thinking…</p>}
          {error && (
            <p className="gs-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <AskBar busy={busy} placeholder={placeholder} onAsk={(text) => act({ type: "ask", text })} />
    </div>
  );
}

// A message that ends in a question says why it asks; any other says why it matters. The question is
// often in bold, so the marks come off first.
const asks = (m: GuideMessage) => m.text.replace(/\*\*/g, "").trim().endsWith("?");

// One message: the guide's (with its why, its card and its choices while it's the one asking) or theirs.
// The guide's text and why carry **bold** and [sources](https://…) (track B's rich()).
function Message({ scanId, m, live, busy, act }: { scanId: string; m: GuideMessage; live: boolean; busy: boolean; act: Props["act"] }) {
  if (m.from === "you") return <p className="gs-you">{m.text}</p>;
  return (
    <div className="gs-msg">
      <span className="gs-msg-mark" aria-hidden>
        <Mark title="" />
      </span>
      <div className="gs-msg-body">
        <p>{rich(m.text)}</p>
        {m.why && (
          <p className="gs-why">
            <b>{asks(m) ? "Why I'm asking:" : "Why it matters:"}</b> {rich(m.why)}
          </p>
        )}
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

export function GuideRoute() {
  const { scanId } = useParams({ from: "/scans/$scanId/guide" });
  const { state, busy, error, act, placeholder } = useGuide(scanId);
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
  return <GuideScreen scanId={scanId} state={state} busy={busy} error={error} act={act} placeholder={placeholder} />;
}
