// Live guidance while filming: SAM finds, on-phone coaching and room coverage.
// Everything here is best-effort: if a sensor or the network isn't there, recording still works.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ChecklistId } from "./checklist";
import { cameraLift } from "./media";

// ---------- live finds (SAM 3.1 on one frame at a time) ----------

export type FindKey = "stairs" | "window" | "furnace" | "panel" | "door" | "duct" | "beam";

// Which checklist step each find ticks.
export const FIND_TICKS: Partial<Record<FindKey, ChecklistId>> = {
  stairs: "stairs",
  window: "windows",
  furnace: "furnace",
  panel: "furnace",
  door: "door",
};

export type LiveBox = { x: number; y: number; w: number; h: number; c: number | null };

export type LiveFind = {
  id: string;
  key: FindKey;
  label: string;
  box: LiveBox; // 0..1 of the frame it was found in
  thumb: string; // data URL: the object cropped from that frame, outlined
  heading: number | null; // compass direction the phone faced, for the radar
  at: number; // ms since recording started
};

const FRAME_EVERY_MS = 1200;
const FRAME_LONG_SIDE = 768; // basement windows are small; 512 px missed them
const WINDOW_APART_DEG = 35; // two windows must be this far apart on the compass to count as two

export function sessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function grab(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (!video.videoWidth) return null;
  const scale = FRAME_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight);
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
  return c;
}

// A card-sized crop around the find, outlined like the rest of the brand's drawings.
function thumbnail(frame: HTMLCanvasElement, box: LiveBox, mint: string): string {
  const pad = 0.35;
  const bx = box.x * frame.width, by = box.y * frame.height, bw = box.w * frame.width, bh = box.h * frame.height;
  const side = Math.max(bw, bh) * (1 + pad * 2);
  const sx = Math.max(0, Math.min(frame.width - side, bx + bw / 2 - side / 2));
  const sy = Math.max(0, Math.min(frame.height - side, by + bh / 2 - side / 2));
  const size = 160;
  const k = size / side;
  const t = document.createElement("canvas");
  t.width = t.height = size;
  const g = t.getContext("2d")!;
  g.drawImage(frame, sx, sy, side, side, 0, 0, size, size);
  g.strokeStyle = mint;
  g.lineWidth = 3;
  g.strokeRect((bx - sx) * k, (by - sy) * k, bw * k, bh * k);
  return t.toDataURL("image/jpeg", 0.8);
}

const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function useLiveFinds(opts: {
  active: boolean;
  session: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  headingRef: RefObject<number | null>;
  startedAt: number;
}) {
  const { active, session, videoRef, headingRef, startedAt } = opts;
  const [finds, setFinds] = useState<LiveFind[]>([]);
  const [flash, setFlash] = useState<{ find: LiveFind; heading: number | null; seq: number } | null>(null);
  const [offline, setOffline] = useState(false);
  const findsRef = useRef<LiveFind[]>([]);
  findsRef.current = finds;
  // Each room sends under its own session, so its 3D builds alone; finds carry on across rooms.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (!active) return;
    setFinds([]);
    setFlash(null);
    setOffline(false);
    const mint = getComputedStyle(document.documentElement).getPropertyValue("--color-mint").trim() || "#4BE38A";
    let stopped = false;
    let turn = 0;
    let failures = 0;
    let seq = 0;

    // Ask for what's still missing first, plus one of the extras each round.
    const plan = (): FindKey[] => {
      const have = new Set(findsRef.current.map((f) => f.key));
      const missing = (["stairs", "window", "furnace", "door", "panel"] as FindKey[]).filter((k) => !have.has(k));
      // Beams are left to the full scan: live, they matched furniture in a finished basement.
      const extras: FindKey[] = ["window", "duct", "panel"];
      const extra = extras[turn++ % extras.length];
      const pick = [...missing.slice(0, 2), extra];
      return [...new Set(pick)].slice(0, 3);
    };

    const tick = async () => {
      while (!stopped) {
        const video = videoRef.current;
        const frame = video ? grab(video) : null;
        const heading = headingRef.current;
        if (frame) {
          const blob: Blob | null = await new Promise((r) => frame.toBlob(r, "image/jpeg", 0.72));
          if (blob && !stopped) {
            const form = new FormData();
            form.append("frame", blob, "frame.jpg");
            form.append("session", sessionRef.current);
            form.append("concepts", JSON.stringify(plan()));
            try {
              const res = await fetch("/api/live/detect", { method: "POST", body: form });
              if (res.status === 429) {
                const { error } = await res.json().catch(() => ({ error: "" }));
                if (error !== "slow down") {
                  setOffline(true);
                  return; // out of live finds for this take; the full scan still runs afterwards
                }
              } else if (res.ok) {
                failures = 0;
                const { finds: got } = (await res.json()) as { finds: { key: FindKey; label: string; boxes: LiveBox[] }[] };
                const fresh: LiveFind[] = [];
                for (const f of got) {
                  const box = [...f.boxes].sort((a, b) => b.w * b.h - a.w * a.h)[0];
                  const known = findsRef.current.filter((x) => x.key === f.key);
                  // Windows can be many; anything else counts once.
                  const isNew =
                    known.length === 0 ||
                    (f.key === "window" && heading != null && known.every((x) => x.heading == null || angleGap(x.heading, heading) > WINDOW_APART_DEG));
                  if (!isNew || !box) continue;
                  fresh.push({
                    id: `${f.key}-${known.length + 1}`,
                    key: f.key,
                    label: f.label,
                    box,
                    thumb: thumbnail(frame, box, mint),
                    heading,
                    at: performance.now() - startedAt,
                  });
                }
                if (fresh.length) {
                  setFinds((prev) => [...prev, ...fresh]);
                  setFlash({ find: fresh[0], heading, seq: ++seq });
                  navigator.vibrate?.(25);
                }
              } else if (++failures >= 3) setOffline(true);
            } catch {
              if (++failures >= 3) setOffline(true);
            }
          }
        }
        await new Promise((r) => setTimeout(r, FRAME_EVERY_MS));
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [active, videoRef, headingRef, startedAt]);

  return { finds, flash, offline };
}

// ---------- coaching that runs on the phone ----------

export type Coach = { id: "dark" | "fast" | "min" | "start" | "hold" | "tilt" | "gap" | "next"; text: string } | null;

const DARK_LUMA = 42;
const FAST_DEG_PER_S = 75;

export function useCoaching(active: boolean, videoRef: RefObject<HTMLVideoElement | null>) {
  const [issue, setIssue] = useState<Coach>(null);

  useEffect(() => {
    if (!active) {
      setIssue(null);
      return;
    }
    let spin = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const r = e.rotationRate;
      if (!r) return;
      spin = Math.max(spin * 0.8, Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0));
    };
    window.addEventListener("devicemotion", onMotion);

    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    let prev: Uint8ClampedArray | null = null;
    let shown: Coach = null;
    let shownAt = 0;

    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (!v?.videoWidth) return;
      g.drawImage(v, 0, 0, 24, 24);
      const px = g.getImageData(0, 0, 24, 24).data;
      let luma = 0;
      let diff = 0;
      for (let i = 0; i < px.length; i += 4) {
        const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        luma += y;
        if (prev) diff += Math.abs(y - (0.2126 * prev[i] + 0.7152 * prev[i + 1] + 0.0722 * prev[i + 2]));
      }
      const n = px.length / 4;
      luma /= n;
      diff /= n;
      prev = px;
      // Gyro when we have it; otherwise how much the picture changed since the last look.
      const fast = spin > FAST_DEG_PER_S || (spin === 0 && diff > 50);
      const next: Coach = luma < DARK_LUMA ? { id: "dark", text: "Turn on more lights" } : fast ? { id: "fast", text: "Slow down a little" } : null;
      const now = performance.now();
      // Hold a message for at least 1.6 s so it can be read.
      if (next?.id !== shown?.id && (now - shownAt > 1600 || !shown)) {
        shown = next;
        shownAt = now;
        setIssue(next);
      }
    }, 400);

    return () => {
      clearInterval(id);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [active, videoRef]);

  return issue;
}

// ---------- coverage: which directions the phone has pointed ----------

const BINS = 36; // 10° each

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };

// Resets for each room: the track shows this room's walls, not the whole basement's.
export function useCoverage(active: boolean, room: number) {
  const headingRef = useRef<number | null>(null);
  const [state, setState] = useState<{ heading: number | null; covered: boolean[]; supported: boolean }>({
    heading: null,
    covered: Array(BINS).fill(false),
    supported: false,
  });

  useEffect(() => {
    if (!active) return;
    const covered: boolean[] = Array(BINS).fill(false);
    headingRef.current = null;
    setState({ heading: null, covered: [...covered], supported: false });
    let last = 0;

    const onOrient = (e: OrientationEventWithCompass) => {
      // iOS gives a true compass heading; elsewhere absolute alpha runs counter-clockwise from north.
      const h = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null;
      if (h == null) return;
      headingRef.current = h;
      covered[Math.floor(h / (360 / BINS)) % BINS] = true;
      const now = performance.now();
      if (now - last > 120) {
        last = now;
        setState({ heading: h, covered: [...covered], supported: true });
      }
    };
    const absoluteEvent = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(absoluteEvent, onOrient as EventListener);
    return () => window.removeEventListener(absoluteEvent, onOrient as EventListener);
  }, [active, room]);

  const percent = Math.round((state.covered.filter(Boolean).length / BINS) * 100);
  return { ...state, percent, headingRef };
}

// ---------- tilt: has this room's ceiling been in the picture? ----------

// sin(35°): enough tilt that the top of the frame is ceiling. The 3D needs floor and ceiling in each room.
const UP_ENOUGH = 0.57;

export function useRoomTilt(active: boolean, room: number) {
  const [state, setState] = useState({ sawUp: false, sensed: false });
  useEffect(() => {
    setState((s) => ({ sawUp: false, sensed: s.sensed }));
    if (!active || typeof DeviceOrientationEvent === "undefined") return;
    let saw = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      const up = cameraLift(e.beta, e.gamma) > UP_ENOUGH;
      if (up && !saw) {
        saw = true;
        setState({ sawUp: true, sensed: true });
      } else setState((s) => (s.sensed ? s : { ...s, sensed: true }));
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [active, room]);
  return state;
}

// ---------- the one line of coaching ----------

// Problems first, then what this room still needs, then the next thing to show. One line, never a list.
export function coachLine(s: {
  issue: Coach;
  minLeft: number | null; // seconds to the minimum, when someone tried to stop early
  room: number;
  roomSec: number;
  holdLeft: number | null; // seconds left holding the phone up for the ceiling
  ceilingDone: boolean;
  tilt: { sawUp: boolean; sensed: boolean };
  coverage: { percent: number; supported: boolean };
  mapped: boolean; // this room has been filmed all the way round
  sheet: boolean; // the "room mapped" sheet is up, and says it all
  next: string | null;
}): Coach {
  if (s.minLeft != null) return { id: "min", text: `Keep filming · ${s.minLeft} s to go` };
  if (s.issue) return s.issue;
  if (s.holdLeft != null) return { id: "hold", text: `Hold it there · ${s.holdLeft} s` };
  if (s.roomSec < 6) return { id: "start", text: s.room === 0 ? "Walk along the walls. Stay 2 m back." : "New room. Walk along its walls." };
  if (s.tilt.sensed && !s.tilt.sawUp && s.roomSec > 12) {
    return { id: "tilt", text: s.ceilingDone ? "Tilt up so we see this ceiling." : "Tilt up to the ceiling. Hold 3 s." };
  }
  if (s.sheet) return null;
  if (!s.mapped && s.coverage.supported && s.coverage.percent >= 40 && s.roomSec > 20) return { id: "gap", text: "Turn to film the gap in the ring." };
  return s.next ? { id: "next", text: `Next: ${s.next}` } : null;
}

// ---------- the 3D scan, assembling while you film ----------

export type Preview3d = {
  version: number;
  count: number;
  positions: Float32Array;
  colors: Uint8Array;
  views: number;
  framesSeen: number;
  wallsSeen: number;
  ceilingHeightM: number | null;
  widthM: number | null;
  depthM: number | null;
  rebuilding: boolean;
};

export function useLive3d(active: boolean, session: string) {
  const [preview, setPreview] = useState<Preview3d | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (!active) return;
    setPreview(null);
    setAvailable(true);
    let version = 0;
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        try {
          const res = await fetch(`/api/live/3d?session=${encodeURIComponent(session)}&since=${version}`, { cache: "no-store" });
          if (res.status === 404) {
            setAvailable(false); // no 3D service on this server
            return;
          }
          if (res.status === 200) {
            const buf = await res.arrayBuffer();
            const len = new DataView(buf).getUint32(0, true);
            const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
            const at = 4 + len;
            const positions = new Float32Array(buf.slice(at, at + meta.count * 12));
            const colors = new Uint8Array(buf.slice(at + meta.count * 12, at + meta.count * 15));
            version = meta.version;
            setPreview({ ...meta, positions, colors });
          }
        } catch {
          // Network blip: try again next round.
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [active, session]);

  return { preview, available };
}
