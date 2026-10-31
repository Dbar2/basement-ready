// The guide's thread: its messages and theirs, the newest just above the ask bar. Each guide message says
// why it's asking (guide.css puts "Why I'm asking:" before it), its card sits under it, and only the newest
// one's choices are live (one mint button for the way on). Bold and sources come through as marked; screen
// readers hear each new message.
import { useEffect, useRef, type ReactNode } from "react";
import { Mark } from "../components/Logo";
import { Card } from "./mount";
import type { GuideAction, GuideMessage } from "./types";

// The guide's two marks: **bold** and [a source](https://…). Anything else is plain text.
const MARK = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
export function rich(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(
      m[1] != null ? (
        <strong key={m.index}>{m[1]}</strong>
      ) : (
        <a key={m.index} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>
      ),
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

type Act = (action: GuideAction, label?: string) => void;

function Message({ scanId, m, live, busy, act }: { scanId: string; m: GuideMessage; live: boolean; busy: boolean; act: Act }) {
  if (m.from === "you") return <p className="gs-you">{m.text}</p>;
  return (
    <div className="gs-msg">
      <span className="gs-msg-mark" aria-hidden>
        <Mark title="" />
      </span>
      <div className="gs-msg-body">
        <p>{rich(m.text)}</p>
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

export function Thread({ scanId, messages, busy, error, act }: { scanId: string; messages: GuideMessage[]; busy: boolean; error?: string | null; act: Act }) {
  const log = useRef<HTMLDivElement>(null);
  // The newest guide message is the one asking: only its buttons are live.
  const asking = messages.findLast((m) => m.from === "guide")?.id;
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages.length, busy]);

  return (
    <div className="gs-thread" ref={log} role="log" aria-live="polite" aria-label="Your guide" aria-busy={busy}>
      {messages.map((m) => (
        <Message key={m.id} scanId={scanId} m={m} live={m.id === asking} busy={busy} act={act} />
      ))}
      {busy && <p className="gs-typing">Thinking…</p>}
      {error && (
        <p className="gs-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
