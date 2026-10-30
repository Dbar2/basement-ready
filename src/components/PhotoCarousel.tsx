// The wait screen for a photo take: the photos instead of a video. SAM reads them in order, and the
// carousel follows along, showing each photo with its finds boxed as soon as they land; once every
// photo is read it goes round them all. Tapping a photo holds it for a while.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { frameUrl, type Detection, type PhotoTake } from "../api";
import "../styles/photos.css";

type Props = {
  scanId: string;
  take: PhotoTake;
  detections: Detection[];
  landed: number[]; // photos whose finds are in, in the order they landed
  done: boolean;
};

const ROUND_MS = 3200; // each photo's turn once all are read
const HOLD_MS = 9000; // how long a tapped photo stays

// Where a picture shown with object-fit: contain actually sits in its box.
function fitted(box: { w: number; h: number }, img: { w: number; h: number }) {
  const k = Math.min(box.w / img.w, box.h / img.h);
  const w = img.w * k, h = img.h * k;
  return { left: (box.w - w) / 2, top: (box.h - h) / 2, width: w, height: h };
}

export function PhotoCarousel({ scanId, take, detections, landed, done }: Props) {
  const all = landed.length >= take.count;
  const [held, setHeld] = useState<{ n: number; until: number } | null>(null);
  const [turn, setTurn] = useState(0);
  // Going round, once all are read; a held photo pauses it.
  useEffect(() => {
    if (!all) return;
    const id = window.setInterval(() => setTurn((t) => t + 1), ROUND_MS);
    return () => clearInterval(id);
  }, [all]);
  useEffect(() => {
    if (!held) return;
    const id = window.setTimeout(() => setHeld(null), Math.max(0, held.until - Date.now()));
    return () => clearTimeout(id);
  }, [held]);
  // The photo whose finds landed last; the first one until any have.
  const current = held?.n ?? (all ? (landed.at(-1)! + 1 + turn) % take.count : (landed.at(-1) ?? 0));
  const read = new Set(landed);
  const roomOf = (n: number) => take.rooms.find((r) => n >= r.from && n < r.to)?.name ?? "";
  const boxes = detections.flatMap((d) => d.track.filter((t) => t[0] === current).map((t, i) => ({ key: `${d.id}-${i}`, d, x: t[1], y: t[2], w: t[3], h: t[4] })));
  const labels = [...new Set(boxes.map((b) => b.d.label))];

  // The picture's place in the stage, for the boxes.
  const stageRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ n: number; w: number; h: number } | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const place = natural?.n === current && stage ? fitted(stage, natural) : null;

  return (
    <div className="photo-carousel">
      <div className="photo-stage" ref={stageRef}>
        {/* The last photo stays up until the next one has loaded; its boxes wait for it too. */}
        <img
          src={frameUrl(scanId, current)}
          alt={`Photo ${current + 1} of ${take.count}${roomOf(current) ? `, ${roomOf(current)}` : ""}`}
          onLoad={(e) => setNatural({ n: current, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        {place && (
          <div className="photo-boxes" style={place} aria-hidden>
            {boxes.map((b) => (
              <span key={b.key} className="photo-box" data-kind={b.d.kind} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
                <b>{b.d.label}</b>
              </span>
            ))}
          </div>
        )}
        {!read.has(current) && !done && <div className="live-sweep" aria-hidden />}
      </div>
      <p className="live-caption" aria-live="polite">
        {`Photo ${current + 1} of ${take.count}${take.rooms.length > 1 ? ` · ${roomOf(current)}` : ""} · `}
        {read.has(current) ? (labels.length ? labels.join(", ") : "nothing to note") : "looking…"}
      </p>
      <ol className="photo-thumbs" aria-label="Your photos">
        {Array.from({ length: take.count }, (_, n) => (
          <li key={n}>
            <button
              aria-label={`Photo ${n + 1}, ${roomOf(n)}${read.has(n) ? "" : ", not read yet"}`}
              aria-current={n === current}
              data-read={read.has(n)}
              data-room-start={take.rooms.some((r) => r.from === n && n > 0)}
              onClick={() => setHeld({ n, until: Date.now() + HOLD_MS })}
            >
              <img src={frameUrl(scanId, n)} alt="" loading="lazy" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
