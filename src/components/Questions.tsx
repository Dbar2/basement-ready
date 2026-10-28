// "What we couldn't see": each question takes the answer it needs, and the verdict re-checks.
import { useState } from "react";
import type { Finding } from "../api";
import { parseLength } from "../units";

type Value = number | boolean | null;

function kindOf(f: Finding): "yesno" | "length" | "number" {
  const c = f.check;
  if (c.operator === "exists" || typeof c.value === "boolean") return "yesno";
  if (c.unit === "m" || c.unit === "mm") return "length";
  return "number";
}

const UNIT_HINT: Record<string, string> = { m2: "m²", units: "homes", spaces: "spaces", STC: "STC" };

function parseFor(f: Finding, text: string): number | null {
  if (f.check.unit === "m") return parseLength(text);
  if (f.check.unit === "mm") {
    const bare = Number(text.trim());
    if (Number.isFinite(bare) && bare >= 100 && bare <= 5000) return bare; // already millimetres
    const m = parseLength(text);
    return m == null ? null : Math.round(m * 1000);
  }
  const n = Number(text.trim().replace(/[^0-9.]/g, ""));
  return text.trim() && Number.isFinite(n) ? n : null;
}

function Question({ f, busy, onAnswer }: { f: Finding; busy: boolean; onAnswer: (value: Value) => void }) {
  const kind = kindOf(f);
  const [text, setText] = useState("");
  const parsed = kind === "yesno" ? null : parseFor(f, text);
  const placeholder = f.check.unit === "m" ? "e.g. 2.05 m or 6' 9\"" : f.check.unit === "mm" ? "e.g. 600 mm or 24\"" : `number of ${UNIT_HINT[f.check.unit ?? ""] ?? "units"}`;

  return (
    <li className="q-item">
      <span className="tag-mono">{f.measured ? "Close call" : f.status === "needs_measurement" ? "Tape measure" : "Question"}</span>
      <div className="q-body">
        <p className="q">{f.question}</p>
        <p className="muted">{f.title}</p>
        {kind === "yesno" ? (
          <div className="q-actions">
            <button className="chip" disabled={busy} onClick={() => onAnswer(true)}>Yes</button>
            <button className="chip" disabled={busy} onClick={() => onAnswer(false)}>No</button>
          </div>
        ) : (
          <form
            className="q-actions"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed != null) onAnswer(parsed);
            }}
          >
            <input className="input q-input" inputMode="decimal" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label={f.title} />
            <button className="btn btn-primary q-save" disabled={busy || parsed == null}>
              {busy ? "Checking…" : "Check"}
            </button>
            {text && parsed == null && <span className="q-hint">We couldn't read that.</span>}
          </form>
        )}
      </div>
    </li>
  );
}

export function Questions({ findings, busyRule, onAnswer }: { findings: Finding[]; busyRule: string | null; onAnswer: (ruleId: string, value: Value) => void }) {
  return (
    <ul className="ruled questions">
      {findings.map((f) => (
        <Question key={f.ruleId} f={f} busy={busyRule === f.ruleId} onAnswer={(v) => onAnswer(f.ruleId, v)} />
      ))}
    </ul>
  );
}

// Answered questions, so a wrong answer is one tap to undo.
export function Answered({ findings, busyRule, onClear }: { findings: Finding[]; busyRule: string | null; onClear: (ruleId: string) => void }) {
  if (!findings.length) return null;
  return (
    <ul className="ruled answered">
      {findings.map((f) => (
        <li key={f.ruleId}>
          <span className="fit-dot" data-ok={f.status === "likely_ok"} aria-hidden />
          <div>
            <b>{f.title}</b> <span className="muted">{f.why}</span>
          </div>
          <button className="link-quiet" disabled={busyRule === f.ruleId} onClick={() => onClear(f.ruleId)}>
            Change
          </button>
        </li>
      ))}
    </ul>
  );
}
