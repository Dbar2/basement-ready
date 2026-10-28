import { useEffect, useState } from "react";
import { ANALYSIS_FPS, answerQuestion, frameUrl, getScan, type Detection, type ScanResult } from "../api";
import { Answered, Questions } from "../components/Questions";
import { AccountNav, SaveCta } from "../auth";
import { Logo } from "../components/Logo";
import { SiteFooter } from "../marketing/parts";
import { ScanViews } from "../components/ScanViews";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const two = (n: number) => String(n).padStart(2, "0");

const FIT_TEXT = { fits: "Fits your plan", depends: "Depends", no: "Doesn't fit", cancelled: "Cancelled" } as const;

function Proof({ scanId, d }: { scanId: string; d: Detection }) {
  return (
    <figure className="proof">
      <img src={frameUrl(scanId, d.frame)} alt={`${d.label} in your video at ${d.seconds.toFixed(1)} seconds`} loading="lazy" />
      <span
        className="proof-box"
        style={{ left: `${d.box.x * 100}%`, top: `${d.box.y * 100}%`, width: `${d.box.w * 100}%`, height: `${d.box.h * 100}%` }}
      />
      <figcaption className="mono">{d.label} · {d.seconds.toFixed(1)} s</figcaption>
    </figure>
  );
}

export function Result({ scanId, onRestart }: { scanId: string; onRestart: () => void }) {
  const [r, setR] = useState<ScanResult | null>(null);
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const [changes, setChanges] = useState<{ before: string; after: string; lines: string[] } | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  // The sample isn't saved anywhere, so its answers live here.
  const [sampleAnswers, setSampleAnswers] = useState<Record<string, number | boolean | null>>({});
  useEffect(() => {
    getScan(scanId).then((s) => setR(s.result));
  }, [scanId]);

  const answer = async (ruleId: string, value: number | boolean | null) => {
    if (!r) return;
    setBusyRule(ruleId);
    setAnswerError(null);
    try {
      const next = await answerQuestion(scanId, r, sampleAnswers, ruleId, value);
      if (scanId === "sample") setSampleAnswers((a) => ({ ...a, [ruleId]: value }));
      // Say what moved, in plain words.
      const STATUS = { likely_ok: "looks right", likely_fix: "needs work", needs_measurement: "needs a measurement", needs_answer: "needs an answer" } as const;
      const lines = next.findings
        .filter((f) => r.findings.find((o) => o.ruleId === f.ruleId)?.status !== f.status)
        .map((f) => `${f.title} → ${STATUS[f.status]}`);
      setChanges({ before: r.headline, after: next.headline, lines });
      setR(next);
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : "We couldn't check that.");
    } finally {
      setBusyRule(null);
    }
  };

  if (!r) return <main className="result-loading"><Logo /></main>;

  const byId = new Map(r.detections.map((d) => [d.id, d]));
  const questions = r.findings.filter((f) => (f.status === "needs_measurement" || f.status === "needs_answer") && !f.answer);
  const answered = r.findings.filter((f) => f.answer && f.answer.outcome !== "unknown");
  const fine = r.findings.filter((f) => f.status === "likely_ok" && !f.answer);
  // Filmed room by room, the rules use one room's numbers: say which.
  const mainRoomName = (r.rooms?.length ?? 0) > 1 ? r.rooms!.find((x) => x.index === r.mainRoom)?.name : undefined;
  const grants = [...r.grants].sort((a, b) => ["fits", "depends", "no", "cancelled"].indexOf(a.fit) - ["fits", "depends", "no", "cancelled"].indexOf(b.fit));

  return (
    <main className="result" data-verdict={r.verdict}>
      <header className="nav">
        <Logo />
        <span className="nav-right">
          <button className="link-quiet" onClick={onRestart}>New scan</button>
          <AccountNav />
        </span>
      </header>

      <section className="verdict-hero">
        <div>
          <p className="eyebrow">Your basement · {r.city ?? "Waterloo"} · {r.route === "second_unit" ? "Second unit route" : "Basement finish route"}</p>
          {r.coverage === "provincial" && <p className="note-inline">We haven't researched your city's own rules yet, so this uses Ontario's building code. Confirm zoning with your city.</p>}
          {changes && (
            <div className="changed" role="status" key={changes.after + changes.lines.join()}>
              <b>{changes.before === changes.after ? "Re-checked with your answer." : "Updated from your answer."}</b>
              {changes.lines.length > 0 && <span> {changes.lines.join(" · ")}</span>}
            </div>
          )}
          <h1 key={r.headline} className="verdict-line">{r.headline}</h1>
          <p className="summary">{r.summary}</p>
          {r.wants && <blockquote>“{r.wants}”</blockquote>}
          {scanId !== "sample" && <SaveCta />}
        </div>
        <dl className="verdict-stats">
          <div>
            <dt>Rough cost of the fixes</dt>
            <dd className="mono">{r.cost.pricedFixes ? `${money(r.cost.low)}–${money(r.cost.high)}` : "To be priced"}</dd>
          </div>
          {r.cost.pricedFixes > 0 && r.cost.unpricedFixes > 0 && (
            <p className="cost-note">+ {r.cost.unpricedFixes} more to be quoted by a builder</p>
          )}
          {r.measurements?.ceilingHeightM != null && (
            <div>
              <dt>Measured by the 3D scan{mainRoomName && ` · ${mainRoomName}`}</dt>
              <dd className="mono">
                {r.measurements.ceilingHeightM.toFixed(2)} m ceiling
                {r.measurements.widthM != null && r.measurements.depthM != null && ` · ${r.measurements.widthM.toFixed(1)} × ${r.measurements.depthM.toFixed(1)} m`}
                {r.measurements.trusted === false ? " (rough)" : r.measurements.scaleSource === "model" && " (est.)"}
              </dd>
            </div>
          )}
          <div>
            <dt>Things to fix</dt>
            <dd className="mono">{r.fixGroups.length}</dd>
          </div>
          <div>
            <dt>Questions for you</dt>
            <dd className="mono">{questions.length}</dd>
          </div>
        </dl>
      </section>

      <ScanViews scanId={scanId} plan={r.plan ?? null} has3d={Boolean(r.has3d)} rooms={r.rooms} mainRoom={r.mainRoom} />

      <section className="block">
        <h2>What you want</h2>
        {r.vision && (r.vision.rooms.length > 0 || r.vision.style || r.vision.mustHaves.length > 0) ? (
          <>
            <p className="lede">From what you said while filming. Your layouts and renders are planned around this.</p>
            <ul className="ruled wishes">
              {r.vision.rooms.map((w, i) => (
                <li key={`${w.room}-${i}`}>
                  {w.atSeconds != null && (
                    <figure className="proof">
                      <img src={frameUrl(scanId, Math.round(w.atSeconds * ANALYSIS_FPS))} alt={`What you were looking at when you said "${w.room}"`} loading="lazy" />
                      <figcaption className="mono">{w.atSeconds.toFixed(1)} s</figcaption>
                    </figure>
                  )}
                  <div>
                    <h3>{w.room}</h3>
                    {w.where && <p className="muted">{w.where}</p>}
                    {w.quote && <p className="quote">“{w.quote}”</p>}
                  </div>
                </li>
              ))}
            </ul>
            {(r.vision.style || r.vision.mustHaves.length > 0) && (
              <p className="wish-tags">
                {r.vision.style && <span className="tag-mono">Feel: {r.vision.style}</span>}
                {r.vision.mustHaves.map((m) => (
                  <span key={m} className="tag-mono">{m}</span>
                ))}
              </p>
            )}
          </>
        ) : (
          <p className="lede">
            We didn't hear any plans in this video. Next time, talk as you film: “Kitchen here, Mom's room here, bright and
            simple.” We'll plan the layouts and renders around what you say, right where you say it.
          </p>
        )}
      </section>

      {r.fixGroups.length > 0 && (
        <section className="block">
          <h2>What has to change</h2>
          <ol className="ruled">
            {r.fixGroups.map((g, i) => (
              <li key={g.category} className="fix">
                <span className="num mono">{two(i + 1)}</span>
                <div className="fix-body">
                  <h3>{g.title}</h3>
                  {g.why.map((w) => <p key={w}>{w}</p>)}
                  <p className="fix-do">{g.description}</p>
                  <p className="sources">
                    {g.sources.slice(0, 2).map((s) => (
                      <a key={s.url + s.section} href={s.url} target="_blank" rel="noreferrer">{s.section ? `${s.title}, ${s.section}` : s.title}</a>
                    ))}
                  </p>
                </div>
                <div className="fix-proof">
                  {g.evidence.slice(0, 2).map((id) => byId.get(id)).filter(Boolean).map((d) => <Proof key={d!.id} scanId={scanId} d={d!} />)}
                </div>
                <span className="cost mono">{g.costLow != null ? `${money(g.costLow)}–${money(g.costHigh!)}` : "Price on quote"}</span>
              </li>
            ))}
          </ol>
          <p className="note">Rough estimates from Ontario contractor sources, not a quote. A designer or builder will confirm.</p>
        </section>
      )}

      {(questions.length > 0 || answered.length > 0) && (
        <section className="block" id="questions">
          <h2>What we couldn't see</h2>
          <p className="lede">We don't guess. Answer what you know and the verdict re-checks against {r.city ?? "your city"}'s rules right away.</p>
          {answerError && <p className="error" role="alert">{answerError}</p>}
          <Questions findings={questions} busyRule={busyRule} onAnswer={answer} />
          {answered.length > 0 && (
            <>
              <h3 className="sub-h">Your answers</h3>
              <Answered findings={answered} busyRule={busyRule} onClear={(id) => answer(id, null)} />
            </>
          )}
        </section>
      )}

      {fine.length > 0 && (
        <section className="block">
          <h2>Already looks right</h2>
          <ul className="ruled">
            {fine.map((f) => (
              <li key={f.ruleId}>
                <b>{f.title}</b> <span className="muted">{f.why}</span>
                {f.measured && <span className="tag-mono measured-tag">Measured in 3D</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="block">
        <h2>Money you may get</h2>
        <p className="lede">Matched to {r.household === "relative" ? "a suite for a parent or relative" : r.household === "renter" ? "renting it out" : "your plan"}. Checked {r.compiledAt}. “Looks eligible” is not approval.</p>
        <ul className="ruled grants">
          {grants.map((g) => (
            <li key={g.id} data-fit={g.fit}>
              <span className="fit">{FIT_TEXT[g.fit]}</span>
              <div>
                <h3>{g.name}</h3>
                <p>{g.amount}</p>
                {g.fit !== "cancelled" && g.nextStep && <p className="muted">Next: {g.nextStep}</p>}
                {g.source?.url && <a href={g.source.url} target="_blank" rel="noreferrer">Source</a>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <h2>Get it done</h2>
        <ol className="ruled steps">
          {r.process.map((p) => (
            <li key={p.step}>
              <span className="num mono">{two(p.step)}</span>
              <div>
                <h3>{p.title}</h3>
                <p className="muted">{p.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="actions">
          <a className="btn btn-primary" href={r.pros.registry.url} target="_blank" rel="noreferrer">
            Find a registered designer <span className="arrow" aria-hidden>→</span>
          </a>
          <span className="muted">Ontario's public registry of qualified (BCIN) designers. Filter by “House” and Waterloo.</span>
        </div>
      </section>

      {r.heldBack > 0 && (
        <p className="note">We held back {r.heldBack} claim{r.heldBack === 1 ? "" : "s"} the video couldn't prove.</p>
      )}
      <SiteFooter />
    </main>
  );
}
