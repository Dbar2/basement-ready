// The few questions left after the video and public records: plain words, a tap to answer, and
// "Not sure" always allowed (then the designer checks it). The verdict re-checks on every answer.
import { useState } from "react";
import type { AnswerValue, Finding } from "../api";
import { parseLength } from "../units";

const YES_NO: { label: string; value: AnswerValue }[] = [
  { label: "Yes", value: true },
  { label: "No", value: false },
  { label: "Not sure", value: "unsure" },
];

function parseFor(f: Finding, text: string): number | null {
  if (f.check.unit === "m") return parseLength(text);
  if (f.check.unit === "mm") {
    const bare = Number(text.trim());
    if (Number.isFinite(bare) && bare >= 100 && bare <= 5000) return bare;
    const m = parseLength(text);
    return m == null ? null : Math.round(m * 1000);
  }
  const n = Number(text.trim().replace(/[^0-9.]/g, ""));
  return text.trim() && Number.isFinite(n) ? n : null;
}

function Question({ f, busy, onAnswer }: { f: Finding; busy: boolean; onAnswer: (value: AnswerValue) => void }) {
  const [text, setText] = useState("");
  const yesNo = f.options?.length || f.check.operator === "exists" || typeof f.check.value === "boolean";
  const parsed = yesNo ? null : parseFor(f, text);
  return (
    <li className="q-item">
      <div className="q-body">
        <p className="q">{f.question}</p>
        {f.hint && <p className="muted">{f.hint}</p>}
        {yesNo ? (
          <div className="q-actions">
            {(f.options ?? YES_NO).map((o) => (
              <button key={o.label} className="chip" disabled={busy} onClick={() => onAnswer(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <form
            className="q-actions"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed != null) onAnswer(parsed);
            }}
          >
            <input className="input q-input" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-label={f.title} />
            <button className="btn btn-primary q-save" disabled={busy || parsed == null}>
              {busy ? "Checking…" : "Check"}
            </button>
            <button type="button" className="chip" disabled={busy} onClick={() => onAnswer("unsure")}>
              Not sure
            </button>
          </form>
        )}
      </div>
    </li>
  );
}

export function Questions({ findings, busyRule, onAnswer }: { findings: Finding[]; busyRule: string | null; onAnswer: (ruleId: string, value: AnswerValue) => void }) {
  return (
    <ul className="ruled questions">
      {findings.map((f) => (
        <Question key={f.ruleId} f={f} busy={busyRule === f.ruleId} onAnswer={(v) => onAnswer(f.ruleId, v)} />
      ))}
    </ul>
  );
}

const said = (v: AnswerValue) => (v === "unsure" ? "Not sure" : v === true ? "Yes" : v === false ? "No" : String(v));

// What they told us, so a wrong answer is one tap to undo.
export function Answered({ findings, busyRule, onClear }: { findings: Finding[]; busyRule: string | null; onClear: (ruleId: string) => void }) {
  if (!findings.length) return null;
  return (
    <ul className="ruled answered">
      {findings.map((f) => (
        <li key={f.ruleId}>
          <span className="fit-dot" data-ok={f.status === "likely_ok"} aria-hidden />
          <div>
            <b>{f.question ?? f.title}</b> <span className="muted">You said: {said(f.answer!.value)}</span>
          </div>
          <button className="link-quiet" disabled={busyRule === f.ruleId} onClick={() => onClear(f.ruleId)}>
            Change
          </button>
        </li>
      ))}
    </ul>
  );
}
