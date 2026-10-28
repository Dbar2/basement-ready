// The guide's voice. Pre-made clips (public/voice/<line>.mp3, scripts/make-voice.ts) play through
// Web Audio, which iOS keeps on the loudspeaker while the mic records; the phone's own speech voice
// gets turned down to the earpiece there, so it's only the fallback when a clip is missing.
// The caption always shows. Each line's time is logged so the server can cut our own voice out of
// the transcript.
import { useCallback, useEffect, useRef, useState } from "react";
import { LINES, type LineId } from "./script";

export type Spoken = { id: LineId; startMs: number; endMs: number };

type WithSession = Navigator & { audioSession?: { type: string } };

// Safari 17+: mix our playback with the mic instead of ducking it. Call before getUserMedia.
export function prepareAudioSession() {
  const session = (navigator as WithSession).audioSession;
  if (!session) return;
  try {
    session.type = "play-and-record";
  } catch {
    // Older Safari: fine, the clips still play.
  }
}

const REPEAT_AFTER_MS = 14_000;

export function useVoice(active: boolean, startedAt: number) {
  const [caption, setCaption] = useState<{ id: LineId; text: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const clips = useRef(new Map<LineId, AudioBuffer | null>());
  const log = useRef<Spoken[]>([]);
  const lastSaid = useRef(new Map<LineId, number>());
  const playing = useRef(false);
  const pending = useRef<LineId | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // iOS only starts audio from inside a tap: call this from the Start button.
  const unlock = useCallback(() => {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctxRef.current ??= new Ctx();
    void ctxRef.current.resume().catch(() => {});
  }, []);

  // Fetch every clip once; a missing one falls back to the phone's voice.
  useEffect(() => {
    if (!active) return;
    log.current = [];
    lastSaid.current.clear();
    const ctx = ctxRef.current;
    if (!ctx) return;
    for (const id of Object.keys(LINES) as LineId[]) {
      if (clips.current.has(id)) continue;
      clips.current.set(id, null);
      fetch(`/voice/${id}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => clips.current.set(id, buf))
        .catch(() => {});
    }
  }, [active]);

  const play = useCallback(
    (id: LineId) => {
      const text = LINES[id];
      setCaption({ id, text });
      lastSaid.current.set(id, performance.now());
      if (mutedRef.current) return;
      const startMs = Math.round(performance.now() - startedAt);
      let finished = false;
      // Some speech engines never say they're done: give up after about how long the line takes.
      const failSafe = window.setTimeout(() => finish(), 1500 + text.length * 80);
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(failSafe);
        log.current.push({ id, startMs, endMs: Math.round(performance.now() - startedAt) });
        playing.current = false;
        setSpeaking(false);
        const next = pending.current;
        pending.current = null;
        if (next) play(next);
      };
      playing.current = true;
      setSpeaking(true);
      const ctx = ctxRef.current;
      const clip = clips.current.get(id);
      if (ctx && clip) {
        void ctx.resume().catch(() => {});
        const src = ctx.createBufferSource();
        src.buffer = clip;
        src.connect(ctx.destination);
        src.onended = finish;
        src.start();
      } else if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.02;
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
      } else finish();
    },
    [startedAt],
  );

  // Say a line, unless it was said recently. While talking, the newest request waits its turn.
  const say = useCallback(
    (id: LineId, { again = false } = {}) => {
      if (!active) return;
      const at = lastSaid.current.get(id);
      if (!again && at != null && performance.now() - at < REPEAT_AFTER_MS) return;
      if (playing.current) pending.current = id;
      else play(id);
    },
    [active, play],
  );

  useEffect(() => {
    if (active) return;
    setCaption(null);
    pending.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [active]);

  return { caption, speaking, muted, setMuted, say, unlock, spoken: () => log.current };
}
