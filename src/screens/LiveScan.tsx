// While we check it (brand/explorations/M2-while-we-check.png): the basement putting itself together
// from the 3D service (the camera's walk first, then each area), your own video with SAM's finds locked
// on, the photos of what it could look like as each one lands, and the questions only a homeowner can
// answer, each asked once. Who it's for and the rent were asked on the start sheet; the server keeps
// every answer (server/eligibility.ts waitQuestions), so a refresh carries on where it left off and
// the answer arrives already using them. Time left comes from the scan's own progress (waitTime.ts).
// When the answer lands, the questions are checked again and anything the video settled is dropped.
// A scan that fails says why and offers "Try again" (the video is kept); a slow one says so. Only the
// person who filmed it answers: a shared link watches. The example says it's a recorded scan, replayed.
// A photo take shows its photos instead of the video, each with its finds boxed as they land.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ANALYSIS_FPS,
  answerEarly,
  DEMO_LABEL,
  EXAMPLE_LABEL,
  getScan,
  localPhotoTakes,
  localVideos,
  replaySample,
  retryScan,
  subscribe,
  waitAsks,
  type PhotoTake,
  type ScanEvent,
  type WaitAsk,
} from "../api";
import { Logo } from "../components/Logo";
import { PhotoCarousel } from "../components/PhotoCarousel";
import "../styles/ask.css";
import "../styles/journey.css";
import { modelsFrom, walkFrom } from "./assembly";
import { leftWords, secondsLeft, waitState } from "./waitTime";

// three.js only loads once there's a basement to draw.
const Assembling = lazy(() => import("../components/Assembling"));

type Props = {
  scanId: string; // "sample" replays the recorded sample scan
  onDone: () => void;
};

const STAGES = [
  { id: "prepare", label: "Reading video" },
  { id: "find", label: "Finding things" },
  { id: "measure", label: "Measuring rooms" },
  { id: "assess", label: "Checking the rules" },
];

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

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type Photo = { n: number; url: string; title: string };

export function LiveScan({ scanId, onDone }: Props) {
  const sample = scanId === "sample";
  const [events, setEvents] = useState<ScanEvent[]>([]);
  // Why it stopped, and whether running the stored video again can help.
  const [failure, setFailure] = useState<{ text: string; retry: boolean } | null>(null);
  // Each "Try again" starts the events over.
  const [run, setRun] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  // Whether this browser (or the signed-in owner) filmed it: only they answer.
  const [canEdit, setCanEdit] = useState(sample);
  const [demo, setDemo] = useState(false);
  // When the newest event arrived here, to count on from its scan time between events.
  const heardAt = useRef(Date.now());
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // A photo take: known at once in the tab that sent it, else from the server or the scan's first log.
  const [sentTake, setSentTake] = useState<PhotoTake | null>(() => localPhotoTakes.get(scanId) ?? null);
  // Play the file from this tab if we have it; after a refresh, play the server's copy.
  const local = localVideos.get(scanId);
  const src = useMemo(
    () => (scanId === "sample" ? "/samples/sample-basement.mp4" : local ? URL.createObjectURL(local) : `/api/scans/${scanId}/video`),
    [scanId, local],
  );

  useEffect(() => () => { if (local) URL.revokeObjectURL(src); }, [src, local]);

  useEffect(() => {
    setEvents([]);
    setFailure(null);
    heardAt.current = Date.now();
    const push = (e: ScanEvent) => {
      heardAt.current = Date.now();
      setEvents((prev) => [...prev, e]);
      if (e.type === "error") setFailure({ text: e.text, retry: (e.data as { retry?: boolean } | undefined)?.retry ?? true });
    };
    return sample ? replaySample(push) : subscribe(scanId, push);
  }, [scanId, run]);

  // Who's watching, and a failure from before this page opened (with whether its video is still kept).
  useEffect(() => {
    if (sample) return;
    void getScan(scanId)
      .then((s) => {
        setCanEdit(Boolean(s.canEdit));
        setDemo(Boolean(s.demo));
        if (s.photos) setSentTake(s.photos);
        if (s.status === "error" && s.error) setFailure({ text: s.error, retry: Boolean(s.failure?.retry) });
      })
      .catch(() => {});
  }, [scanId, run]);

  const detections = useMemo(
    () => events.flatMap((e) => (e.type === "find" ? e.data?.detections ?? [] : [])),
    [events],
  );
  const take = useMemo((): PhotoTake | null => {
    if (sentTake) return sentTake;
    const first = events.find((e) => e.type === "log" && e.data?.photos);
    return first?.data?.photos ? { count: first.data.frameCount ?? first.data.photos.at(-1)!.to, rooms: first.data.photos } : null;
  }, [sentTake, events]);
  // The photos whose finds are in, in the order they landed.
  const landed = useMemo(() => events.flatMap((e) => (e.type === "find" && e.data?.photo != null ? [e.data.photo] : [])), [events]);
  const done = events.some((e) => e.type === "done");
  const failed = !done && failure !== null;
  const lastStage = [...events].reverse().find((e) => e.type === "stage")?.text ?? "prepare";
  // Measuring is under way once the 3D starts and the finds are in, until its sizes arrive. The rules
  // check starts alongside it, so it only shows once the measuring is done.
  const measuring =
    events.some((e) => e.type === "log" && /in 3D|Mapping your whole basement|Measuring (area|your basement)/.test(e.text)) &&
    !events.some((e) => e.type === "measure");
  const stage = done ? "done" : measuring && events.some((e) => e.type === "find" && /Found|No /.test(e.text)) ? "measure" : lastStage;
  const stageIndex = done ? STAGES.length : Math.max(0, STAGES.findIndex((s) => s.id === stage));
  const finds = events.filter((e) => e.type === "find" || e.type === "measure");
  const found = finds.filter((f) => (f.data?.detections?.length ?? 0) > 0).map((f) => f.data?.label?.toLowerCase()).filter(Boolean) as string[];
  const lastLog = events.filter((e) => e.type === "log").slice(-1)[0];

  // The basement assembling: the walk, then each area as its 3D is ready.
  const path = useMemo(() => walkFrom(events), [events]);
  const models = useMemo(() => modelsFrom(events), [events]);
  const has3d = Boolean(path) || models.length > 0;
  const [front, setFront] = useState<"3d" | "video">("3d");
  const areaCount = events.map((e) => (e.type === "log" ? /Measuring area \d+ of (\d+)/.exec(e.text) : null)).filter(Boolean).at(-1)?.[1];
  const areasIn = models.filter((m) => m.area !== "all").length;
  const modelCaption = models.some((m) => m.area === "all")
    ? "Your whole basement in 3D"
    : areasIn
      ? areaCount && Number(areaCount) > 1
        ? `${areasIn} of ${areaCount} areas in 3D`
        : "Your basement in 3D"
      : "Your walk through the basement";

  // The photos, as each one lands.
  const photos = useMemo(() => {
    const byN = new Map<number, Photo>();
    for (const e of events) if (e.type === "photo" && e.data?.url && e.data.n) byN.set(e.data.n, { n: e.data.n, url: e.data.url, title: e.data.title ?? e.text });
    return [...byN.values()].sort((a, b) => a.n - b.n);
  }, [events]);

  // Time left, from the scan's own progress. It stops when the scan does.
  const [, tick] = useState(0);
  useEffect(() => {
    if (done || failed) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [done, failed]);
  const quiet = (Date.now() - heardAt.current) / 1000;
  const scanNow = (events.at(-1)?.at ?? 0) + quiet;
  const wait = done || failed || sample ? "ok" : waitState(quiet, scanNow);
  const leftText = done ? "Done" : failed ? "Stopped" : wait !== "ok" ? "Taking longer than usual" : events.length ? leftWords(secondsLeft(events, scanNow)) : "Starting…";

  const tryAgain = async () => {
    setRetrying(true);
    setRetryNote(null);
    try {
      const r = await retryScan(scanId);
      if (r.status === "done") return onDone();
      if (r.waiting) setRetryNote("It's still in line: it starts as soon as a worker is free. You can leave this page and come back to this link.");
      else setRun((n) => n + 1);
    } catch (err) {
      setRetryNote(err instanceof Error ? err.message : "That didn't start. Try again in a moment.");
    } finally {
      setRetrying(false);
    }
  };

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

  // Draw SAM's boxes for whatever frame the video is on.
  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || take) return;
    const index = detections.map((d) => ({ d, byFrame: new Map(d.track.map((t) => [t[0], t])) }));
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const rect = v.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      if (c.width !== Math.round(rect.width * dpr)) {
        c.width = Math.round(rect.width * dpr);
        c.height = Math.round(rect.height * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (!v.videoWidth) return;
      // object-fit: contain, so find where the picture actually sits.
      const scale = Math.min(rect.width / v.videoWidth, rect.height / v.videoHeight);
      const pw = v.videoWidth * scale, ph = v.videoHeight * scale;
      const ox = (rect.width - pw) / 2, oy = (rect.height - ph) / 2;
      const frame = Math.floor(v.currentTime * ANALYSIS_FPS);
      ctx.font = `600 12px ${cssVar("--font-body")}`;
      for (const { d, byFrame } of index) {
        const t = byFrame.get(frame);
        if (!t) continue;
        const [, x, y, w, h] = t;
        const bx = ox + x * pw, by = oy + y * ph, bw = w * pw, bh = h * ph;
        const color = cssVar(`--find-${d.kind}`) || cssVar("--color-mint");
        ctx.strokeStyle = cssVar("--color-mint");
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);
        // Corner ticks, like a surveyor's frame.
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        const k = Math.min(14, bw / 3, bh / 3);
        for (const [cx, cy, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
          ctx.beginPath();
          ctx.moveTo(cx + dx * k, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy + dy * k);
          ctx.stroke();
        }
        const label = d.label;
        const tw = ctx.measureText(label).width + 14;
        const ly = by > 26 ? by - 24 : by + 4;
        ctx.fillStyle = cssVar("--color-card");
        ctx.fillRect(bx, ly, tw, 20);
        ctx.fillStyle = cssVar("--color-ink");
        ctx.fillText(label, bx + 7, ly + 14);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [detections, take]);

  const yours = take ? "photos" : "video";
  const video = (
    <div
      key="video"
      className="live-video live-tile"
      data-photos={Boolean(take)}
      data-role={has3d && front === "3d" ? "inset" : "main"}
      {...(has3d && front === "3d" ? { role: "button", tabIndex: 0, "aria-label": `Show your ${yours}`, "data-label": `Your ${yours}`, onClick: () => setFront("video"), onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && setFront("video") } : {})}
    >
      {take ? (
        <PhotoCarousel scanId={scanId} take={take} detections={detections} landed={landed} done={done} />
      ) : (
        <>
          <video
            ref={videoRef}
            src={src}
            autoPlay
            muted
            loop
            playsInline
            // The server's copy appears a few seconds into the scan; keep trying until it does.
            onError={(e) => {
              const v = e.currentTarget;
              if (!local && scanId !== "sample") setTimeout(() => v.load(), 2000);
            }}
          />
          <canvas ref={canvasRef} aria-hidden />
          {!done && <div className="live-sweep" aria-hidden />}
          <p className="live-caption" aria-live="polite">
            {found.length ? `Found ${found.slice(0, 3).join(", ")}${found.length > 3 ? ` and ${found.length - 3} more` : ""}` : (lastLog?.text ?? "Looking through your video…")}
          </p>
        </>
      )}
    </div>
  );

  return (
    <main className="live">
      <header className="live-top">
        <Logo />
        <span className="live-left mono" data-state={failed ? "failed" : wait}>{leftText}</span>
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
      <ol className="live-stages" aria-label="Scan progress">
        {STAGES.map((st, i) => (
          <li key={st.id} data-state={i < stageIndex ? "done" : i === stageIndex ? "active" : "todo"}>
            <i aria-hidden />
            <span>{st.id === "prepare" && take ? "Reading photos" : st.label}</span>
          </li>
        ))}
      </ol>

      <section className="live-stage">
        <div className="live-main" data-3d={has3d}>
          {has3d && (
            <div
              key="model"
              className="live-model live-tile"
              data-role={front === "3d" ? "main" : "inset"}
              {...(front === "video" ? { role: "button", tabIndex: 0, "aria-label": "Show your basement in 3D", "data-label": "Your basement", onClick: () => setFront("3d"), onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && setFront("3d") } : {})}
            >
              <Suspense fallback={null}>
                <Assembling path={path} models={models} />
              </Suspense>
              <p className="live-caption live-model-caption" aria-live="polite">{modelCaption}</p>
            </div>
          )}
          {video}
        </div>

        <aside className="live-side" aria-live="polite">
          {wait !== "ok" && !failed && (
            <div className="live-slow" role="status">
              <p>
                <b>{wait === "stalled" ? "This has stopped moving." : "Taking longer than usual."}</b>{" "}
                {wait === "stalled" ? "Your video is saved, so it can run again." : "Your video is saved and we're still on it. You can leave and come back to this link."}
              </p>
              {wait === "stalled" && canEdit && (
                <button className="btn btn-ghost" disabled={retrying} onClick={() => void tryAgain()}>
                  {retrying ? "Starting…" : "Try again"}
                </button>
              )}
              {retryNote && <p className="muted">{retryNote}</p>}
            </div>
          )}
          {failed ? (
            <div className="live-failed" role="alert">
              <h2>We couldn't finish this scan</h2>
              <p>{failure.text}</p>
              <div className="live-failed-actions">
                {failure.retry && canEdit && (
                  <button className="btn btn-primary" disabled={retrying} onClick={() => void tryAgain()}>
                    {retrying ? "Starting…" : "Try again"} <span className="arrow" aria-hidden>→</span>
                  </button>
                )}
                <a className={failure.retry && canEdit ? "link-quiet" : "btn btn-primary"} href="/scans/sample">
                  See the example
                </a>
                <a className="link-quiet" href="/">Film again</a>
              </div>
              {retryNote && <p className="muted">{retryNote}</p>}
            </div>
          ) : done && !ask && (asks !== null || !canEdit) ? (
            <div className="live-ready">
              <h2>Your answer is ready</h2>
              <button className="btn btn-primary" onClick={onDone}>
                See my plan <span className="arrow" aria-hidden>→</span>
              </button>
            </div>
          ) : ask ? (
            <div className="live-ask" key={ask.id}>
              <span className="mono">
                {answered.length + 1} of {answered.length + pending.length} · while we check{sample ? " · you're answering for the example household" : ""}
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
                  <button className="btn btn-primary" disabled={words.trim().length < 2}>Save</button>
                </form>
              )}
              {ask.decides && ask.decides.length > 0 && <p className="live-ask-decides mono">Decides: {ask.decides.join(" · ")}</p>}
              {done && (
                <button className="link-quiet" onClick={onDone}>
                  Skip and see my plan
                </button>
              )}
            </div>
          ) : (
            <div className="live-ready">
              <h2>{!canEdit ? "Checking this basement…" : asks === null ? "Getting your questions…" : "Thanks. Almost there."}</h2>
              <p className="muted">{lastLog?.text ?? "Checking your basement against the rules."}</p>
              {!canEdit && <p className="muted">Only the person who filmed it answers its questions. This page shows the answer when it's ready.</p>}
            </div>
          )}

          {photos.length > 0 && (
            <section className="live-photos" aria-label="What it could look like">
              <h3>What it could look like</h3>
              <ul>
                {photos.map((p) => (
                  <li key={p.n}>
                    <img src={p.url} alt={`${p.title}, virtually staged from your own video`} />
                    <span className="live-photo-label mono">Virtually staged</span>
                    <b>{p.title}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </section>
    </main>
  );
}
