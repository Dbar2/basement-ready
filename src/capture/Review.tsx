// Play the take back, then use it or film again.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CHECKLIST, MIN_SEC, type ChecklistId } from "./checklist";
import { CornerTicks, Dimension, Icon } from "./drawing";
import { formatBytes, formatLabel, formatTime, settleDuration } from "./media";

export type Take = {
  file: File;
  durationSec: number;
  checklist: ChecklistId[];
  source: "camera" | "upload";
  note?: "max" | "interrupted" | "short";
};

type Props = { take: Take; busy: boolean; onUse: () => void; onRetake: () => void; onClose: () => void };

const NOTES = {
  max: "We stopped at 2 minutes, the most we can check.",
  interrupted: "Filming stopped when the camera was interrupted. What you got is long enough to use.",
  short: `This video is under ${MIN_SEC} seconds, so we may miss things. A longer walk-through helps.`,
};

function missedNote(ids: ChecklistId[]) {
  if (ids.length === 1 && ids[0] === "door") return "You didn't tick an outside door. That's fine if there isn't one.";
  const names = CHECKLIST.filter((c) => ids.includes(c.id)).map((c) => c.short);
  return `Not ticked: ${names.join(", ")}. If you skipped something by accident, a retake helps us check more.`;
}

export function Review({ take, busy, onUse, onRetake, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(take.durationSec);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [unplayable, setUnplayable] = useState(false);

  useEffect(() => {
    const u = URL.createObjectURL(take.file);
    setUrl(u);
    setUnplayable(false);
    setTime(0);
    setPlaying(false);
    return () => URL.revokeObjectURL(u);
  }, [take.file]);

  const fromCamera = take.source === "camera";
  const missed = CHECKLIST.filter((c) => !take.checklist.includes(c.id));
  const length = duration || take.durationSec;

  const toggle = () => {
    const v = videoRef.current;
    if (!v || unplayable) return;
    if (v.paused) void v.play().catch(() => setUnplayable(true));
    else v.pause();
  };

  return (
    <div className="cap-review">
      <header className="cap-page-bar">
        <span className="cap-eyebrow">Review</span>
        <button className="cap-icon-btn" aria-label="Close" onClick={onClose}>
          <Icon.close />
        </button>
      </header>

      <div className="cap-review-stage" style={dims ? ({ "--ar": String(dims.w / dims.h) } as CSSProperties) : undefined}>
        <div className="cap-frame">
          {url && (
            <video
              ref={videoRef}
              className="cap-video cap-video--review"
              src={url}
              playsInline
              preload="metadata"
              aria-label="Your video"
              onClick={toggle}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setDims({ w: v.videoWidth, h: v.videoHeight });
                void settleDuration(v).then((d) => d > 0 && setDuration(d));
              }}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => setUnplayable(true)}
            />
          )}
          <CornerTicks />
          {length > 0 && <Dimension className="cap-dim--under" label={formatTime(length)} />}
          {unplayable && <p className="cap-plate cap-plate--center">This browser can't play this file, but we can still check it.</p>}
        </div>
      </div>

      <div className="cap-player" data-hidden={unplayable}>
        <button className="cap-icon-btn cap-icon-btn--solid" onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={unplayable}>
          {playing ? <Icon.pause /> : <Icon.play />}
        </button>
        <input
          className="cap-scrub"
          type="range"
          min={0}
          max={length || 1}
          step={0.1}
          value={Math.min(time, length || 1)}
          aria-label="Position"
          aria-valuetext={`${formatTime(time)} of ${formatTime(length)}`}
          disabled={unplayable}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = Number(e.target.value);
            setTime(Number(e.target.value));
          }}
        />
        <span className="cap-player-time">
          {formatTime(time)} / {formatTime(length)}
        </span>
      </div>

      <div className="cap-review-body">
        <h1 className="cap-title cap-title--sm" data-focus tabIndex={-1}>
          {fromCamera ? "Check your take." : "Check your video."}
        </h1>
        <dl className="cap-facts">
          <div>
            <dt>Length</dt>
            <dd>{length > 0 ? formatTime(length) : "Unknown"}</dd>
          </div>
          {fromCamera && (
            <div>
              <dt>Ticked</dt>
              <dd>
                {take.checklist.length} of {CHECKLIST.length}
              </dd>
            </div>
          )}
          <div>
            <dt>File</dt>
            <dd>
              {formatBytes(take.file.size)} · {formatLabel(take.file.type)}
            </dd>
          </div>
        </dl>
        {take.note && <p className="cap-note">{NOTES[take.note]}</p>}
        {fromCamera && missed.length > 0 && <p className="cap-note">{missedNote(missed.map((m) => m.id))}</p>}
      </div>

      <div className="cap-page-actions">
        <button className="cap-btn cap-btn--primary" onClick={onUse} disabled={busy}>
          Use this video <Icon.arrow />
        </button>
        <button className="cap-btn cap-btn--ghost" onClick={onRetake} disabled={busy}>
          {busy ? "Starting the camera…" : fromCamera ? "Retake" : "Choose another"}
        </button>
      </div>
    </div>
  );
}
