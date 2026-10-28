import { useEffect, useRef, useState } from "react";
import { CEILING_HOLD_MS } from "./checklist";
import { cameraLift } from "./media";

export const LEVEL_STEPS = 5;

// Microphone level as 0..LEVEL_STEPS, so people can see we hear them. Re-renders only when the step changes.
export function useMicLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    setLevel(0);
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!stream || stream.getAudioTracks().length === 0 || !AudioCtx) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioCtx();
    } catch {
      return;
    }
    void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
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
      void ctx.close().catch(() => {});
    };
  }, [stream]);
  return level;
}

// Watches the tilt sensor while `armed`. Holding the rear camera pointed up for 3 s calls onHeld once.
// `progress` is 0..1 while pointed up and 0 otherwise. `sensed` turns true once the sensor reports at all.
export function useCeilingHold(armed: boolean, onHeld: () => void) {
  const [progress, setProgress] = useState(0);
  const [sensed, setSensed] = useState(false);
  const onHeldRef = useRef(onHeld);
  onHeldRef.current = onHeld;

  useEffect(() => {
    setProgress(0);
    if (!armed || typeof DeviceOrientationEvent === "undefined") return;
    let upSince: number | null = null;
    let fired = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      setSensed(true);
      // sin(50°) ≈ 0.77: far enough up that the frame is mostly ceiling.
      if (cameraLift(e.beta, e.gamma) > 0.77) upSince ??= performance.now();
      else upSince = null;
    };
    const id = window.setInterval(() => {
      const p = upSince == null ? 0 : Math.min(1, (performance.now() - upSince) / CEILING_HOLD_MS);
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
  }, [armed]);

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
