// What sits on the camera while filming (brand/explorations/M1-filming-guides.png): the guide's
// voice line on top, one task card below, a small 3D room that fills in wall by wall, and an arrow
// toward the part of the room that isn't filmed yet.
import type { ReactNode } from "react";
import { NEEDS, type Need } from "./script";

// The voice line, with bars that move while it speaks.
export function VoiceBubble({ text, speaking, muted, onMute }: { text: string | null; speaking: boolean; muted: boolean; onMute: () => void }) {
  if (!text) return null;
  return (
    <div className="guide-voice" data-speaking={speaking}>
      <button className="guide-voice-icon" onClick={onMute} aria-label={muted ? "Turn the guide's voice on" : "Mute the guide's voice"} aria-pressed={muted}>
        {muted ? (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <span className="guide-bars" aria-hidden>
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
      </button>
      <p key={text} role="status">
        {text}
      </p>
    </div>
  );
}

export function TaskCard(props: { title: string; done: Need[]; children?: ReactNode; notice?: ReactNode }) {
  const { title, done, children, notice } = props;
  return (
    <div className="guide-card">
      {notice}
      <h2 className="guide-task" key={title} data-focus tabIndex={-1}>
        {title}
      </h2>
      {children}
      <div className="guide-progress" aria-label={`${done.length} of ${NEEDS.length} things shown`}>
        <span className="guide-dots" aria-hidden>
          {NEEDS.map((n) => (
            <i key={n.id} data-done={done.includes(n.id)} title={n.label} />
          ))}
        </span>
        <span className="guide-count">
          {done.length} of {NEEDS.length}
        </span>
      </div>
    </div>
  );
}

export function TurnHint({ dir }: { dir: "left" | "right" | "around" | null }) {
  if (!dir) return null;
  const label = dir === "around" ? "Turn around" : `Turn ${dir}`;
  return (
    <div className="guide-turn" data-dir={dir} role="img" aria-label={label}>
      <svg viewBox="0 0 64 64" aria-hidden>
        {dir === "around" ? (
          <path d="M44 20a16 16 0 1 0 4 14M44 8v12H32" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M40 10L18 32l22 22M20 32h34" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      <span>{label}</span>
    </div>
  );
}

// The room in miniature, seen from above at an angle. Each wall fills with dots once the phone has
// pointed at it; walls not filmed yet stay dashed. The cone is where the phone points now.
export function MiniRoom(props: { covered: boolean[]; heading: number | null; start: number | null; label: string; onOpen?: () => void }) {
  const { covered, heading, start, label, onOpen } = props;
  const n = covered.length;
  // Wall k faces start + k·90°: 0 ahead of where you started, 1 to the right, 2 behind, 3 left.
  const wallCover = [0, 1, 2, 3].map((k) => {
    if (start == null) return 0;
    let hit = 0, all = 0;
    for (let b = 0; b < n; b++) {
      const deg = (b + 0.5) * (360 / n);
      const rel = (deg - start + 405) % 360; // shift so each wall's 90° slice starts at 0
      if (Math.floor(rel / 90) === k) {
        all++;
        if (covered[b]) hit++;
      }
    }
    return all ? hit / all : 0;
  });
  // Plan coordinates (x right, z ahead) to the drawing, at a 30° angle.
  const P = (x: number, z: number, y = 0) => [60 + (x - z) * 26, 66 + (x + z) * 13 - y * 30] as const;
  const wall = (k: number) => {
    const ends = [
      [[-1, 1], [1, 1]],
      [[1, 1], [1, -1]],
      [[1, -1], [-1, -1]],
      [[-1, -1], [-1, 1]],
    ][k];
    const [a, b] = ends;
    return [P(a[0], a[1]), P(b[0], b[1]), P(b[0], b[1], 1), P(a[0], a[1], 1)].map((p) => p.join(",")).join(" ");
  };
  const cone = (() => {
    if (heading == null || start == null) return null;
    const a = ((heading - start) * Math.PI) / 180;
    const tip = P(0, 0, 0.35);
    const spread = 0.45;
    const l = P(Math.sin(a - spread) * 0.8, Math.cos(a - spread) * 0.8, 0.35);
    const r = P(Math.sin(a + spread) * 0.8, Math.cos(a + spread) * 0.8, 0.35);
    return `${tip.join(",")} ${l.join(",")} ${r.join(",")}`;
  })();
  // Far walls first, so the near ones sit in front.
  const order = [0, 3, 1, 2];
  return (
    <button className="guide-room" onClick={onOpen} aria-label={`${label}: ${wallCover.filter((c) => c >= 0.6).length} of 4 walls filmed${onOpen ? ". Open the 3D scan" : ""}`}>
      <svg viewBox="0 0 120 100" aria-hidden>
        <defs>
          <pattern id="guide-dots" width="4" height="4" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.05" className="guide-dot" />
          </pattern>
        </defs>
        <polygon points={[P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)].map((p) => p.join(",")).join(" ")} className="guide-floor" />
        {order.map((k) => (
          <polygon key={k} points={wall(k)} className="guide-wall" data-filmed={wallCover[k] >= 0.6} data-near={k === 1 || k === 2} />
        ))}
        {cone && <polygon points={cone} className="guide-cone" />}
      </svg>
      <span className="guide-room-label">{label}</span>
    </button>
  );
}
