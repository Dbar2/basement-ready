// While we check it (brand/explorations/M2-while-we-check.png): your own video plays with SAM's finds
// locked on, a progress bar says how long is left, and the only questions a homeowner can answer are
// asked here, so the answer arrives already using them.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ANALYSIS_FPS, answerEarly, localVideos, replaySample, setHousehold, subscribe, type AnswerValue, type Household, type ScanEvent } from "../api";
import { Logo } from "../components/Logo";

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

// Asked while the scan runs. Same wording as the rules triage (server/triage.ts).
type Ask = { id: string; question: string; hint: string; options: { label: string; value: AnswerValue | Household }[]; picture: "door" | "pipes" | "people" };
const ASKS: Ask[] = [
  {
    id: "household",
    question: "Who will live down there?",
    hint: "It decides which grants fit.",
    options: [
      { label: "A parent or relative", value: "relative" },
      { label: "A renter", value: "renter" },
      { label: "Not sure yet", value: "unsure" },
    ],
    picture: "people",
  },
  {
    id: "exit_from_suite",
    question: "Is there a door from the basement straight outside?",
    hint: "A side door or walk-out to the yard. Not the stairs up to the main floor.",
    options: [
      { label: "Yes", value: true },
      { label: "No", value: false },
      { label: "Not sure", value: "unsure" },
    ],
    picture: "door",
  },
  {
    id: "plumbing_fixtures_and_shutoff",
    question: "Is there a bathroom down there, or capped pipes for one?",
    hint: "Capped pipes in the floor are a rough-in. They make a bathroom much cheaper.",
    options: [
      { label: "Yes", value: true },
      { label: "No", value: false },
      { label: "Not sure", value: "unsure" },
    ],
    picture: "pipes",
  },
];

// Simple line drawings, so the question reads at a glance.
const PICTURES: Record<Ask["picture"], ReactNode> = {
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
};

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function LiveScan({ scanId, onDone }: Props) {
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Play the file from this tab if we have it; after a refresh, play the server's copy.
  const local = localVideos.get(scanId);
  const src = useMemo(
    () => (scanId === "sample" ? "/samples/sample-basement.mp4" : local ? URL.createObjectURL(local) : `/api/scans/${scanId}/video`),
    [scanId, local],
  );

  useEffect(() => () => { if (local) URL.revokeObjectURL(src); }, [src, local]);

  useEffect(() => {
    setEvents([]);
    const push = (e: ScanEvent) => {
      setEvents((prev) => [...prev, e]);
      if (e.type === "error") setError(e.text);
    };
    return scanId === "sample" ? replaySample(push) : subscribe(scanId, push);
  }, [scanId]);

  const detections = useMemo(
    () => events.flatMap((e) => (e.type === "find" ? e.data?.detections ?? [] : [])),
    [events],
  );
  const done = events.some((e) => e.type === "done");
  const lastStage = [...events].reverse().find((e) => e.type === "stage")?.text ?? "prepare";
  // Measuring rooms is under way once the 3D starts, until the rules check begins.
  const measuring = lastStage === "find" && events.some((e) => e.type === "log" && /in 3D/.test(e.text));
  const stage = done ? "done" : measuring && events.some((e) => e.type === "find" && /Found|No /.test(e.text)) ? "measure" : lastStage;
  const stageIndex = done ? STAGES.length : Math.max(0, STAGES.findIndex((s) => s.id === stage));
  const finds = events.filter((e) => e.type === "find" || e.type === "measure");
  const found = finds.filter((f) => (f.data?.detections?.length ?? 0) > 0).map((f) => f.data?.label?.toLowerCase()).filter(Boolean) as string[];
  const lastLog = events.filter((e) => e.type === "log").slice(-1)[0];

  // A rough time left: about 2 minutes for a full take, counted from when the scan started.
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRef(Date.now());
  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [done]);
  const leftSec = Math.max(15, 150 - (now - startedAt.current) / 1000);
  const leftText = done ? "Done" : leftSec > 75 ? "About 2 min left" : leftSec > 40 ? "About 1 min left" : "Almost there";

  // The questions, one at a time. Answers go to the server now and apply when the scan finishes.
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const pending = ASKS.filter((a) => !(a.id in answered));
  const ask = pending[0] ?? null;
  const pick = (a: Ask, o: Ask["options"][number]) => {
    setAnswered((prev) => ({ ...prev, [a.id]: o.label }));
    if (a.id === "household") void setHousehold(scanId, o.value as Household);
    else void answerEarly(scanId, a.id, o.value as AnswerValue);
  };

  // Ready and nothing left to ask: open the answer on its own after a moment.
  useEffect(() => {
    if (!done || ask) return;
    const id = window.setTimeout(onDone, 2500);
    return () => clearTimeout(id);
  }, [done, ask]);

  // Draw SAM's boxes for whatever frame the video is on.
  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
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
  }, [detections]);

  return (
    <main className="live">
      <header className="live-top">
        <Logo />
        <span className="live-left mono">{leftText}</span>
      </header>
      <ol className="live-stages" aria-label="Scan progress">
        {STAGES.map((st, i) => (
          <li key={st.id} data-state={i < stageIndex ? "done" : i === stageIndex ? "active" : "todo"}>
            <i aria-hidden />
            <span>{st.label}</span>
          </li>
        ))}
      </ol>

      <section className="live-stage">
        <div className="live-video">
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
            {error ? error : found.length ? `Found ${found.slice(0, 3).join(", ")}${found.length > 3 ? ` and ${found.length - 3} more` : ""}` : (lastLog?.text ?? "Looking through your video…")}
          </p>
        </div>

        <aside className="live-side" aria-live="polite">
          {done && !ask ? (
            <div className="live-ready">
              <h2>Your answer is ready</h2>
              <button className="btn btn-primary" onClick={onDone}>
                See my plan <span className="arrow" aria-hidden>→</span>
              </button>
            </div>
          ) : ask ? (
            <div className="live-ask" key={ask.id}>
              <span className="mono">
                {ASKS.length - pending.length + 1} of {ASKS.length} · while we check
              </span>
              <h2>{ask.question}</h2>
              <svg viewBox="0 0 120 80" className="live-ask-pic" aria-hidden>
                {PICTURES[ask.picture]}
              </svg>
              <p className="muted">{ask.hint}</p>
              <div className="live-ask-options">
                {ask.options.map((o) => (
                  <button key={o.label} className="btn btn-ghost" onClick={() => pick(ask, o)}>
                    {o.label}
                  </button>
                ))}
              </div>
              {done && (
                <button className="link-quiet" onClick={onDone}>
                  Skip and see my plan
                </button>
              )}
            </div>
          ) : (
            <div className="live-ready">
              <h2>Thanks. Almost there.</h2>
              <p className="muted">{lastLog?.text ?? "Checking your basement against the rules."}</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
