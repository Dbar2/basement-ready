// Guided basement capture: brief, camera, record with a live checklist, review, hand back a File.
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import "./capture.css";
import { CHECKLIST, MAX_SEC, MIN_SEC, TIPS, type ChecklistId } from "./checklist";
import { CornerTicks, Crosshair, Dimension, Icon, Ruler } from "./drawing";
import { LEVEL_STEPS, useCeilingHold, useMediaQuery, useMicLevel, useWakeLock } from "./hooks";
import {
  baseType,
  canRecord,
  extensionFor,
  fileStamp,
  formatTime,
  openCamera,
  pickRecorderType,
  readDuration,
  requestMotion,
  round1,
  stopStream,
  toProblem,
  type ProblemKind,
} from "./media";
import { DeniedPage, IntroPage, ProblemPage } from "./Pages";
import { Review, type Take } from "./Review";

export type CaptureMeta = { durationSec: number; checklist: string[] };

export type CaptureProps = {
  onComplete: (file: File, meta: CaptureMeta) => void;
  onCancel: () => void;
};

type Phase =
  | { name: "intro" }
  | { name: "denied" }
  | { name: "error"; kind: Exclude<ProblemKind, "denied"> }
  | { name: "ready" }
  | { name: "recording" }
  | { name: "review"; take: Take };

type StopReason = "user" | "max" | "interrupted" | "discard" | "failed";

// ~3.5 Mbps keeps a 2-minute 1080p take near 50 MB. The server samples it down to 1280 px at 5 fps anyway.
const VIDEO_BITRATE = 3_500_000;
const ORDER = CHECKLIST.map((c) => c.id);

export function Capture({ onComplete, onCancel }: CaptureProps) {
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasAudio, setHasAudio] = useState(true);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [checked, setChecked] = useState<ChecklistId[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [announce, setAnnounce] = useState("");

  const rootRef = useRef<HTMLElement>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopRef = useRef<{ reason: StopReason; at: number } | null>(null);
  const milestonesRef = useRef({ min: false, end: false });
  const phaseRef = useRef(phase);
  const checkedRef = useRef(checked);
  const mountedRef = useRef(true);
  phaseRef.current = phase;
  checkedRef.current = checked;

  const recording = phase.name === "recording";

  // ---------- camera ----------

  function releaseCamera() {
    stopStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setDims(null);
  }

  function startCamera(askMotion: boolean) {
    // iOS only shows the motion prompt from inside a tap, so this goes first, before any await.
    const motion = askMotion ? requestMotion() : Promise.resolve(false);
    setBusy(true);
    void motion
      .then(() => openCamera())
      .then(({ stream: s, hasAudio: audio }) => {
        if (!mountedRef.current) return stopStream(s);
        stopStream(streamRef.current);
        streamRef.current = s;
        setStream(s);
        setHasAudio(audio);
        s.getVideoTracks()[0]?.addEventListener("ended", () => onTrackEnded(s));
        setPhase({ name: "ready" });
      })
      .catch((err) => {
        const p = toProblem(err);
        setPhase(p.kind === "denied" ? { name: "denied" } : { name: "error", kind: p.kind });
      })
      .finally(() => setBusy(false));
  }

  // The OS can take the camera away: a phone call, another app, or the tab going to the background.
  function onTrackEnded(s: MediaStream) {
    if (streamRef.current !== s) return;
    if (phaseRef.current.name === "recording") stopRecording("interrupted");
    else if (phaseRef.current.name === "ready") {
      releaseCamera();
      setPhase({ name: "error", kind: "interrupted" });
    }
  }

  // ---------- recording ----------

  function startRecording() {
    const s = streamRef.current;
    if (!s) return;
    const type = pickRecorderType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(s, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: VIDEO_BITRATE });
    } catch {
      releaseCamera();
      return setPhase({ name: "error", kind: "failed" });
    }
    chunksRef.current = [];
    stopRef.current = null;
    milestonesRef.current = { min: false, end: false };
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => finishRecording(rec, type);
    rec.onerror = () => stopRecording("failed");
    try {
      rec.start(1000);
    } catch {
      releaseCamera();
      return setPhase({ name: "error", kind: "failed" });
    }
    recorderRef.current = rec;
    startedAtRef.current = performance.now();
    setElapsed(0);
    setChecked([]);
    setNudge(false);
    setConfirmDiscard(false);
    setPhase({ name: "recording" });
    setAnnounce("Recording. Start at the top of the stairs.");
  }

  function stopRecording(reason: StopReason) {
    const rec = recorderRef.current;
    if (!rec || stopRef.current) return;
    stopRef.current = { reason, at: (performance.now() - startedAtRef.current) / 1000 };
    if (rec.state === "inactive") finishRecording(rec, rec.mimeType);
    else rec.stop();
  }

  function finishRecording(rec: MediaRecorder, requested: string | undefined) {
    if (recorderRef.current !== rec) return;
    recorderRef.current = null;
    // onstop without our stopRecording means the recorder died on its own.
    const { reason, at } = stopRef.current ?? { reason: "interrupted" as const, at: (performance.now() - startedAtRef.current) / 1000 };
    const durationSec = round1(Math.min(MAX_SEC, at));
    const chunks = chunksRef.current;
    chunksRef.current = [];
    setConfirmDiscard(false);

    if (reason === "discard") {
      setElapsed(0);
      setChecked([]);
      setAnnounce("Take thrown away.");
      return setPhase(streamRef.current ? { name: "ready" } : { name: "error", kind: "interrupted" });
    }

    const mime = baseType(rec.mimeType || requested || chunks[0]?.type || "video/webm");
    const blob = new Blob(chunks, { type: mime });
    releaseCamera();
    if (blob.size === 0 || reason === "failed") return setPhase({ name: "error", kind: "failed" });
    if (reason === "interrupted" && durationSec < MIN_SEC) return setPhase({ name: "error", kind: "interrupted" });

    const file = new File([blob], `basement-${fileStamp()}.${extensionFor(mime)}`, { type: mime });
    const note = reason === "max" ? "max" : reason === "interrupted" ? "interrupted" : undefined;
    setPhase({ name: "review", take: { file, durationSec, checklist: ORDER.filter((id) => checkedRef.current.includes(id)), source: "camera", note } });
    setAnnounce(reason === "max" ? "Stopped at 2 minutes." : "Stopped. Check your take.");
  }

  // Clock, plus the two moments worth saying out loud.
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      const t = (performance.now() - startedAtRef.current) / 1000;
      setElapsed(t);
      const m = milestonesRef.current;
      if (t >= MIN_SEC && !m.min) {
        m.min = true;
        setNudge(false);
        setAnnounce("30 seconds. Stop whenever you're ready.");
      }
      if (t >= MAX_SEC - 15 && !m.end) {
        m.end = true;
        setAnnounce("15 seconds left.");
      }
      if (t >= MAX_SEC) stopRecording("max");
    }, 200);
    // stopRecording only touches refs and setters, so this render's copy stays valid.
    return () => clearInterval(id);
  }, [recording]);

  // Leaving the app mid-take on a phone kills the camera, so end the take cleanly instead.
  useEffect(() => {
    const onVisibility = () => {
      const name = phaseRef.current.name;
      if (document.hidden && name === "recording") stopRecording("interrupted");
      if (!document.hidden && name === "ready" && streamRef.current?.getVideoTracks()[0]?.readyState === "ended") startCamera(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Release everything on the way out.
  useEffect(() => {
    mountedRef.current = true;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      mountedRef.current = false;
      html.style.overflow = overflow;
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (rec && rec.state !== "inactive") rec.stop();
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const v = liveRef.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
  }, [stream, phase.name]);

  // Move focus to the new screen's heading so screen readers follow along.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true });
  }, [phase.name]);

  useWakeLock(recording);
  const level = useMicLevel(phase.name === "ready" || recording ? stream : null);
  const sideways = useMediaQuery("(orientation: landscape) and (pointer: coarse) and (max-height: 520px)");

  // ---------- checklist ----------

  const check = (id: ChecklistId) => setChecked((prev) => (prev.includes(id) ? prev : ORDER.filter((x) => x === id || prev.includes(x))));
  const toggle = (id: ChecklistId) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : ORDER.filter((x) => x === id || prev.includes(x))));

  const ceiling = useCeilingHold(recording && !checked.includes("ceiling"), () => {
    check("ceiling");
    setAnnounce("Ceiling done.");
  });

  // ---------- upload ----------

  async function onPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    releaseCamera();
    setBusy(true);
    const durationSec = round1(await readDuration(file));
    setBusy(false);
    if (!mountedRef.current) return;
    const note = durationSec > 0 && durationSec < MIN_SEC ? "short" : undefined;
    setPhase({ name: "review", take: { file, durationSec, checklist: [], source: "upload", note } });
  }

  const pickFile = () => fileRef.current?.click();
  const close = () => {
    releaseCamera();
    onCancel();
  };

  // ---------- render ----------

  const picker = <input ref={fileRef} type="file" accept="video/*" hidden onChange={onPicked} />;
  const live = <p className="cap-sr" aria-live="polite">{announce}</p>;

  if (phase.name === "intro" || phase.name === "denied" || phase.name === "error") {
    return (
      <section ref={rootRef} className="cap cap--page" aria-label="Film your basement">
        {phase.name === "intro" && <IntroPage recordable={canRecord()} busy={busy} onStart={() => startCamera(true)} onUpload={pickFile} onClose={close} />}
        {phase.name === "denied" && <DeniedPage busy={busy} onRetry={() => startCamera(true)} onUpload={pickFile} onClose={close} />}
        {phase.name === "error" && (
          <ProblemPage kind={phase.kind} busy={busy} recordable={canRecord()} onRetry={() => startCamera(true)} onUpload={pickFile} onClose={close} />
        )}
        {picker}
        {live}
      </section>
    );
  }

  if (phase.name === "review") {
    const { take } = phase;
    return (
      <section ref={rootRef} className="cap cap--review" aria-label="Check your video">
        <Review
          take={take}
          onUse={() => onComplete(take.file, { durationSec: take.durationSec, checklist: take.checklist })}
          onRetake={() => (take.source === "camera" ? startCamera(false) : pickFile())}
          busy={busy}
          onClose={close}
        />
        {picker}
        {live}
      </section>
    );
  }

  const current = CHECKLIST.find((c) => !checked.includes(c.id)) ?? null;
  const holding = ceiling.progress > 0;
  const focus = holding ? CHECKLIST.find((c) => c.id === "ceiling")! : current;
  const focusIndex = focus ? CHECKLIST.indexOf(focus) : -1;
  const pastMin = elapsed >= MIN_SEC;
  const left = MAX_SEC - elapsed;
  const mirrored = stream?.getVideoTracks()[0]?.getSettings().facingMode === "user";

  return (
    <section ref={rootRef} className="cap cap--live" data-phase={phase.name} aria-label="Film your basement">
      <header className="cap-bar" inert={confirmDiscard}>
        <button
          className="cap-icon-btn"
          aria-label={recording ? "Stop and throw away this take" : "Close the camera"}
          onClick={() => (recording ? setConfirmDiscard(true) : close())}
        >
          <Icon.close />
        </button>
        <div className="cap-status" data-recording={recording}>
          {recording ? (
            <>
              <span className="cap-rec">
                <Icon.rec /> Rec
              </span>
              <span className="cap-time">{formatTime(elapsed)}</span>
              {left <= 15 ? <span className="cap-left">{Math.ceil(left)} s left</span> : <span className="cap-of">/ {formatTime(MAX_SEC)}</span>}
            </>
          ) : (
            <>
              <span className="cap-status-label">Camera ready</span>
              {dims && <span className="cap-of">{Math.min(dims.w, dims.h)}p</span>}
            </>
          )}
        </div>
        <div className="cap-mic" data-off={!hasAudio} aria-label={hasAudio ? `Microphone level ${level} of ${LEVEL_STEPS}` : "No microphone"} role="img">
          <span className="cap-mic-label">{hasAudio ? "Mic" : "No mic"}</span>
          {hasAudio && (
            <span className="cap-mic-bars" aria-hidden>
              {Array.from({ length: LEVEL_STEPS }, (_, i) => (
                <i key={i} data-on={i < level} />
              ))}
            </span>
          )}
        </div>
      </header>

      <div className="cap-stage" inert={confirmDiscard}>
        <div className="cap-frame" style={dims ? ({ "--ar": String(dims.w / dims.h) } as CSSProperties) : undefined}>
          <video
            ref={liveRef}
            className="cap-video"
            data-mirrored={mirrored}
            autoPlay
            muted
            playsInline
            aria-label="Camera preview"
            onLoadedMetadata={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            onResize={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          />
          <CornerTicks />
          <Crosshair />
          {dims && (
            <>
              <Dimension className="cap-dim--top" label={`${dims.w} px`} />
              <Dimension className="cap-dim--side" axis="y" label={`${dims.h} px`} />
            </>
          )}
        </div>
        {sideways && <p className="cap-plate cap-plate--center">Turn your phone upright</p>}
      </div>

      <aside className="cap-panel" aria-label={recording ? "What to show us" : "Before you start"} inert={confirmDiscard}>
        <Ruler elapsed={recording ? elapsed : 0} min={MIN_SEC} max={MAX_SEC} />

        {recording ? (
          <div className="cap-step" data-holding={holding} data-done={!focus}>
            {focus ? (
              <>
                <span className="cap-step-num">
                  {String(focusIndex + 1).padStart(2, "0")} / {String(CHECKLIST.length).padStart(2, "0")}
                </span>
                <h2 className="cap-step-title" data-focus tabIndex={-1}>
                  {focus.label}
                </h2>
                <p className="cap-step-hint">
                  {holding
                    ? `Hold it there. ${Math.ceil((1 - ceiling.progress) * 3)} s`
                    : focus.id === "ceiling" && !ceiling.sensed
                      ? "Point your phone up for 3 seconds, then tap Done."
                      : focus.hint}
                </p>
                {holding ? (
                  <span className="cap-hold" aria-hidden>
                    <span style={{ width: `${ceiling.progress * 100}%` }} />
                  </span>
                ) : (
                  <button className="cap-btn cap-btn--ghost cap-step-done" onClick={() => check(focus.id)}>
                    <Icon.check /> Done
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="cap-step-num">06 / 06</span>
                <h2 className="cap-step-title" data-focus tabIndex={-1}>
                  All six covered.
                </h2>
                <p className="cap-step-hint">Keep talking about your plans, or stop when you're ready.</p>
              </>
            )}
          </div>
        ) : (
          <div className="cap-step cap-step--ready">
            <span className="cap-step-num">Before you start</span>
            <h2 className="cap-step-title" data-focus tabIndex={-1}>
              Start at the top of the stairs.
            </h2>
            <ul className="cap-tips">
              {TIPS.map((t) => (
                <li key={t.label}>{t.label}</li>
              ))}
            </ul>
          </div>
        )}

        <ol className="cap-list" aria-label="What to show us" data-interactive={recording}>
          {CHECKLIST.map((c, i) => {
            const done = checked.includes(c.id);
            const isCurrent = recording && focus?.id === c.id;
            const body = (
              <>
                <span className="cap-box" aria-hidden>
                  {done ? <Icon.check /> : String(i + 1).padStart(2, "0")}
                </span>
                <span className="cap-list-short">{c.short}</span>
                <span className="cap-list-label">{c.label}</span>
              </>
            );
            return (
              <li key={c.id} data-done={done} data-current={isCurrent}>
                {recording ? (
                  <button aria-pressed={done} aria-label={`${String(i + 1).padStart(2, "0")} ${c.label}`} onClick={() => toggle(c.id)}>
                    {body}
                  </button>
                ) : (
                  <span className="cap-list-static">{body}</span>
                )}
              </li>
            );
          })}
        </ol>

        <div className="cap-actions">
          {recording ? (
            <button
              className={`cap-btn ${pastMin ? "cap-btn--primary" : "cap-btn--waiting"}`}
              aria-disabled={!pastMin}
              aria-describedby={nudge ? "cap-nudge" : undefined}
              onClick={() => (pastMin ? stopRecording("user") : setNudge(true))}
            >
              <Icon.stop /> {pastMin ? "Stop and review" : `Keep filming · ${Math.ceil(MIN_SEC - elapsed)} s to go`}
            </button>
          ) : (
            <>
              <button className="cap-btn cap-btn--primary" onClick={startRecording} disabled={!stream}>
                <Icon.rec /> Start recording
              </button>
              <button className="cap-btn cap-btn--ghost cap-btn--narrow" onClick={pickFile} aria-label="Upload a video instead">
                Upload
              </button>
            </>
          )}
        </div>
        {nudge && !pastMin && (
          <p id="cap-nudge" className="cap-nudge">
            We need at least 30 seconds to see the whole space.
          </p>
        )}
      </aside>

      {confirmDiscard && (
        <div
          className="cap-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="cap-confirm-title"
          onKeyDown={(e) => e.key === "Escape" && setConfirmDiscard(false)}
        >
          <div className="cap-confirm-card">
            <h2 id="cap-confirm-title" data-focus tabIndex={-1}>
              Throw away this take?
            </h2>
            <p>You'll start again from 0:00. The camera stays on.</p>
            <div className="cap-confirm-actions">
              <button className="cap-btn cap-btn--primary" onClick={() => setConfirmDiscard(false)} autoFocus>
                Keep filming
              </button>
              <button className="cap-btn cap-btn--ghost" onClick={() => stopRecording("discard")}>
                Throw it away
              </button>
            </div>
          </div>
        </div>
      )}
      {picker}
      {live}
    </section>
  );
}
