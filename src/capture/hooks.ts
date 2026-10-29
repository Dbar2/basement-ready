import { useEffect, useRef, useState } from "react";
import { CEILING_HOLD_MS } from "./checklist";
import { audioContext } from "./audio";
import { cameraLift } from "./media";

export const LEVEL_STEPS = 5;

// Microphone level as 0..LEVEL_STEPS, so people can see we hear them. Re-renders only when the step changes.
// It listens on the capture's one shared AudioContext (see audio.ts), never a second one.
export function useMicLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    setLevel(0);
    const ctx = stream && stream.getAudioTracks().length > 0 ? audioContext() : null;
    if (!stream || !ctx) return;
    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch {
      return;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const id = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-8);
      // -58 dB is a quiet room, -18 dB is talking close to the phone.
      setLevel(Math.max(0, Math.min(LEVEL_STEPS, Math.round(((db + 58) / 40) * LEVEL_STEPS))));
    }, 90);
    return () => {
      clearInterval(id);
      source.disconnect();
    };
  }, [stream]);
  return level;
}

// Watches the tilt sensor while `armed`. Holding the rear camera pointed up (or down) for `holdMs` calls
// onHeld once. For phones with tilt but no compass, where the coverage view can't paint.
// `progress` is 0..1 while held and 0 otherwise. `sensed` turns true once the sensor reports at all.
export function useTiltHold(armed: boolean, toward: "up" | "down", onHeld: () => void, holdMs = CEILING_HOLD_MS) {
  const [progress, setProgress] = useState(0);
  const [sensed, setSensed] = useState(false);
  const onHeldRef = useRef(onHeld);
  onHeldRef.current = onHeld;

  useEffect(() => {
    setProgress(0);
    if (!armed || typeof DeviceOrientationEvent === "undefined") return;
    let heldSince: number | null = null;
    let fired = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      setSensed(true);
      // sin(50°) ≈ 0.77: far enough up that the frame is mostly ceiling; sin(40°) down is mostly floor.
      const lift = cameraLift(e.beta, e.gamma);
      if (toward === "up" ? lift > 0.77 : lift < -0.64) heldSince ??= performance.now();
      else heldSince = null;
    };
    const id = window.setInterval(() => {
      const p = heldSince == null ? 0 : Math.min(1, (performance.now() - heldSince) / holdMs);
      setProgress(p);
      if (p >= 1 && !fired) {
        fired = true;
        onHeldRef.current();
      }
    }, 100);
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      clearInterval(id);
      window.removeEventListener("deviceorientation", onOrient);
    };
  }, [armed, toward, holdMs]);

  return { progress, sensed };
}

// Keeps the screen awake while `on`. Safari 16.4+ and Chrome support it; elsewhere it quietly does nothing.
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    navigator.wakeLock
      .request("screen")
      .then((s) => {
        if (cancelled) void s.release();
        else sentinel = s;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      void sentinel?.release().catch(() => {});
    };
  }, [on]);
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}
