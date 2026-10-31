// Live guidance while filming: SAM finds, on-phone coaching and the 3D assembling on the server.
// Everything here is best-effort: if a sensor or the network isn't there, recording still works.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Need } from "./script";
import { lookOf, type Look } from "./rooms";
import type { LiveMap } from "./map";

// ---------- live finds (SAM 3.1 on one frame at a time) ----------

// server/live.ts LIVE_CONCEPTS. SAM can't find a furnace, a rough-in or a bulkhead by name, so they aren't
// asked for live; the scan finds them by pointing (server/pointFinds.ts).
export type FindKey = "stairs" | "window" | "panel" | "door" | "duct" | "beam" | "drain" | "heater";

// Which checklist step each find ticks. The panel or the water heater means the furnace room is in view.
export const FIND_TICKS: Partial<Record<FindKey, Need>> = {
  stairs: "stairs",
  window: "windows",
  panel: "furnace",
  heater: "furnace",
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
  // How wide the widest door in each answer was (0 for none): a doorway helps mark where one part of
  // the basement gives way to another.
  onDoor?: (sec: number, width: number) => void;
}) {
  const { active, session, videoRef, headingRef, startedAt } = opts;
  const onDoorRef = useRef(opts.onDoor);
  onDoorRef.current = opts.onDoor;
  const [finds, setFinds] = useState<LiveFind[]>([]);
  const [flash, setFlash] = useState<{ find: LiveFind; heading: number | null; seq: number } | null>(null);
  const [offline, setOffline] = useState(false);
  const findsRef = useRef<LiveFind[]>([]);
  findsRef.current = finds;

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
    let spent = false;

    // Doors every round (they mark a way through), then what's still missing, then an extra.
    const plan = (): FindKey[] => {
      const have = new Set(findsRef.current.map((f) => f.key));
      const missing = (["stairs", "window", "panel"] as FindKey[]).filter((k) => !have.has(k));
      // Beams are left to the full scan: live, they matched furniture in a finished basement. The
      // drain and the water heater are what the guide talks about, so they're asked for in turn too.
      const extras: FindKey[] = ["window", "drain", "heater", "duct", "panel"];
      const extra = extras[turn++ % extras.length];
      return [...new Set<FindKey>(["door", ...missing.slice(0, 1), extra, ...missing.slice(1)])].slice(0, 3);
    };
    const tick = async () => {
      while (!stopped) {
        const video = videoRef.current;
        const frame = video ? grab(video) : null;
        const heading = headingRef.current;
        if (frame) {
          const blob: Blob | null = await new Promise((r) => frame.toBlob(r, "image/jpeg", 0.85));
          if (blob && !stopped) {
            const form = new FormData();
            form.append("frame", blob, "frame.jpg");
            form.append("session", session);
            form.append("concepts", JSON.stringify(spent ? ["door"] : plan()));
            // The compass when this frame was taken: the live map turns its camera marker with it.
            if (heading != null) form.append("heading", heading.toFixed(1));
            try {
              const res = await fetch("/api/live/detect", { method: "POST", body: form });
              if (res.status === 429) {
                const { error } = await res.json().catch(() => ({ error: "" }));
                // Out of live finds for this take (the full scan still runs afterwards). Frames keep
                // going, so the map keeps building.
                if (error !== "slow down") {
                  setOffline(true);
                  spent = true;
                }
              } else if (res.ok) {
                failures = 0;
                const { finds: got } = (await res.json()) as { finds: { key: FindKey; label: string; boxes: LiveBox[] }[] };
                onDoorRef.current?.(
                  (performance.now() - startedAt) / 1000,
                  Math.max(0, ...got.filter((f) => f.key === "door").flatMap((f) => f.boxes.map((b) => b.w))),
                );
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
  }, [active, session, videoRef, headingRef, startedAt]);

  return { finds, flash, offline };
}

// ---------- coaching that runs on the phone ----------

export type Coach = { id: "dark" | "fast"; text: string } | null;
// The latest look at the picture, for painting coverage only while it's any use, and for the wide shot.
export type Steadiness = { bright: boolean; steady: boolean; still: boolean };

const DARK_LUMA = 42;
const FAST_DEG_PER_S = 75;
// Held still: barely turning, by the gyro; without one, a picture that hardly changes.
const STILL_DEG_PER_S = 12;
const STILL_DIFF = 6;
// The colour signature for spotting another part of the basement, every third look (1.2 s).
const LOOK_EVERY = 3;

export function useCoaching(active: boolean, videoRef: RefObject<HTMLVideoElement | null>, onLook?: (sec: number, look: Look) => void, startedAt = 0) {
  const [issue, setIssue] = useState<Coach>(null);
  const stateRef = useRef<Steadiness>({ bright: true, steady: true, still: false });
  const onLookRef = useRef(onLook);
  onLookRef.current = onLook;

  useEffect(() => {
    stateRef.current = { bright: true, steady: true, still: false };
    if (!active) {
      setIssue(null);
      return;
    }
    let spin = 0;
    let gyro = false;
    const onMotion = (e: DeviceMotionEvent) => {
      const r = e.rotationRate;
      if (!r || r.alpha == null) return;
      gyro = true;
      spin = Math.max(spin * 0.8, Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0));
    };
    window.addEventListener("devicemotion", onMotion);

    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    let prev: Uint8ClampedArray | null = null;
    let shown: Coach = null;
    let shownAt = 0;
    let looks = 0;

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
      const first = !prev;
      prev = px;
      if (++looks % LOOK_EVERY === 0) onLookRef.current?.((performance.now() - startedAt) / 1000, lookOf(px));
      // Gyro when we have it; otherwise how much the picture changed since the last look.
      const fast = gyro ? spin > FAST_DEG_PER_S : !first && diff > 50;
      const still = gyro ? spin < STILL_DEG_PER_S : !first && diff < STILL_DIFF;
      stateRef.current = { bright: luma >= DARK_LUMA, steady: !fast, still };
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
  }, [active, videoRef, startedAt]);

  return { issue, stateRef };
}

// ---------- the 3D scan, assembling while you film ----------

export type Preview3d = {
  version: number;
  count: number;
  positions: Float32Array;
  colors: Uint8Array;
  pointViews: Uint8Array; // which of the rebuild's views each point came from
  views: number;
  framesSeen: number;
  ceilingHeightM: number | null;
  widthM: number | null;
  depthM: number | null;
  rebuilding: boolean;
  map: LiveMap | null; // where the camera stood, the room box and its unfilmed sides
  at: number; // performance.now() when it arrived
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
            const pointViews = new Uint8Array(buf.slice(at + meta.count * 15, at + meta.count * 16));
            version = meta.version;
            setPreview({ ...meta, map: meta.map ?? null, positions, colors, pointViews, at: performance.now() });
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
