// Guided basement capture: brief, camera, film with a voice guide that finds the rooms itself, review,
// hand back a File. The look follows brand/explorations/M1-filming-guides.png.
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import "./capture.css";
import { MAX_SEC, MIN_SEC, TIPS } from "./checklist";
import { Dimension, Icon } from "./drawing";
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
import { FIND_TICKS, sessionId, useCoaching, useCoverage, useLive3d, useLiveFinds, useRoomTilt } from "./live";
import { lazy, Suspense } from "react";
const Live3DFull = lazy(() => import("./Live3D").then((m) => ({ default: m.Live3DFull })));
import { FindFlash } from "./LiveLayer";
import { MiniRoom, TaskCard, TurnHint, VoiceBubble } from "./Guide";
import { RoomDetector } from "./rooms";
import { currentTask, IDEAS, NEEDS, turnToward, type Need } from "./script";
import { prepareAudioSession, useVoice, type Spoken } from "./voice";
import { DeniedPage, IntroPage, ProblemPage } from "./Pages";
import { Review, type Take } from "./Review";

// rooms: where each room starts in the take, so each gets its own 3D scan. Empty for uploads.
// ideas: what they tapped when asked what a room should be. spoken: when the guide was talking,
// so the server can cut its voice out of the transcript.
export type CaptureMeta = {
  durationSec: number;
  checklist: Need[];
  rooms: { startS: number }[];
  ideas: { room: number; idea: string; sec: number }[];
  spoken: Spoken[];
};

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
const ORDER = NEEDS.map((c) => c.id);
const MAX_ROOMS = 8;
const MIN_ROOM_SEC = 5;
const UNDO_SEC = 8;

export function Capture({ onComplete, onCancel }: CaptureProps) {
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasAudio, setHasAudio] = useState(true);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [checked, setChecked] = useState<Need[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [announce, setAnnounce] = useState("");
  // One id per take: live finds and the assembling 3D share it on the server.
  const [session, setSession] = useState(() => sessionId());
  // Where each room starts, in seconds into the take. The last one is the room you're in.
  const [rooms, setRooms] = useState<number[]>([0]);
  const [roomNames, setRoomNames] = useState<(string | null)[]>([null]);
  const [autoRoomAt, setAutoRoomAt] = useState<number | null>(null); // a room the guide started, still undoable
  const [ideas, setIdeas] = useState<CaptureMeta["ideas"]>([]);
  const [planRooms, setPlanRooms] = useState<number[]>([]); // rooms where they said or tapped what they want
  const [show3d, setShow3d] = useState(false);

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
  const ideasRef = useRef(ideas);
  ideasRef.current = ideas;
  const detectorRef = useRef(new RoomDetector());
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
    prepareAudioSession();
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
    voice.unlock();
    setSession(sessionId());
    startedAtRef.current = performance.now();
    detectorRef.current = new RoomDetector();
    setElapsed(0);
    setChecked([]);
    setRooms([0]);
    setRoomNames([null]);
    setAutoRoomAt(null);
    setIdeas([]);
    setPlanRooms([]);
    setShow3d(false);
    setNudge(false);
    setConfirmDiscard(false);
    setPhase({ name: "recording" });
    setAnnounce("Recording. Start at the bottom of the stairs.");
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
      setRoomNames([null]);
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
    const take: Take = {
      file,
      durationSec,
      checklist: ORDER.filter((id) => checkedRef.current.includes(id)),
      rooms: roomsRef.current.filter((t) => t < durationSec),
      ideas: ideasRef.current,
      spoken: voice.spoken(),
      source: "camera",
      note,
    };
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

  // ---------- what's been shown ----------

  const check = (id: Need) => setChecked((prev) => (prev.includes(id) ? prev : ORDER.filter((x) => x === id || prev.includes(x))));

  const ceiling = useCeilingHold(recording && !checked.includes("ceiling"), () => {
    check("ceiling");
    setAnnounce("Ceiling done.");
  });

  // ---------- rooms and the guide ----------

  const voice = useVoice(recording, startedAtRef.current);
  const room = rooms.length - 1;
  const roomStart = rooms[room];
  const roomSec = recording ? Math.max(0, elapsed - roomStart) : 0;
  // Each room has its own session on the server, so its 3D builds from its own frames.
  const roomSession = `${session}-r${room}`;
  const coverage = useCoverage(recording, room);
  const live3d = useLive3d(recording, roomSession);
  const issue = useCoaching(recording, liveRef);
  const tilt = useRoomTilt(recording, room);

  function startRoom(auto: boolean) {
    if (!recording || roomsRef.current.length >= MAX_ROOMS) return;
    const t = round1((performance.now() - startedAtRef.current) / 1000);
    if (t - roomsRef.current[roomsRef.current.length - 1] < MIN_ROOM_SEC) return;
    setRooms((prev) => [...prev, t]);
    setRoomNames((prev) => [...prev, null]);
    setAutoRoomAt(auto ? t : null);
    if (!auto) detectorRef.current.reset(t);
    voice.say("new_room", { again: true });
    setAnnounce(`New room. Walk along its walls.`);
  }

  // Not a new room after all: join it back to the one before.
  function undoRoom() {
    if (roomsRef.current.length < 2) return;
    setRooms((prev) => prev.slice(0, -1));
    setRoomNames((prev) => prev.slice(0, -1));
    setAutoRoomAt(null);
    detectorRef.current.reset((performance.now() - startedAtRef.current) / 1000);
  }

  const liveFinds = useLiveFinds({
    active: recording,
    session: roomSession,
    videoRef: liveRef,
    headingRef: coverage.headingRef,
    startedAt: startedAtRef.current,
    onFrame: (f) => {
      if (detectorRef.current.push(f)) startRoom(true);
    },
  });

  // Where the phone faced when this room started: "ahead" for the little room drawing.
  const roomHeadingRef = useRef<{ room: number; heading: number | null }>({ room: 0, heading: null });
  if (roomHeadingRef.current.room !== room) roomHeadingRef.current = { room, heading: null };
  if (roomHeadingRef.current.heading == null && coverage.heading != null) roomHeadingRef.current.heading = coverage.heading;

  const windowHere = liveFinds.finds.some((f) => f.key === "window" && f.at / 1000 >= roomStart);
  const wallsHere = roomSec >= 8 && (coverage.supported ? coverage.percent >= 85 : (live3d.preview?.wallsSeen ?? 0) >= 4);
  const task = currentTask({
    sec: elapsed,
    done: new Set(checked),
    room: {
      index: room,
      name: roomNames[room] ?? null,
      sec: roomSec,
      coverage: coverage.percent,
      walls: wallsHere,
      sawUp: tilt.sawUp,
      windowSeen: windowHere,
      plans: planRooms.includes(room),
    },
    tiltSensor: tilt.sensed,
    compass: coverage.supported,
  });
  const turn = recording && task.id === "walls" && coverage.percent >= 15 ? turnToward(coverage.covered, coverage.heading) : null;

  // The guide speaks when the task changes, and when something is found or missing.
  useEffect(() => {
    if (recording) voice.say(task.line);
  }, [recording, task.id, room]);
  useEffect(() => {
    if (turn) voice.say(turn === "left" ? "turn_left" : turn === "right" ? "turn_right" : "turn_around");
  }, [turn]);
  useEffect(() => {
    if (issue) voice.say(issue.id === "dark" ? "too_dark" : "slow_down");
  }, [issue?.id]);
  useEffect(() => {
    if (wallsHere) {
      check("walls");
      voice.say("walls_done", { again: true });
    }
  }, [wallsHere, room]);
  useEffect(() => {
    if (recording && tilt.sawUp) {
      check("ceiling");
      voice.say("ceiling_done", { again: true });
    }
  }, [tilt.sawUp, room]);

  // A find ticks what it shows, so nobody has to tap Done while holding a phone.
  useEffect(() => {
    const latest = liveFinds.finds[liveFinds.finds.length - 1];
    if (!latest) return;
    const step = FIND_TICKS[latest.key];
    if (step && !checkedRef.current.includes(step)) check(step);
    if (latest.key === "stairs") voice.say("stairs_done");
    if (latest.key === "window") voice.say("window_found", { again: true });
    if (latest.key === "furnace" || latest.key === "panel") {
      // The room with the furnace is the furnace room.
      setRoomNames((prev) => (prev.includes("Furnace room") ? prev : prev.map((n, i) => (i === prev.length - 1 ? "Furnace room" : n))));
      voice.say("furnace_found");
    }
    setAnnounce(`Found the ${latest.label.toLowerCase()}.`);
  }, [liveFinds.finds.length]);

  // An idea tapped, or a few seconds of talking, answers "what would you like this room to be?"
  function pickIdea(idea: string) {
    setIdeas((prev) => [...prev, { room, idea, sec: round1(elapsed) }]);
    setPlanRooms((prev) => (prev.includes(room) ? prev : [...prev, room]));
    check("plans");
    voice.say("plans_heard", { again: true });
  }
  const talkRef = useRef({ room: -1, ms: 0 });
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      const r = roomsRef.current.length - 1;
      if (talkRef.current.room !== r) talkRef.current = { room: r, ms: 0 };
      // Our own voice lifts the mic level too, so only count talking while the guide is quiet.
      if (levelRef.current >= 3 && !speakingRef.current) talkRef.current.ms += 250;
      if (talkRef.current.ms >= 4000) {
        setPlanRooms((prev) => (prev.includes(r) ? prev : [...prev, r]));
        if (!checkedRef.current.includes("plans")) check("plans");
      }
    }, 250);
    return () => clearInterval(id);
  }, [recording]);
  const speakingRef = useRef(false);
  speakingRef.current = voice.speaking;

  // The "new room" note offers an undo for a few seconds.
  useEffect(() => {
    if (autoRoomAt == null) return;
    const id = window.setTimeout(() => setAutoRoomAt(null), UNDO_SEC * 1000);
    return () => clearTimeout(id);
  }, [autoRoomAt]);

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
    setPhase({ name: "review", take: { file, durationSec, checklist: [], rooms: [], ideas: [], spoken: [], source: "upload", note } });
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
          onUse={() =>
            onComplete(take.file, {
              durationSec: take.durationSec,
              checklist: take.checklist,
              rooms: take.rooms.map((startS) => ({ startS })),
              ideas: take.ideas,
              spoken: take.spoken,
            })
          }
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
  const roomLabel = roomNames[room] ?? `Room ${room + 1}`;
  const stop = () => {
    if (pastMin) return stopRecording("user");
    setNudge(true);
    voice.say("keep_going", { again: true });
  };

  return (
    <section ref={rootRef} className="cap cap--live" data-phase={phase.name} aria-label="Film your basement">
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
          {recording && <FindFlash flash={liveFinds.flash} videoRef={liveRef} heading={coverage.heading} />}

          <div className="guide-top">
            <div className="guide-bar">
              <button
                className="guide-icon-btn"
                aria-label={recording ? "Stop and throw away this take" : "Close the camera"}
                onClick={() => (recording ? setConfirmDiscard(true) : close())}
              >
                <Icon.close />
              </button>
              {recording ? (
                <span className="guide-rec">
                  <i aria-hidden /> {formatTime(elapsed)}
                  {left <= 15 && <b> · {Math.ceil(left)} s left</b>}
                </span>
              ) : (
                <span className="guide-rec guide-rec--ready">
                  {hasAudio ? "Camera and mic ready" : "Camera ready · no mic"}
                  {hasAudio && (
                    <span className="cap-mic-bars" aria-hidden>
                      {Array.from({ length: LEVEL_STEPS }, (_, i) => (
                        <i key={i} data-on={i < level} />
                      ))}
                    </span>
                  )}
                </span>
              )}
              {recording && (
                <button className="guide-done" data-waiting={!pastMin} aria-disabled={!pastMin} onClick={stop}>
                  {pastMin ? "Done" : `Done in ${Math.ceil(MIN_SEC - elapsed)} s`}
                </button>
              )}
            </div>
            <VoiceBubble
              text={recording ? (voice.caption?.text ?? null) : "Hi! I'll guide you with my voice. Tap Start, then begin at the bottom of the stairs."}
              speaking={voice.speaking}
              muted={voice.muted}
              onMute={() => voice.setMuted((m) => !m)}
            />
          </div>

          <TurnHint dir={turn} />

          <div className="guide-bottom">
            {recording && (
              <MiniRoom
                covered={coverage.covered}
                heading={coverage.heading}
                start={roomHeadingRef.current.heading}
                label={roomLabel}
                onOpen={live3d.preview ? () => setShow3d(true) : undefined}
              />
            )}
            {recording ? (
              <TaskCard
                title={task.title}
                done={checked}
                notice={
                  autoRoomAt != null ? (
                    <p className="guide-notice">
                      New room: <b>{roomLabel}</b>
                      <button onClick={undoRoom}>Same room</button>
                    </p>
                  ) : null
                }
              >
                {task.id === "plans" && (
                  <div className="guide-ideas">
                    {IDEAS.map((idea) => (
                      <button key={idea} onClick={() => pickIdea(idea)}>
                        {idea}
                      </button>
                    ))}
                    {hasAudio && (
                      <span className="guide-listening">
                        <span className="cap-mic-bars" aria-hidden>
                          {Array.from({ length: LEVEL_STEPS }, (_, i) => (
                            <i key={i} data-on={i < level} />
                          ))}
                        </span>
                        Listening…
                      </span>
                    )}
                  </div>
                )}
                {task.id !== "plans" && rooms.length < MAX_ROOMS && roomSec >= MIN_ROOM_SEC && (
                  <button className="guide-link" onClick={() => startRoom(false)}>
                    In another room already? Tap here
                  </button>
                )}
                {nudge && !pastMin && <p className="guide-nudge">We need at least 30 seconds to see the space.</p>}
              </TaskCard>
            ) : (
              <div className="guide-card guide-card--start">
                <h2 className="guide-task" data-focus tabIndex={-1}>
                  Start at the bottom of the stairs
                </h2>
                <p className="guide-tips">{TIPS.map((t) => t.label).join(" · ")}</p>
                <button className="cap-btn cap-btn--primary guide-start" onClick={startRecording} disabled={!stream}>
                  <Icon.rec /> Start
                </button>
                <button className="guide-link" onClick={pickFile}>
                  Upload a video instead
                </button>
              </div>
            )}
          </div>

          {show3d && live3d.preview && (
            <Suspense fallback={null}>
              <Live3DFull preview={live3d.preview} room={roomLabel} onClose={() => setShow3d(false)} />
            </Suspense>
          )}

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
