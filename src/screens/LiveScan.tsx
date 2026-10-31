// While we check it: their own video (or photos) with SAM's finds boxed on it and the time left
// (src/guide/visuals/VideoFinds.tsx, the guide's wait visual), and beside it the questions only a
// homeowner can answer, each asked once, until the guide's thread asks them. Who it's for and the rent
// were asked on the start sheet; the server keeps every answer (server/eligibility.ts waitQuestions), so
// a refresh carries on where it left off and the answer arrives already using them. When the answer
// lands, the questions are checked again and anything the video settled is dropped. A scan that fails
// says why and offers "Try again" (the video is kept). Only the person who filmed it answers: a shared
// link watches. The example says it's a recorded scan, replayed.
import { useEffect, useState, type ReactNode } from "react";
import { answerEarly, DEMO_LABEL, EXAMPLE_LABEL, waitAsks, type WaitAsk } from "../api";
import { Logo } from "../components/Logo";
import { useScanWatch, VideoFindsView } from "../guide/visuals/VideoFinds";
import "../styles/ask.css";
import "../styles/journey.css";

type Props = {
  scanId: string; // "sample" replays the recorded sample scan
  onDone: () => void;
};

type Picture = "door" | "pipes" | "people" | "house" | "houses" | "bill" | "rent" | "tools" | "room";
// The questions are worded on the server; each gets a drawing here.
const PICTURE: Record<string, Picture> = {
  who: "people",
  plans: "room",
  exit_from_suite: "door",
  plumbing_fixtures_and_shutoff: "pipes",
  rent: "rent",
  lives_there: "house",
  other_home: "houses",
  house_value: "bill",
  senior: "people",
  work_started: "tools",
};

// Simple line drawings, so the question reads at a glance.
const PICTURES: Record<Picture, ReactNode> = {
  room: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M10 70h100M14 70V16h92v54" />
      <path d="M24 70V54h30v16M24 54v-6h30v6" />
      <path d="M70 70V44h26v26M70 54h26" />
      <path d="M78 16v10m-6 0h12" />
    </g>
  ),
  door: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M8 70h104M30 70V18h34v52M64 18l20 8v52l-20-8" />
      <path d="M84 40h22M98 32l8 8-8 8" />
      <circle cx="58" cy="46" r="2" fill="currentColor" />
    </g>
  ),
  pipes: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M8 62h104" />
      <path d="M36 62V44M60 62V40M84 62V48" />
      <rect x="31" y="38" width="10" height="6" rx="1" />
      <rect x="55" y="34" width="10" height="6" rx="1" />
      <rect x="79" y="42" width="10" height="6" rx="1" />
    </g>
  ),
  people: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <circle cx="44" cy="26" r="9" />
      <path d="M26 66c0-12 8-20 18-20s18 8 18 20" />
      <circle cx="80" cy="32" r="7" />
      <path d="M66 66c0-9 6-15 14-15s14 6 14 15" />
    </g>
  ),
  house: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M8 70h104M30 70V38L60 14l30 24v32" />
      <path d="M52 70V52h16v18" />
    </g>
  ),
  houses: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M8 70h104M16 70V44l22-18 22 18v26" />
      <path d="M66 70V50l18-14 18 14v20" />
    </g>
  ),
  bill: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M36 8h48v64l-8-5-8 5-8-5-8 5-8-5-8 5z" />
      <path d="M46 24h28M46 34h28M46 50h12M66 50h8" />
    </g>
  ),
  rent: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <circle cx="44" cy="40" r="14" />
      <path d="M58 40h50M96 40v12M106 40v8" />
      <circle cx="44" cy="40" r="4" />
    </g>
  ),
  tools: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M8 70h104" />
      <path d="M40 62l30-30M64 26l12-12 10 10-12 12z" />
      <path d="M82 62V40M76 40h12" />
    </g>
  ),
};

export function LiveScan({ scanId, onDone }: Props) {
  const watch = useScanWatch(scanId);
  const { sample, done, failed, failure, canEdit, demo, wait } = watch;

  // The questions, one at a time, each once. The server says what's still worth asking (it already
  // knows the start sheet's answers); answers go to it now and apply when the scan finishes.
  const [asks, setAsks] = useState<WaitAsk[] | null>(null);
  const [answered, setAnswered] = useState<string[]>([]);
  const [words, setWords] = useState("");
  useEffect(() => {
    setAsks(null);
    setAnswered([]);
    waitAsks(scanId).then(setAsks).catch(() => setAsks([]));
  }, [scanId]);
  // The answer has landed: ask again, so anything the video settled is dropped before it's asked.
  useEffect(() => {
    if (!done || sample) return;
    void waitAsks(scanId).then(setAsks).catch(() => {});
  }, [done, scanId]);
  const pending = canEdit && !failed ? (asks ?? []).filter((a) => !answered.includes(a.id)) : [];
  const ask = pending[0] ?? null;
  const pick = async (a: WaitAsk, value: WaitAsk["options"][number]["value"]) => {
    setAnswered((prev) => [...prev, a.id]);
    setWords("");
    const next = await answerEarly(scanId, a.id, value).catch(() => null);
    setAsks(next ?? (await waitAsks(scanId).catch(() => asks ?? [])));
  };

  // Ready and nothing left to ask: open the answer on its own after a moment.
  useEffect(() => {
    if (!done || ask || (asks === null && canEdit)) return;
    const id = window.setTimeout(onDone, 2500);
    return () => clearTimeout(id);
  }, [done, ask, asks]);

  return (
    <main className="live">
      <header className="live-top">
        <Logo />
      </header>
      {sample && (
        <p className="example-label" role="note">
          <span className="tag-mono">Example</span> {EXAMPLE_LABEL}
        </p>
      )}
      {demo && (
        <p className="example-label" role="note">
          <span className="tag-mono">Demo house</span> {DEMO_LABEL}
        </p>
      )}

      <section className="live-stage">
        <div className="live-main">
          <VideoFindsView scanId={scanId} watch={watch} />
        </div>

        <aside className="live-side" aria-live="polite">
          {wait !== "ok" && !failed && (
            <div className="live-slow" role="status">
              <p>
                <b>{wait === "stalled" ? "This has stopped moving." : "Taking longer than usual."}</b>{" "}
                {wait === "stalled" ? "Your video is saved, so it can run again." : "Your video is saved and we're still on it. You can leave and come back to this link."}
              </p>
              {wait === "stalled" && canEdit && (
                <button className="btn btn-ghost" disabled={watch.retrying} onClick={() => void watch.tryAgain()}>
                  {watch.retrying ? "Starting…" : "Try again"}
                </button>
              )}
            </div>
          )}
          {failed && failure ? (
            <div className="live-failed" role="alert">
              <h2>We couldn't finish this scan</h2>
              <p>{failure.text}</p>
              <div className="live-failed-actions">
                {failure.retry && canEdit && (
                  <button className="btn btn-primary" disabled={watch.retrying} onClick={() => void watch.tryAgain()}>
                    {watch.retrying ? "Starting…" : "Try again"} <span className="arrow" aria-hidden>→</span>
                  </button>
                )}
                <a className={failure.retry && canEdit ? "link-quiet" : "btn btn-primary"} href="/scans/sample">
                  See the example
                </a>
                <a className="link-quiet" href="/">Film again</a>
              </div>
            </div>
          ) : done && !ask && (asks !== null || !canEdit) ? (
            <div className="live-ready">
              <h2>{canEdit ? "Your basement is measured" : "Your answer is ready"}</h2>
              {canEdit && <p className="muted">Next, check its floor plan. Everything else is drawn on it.</p>}
              <button className="btn btn-primary" onClick={onDone}>
                {canEdit ? "Is this your basement?" : "See the answer"} <span className="arrow" aria-hidden>→</span>
              </button>
            </div>
          ) : ask ? (
            <div className="live-ask" key={ask.id}>
              <span className="aside">
                <span className="mono">
                  {answered.length + 1} of {answered.length + pending.length}
                </span>{" "}
                · while we check{sample ? " · for the example household" : ""}
              </span>
              <h2>{ask.question}</h2>
              <svg viewBox="0 0 120 80" className="live-ask-pic" aria-hidden>
                {PICTURES[PICTURE[ask.id] ?? "house"]}
              </svg>
              <p className="muted">{ask.hint}</p>
              <div className="live-ask-options">
                {ask.options.map((o) => (
                  <button key={o.label} className="btn btn-ghost" onClick={() => void pick(ask, o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
              {ask.words && (
                <form
                  className="live-ask-words"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (words.trim().length >= 2) void pick(ask, words.trim());
                  }}
                >
                  <input className="input" value={words} maxLength={160} onChange={(e) => setWords(e.target.value)} placeholder="Or say it your way" aria-label="What you'd like it to be, in your own words" />
                  <button className="btn btn-ghost" disabled={words.trim().length < 2}>Save</button>
                </form>
              )}
              {ask.decides && ask.decides.length > 0 && <p className="live-ask-decides">Decides: {ask.decides.join(" · ")}</p>}
              {done && (
                <button className="link-quiet" onClick={onDone}>
                  Skip, check my plan
                </button>
              )}
            </div>
          ) : (
            <div className="live-ready">
              <h2>{!canEdit ? "Checking this basement…" : asks === null ? "Getting your questions…" : "Thanks. Almost there."}</h2>
              {!canEdit && <p className="muted">Only the person who filmed it answers its questions. This page shows the answer when it's ready.</p>}
            </div>
          )}
          {watch.retryNote && <p className="muted">{watch.retryNote}</p>}
        </aside>
      </section>
    </main>
  );
}
