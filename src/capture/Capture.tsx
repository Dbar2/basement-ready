// Guided basement capture: brief, camera, one take of the whole basement with a voice guide and a
// "paint the room" view of what's filmed, review, hand back a File.
import { Suspense, useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import "./capture.css";
import { MAX_SEC, MIN_SEC, TIPS } from "./checklist";
import { Dimension, Icon } from "./drawing";
import { LEVEL_STEPS, useMediaQuery, useMicLevel, useTiltHold, useWakeLock } from "./hooks";
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
  type Lens,
  type ProblemKind,
} from "./media";
import { FIND_TICKS, sessionId, useCoaching, useLive3d, useLiveFinds } from "./live";
import { lazy3d, View3DBoundary } from "../components/View3D";
const Live3DFull = lazy3d(() => import("./Live3D").then((m) => m.Live3DFull));
import { FindFlash } from "./LiveLayer";
import { CoveragePanel, useCoverage } from "./Coverage";
import { describeGap, nextGap, Steady, type Gap, type Group } from "./paint";
import { TurnHint, VoiceBubble } from "./Guide";
import { RoomDetector, type Look } from "./rooms";
import { currentTask, IDEAS, NEEDS, SKIPPABLE, type LineId, type Need } from "./script";
import { keepAudio, prepareAudioSession } from "./audio";
import { TalkMeter, useVoice, type Spoken } from "./voice";
import { DeniedPage, IntroPage, ProblemPage } from "./Pages";
import { Review, type Take } from "./Review";

// rooms: where the picture changed enough to be another part of the basement. Never shown; the server
// only uses them to label areas of the one plan. ideas: what they tapped when asked what the space
// should be. spoken: when the guide was talking, so the server can cut its voice out of the transcript.
// lens: "ultrawide" when the 0.5x lens filmed it. wideAt: seconds into the take of the wide shot from a
// corner, for the staged photos. Uploads have no rooms, lens or wide shot.
export type CaptureMeta = {
  durationSec: number;
  checklist: Need[];
  rooms: { startS: number }[];
  ideas: { room: number; idea: string; sec: number }[];
  spoken: Spoken[];
  lens: Lens | null;
  wideAt: number | null;
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
// Painted enough to call it done. The walls matter most for the 3D; the floor only near the walls.
const DONE_AT: Record<Group, number> = { walls: 0.7, ceiling: 0.45, floor: 0.35 };
// The wide shot: held still this long.
const WIDE_HOLD_MS = 2000;
// Directions wait until the paint has stopped growing (by this much) for this long.
const GROWING = 0.02;
const STALL_MS = 4000;
// A door SAM saw this recently counts toward spotting another part of the basement.
const DOOR_FRESH_SEC = 2.5;

const PRAISE: Partial<Record<Need, LineId>> = {
  stairs: "stairs_done",
  walls: "walls_done",
  ceiling: "ceiling_done",
  floor: "floor_done",
  furnace: "furnace_found",
  plans: "plans_heard",
  wide: "wide_done",
};
const DIRECTION: Record<string, LineId> = { left: "turn_left", right: "turn_right", around: "turn_around", up: "tilt_up", down: "tilt_down" };

export function Capture({ onComplete, onCancel }: CaptureProps) {
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasAudio, setHasAudio] = useState(true);
  const [lens, setLens] = useState<Lens>("wide");
  const [paused, setPaused] = useState(false); // the phone took the camera away for a moment
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [checked, setChecked] = useState<Need[]>([]);
  const [skipped, setSkipped] = useState<Need[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [announce, setAnnounce] = useState("");
  // One id per take: live finds and the assembling 3D share it on the server.
  const [session, setSession] = useState(() => sessionId());
  const [ideas, setIdeas] = useState<CaptureMeta["ideas"]>([]);
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
  const ideasRef = useRef(ideas);
  const lensRef = useRef(lens);
  // Silent marks where the picture changed into another part of the basement.
  const detectorRef = useRef(new RoomDetector());
  const marksRef = useRef<number[]>([]);
  const doorRef = useRef({ sec: -Infinity, width: 0 });
  const wideAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  phaseRef.current = phase;
  checkedRef.current = checked;
  ideasRef.current = ideas;
  lensRef.current = lens;

  const recording = phase.name === "recording";
  const sinceStart = () => (performance.now() - startedAtRef.current) / 1000;

  // ---------- camera ----------

  function releaseCamera() {
    stopStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setDims(null);
    setPaused(false);
  }

  // `quiet`: the camera dropped out on the ready screen and is coming back by itself; only a failure shows.
  function startCamera(askMotion: boolean, quiet = false) {
    // iOS only shows the motion prompt and starts audio from inside a tap, so these go first, before
    // any await. The phone then asks for motion, camera and mic in one go, back to back.
    const motion = askMotion ? requestMotion() : Promise.resolve(false);
    prepareAudioSession();
    void voice.prepare();
    if (!quiet) setBusy(true);
    void motion
      .then(() => openCamera())
      .then(({ stream: s, hasAudio: audio, lens: l }) => {
        if (!mountedRef.current) return stopStream(s);
        stopStream(streamRef.current);
        streamRef.current = s;
        setStream(s);
        setHasAudio(audio);
        setLens(l);
        setPaused(false);
        watchTrack(s);
        if (phaseRef.current.name !== "recording") setPhase({ name: "ready" });
      })
      .catch((err) => {
        const p = toProblem(err);
        setPhase(p.kind === "denied" ? { name: "denied" } : { name: "error", kind: p.kind });
      })
      .finally(() => setBusy(false));
  }

  // The phone can pause the camera (a notification, the audio route changing) or take it away (a call,
  // another app). A pause keeps the take; the picture comes back by itself.
  function watchTrack(s: MediaStream) {
    const track = s.getVideoTracks()[0];
    if (!track) return;
    track.addEventListener("mute", () => streamRef.current === s && setPaused(true));
    track.addEventListener("unmute", () => streamRef.current === s && setPaused(false));
    track.addEventListener("ended", () => {
      if (streamRef.current !== s) return;
      if (phaseRef.current.name === "recording") return stopRecording("interrupted");
      // On the ready screen nothing is lost: get the camera back without asking again.
      setPaused(true);
      if (!document.hidden) startCamera(false, true);
    });
  }

  // ---------- recording ----------

  async function startRecording() {
    const s = streamRef.current;
    if (!s || busy) return;
    // Every clip is fetched by now; wait for the intro so the first line is the guide, not silence.
    setBusy(true);
    await voice.prepare();
    setBusy(false);
    if (!mountedRef.current || streamRef.current !== s) return;
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
    detectorRef.current = new RoomDetector();
    marksRef.current = [];
    doorRef.current = { sec: -Infinity, width: 0 };
    wideAtRef.current = null;
    talkRef.current.reset();
    stillRef.current = null;
    hintRef.current.reset();
    sinceRef.current = {};
    setElapsed(0);
    setChecked([]);
    setSkipped([]);
    setIdeas([]);
    setShow3d(false);
    setNudge(false);
    setConfirmDiscard(false);
    setPhase({ name: "recording" });
    setAnnounce("Recording. Film the stairs on your way down.");
  }

  function stopRecording(reason: StopReason) {
    const rec = recorderRef.current;
    if (!rec || stopRef.current) return;
    stopRef.current = { reason, at: sinceStart() };
    if (rec.state === "inactive") finishRecording(rec, rec.mimeType);
    else rec.stop();
  }

  function finishRecording(rec: MediaRecorder, requested: string | undefined) {
    if (recorderRef.current !== rec) return;
    recorderRef.current = null;
    // onstop without our stopRecording means the recorder died on its own.
    const { reason, at } = stopRef.current ?? { reason: "interrupted" as const, at: sinceStart() };
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
    const wideAt = wideAtRef.current;
    const take: Take = {
      file,
      durationSec,
      checklist: ORDER.filter((id) => checkedRef.current.includes(id)),
      rooms: [0, ...marksRef.current].filter((t) => t < durationSec),
      ideas: ideasRef.current,
      spoken: voice.spoken(),
      lens: lensRef.current,
      wideAt: wideAt != null && wideAt < durationSec ? wideAt : null,
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
      const t = sinceStart();
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
      if (!document.hidden && name === "ready" && streamRef.current?.getVideoTracks()[0]?.readyState === "ended") startCamera(false, true);
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
      keepAudio(false);
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
  const portrait = dims ? dims.h >= dims.w : true;

  // ---------- what's been shown ----------

  const check = (id: Need) => setChecked((prev) => (prev.includes(id) ? prev : ORDER.filter((x) => x === id || prev.includes(x))));

  const voice = useVoice(recording, startedAtRef.current);
  const live3d = useLive3d(recording, session);
  const coaching = useCoaching(recording, liveRef, onLook, startedAtRef.current);
  const coverage = useCoverage(recording, lens, portrait, coaching.stateRef);

  // The colour signature changed a lot: another part of the basement. Mark it for the plan's labels,
  // and let the old paint fade, without a word.
  function onLook(sec: number, look: Look) {
    const door = sec - doorRef.current.sec <= DOOR_FRESH_SEC ? doorRef.current.width : 0;
    if (!detectorRef.current.push({ sec, look, doorWidth: door })) return;
    marksRef.current.push(round1(sec));
    coverage.fade();
  }

  const liveFinds = useLiveFinds({
    active: recording,
    session,
    videoRef: liveRef,
    headingRef: coverage.headingRef,
    startedAt: startedAtRef.current,
    onDoor: (sec, width) => {
      if (width > 0) doorRef.current = { sec, width };
    },
  });

  // When each step first came up, so each gets its own time on screen.
  const sinceRef = useRef<Partial<Record<Need, number>>>({});
  const task = currentTask({
    sec: elapsed,
    done: new Set(checked),
    skipped: new Set(skipped),
    since: sinceRef.current,
    tiltSensor: coverage.tilt,
    compass: coverage.compass,
  });
  if (recording && task.id !== "finish") sinceRef.current[task.id] ??= elapsed;

  // Painted enough: done. Without a compass, holding the phone up (or down) for a moment counts instead.
  useEffect(() => {
    if (!recording || !coverage.compass) return;
    if (coverage.walls >= DONE_AT.walls) check("walls");
    if (coverage.ceiling >= DONE_AT.ceiling) check("ceiling");
    if (coverage.floor >= DONE_AT.floor) check("floor");
  }, [recording, coverage.compass, coverage.walls, coverage.ceiling, coverage.floor]);
  useTiltHold(recording && !coverage.compass && task.id === "ceiling", "up", () => check("ceiling"));
  useTiltHold(recording && !coverage.compass && task.id === "floor", "down", () => check("floor"), 2000);

  // Praise for each step as it's done, once. The queue drops it if a new task is waiting.
  const praisedRef = useRef(new Set<Need>());
  useEffect(() => {
    if (!recording) {
      praisedRef.current.clear();
      return;
    }
    for (const n of checked) {
      if (praisedRef.current.has(n)) continue;
      praisedRef.current.add(n);
      const line = PRAISE[n];
      if (line) voice.say(line);
      setAnnounce(`${NEEDS.find((x) => x.id === n)?.label} done.`);
    }
  }, [recording, checked]);

  // ---------- which way to go ----------

  const group: Group | null = task.id === "walls" || task.id === "ceiling" || task.id === "floor" ? task.id : null;
  const hintRef = useRef(new Steady<string>());
  const gapRef = useRef<Gap | null>(null);
  const hintGroupRef = useRef<Group | null>(null);
  // When the paint last grew. While it's growing, someone is filming what's needed: no arrow.
  const growRef = useRef({ value: 0, at: 0 });
  // A new step starts its directions afresh: no arrow left over from the walls on the ceiling step.
  if (hintGroupRef.current !== group) {
    hintGroupRef.current = group;
    hintRef.current.reset();
    gapRef.current = null;
    growRef.current = { value: group ? coverage[group] : 0, at: performance.now() };
  }
  let gap: Gap | null = null;
  if (recording && group && coverage.compass && coverage.viewRef.current) {
    const now = performance.now();
    // Growing, or just faded for another part of the basement: either way, not stuck.
    if (coverage[group] >= growRef.current.value + GROWING || coverage[group] < growRef.current.value - GROWING) {
      growRef.current = { value: coverage[group], at: now };
    }
    const stalled = now - growRef.current.at >= STALL_MS;
    const raw = stalled ? nextGap((i) => coverage.grid.fill(i), coverage.viewRef.current, group) : null;
    const key = raw && (raw.turn || raw.tilt) ? `${raw.turn ?? ""}|${raw.tilt ?? ""}` : null;
    const steady = hintRef.current.push(key, performance.now());
    if (raw && key === steady) gapRef.current = raw;
    if (!steady) gapRef.current = null;
    gap = gapRef.current;
  }
  const hintKey = gap ? `${gap.turn ?? ""}|${gap.tilt ?? ""}` : null;
  useEffect(() => {
    if (!recording || !gap) return;
    const line = DIRECTION[gap.turn ?? gap.tilt ?? ""];
    // The ceiling and floor tasks already say "tilt": only speak up about turning there.
    if (line && (group === "walls" || gap.turn)) voice.say(line);
  }, [hintKey]);

  useEffect(() => {
    if (recording) voice.say(task.line, { again: true });
  }, [recording, task.id]);
  // Light and speed only matter while there's still something to film.
  useEffect(() => {
    if (coaching.issue && task.id !== "finish") voice.say(coaching.issue.id === "dark" ? "too_dark" : "slow_down");
  }, [coaching.issue?.id]);

  // A find ticks what it shows, so nobody has to tap anything while holding a phone.
  useEffect(() => {
    const latest = liveFinds.finds[liveFinds.finds.length - 1];
    if (!latest) return;
    const step = FIND_TICKS[latest.key];
    if (step && !checkedRef.current.includes(step)) check(step);
    if (latest.key === "window") voice.say("window_found");
    setAnnounce(`Found the ${latest.label.toLowerCase()}.`);
  }, [liveFinds.finds.length]);

  // ---------- plans: a tap, or about 1.5 s of talking ----------

  function pickIdea(idea: string) {
    setIdeas((prev) => [...prev, { room: marksRef.current.length, idea, sec: round1(elapsed) }]);
    check("plans");
  }
  const talkRef = useRef(new TalkMeter());
  const listening = recording && task.id === "plans";
  useEffect(() => {
    if (!listening) return;
    talkRef.current.reset();
    const id = window.setInterval(() => {
      if (talkRef.current.push(levelRef.current >= 3, performance.now(), voice.guide())) check("plans");
    }, 100);
    return () => clearInterval(id);
  }, [listening]);

  // ---------- the wide shot: still for 2 seconds ----------

  const stillRef = useRef<number | null>(null);
  const wideOn = recording && task.id === "wide";
  useEffect(() => {
    if (!wideOn) return;
    stillRef.current = null;
    const id = window.setInterval(() => {
      const s = coaching.stateRef.current;
      const now = performance.now();
      if (!s.still || !s.bright) return void (stillRef.current = null);
      stillRef.current ??= now;
      if (now - stillRef.current >= WIDE_HOLD_MS) {
        // The middle of the still stretch is the sharpest, widest frame.
        wideAtRef.current = round1((stillRef.current + WIDE_HOLD_MS / 2 - startedAtRef.current) / 1000);
        check("wide");
      }
    }, 200);
    return () => clearInterval(id);
  }, [wideOn]);

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
    setPhase({
      name: "review",
      take: { file, durationSec, checklist: [], rooms: [], ideas: [], spoken: [], lens: null, wideAt: null, source: "upload", note },
    });
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
              lens: take.lens,
              wideAt: take.wideAt,
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
  const stop = () => {
    if (pastMin) return stopRecording("user");
    setNudge(true);
    voice.say("keep_going");
  };
  const skippable = SKIPPABLE.has(task.id) && task.id !== "finish";
  const micBars = (
    <span className="cap-mic-bars" aria-hidden>
      {Array.from({ length: LEVEL_STEPS }, (_, i) => (
        <i key={i} data-on={i < level} />
      ))}
    </span>
  );

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
          {recording && <FindFlash flash={liveFinds.flash} videoRef={liveRef} heading={coverage.view?.heading ?? null} />}

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
                  {lens === "ultrawide" && <span className="guide-lens">0.5×</span>}
                  {hasAudio && micBars}
                </span>
              )}
              {recording && (
                <button className="guide-done" data-waiting={!pastMin} aria-disabled={!pastMin} onClick={stop}>
                  {pastMin ? "Done" : `Done in ${Math.ceil(MIN_SEC - elapsed)} s`}
                </button>
              )}
            </div>
            <VoiceBubble
              text={recording ? (voice.caption?.text ?? null) : "Hi! I'll guide you with my voice. Stand at the top of the stairs, tap Start, and film them on your way down."}
              speaking={voice.speaking}
              muted={voice.muted}
              onMute={() => voice.setMuted((m) => !m)}
            />
          </div>

          {recording && gap && <TurnHint turn={gap.turn} tilt={gap.tilt} what={describeGap(gap)} />}
          {paused && (
            <p className="cap-plate cap-plate--center" role="status">
              Camera paused. It'll be back in a moment{recording ? ", and the take keeps going" : ""}.
            </p>
          )}

          <div className="guide-bottom">
            {recording ? (
              <CoveragePanel
                title={task.title}
                count={`${checked.length} of ${NEEDS.length}`}
                coverage={coverage}
                lens={lens}
                portrait={portrait}
                gap={gap}
                preview={live3d.preview}
                onOpen3d={() => setShow3d(true)}
                action={
                  skippable ? (
                    <button className="cov-skip" onClick={() => setSkipped((prev) => [...prev, task.id as Need])}>
                      Skip
                    </button>
                  ) : undefined
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
                        {micBars}
                        Listening…
                      </span>
                    )}
                  </div>
                )}
                {nudge && !pastMin && <p className="guide-nudge">We need at least 30 seconds to see the space.</p>}
              </CoveragePanel>
            ) : (
              <div className="guide-card guide-card--start">
                <h2 className="guide-task" data-focus tabIndex={-1}>
                  Start at the top of the stairs
                </h2>
                <p className="guide-tips">{TIPS.map((t) => t.label).join(" · ")}</p>
                <button className="cap-btn cap-btn--primary guide-start" onClick={() => void startRecording()} disabled={!stream || busy || paused}>
                  <Icon.rec /> {busy ? "Starting…" : "Start"}
                </button>
                <button className="guide-link" onClick={pickFile}>
                  Upload a video instead
                </button>
              </div>
            )}
          </div>

          {show3d && live3d.preview && (
            <View3DBoundary quiet>
              <Suspense fallback={null}>
                <Live3DFull preview={live3d.preview} onClose={() => setShow3d(false)} />
              </Suspense>
            </View3DBoundary>
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
