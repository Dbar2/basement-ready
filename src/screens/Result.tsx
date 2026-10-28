import { useEffect, useState } from "react";
import { frameUrl, getScan, type Detection, type ScanResult } from "../api";
import { AccountNav, SaveCta } from "../auth";
import { Logo } from "../components/Logo";

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
  useEffect(() => {
    getScan(scanId).then((s) => setR(s.result));
  }, [scanId]);

  if (!r) return <main className="result-loading"><Logo /></main>;

  const byId = new Map(r.detections.map((d) => [d.id, d]));
  const questions = r.findings.filter((f) => f.status === "needs_measurement" || f.status === "needs_answer");
  const fine = r.findings.filter((f) => f.status === "likely_ok");
  const grants = [...r.grants].sort((a, b) => ["fits", "depends", "no", "cancelled"].indexOf(a.fit) - ["fits", "depends", "no", "cancelled"].indexOf(b.fit));

  return (
    <main className="result" data-verdict={r.verdict}>
      <header className="nav">
        <Logo />
        <span className="nav-right">
          <button className="link-quiet" onClick={onRestart}>Scan another basement</button>
          <AccountNav />
        </span>
      </header>

      <section className="verdict-hero">
        <div>
          <p className="eyebrow">Your basement · {r.city ?? "Waterloo"} · {r.route === "second_unit" ? "Second unit route" : "Basement finish route"}</p>
          {r.coverage === "provincial" && <p className="note-inline">We haven't researched your city's own rules yet, so this uses Ontario's building code. Confirm zoning with your city.</p>}
          <h1>{r.headline}</h1>
          <p className="summary">{r.summary}</p>
          {r.wants && <blockquote>“{r.wants}”</blockquote>}
          {scanId !== "sample" && <SaveCta />}
        </div>
        <dl className="verdict-stats">
          <div>
            <dt>Rough cost of the fixes</dt>
            <dd className="mono">{r.cost.pricedFixes ? `${money(r.cost.low)}–${money(r.cost.high)}` : "To be priced"}</dd>
          </div>
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

      {questions.length > 0 && (
        <section className="block">
          <h2>What we couldn't see</h2>
          <p className="lede">We don't guess. Answer these and the verdict gets firmer.</p>
          <ul className="ruled questions">
            {questions.map((q) => (
              <li key={q.ruleId}>
                <span className="tag-mono">{q.status === "needs_measurement" ? "Tape measure" : "Question"}</span>
                <div>
                  <p className="q">{q.question}</p>
                  <p className="muted">{q.title}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fine.length > 0 && (
        <section className="block">
          <h2>Already looks right</h2>
          <ul className="ruled">
            {fine.map((f) => <li key={f.ruleId}><b>{f.title}</b> <span className="muted">{f.why}</span></li>)}
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
    </main>
  );
}
