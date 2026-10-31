// The wait's visual: their own video (or photos) with SAM's finds boxed on the frame as they land, a line
// saying what it's doing and the time left, and a progress line along the bottom edge. The scan's events
// come from the server (the example replays its recorded ones); time left comes from the scan's own
// progress (src/screens/waitTime.ts). A scan that stops says why on the pane and, for the person who
// filmed it, offers "Try again" (the video is kept). Lifted from the wait screen (src/screens/LiveScan.tsx),
// which now shows this and its questions only.
import { useEffect, useMemo, useRef, useState } from "react";
import { ANALYSIS_FPS, EXAMPLE_LABEL, getScan, localPhotoTakes, localVideos, replaySample, retryScan, subscribe, type PhotoTake, type ScanEvent } from "../../api";
import { PhotoCarousel } from "../../components/PhotoCarousel";
import { leftWords, secondsLeft, waitState } from "../../screens/waitTime";
import "../../styles/journey.css";
import type { VisualProps } from "../mount";

const STAGES = [
  { id: "prepare", label: "Reading your video" },
  { id: "find", label: "Finding things" },
  { id: "measure", label: "Measuring your basement" },
  { id: "assess", label: "Checking the rules" },
];

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Everything the wait knows about the scan, shared by this visual and the wait screen's questions.
export function useScanWatch(scanId: string) {
  const sample = scanId === "sample";
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [failure, setFailure] = useState<{ text: string; retry: boolean } | null>(null);
  const [run, setRun] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(sample);
  const [demo, setDemo] = useState(false);
  const heardAt = useRef(Date.now());
  const [sentTake, setSentTake] = useState<PhotoTake | null>(() => localPhotoTakes.get(scanId) ?? null);

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

  const detections = useMemo(() => events.flatMap((e) => (e.type === "find" ? e.data?.detections ?? [] : [])), [events]);
  const take = useMemo((): PhotoTake | null => {
    if (sentTake) return sentTake;
    const first = events.find((e) => e.type === "log" && e.data?.photos);
    return first?.data?.photos ? { count: first.data.frameCount ?? first.data.photos.at(-1)!.to, rooms: first.data.photos } : null;
  }, [sentTake, events]);
  const landed = useMemo(() => events.flatMap((e) => (e.type === "find" && e.data?.photo != null ? [e.data.photo] : [])), [events]);
  const done = events.some((e) => e.type === "done");
  const failed = !done && failure !== null;
  const lastStage = [...events].reverse().find((e) => e.type === "stage")?.text ?? "prepare";
  // Measuring is under way once the 3D starts and the finds are in, until its sizes arrive. The rules
  // check runs alongside it, so it only shows once the measuring is done.
  const measuring =
    events.some((e) => e.type === "log" && /in 3D|Mapping your whole basement|Measuring (area|your basement)/.test(e.text)) && !events.some((e) => e.type === "measure");
  const stage = done ? "done" : measuring && events.some((e) => e.type === "find" && /Found|No /.test(e.text)) ? "measure" : lastStage;
  const stageLabel = done ? "Measured" : STAGES.find((s) => s.id === stage)?.label ?? STAGES[0].label;
  const found = events
    .filter((f) => (f.type === "find" || f.type === "measure") && (f.data?.detections?.length ?? 0) > 0)
    .map((f) => f.data?.label?.toLowerCase())
    .filter(Boolean) as string[];

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
  const left = done ? 0 : events.length ? secondsLeft(events, scanNow) : null;
  const leftText = done ? "done" : failed ? "stopped" : wait !== "ok" ? "taking longer than usual" : events.length ? leftWords(left).replace(/^About/, "about") : "starting";
  // How far along, for the line on the pane's bottom edge: time spent over time spent plus time left.
  const fraction = done ? 1 : left == null || !events.length ? 0.03 : Math.min(0.97, Math.max(0.03, scanNow / (scanNow + left)));

  const tryAgain = async () => {
    setRetrying(true);
    setRetryNote(null);
    try {
      const r = await retryScan(scanId);
      if (r.status === "done") setEvents((prev) => [...prev, { type: "done", text: "", at: scanNow } as ScanEvent]);
      else if (r.waiting) setRetryNote("It's still in line: it starts as soon as a worker is free. You can leave this page and come back to this link.");
      else setRun((n) => n + 1);
    } catch (err) {
      setRetryNote(err instanceof Error ? err.message : "That didn't start. Try again in a moment.");
    } finally {
      setRetrying(false);
    }
  };

  return { sample, events, detections, take, landed, done, failed, failure, canEdit, demo, stageLabel, leftText, fraction, found, wait, tryAgain, retrying, retryNote };
}

export type ScanWatch = ReturnType<typeof useScanWatch>;

// The visual itself, for a scan someone is already watching (the wait screen keeps one watch for this
// and its questions).
export function VideoFindsView({ scanId, watch }: { scanId: string; watch: ScanWatch }) {
  const { take, detections, landed, done, failed, failure } = watch;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // With reduced motion the video waits for a tap, and the finds are boxed on the frame it shows.
  const [still] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  // Play the file from this tab if we have it; after a refresh, play the server's copy.
  const local = localVideos.get(scanId);
  const [blob, setBlob] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!local) return;
    const url = URL.createObjectURL(local);
    setBlob({ file: local, url });
    return () => URL.revokeObjectURL(url);
  }, [local]);
  const src = scanId === "sample" ? "/samples/sample-basement.mp4" : local ? (blob?.file === local ? blob.url : undefined) : `/api/scans/${scanId}/video`;

  // SAM's boxes for whatever frame the video is on: a mint frame with corner ticks in the find's colour,
  // and its name on a card tag above it.
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
      if (c.width !== Math.round(rect.width * dpr) || c.height !== Math.round(rect.height * dpr)) {
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
      ctx.font = `700 12px ${cssVar("--font-body")}`;
      // Tags that would overlap one already drawn are left off (Drawing Set: labels hide, never pile up).
      const tags: { x: number; y: number; w: number }[] = [];
      const clear = (x: number, y: number, w: number) => tags.every((t) => x + w < t.x || t.x + t.w < x || y + 20 < t.y || t.y + 20 < y);
      for (const { d, byFrame } of index) {
        const t = byFrame.get(frame);
        if (!t) continue;
        const [, x, y, w, h] = t;
        const bx = ox + x * pw, by = oy + y * ph, bw = w * pw, bh = h * ph;
        ctx.strokeStyle = cssVar(`--find-${d.kind}`) || cssVar("--color-ink");
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bx, by, bw, bh);
        const label = d.label;
        const tw = ctx.measureText(label).width + 14;
        const ly = [by > 26 ? by - 24 : by + 4, by + 4].find((y) => clear(bx, y, tw));
        if (ly == null) continue;
        tags.push({ x: bx, y: ly, w: tw });
        ctx.fillStyle = cssVar("--color-card");
        ctx.fillRect(bx, ly, tw, 20);
        ctx.fillStyle = cssVar("--color-ink");
        ctx.fillText(label, bx + 7, ly + 14);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [detections, take]);

  const status = failed
    ? failure?.text ?? "The scan stopped."
    : `${watch.sample ? "Example · " : ""}${watch.stageLabel}${done ? "" : ` · ${watch.leftText}`}`;
  const foundWords = watch.found.length
    ? `Found ${watch.found.slice(0, 3).join(", ")}${watch.found.length > 3 ? ` and ${watch.found.length - 3} more` : ""}`
    : "";

  return (
    <div className="video-finds" data-state={failed ? "failed" : done ? "done" : watch.wait} data-photos={Boolean(take) || undefined}>
      <div className="video-finds-media">
        {take ? (
          <PhotoCarousel scanId={scanId} take={take} detections={detections} landed={landed} done={done} />
        ) : (
          <>
            <video
              ref={videoRef}
              src={src}
              autoPlay={!still}
              controls={still}
              muted
              loop
              playsInline
              aria-label={watch.sample ? EXAMPLE_LABEL : "Your video, with what it found boxed on it"}
              // The server's copy appears a few seconds into the scan; keep trying until it does.
              onError={(e) => {
                const v = e.currentTarget;
                if (!local && scanId !== "sample") setTimeout(() => v.load(), 2000);
              }}
            />
            <canvas ref={canvasRef} aria-hidden />
          </>
        )}
      </div>
      <p className="video-finds-status" aria-live="polite">
        <span>{status}</span>
        {failed && failure?.retry && watch.canEdit && (
          <button type="button" className="link-quiet" disabled={watch.retrying} onClick={() => void watch.tryAgain()}>
            {watch.retrying ? "Starting…" : "Try again"}
          </button>
        )}
      </p>
      {watch.retryNote && <p className="video-finds-note">{watch.retryNote}</p>}
      <span className="video-finds-said" aria-live="polite">
        {foundWords}
      </span>
      <div className="video-finds-progress" role="progressbar" aria-label="How far along the scan is" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(watch.fraction * 100)}>
        <i style={{ transform: `scaleX(${watch.fraction})` }} />
      </div>
    </div>
  );
}

export function VideoFinds({ scanId, onDone }: Pick<VisualProps<"video">, "scanId"> & { onDone?: () => void }) {
  const watch = useScanWatch(scanId);
  useEffect(() => {
    if (watch.done) onDone?.();
  }, [watch.done]);
  return <VideoFindsView scanId={scanId} watch={watch} />;
}
