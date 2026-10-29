// The guide's voice. Pre-made clips (public/voice/<line>.mp3, made by `pnpm voice`) play through the
// one shared AudioContext, which iOS keeps on the loudspeaker while the mic records. Every clip is
// fetched and decoded on the first tap, before filming starts. The phone's own speech voice is never
// used: if a clip is missing, only the caption shows. Each line's time is logged so the server can cut
// our own voice out of the transcript.
import { useCallback, useEffect, useRef, useState } from "react";
import { audioContext, keepAudio } from "./audio";
import { DIRECTION_LINES, LINE_KIND, LINES, type LineId, type LineKind } from "./script";

export type Spoken = { id: LineId; startMs: number; endMs: number };

// ---------- when to speak (pure, so it can be tested) ----------

// Silence between the end of one line and the start of the next, whatever they are.
export const GAP_MS = 6500;
// The same line again, at the soonest.
export const REPEAT_MS = 30_000;
// Nagging about speed or light every few seconds helps nobody.
export const NAG_REPEAT_MS = 45_000;
// All the "turn" and "tilt" lines share one allowance.
export const DIRECTION_MS = 14_000;
// How long a caption stays up after its line ends, so a stale line doesn't sit on the camera.
const CAPTION_HOLD_MS = 6000;
// A line waiting its turn goes stale: a direction is wrong a few seconds later, a task isn't.
const STALE_MS: Record<LineKind, number> = { task: 15_000, reply: 10_000, praise: 5_000, nag: 3_000 };
const RANK: Record<LineKind, number> = { task: 3, reply: 3, praise: 2, nag: 1 };
const NAGS = new Set<LineId>(["slow_down", "too_dark"]);

type Waiting = { id: LineId; at: number; again: boolean };

export class VoiceQueue {
  private waiting: Waiting[] = [];
  private said = new Map<LineId, number>();
  private directionAt = -Infinity;
  private endedAt = -Infinity;
  playing: LineId | null = null;

  // Ask for a line. `again` lets a task line repeat when the task really changed back to it.
  request(id: LineId, at: number, { again = false } = {}) {
    if (!again && this.blocked(id, at)) return false;
    const kind = LINE_KIND[id];
    // One of each waits: a newer direction replaces an older one, a newer task replaces an older task.
    this.waiting = this.waiting.filter(
      (w) => w.id !== id && !(DIRECTION_LINES.has(w.id) && DIRECTION_LINES.has(id)) && !(kind === "task" && LINE_KIND[w.id] === "task"),
    );
    this.waiting.push({ id, at, again });
    return true;
  }

  private blocked(id: LineId, at: number) {
    const last = this.said.get(id);
    if (last != null && at - last < (NAGS.has(id) ? NAG_REPEAT_MS : REPEAT_MS)) return true;
    return DIRECTION_LINES.has(id) && at - this.directionAt < DIRECTION_MS;
  }

  // The line to start now, if any: nothing while one plays or during the gap after it.
  next(at: number): LineId | null {
    if (this.playing || at - this.endedAt < GAP_MS) return null;
    this.waiting = this.waiting.filter((w) => at - w.at <= STALE_MS[LINE_KIND[w.id]] && (w.again || !this.blocked(w.id, at)));
    if (!this.waiting.length) return null;
    const best = this.waiting.reduce((a, b) => (RANK[LINE_KIND[b.id]] > RANK[LINE_KIND[a.id]] || (RANK[LINE_KIND[b.id]] === RANK[LINE_KIND[a.id]] && b.at >= a.at) ? b : a));
    this.waiting = this.waiting.filter((w) => w !== best);
    // Praise and nags that queued up behind a task are old news once it has been said.
    if (RANK[LINE_KIND[best.id]] === 3) this.waiting = this.waiting.filter((w) => RANK[LINE_KIND[w.id]] === 3);
    this.playing = best.id;
    this.said.set(best.id, at);
    if (DIRECTION_LINES.has(best.id)) this.directionAt = at;
    return best.id;
  }

  ended(at: number) {
    this.playing = null;
    this.endedAt = at;
  }

  // When the last line finished (-Infinity before any), for telling the homeowner's voice from ours.
  get lastEnd() {
    return this.endedAt;
  }

  reset() {
    this.waiting = [];
    this.said.clear();
    this.directionAt = -Infinity;
    this.endedAt = -Infinity;
    this.playing = null;
  }
}

// ---------- telling talk from noise ----------

// About 1.5 s of steady talking. Nothing counts while the guide speaks or just after, since the mic
// hears the guide too; brief dips between words don't break a run.
export const TALK_MS = 1500;
const ECHO_MS = 500;
const DIP_MS = 350;

export class TalkMeter {
  private start: number | null = null;
  private loudAt = -Infinity;

  // One mic reading. Returns true once the homeowner has talked long enough.
  push(loud: boolean, at: number, guide: { speaking: boolean; lastEnd: number }) {
    if (guide.speaking || at - guide.lastEnd < ECHO_MS) {
      this.start = null;
      return false;
    }
    if (loud) {
      this.start ??= at;
      this.loudAt = at;
    } else if (at - this.loudAt > DIP_MS) this.start = null;
    return this.start != null && at - this.start >= TALK_MS;
  }

  reset() {
    this.start = null;
  }
}

// ---------- the hook ----------

const IDS = Object.keys(LINES) as LineId[];

export function useVoice(active: boolean, startedAt: number) {
  const [caption, setCaption] = useState<{ id: LineId; text: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const clips = useRef(new Map<LineId, AudioBuffer>());
  const loading = useRef(new Map<LineId, Promise<void>>());
  const queue = useRef(new VoiceQueue());
  const log = useRef<Spoken[]>([]);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const startedRef = useRef(startedAt);
  startedRef.current = startedAt;
  const hideRef = useRef(0);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Fetch and decode every clip. Call from a tap (Start camera); calling again retries any that failed.
  // Resolves once the intro is ready, or after `waitMs` at the most.
  const prepare = useCallback((waitMs = 2500): Promise<void> => {
    const ctx = audioContext();
    keepAudio(true);
    if (!ctx) return Promise.resolve();
    for (const id of IDS) {
      if (clips.current.has(id) || loading.current.has(id)) continue;
      const job = fetch(`/voice/${id}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => void clips.current.set(id, buf))
        .catch(() => console.warn(`[voice] no clip for "${id}": its caption shows without sound`))
        .finally(() => loading.current.delete(id));
      loading.current.set(id, job);
    }
    const intro = loading.current.get("intro") ?? Promise.resolve();
    return Promise.race([intro, new Promise<void>((r) => setTimeout(r, waitMs))]);
  }, []);

  const play = useCallback((id: LineId) => {
    const text = LINES[id];
    clearTimeout(hideRef.current);
    setCaption({ id, text });
    setSpeaking(true);
    const ctx = audioContext();
    const clip = clips.current.get(id);
    const startMs = Math.round(performance.now() - startedRef.current);
    let done = false;
    let failSafe = 0;
    const finish = (heard: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(failSafe);
      if (heard) log.current.push({ id, startMs, endMs: Math.round(performance.now() - startedRef.current) });
      queue.current.ended(performance.now());
      setSpeaking(false);
      hideRef.current = window.setTimeout(() => setCaption((c) => (c?.id === id ? null : c)), CAPTION_HOLD_MS);
    };
    if (!ctx || !clip || mutedRef.current) {
      // Caption only: give it about as long on screen as saying it would take.
      failSafe = window.setTimeout(() => finish(false), 1200 + text.length * 55);
      return;
    }
    void ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    src.buffer = clip;
    src.connect(ctx.destination);
    src.onended = () => finish(true);
    failSafe = window.setTimeout(() => finish(true), clip.duration * 1000 + 1500);
    sourceRef.current = src;
    src.start();
  }, []);

  // Ask for a line; the queue decides when, or whether, it plays.
  const say = useCallback(
    (id: LineId, opts: { again?: boolean } = {}) => {
      if (active) queue.current.request(id, performance.now(), opts);
    },
    [active],
  );

  // Start the next line whenever the queue allows.
  useEffect(() => {
    if (!active) return;
    log.current = [];
    queue.current.reset();
    keepAudio(true);
    const tick = () => {
      const id = queue.current.next(performance.now());
      if (id) play(id);
    };
    const timer = window.setInterval(tick, 150);
    return () => clearInterval(timer);
  }, [active, play]);

  useEffect(() => {
    if (active) return;
    // Filming stopped: the guide stops mid-line too, rather than talking over the review.
    try {
      sourceRef.current?.stop();
    } catch {
      // Already finished.
    }
    sourceRef.current = null;
    clearTimeout(hideRef.current);
    setCaption(null);
    setSpeaking(false);
  }, [active]);

  return {
    caption,
    speaking,
    muted,
    setMuted,
    say,
    prepare,
    // For the talk meter: is the guide talking, and when did it last stop.
    guide: () => ({ speaking: queue.current.playing != null, lastEnd: queue.current.lastEnd }),
    spoken: () => log.current,
  };
}
