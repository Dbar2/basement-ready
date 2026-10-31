// The guide's thread: its messages and theirs, newest just above the ask bar. Each guide message says
// why it's asking, and the newest one's choices are the buttons (one mint button for the way on). A
// card (track F) sits under the message that asks for it. Screen readers hear each new message.
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import type { CardRef, Choice, GuideAction, GuideMessage } from "./types";

// The guide's few marks: **bold** and [a source](https://…). Anything else is plain text.
const MARK = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
export function rich(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    out.push(
      m[1] != null ? (
        <strong key={m.index}>{m[1]}</strong>
      ) : (
        <a key={m.index} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>
      ),
    );
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function Choices({ choices, busy, onChoose }: { choices: Choice[]; busy: boolean; onChoose: (a: GuideAction) => void }) {
  return (
    <div className="guide-choices">
      {choices.map((c) => (
        <button key={c.label} type="button" className={c.primary ? "btn btn-primary" : "chip"} disabled={busy} onClick={() => onChoose(c.action)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function Thread({
  messages,
  busy,
  onChoose,
  card,
}: {
  messages: GuideMessage[];
  busy: boolean;
  onChoose: (action: GuideAction) => void;
  card?: (card: CardRef, message: GuideMessage) => ReactNode;
}) {
  const end = useRef<HTMLDivElement>(null);
  // The newest guide message is the one that's asking: only its buttons are live.
  const asking = [...messages].reverse().find((m) => m.from === "guide")?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, busy]);

  return (
    <div className="guide-thread" role="log" aria-live="polite" aria-label="Your guide" aria-busy={busy}>
      {messages.map((m) => (
        <Fragment key={m.id}>
          {m.from === "you" ? (
            <p className="guide-msg guide-you">{m.text}</p>
          ) : (
            <div className="guide-msg guide-says" data-step-message={m.id === asking || undefined}>
              <p className="guide-text">{rich(m.text)}</p>
              {m.why && <p className="guide-why">Why I'm asking: {m.why}</p>}
              {m.card && card?.(m.card, m)}
              {m.id === asking && m.choices?.length ? <Choices choices={m.choices} busy={busy} onChoose={onChoose} /> : null}
            </div>
          )}
        </Fragment>
      ))}
      {busy && (
        <p className="guide-msg guide-says guide-typing" aria-label="The guide is typing">
          <span />
          <span />
          <span />
        </p>
      )}
      <div ref={end} />
    </div>
  );
}
