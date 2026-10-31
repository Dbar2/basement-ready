// "Ask anything about your basement": typed, or said aloud. Said aloud means recorded here (MediaRecorder,
// up to 30 s) and heard on the server by Muse Voice Transcribe (server/guide/voice.ts); the words land
// in the box to check, then they send them. Never the browser's own speech recognizer, which sends the
// audio to Google or Apple. No mic for the example (it never spends) or where the browser can't record.
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { hearGuide } from "./api";

const MAX_MS = 30_000;
const canRecord = () => typeof window !== "undefined" && "MediaRecorder" in window && Boolean(navigator.mediaDevices?.getUserMedia);

type Mic = "idle" | "recording" | "hearing";

export function AskBar({ onAsk, busy, placeholder = "Ask anything about your basement", scanId }: { onAsk: (text: string) => void; busy: boolean; placeholder?: string; scanId?: string }) {
  const params = useParams({ strict: false }) as { scanId?: string };
  const id = scanId ?? params.scanId;
  const [text, setText] = useState("");
  const [mic, setMic] = useState<Mic>("idle");
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stopAt = useRef<number | null>(null);
  const voice = Boolean(id) && id !== "sample" && canRecord();

  // Leaving the page stops the recording and lets go of the microphone.
  useEffect(
    () => () => {
      if (stopAt.current) window.clearTimeout(stopAt.current);
      if (rec.current?.state === "recording") rec.current.stop();
    },
    [],
  );

  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    onAsk(t);
    setText("");
  };

  const listen = async () => {
    if (mic === "recording") {
      rec.current?.stop();
      return;
    }
    if (mic !== "idle" || !id) return;
    setNote(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNote("I can't use the microphone. Type your question instead.");
      return;
    }
    // Whatever the browser records: webm/opus in Chrome, mp4/aac in Safari. The server converts it.
    const r = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      if (stopAt.current) window.clearTimeout(stopAt.current);
      stream.getTracks().forEach((t) => t.stop());
      setMic("hearing");
      try {
        const said = await hearGuide(id, new Blob(chunks, { type: r.mimeType || chunks[0]?.type || "" }));
        setText((was) => (was.trim() ? `${was.trim()} ${said}` : said));
      } catch (err) {
        setNote(err instanceof Error ? err.message : "I couldn't hear that. Try again, or type it.");
      } finally {
        setMic("idle");
      }
    };
    rec.current = r;
    r.start();
    setMic("recording");
    stopAt.current = window.setTimeout(() => r.state === "recording" && r.stop(), MAX_MS);
  };

  const label = mic === "recording" ? "Stop and use what I said" : mic === "hearing" ? "Listening to what you said" : "Say it";
  return (
    <form className="gs-ask" data-voice={voice || undefined} onSubmit={send}>
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
        placeholder={note ?? (mic === "recording" ? "Listening… tap the mic when you're done" : mic === "hearing" ? "Writing down what you said…" : placeholder)}
        onChange={(e) => setText(e.target.value)}
      />
      {voice && (
        <button type="button" className="gs-mic" data-state={mic} aria-pressed={mic === "recording"} aria-busy={mic === "hearing"} aria-label={label} title={label} disabled={mic === "hearing" || busy} onClick={() => void listen()}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <button type="submit" className="gs-send" disabled={busy || !text.trim()}>
        Send
      </button>
      <span className="visually-hidden" role="status">
        {note ?? (mic === "recording" ? "Recording. Tap the mic to stop." : mic === "hearing" ? "Writing down what you said." : "")}
      </span>
    </form>
  );
}
