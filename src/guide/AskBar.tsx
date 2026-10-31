// "Ask anything about your basement": typed, or said aloud where the browser can listen (Web Speech).
// What they say lands in the box to check, then they send it.
import { useEffect, useRef, useState, type FormEvent } from "react";

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function Speech(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function AskBar({ onAsk, busy, placeholder = "Ask anything about your basement" }: { onAsk: (text: string) => void; busy: boolean; placeholder?: string }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const canListen = Speech() !== null;

  useEffect(() => () => rec.current?.stop(), []);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    onAsk(t);
    setText("");
  };

  const listen = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const S = Speech();
    if (!S) return;
    const r = new S();
    r.lang = "en-CA";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => setText(Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ").trim());
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <form className="gs-ask" data-voice={canListen || undefined} onSubmit={send}>
      <label className="visually-hidden" htmlFor="guide-ask-input">
        Ask anything about your basement
      </label>
      <input
        id="guide-ask-input"
        className="input"
        value={text}
        maxLength={500}
        autoComplete="off"
        enterKeyHint="send"
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      {canListen && (
        <button type="button" className="gs-mic" aria-pressed={listening} aria-label={listening ? "Stop listening" : "Say it"} onClick={listen}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <button type="submit" className="gs-send" disabled={busy || !text.trim()}>
        Send
      </button>
    </form>
  );
}
