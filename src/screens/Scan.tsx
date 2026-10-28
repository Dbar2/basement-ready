import { useState } from "react";
import { findings, REVEAL_SECONDS, scanLog } from "../data/sampleBasement";
import { Logo } from "../components/Logo";
import { ScanStage } from "../three/ScanStage";

const STATUS_TEXT = { ok: "OK", fix: "Fix", check: "Check" } as const;

export function Scan({ onDone }: { onDone: () => void }) {
  const [t, setT] = useState(0);
  const log = scanLog.filter((l) => t >= l.at).slice(-4);
  const found = findings.filter((f) => t >= f.at);
  const finished = t >= REVEAL_SECONDS;

  return (
    <main className="scan">
      <ScanStage mode="reveal" onTime={setT} />

      <div className="scan-top">
        <Logo />
        <div className="scan-progress" aria-label="Scan progress">
          <span style={{ width: `${Math.min(100, (t / REVEAL_SECONDS) * 100)}%` }} />
        </div>
      </div>

      <aside className="scan-finds" aria-live="polite">
        <h3>What we found</h3>
        {found.length === 0 && <p className="mono" style={{ margin: 0 }}>Looking…</p>}
        {found.map((f) => (
          <div className="find-row" key={f.id} data-kind={f.kind}>
            <span className="find-dot" />
            <span>
              <div className="name">{f.label}</div>
              <div className="measure">{f.measure}</div>
            </span>
            <span className="status" data-status={f.status}>{STATUS_TEXT[f.status]}</span>
          </div>
        ))}
      </aside>

      <div className="scan-log" aria-live="polite">
        {log.map((l) => <p key={l.text}>{l.text}</p>)}
      </div>

      {finished && (
        <button className="btn btn-primary scan-next" onClick={onDone}>
          See the answer
        </button>
      )}
    </main>
  );
}
