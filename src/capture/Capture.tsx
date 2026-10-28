// Guided basement capture: brief, camera, record room by room around the record ring, review, hand back a File.
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import "./capture.css";
import { CHECKLIST, MAX_SEC, MIN_SEC, TIPS, type ChecklistId } from "./checklist";
import { CornerTicks, Crosshair, Dimension, Icon } from "./drawing";
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
import { coachLine, FIND_TICKS, sessionId, useCoaching, useCoverage, useLive3d, useLiveFinds, useRoomTilt } from "./live";
import { lazy, Suspense } from "react";
const Live3D = lazy(() => import("./Live3D").then((m) => ({ default: m.Live3D })));
import { LiveLayer, RoomDone } from "./LiveLayer";
import { Ring } from "./Ring";
import { DeniedPage, IntroPage, ProblemPage } from "./Pages";
import { Review, type Take } from "./Review";

// rooms: where each room starts in the take, so each gets its own 3D scan. Empty for uploads.
export type CaptureMeta = { durationSec: number; checklist: string[]; rooms: { startS: number }[] };

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

// 10 Mbps H.264 is close to what the phone's own camera records (about 10 Mbps HEVC): fewer blocky,
// smeared frames for SAM and the 3D. A 2-minute take is about 150 MB; the server takes up to 400 MB.
const VIDEO_BITRATE = 10_000_000;
const ORDER = CHECKLIST.map((c) => c.id);
const MAX_ROOMS = 8;
const MIN_ROOM_SEC = 5;

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
  // One id per take: live finds and the assembling 3D share it on the server.
  const [session, setSession] = useState(() => sessionId());
  // Where each room starts, in seconds into the take. The last one is the room you're in.
  const [rooms, setRooms] = useState<number[]>([0]);
  const [keptFilming, setKeptFilming] = useState(-1); // the room whose "mapped" sheet was waved off

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
  const roomsRef = useRef(rooms);
  const mountedRef = useRef(true);
  phaseRef.current = phase;
  checkedRef.current = checked;
  roomsRef.current = rooms;

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
    setSession(sessionId());
    startedAtRef.current = performance.now();
    setElapsed(0);
    setChecked([]);
    setRooms([0]);
    setKeptFilming(-1);
    setNudge(false);
    setConfirmDiscard(false);
    setPhase({ name: "recording" });
    setAnnounce("Recording. Walk along the walls, about 2 metres back.");
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
      setRooms([0]);
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
    const take: Take = { file, durationSec, checklist: ORDER.filter((id) => checkedRef.current.includes(id)), rooms: roomsRef.current.filter((t) => t < durationSec), source: "camera", note };
    setPhase({ name: "review", take });
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
  const levelRef = useRef(0);
  levelRef.current = level;
  const sideways = useMediaQuery("(orientation: landscape) and (pointer: coarse) and (max-height: 520px)");

  // ---------- checklist ----------

  const check = (id: ChecklistId) => setChecked((prev) => (prev.includes(id) ? prev : ORDER.filter((x) => x === id || prev.includes(x))));
  const toggle = (id: ChecklistId) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : ORDER.filter((x) => x === id || prev.includes(x))));

  const ceiling = useCeilingHold(recording && !checked.includes("ceiling"), () => {
    check("ceiling");
    setAnnounce("Ceiling done.");
  });

  // ---------- rooms and live guidance ----------

  const room = rooms.length - 1;
  const roomSec = recording ? Math.max(0, elapsed - rooms[room]) : 0;
  // Each room has its own session on the server, so its 3D builds from its own frames.
  const roomSession = `${session}-r${room}`;
  const coverage = useCoverage(recording, room);
  const liveFinds = useLiveFinds({ active: recording, session: roomSession, videoRef: liveRef, headingRef: coverage.headingRef, startedAt: startedAtRef.current });
  const live3d = useLive3d(recording, roomSession);
  const issue = useCoaching(recording, liveRef);
  const tilt = useRoomTilt(recording, room);
  const windowsFound = liveFinds.finds.filter((f) => f.key === "window").length;

  // Mapped: the track has gone most of the way round, or (no compass) the 3D has found four walls.
  const mapped =
    recording && roomSec >= 10 && (coverage.supported ? coverage.percent >= 85 : (live3d.preview?.wallsSeen ?? 0) >= 4);
  const canAddRoom = recording && rooms.length < MAX_ROOMS && roomSec >= MIN_ROOM_SEC;

  // The "mapped" sheet steps aside after a few seconds; the Next room button stays lit.
  useEffect(() => {
    if (!mapped || keptFilming === room) return;
    const id = window.setTimeout(() => setKeptFilming(room), 8000);
    return () => clearTimeout(id);
  }, [mapped, keptFilming, room]);

  function nextRoom() {
    if (!recording || roomsRef.current.length >= MAX_ROOMS) return;
    const t = round1((performance.now() - startedAtRef.current) / 1000);
    if (t - roomsRef.current[roomsRef.current.length - 1] < MIN_ROOM_SEC) return;
    setRooms((prev) => [...prev, t]);
    setAnnounce(`Room ${roomsRef.current.length + 1}. Walk along its walls.`);
  }

  // A find ticks its checklist step, so nobody has to tap Done while holding a phone.
  useEffect(() => {
    const latest = liveFinds.finds[liveFinds.finds.length - 1];
    if (!latest) return;
    const step = FIND_TICKS[latest.key];
    if (step && !checkedRef.current.includes(step)) {
      check(step);
      setAnnounce(`Found the ${latest.label.toLowerCase()}.`);
    }
  }, [liveFinds.finds.length]);

  // About six seconds of talking ticks "Say what you want".
  const talkMsRef = useRef(0);
  useEffect(() => {
    if (!recording) return;
    talkMsRef.current = 0;
    const id = window.setInterval(() => {
      if (levelRef.current >= 3) talkMsRef.current += 250;
      if (talkMsRef.current >= 6000 && !checkedRef.current.includes("plans")) {
        check("plans");
        setAnnounce("Got what you said.");
      }
    }, 250);
    return () => clearInterval(id);
  }, [recording]);

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
    setPhase({ name: "review", take: { file, durationSec, checklist: [], rooms: [], source: "upload", note } });
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
          onUse={() => onComplete(take.file, { durationSec: take.durationSec, checklist: take.checklist, rooms: take.rooms.map((startS) => ({ startS })) })}
          onRetake={() => (take.source === "camera" ? startCamera(false) : pickFile())}
          busy={busy}
          onClose={close}
        />
        {picker}
        {live}
      </section>
    );
  }

  const pastMin = elapsed >= MIN_SEC;
  const left = MAX_SEC - elapsed;
  const mirrored = stream?.getVideoTracks()[0]?.getSettings().facingMode === "user";
  const next = CHECKLIST.find((c) => !checked.includes(c.id));
  const showDone = mapped && keptFilming !== room;
  const roomLabel = `Room ${room + 1}`;
  const line = recording
    ? coachLine({
        issue,
        minLeft: nudge && !pastMin ? Math.ceil(MIN_SEC - elapsed) : null,
        room,
        roomSec,
        holdLeft: ceiling.progress > 0 ? Math.ceil((1 - ceiling.progress) * 3) : null,
        ceilingDone: checked.includes("ceiling"),
        tilt,
        coverage,
        mapped,
        sheet: showDone,
        next: next ? next.label.charAt(0).toLowerCase() + next.label.slice(1) : null,
      })
    : null;
  const stop = () => (pastMin ? stopRecording("user") : setNudge(true));
  const size = live3d.preview?.widthM && live3d.preview?.depthM ? { widthM: live3d.preview.widthM, depthM: live3d.preview.depthM } : null;

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
          <h2 className="cap-sr" data-focus tabIndex={-1}>
            {recording ? `Recording ${roomLabel}` : "Camera ready"}
          </h2>
          {recording ? (
            <LiveLayer videoRef={liveRef} flash={liveFinds.flash} heading={coverage.heading} room={roomLabel} line={line} />
          ) : (
            <>
              <Crosshair />
              <div className="cap-top">
                <p className="cap-coach" data-kind="start">
                  Start at the top of the stairs.
                </p>
                <p className="cap-tips">{TIPS.map((t) => t.label).join(" · ")}</p>
              </div>
            </>
          )}

          {showDone && (
            <RoomDone
              name={roomLabel}
              size={size}
              canAddRoom={canAddRoom}
              onNext={nextRoom}
              onDone={stop}
              onKeep={() => setKeptFilming(room)}
            />
          )}

          <div className="cap-dock">
            <div className="cap-dock-side">
              {recording
                ? canAddRoom &&
                  !showDone && (
                    <button className="cap-pill-btn" data-ready={mapped} onClick={nextRoom}>
                      Next room
                    </button>
                  )
                : (
                    <button className="cap-pill-btn" onClick={pickFile} aria-label="Upload a video instead">
                      Upload
                    </button>
                  )}
            </div>
            <Ring
              recording={recording}
              done={checked}
              windows={windowsFound}
              coverage={coverage}
              elapsed={elapsed}
              canStart={Boolean(stream)}
              onPrimary={recording ? stop : startRecording}
              onToggle={toggle}
            />
            <div className="cap-dock-side cap-dock-side--end">
              {recording && live3d.available && (
                <Suspense fallback={null}>
                  <Live3D key={room} preview={live3d.preview} room={roomLabel} />
                </Suspense>
              )}
            </div>
          </div>

          {dims && (
            <>
              <Dimension className="cap-dim--top" label={`${dims.w} px`} />
              <Dimension className="cap-dim--side" axis="y" label={`${dims.h} px`} />
            </>
          )}
        </div>
        {sideways && <p className="cap-plate cap-plate--center">Turn your phone upright</p>}
      </div>

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
