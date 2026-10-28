// The find outline: mint corner ticks round what SAM just found, on the live picture.
import { useEffect, useState, type RefObject } from "react";
import type { LiveFind } from "./live";

const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// Outlines the find on the live picture, but only while the phone still points where it was found.
export function FindFlash({
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
