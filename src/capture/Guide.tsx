// What sits on the camera while filming, besides the coverage panel: the guide's voice line on top,
// and one arrow toward the part of the basement that isn't filmed yet.
import type { Tilt, Turn } from "./paint";

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

// One arrow: turn, or tilt, or both; and what's missing over there, in words.
export function TurnHint({ turn, tilt, what }: { turn: Turn | null; tilt: Tilt | null; what: string | null }) {
  if (!turn && !tilt) return null;
  const verb = turn ? (turn === "around" ? "Turn around" : `Turn ${turn}`) : `Tilt ${tilt}`;
  const label = turn && tilt ? `${verb}, then tilt ${tilt}` : verb;
  const at = turn === "around" ? "around" : turn ?? tilt!;
  return (
    <div className="guide-turn" data-dir={at} role="img" aria-label={what ? `${label}: ${what} isn't filmed` : label}>
      <svg viewBox="0 0 64 64" aria-hidden>
        {turn === "around" ? (
          <path d="M44 20a16 16 0 1 0 4 14M44 8v12H32" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M40 10L18 32l22 22M20 32h34" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      <span>
        <b>{label}</b>
        {what && <em>{what} isn't filmed</em>}
      </span>
    </div>
  );
}
