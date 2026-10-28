// The scan you watch: your own video plays while SAM's finds lock on to each object.
import { useEffect, useMemo, useRef, useState } from "react";
import { ANALYSIS_FPS, replaySample, startScan, subscribe, type Detection, type Household, type ScanEvent } from "../api";
import { Logo } from "../components/Logo";

type Props = {
  video: File | null; // null = the sample basement
  household: Household;
  address: string;
  onDone: (scanId: string) => void;
};

const STAGES = [
  { id: "prepare", label: "Reading your video" },
  { id: "find", label: "Finding what matters" },
  { id: "assess", label: "Checking Waterloo's rules" },
  { id: "done", label: "Ready" },
];

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function LiveScan({ video, household, address, onDone }: Props) {
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const src = useMemo(() => (video ? URL.createObjectURL(video) : "/samples/sample-basement.mp4"), [video]);

  useEffect(() => () => { if (video) URL.revokeObjectURL(src); }, [src, video]);

  useEffect(() => {
    const push = (e: ScanEvent) => {
      setEvents((prev) => [...prev, e]);
      if (e.type === "error") setError(e.text);
    };
    if (!video) {
      setScanId("sample");
      return replaySample(push);
    }
    let stop = () => {};
    startScan(video, household, address)
      .then((id) => {
        setScanId(id);
        stop = subscribe(id, push);
      })
      .catch((err) => setError(err.message));
    return () => stop();
  }, [video, household, address]);

  const detections = useMemo(
    () => events.flatMap((e) => (e.type === "find" ? e.data?.detections ?? [] : [])),
    [events],
  );
  const stage = [...events].reverse().find((e) => e.type === "stage" || e.type === "done")?.type === "done"
    ? "done"
    : [...events].reverse().find((e) => e.type === "stage")?.text ?? "prepare";
  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const done = stage === "done";
  const finds = events.filter((e) => e.type === "find");
  const log = events.filter((e) => e.type === "log").slice(-3);

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
        <ol className="live-stages" aria-label="Scan progress">
          {STAGES.map((s, i) => (
            <li key={s.id} data-state={i < stageIndex ? "done" : i === stageIndex ? "active" : "todo"}>
              <span className="mono">0{i + 1}</span> {s.label}
            </li>
          ))}
        </ol>
      </header>

      <section className="live-stage">
        <div className="live-video">
          <video ref={videoRef} src={src} autoPlay muted loop playsInline />
          <canvas ref={canvasRef} aria-hidden />
          {!done && <div className="live-sweep" aria-hidden />}
        </div>

        <aside className="live-finds" aria-live="polite">
          <h2>What we found</h2>
          <ul>
            {finds.length === 0 && <li className="muted">Looking through your video…</li>}
            {finds.map((f, i) => {
              const n = f.data?.detections?.length ?? 0;
              return (
                <li key={i} data-kind={f.data?.kind} className={n ? "" : "muted"}>
                  <span className="find-dot" />
                  <span>{f.text}</span>
                  {n > 0 && <span className="mono">{n}×</span>}
                </li>
              );
            })}
          </ul>
          {done && scanId && (
            <button className="btn btn-primary" onClick={() => onDone(scanId)}>
              See your answer <span className="arrow" aria-hidden>→</span>
            </button>
          )}
        </aside>
      </section>

      <div className="live-log" aria-live="polite">
        {error ? <p className="error">{error}</p> : log.map((l, i) => <p key={`${l.at}-${i}`}>{l.text}</p>)}
      </div>
    </main>
  );
}
