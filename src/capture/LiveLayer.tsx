// What sits on top of the camera while recording: the room you're in, one line of coaching,
// the find outline, and the "room mapped" sheet. Drawing language: corner ticks, hairlines, mono labels.
import { useEffect, useState, type RefObject } from "react";
import type { Coach, LiveFind } from "./live";

const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// Outlines the find on the live picture, but only while the phone still points where it was found.
function FindFlash({
  flash,
  videoRef,
  heading,
}: {
  flash: { find: LiveFind; heading: number | null; seq: number } | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  heading: number | null;
}) {
  const [visible, setVisible] = useState<typeof flash>(null);
  useEffect(() => {
    if (!flash) return;
    setVisible(flash);
    const id = window.setTimeout(() => setVisible(null), 1600);
    return () => clearTimeout(id);
  }, [flash]);

  const v = videoRef.current;
  if (!visible || !v?.videoWidth) return null;
  if (visible.heading != null && heading != null && angleGap(visible.heading, heading) > 10) return null;

  // The video fills the frame with object-fit: cover, so map frame fractions through that crop.
  const cw = v.clientWidth, ch = v.clientHeight;
  const scale = Math.max(cw / v.videoWidth, ch / v.videoHeight);
  const dx = (cw - v.videoWidth * scale) / 2, dy = (ch - v.videoHeight * scale) / 2;
  const { box, label } = visible.find;
  const style = {
    left: dx + box.x * v.videoWidth * scale,
    top: dy + box.y * v.videoHeight * scale,
    width: box.w * v.videoWidth * scale,
    height: box.h * v.videoHeight * scale,
  };
  return (
    <div key={visible.seq} className="cap-flash" style={style} aria-hidden>
      <i data-c="tl" />
      <i data-c="tr" />
      <i data-c="bl" />
      <i data-c="br" />
      <span className="cap-flash-label">{label}</span>
    </div>
  );
}

// The room so far, drawn like the plan it will become: a rectangle with its sizes.
function MiniPlan({ widthM, depthM }: { widthM: number; depthM: number }) {
  const w = 150, h = 84;
  const k = Math.min((w - 16) / widthM, (h - 22) / depthM);
  const rw = widthM * k, rh = depthM * k;
  const x = (w - rw) / 2, y = 4;
  return (
    <svg className="room-done-plan" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <rect x={x} y={y} width={rw} height={rh} pathLength={1} />
      <path d={`M${x} ${y + rh + 9}h${rw}M${x} ${y + rh + 5}v8M${x + rw} ${y + rh + 5}v8`} className="room-done-dim" />
    </svg>
  );
}

export function RoomDone(props: {
  name: string;
  size: { widthM: number; depthM: number } | null;
  canAddRoom: boolean;
  onNext: () => void;
  onDone: () => void;
  onKeep: () => void;
}) {
  const { name, size, canAddRoom, onNext, onDone, onKeep } = props;
  return (
    <div className="room-done" role="status">
      <p className="room-done-title">
        <b>{name} mapped</b>
        <button className="room-done-keep" onClick={onKeep}>
          Keep filming
        </button>
      </p>
      {size && (
        <>
          <MiniPlan widthM={size.widthM} depthM={size.depthM} />
          <p className="room-done-size">
            {size.widthM.toFixed(1)} × {size.depthM.toFixed(1)} m <span>est.</span>
          </p>
        </>
      )}
      <div className="room-done-actions">
        {canAddRoom && (
          <button className="cap-btn cap-btn--primary" onClick={onNext}>
            Next room
          </button>
        )}
        <button className="cap-btn cap-btn--ghost" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export function LiveLayer(props: {
  videoRef: RefObject<HTMLVideoElement | null>;
  flash: { find: LiveFind; heading: number | null; seq: number } | null;
  heading: number | null;
  room: string | null;
  line: Coach;
}) {
  const { videoRef, flash, heading, room, line } = props;
  return (
    <>
      <FindFlash flash={flash} videoRef={videoRef} heading={heading} />
      <div className="cap-top">
        {room && <span className="cap-room">{room}</span>}
        {line && (
          <p className="cap-coach" data-kind={line.id} role="status" key={line.text}>
            {line.text}
          </p>
        )}
      </div>
    </>
  );
}
