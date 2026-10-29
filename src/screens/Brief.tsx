// The one-page plan to hand a designer: the decision, the suggested layout on the floor plan, what
// has to change and what it costs, what the homeowner wants, and what's still to confirm.
// Laid out for paper: "Save as PDF" is the browser's print dialog.
import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { aerialUrl, getScan, type ScanResult } from "../api";
import { FloorPlan } from "../components/FloorPlan";
import { Logo } from "../components/Logo";
import { conceptUrl } from "../components/StagedViews";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const range = (lo: number | null | undefined, hi: number | null | undefined) => (lo == null || hi == null ? null : lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`);

export function Brief() {
  const { scanId } = useParams({ from: "/scans/$scanId/brief" });
  const [r, setR] = useState<ScanResult | null>(null);
  useEffect(() => {
    void getScan(scanId).then((s) => setR(s.result));
  }, [scanId]);
  useEffect(() => {
    if (r) document.title = `Basement plan${r.property ? ` · ${r.property.address}` : ""}`;
  }, [r]);
  if (!r) return <main className="result-loading"><Logo /></main>;

  const p = r.property;
  const today = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const designer = r.findings.filter((f) => f.status === "designer_checks" || f.status === "needs_measurement" || f.status === "needs_answer");
  const photos = (r.concepts?.items ?? []).filter((c) => c.kept);
  const wants = r.vision?.rooms ?? [];
  const upTo = r.money ? r.money.fits || r.money.possible : 0;

  return (
    <main className="brief">
      <div className="brief-actions">
        <a className="link-quiet" href={`/scans/${scanId}`}>Back to the answer</a>
        <button className="btn btn-primary" onClick={() => window.print()}>
          Save as PDF
        </button>
      </div>

      <header className="brief-head">
        <Logo />
        <div>
          <p className="mono">Basement suite plan · {today}</p>
          <p className="mono">{p ? `${p.address}, ${p.municipality}` : r.city ?? ""}</p>
        </div>
      </header>

      <section className="brief-decision">
        <h1>{r.headline}</h1>
        {r.summary && <p>{r.summary}</p>}
        <dl>
          <div>
            <dt>Rough cost, all in</dt>
            <dd>{range(r.cost.low, r.cost.high) ?? "To be priced"}</dd>
          </div>
          {upTo > 0 && (
            <div>
              <dt>Money they may get</dt>
              <dd>up to {money(upTo)}</dd>
            </div>
          )}
          {p?.zone && (
            <div>
              <dt>Zoning</dt>
              <dd>
                {p.zone.code}
                {p.lotAreaM2 ? ` · lot ${p.lotAreaM2} m²` : ""}
              </dd>
            </div>
          )}
          <div>
            <dt>For</dt>
            <dd>{r.household === "relative" ? "A parent or relative" : r.household === "renter" ? "A renter" : "Not decided"}</dd>
          </div>
        </dl>
      </section>

      <div className="brief-grid">
        <section>
          <h2>Suggested layout</h2>
          {r.plan ? <FloorPlan plan={r.plan} units="m" layout={r.layout ?? null} /> : <p className="muted">No floor plan from this video.</p>}
          {r.layout && (
            <ul className="brief-checks">
              {r.layout.checks.map((c) => (
                <li key={c.label} data-ok={c.ok === null ? "unknown" : c.ok}>
                  {c.label}. <span className="muted">{c.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          {photos.length > 0 && (
            <>
              <h2>What it could look like</h2>
              <div className="brief-photos">
                {photos.slice(0, 2).map((c) => (
                  <figure key={c.n}>
                    <img src={conceptUrl(scanId, c.n)} alt={c.title} />
                    <figcaption className="mono">{c.title} · virtually staged</figcaption>
                  </figure>
                ))}
              </div>
            </>
          )}
          {wants.length > 0 && (
            <>
              <h2>What they want</h2>
              <ul>
                {wants.map((w, i) => (
                  <li key={i}>
                    <b>{w.room}</b>
                    {w.where && ` · ${w.where}`}
                  </li>
                ))}
              </ul>
            </>
          )}
          {!photos.length && p && <img className="brief-aerial" src={aerialUrl(p)} alt={`${p.address} from above`} />}
        </section>
      </div>

      <div className="brief-grid">
        <section>
          <h2>What has to change</h2>
          <ul className="brief-list">
            {r.fixGroups.map((g) => (
              <li key={g.category}>
                <span>{g.title}</span>
                <span className="mono">{range(g.costLow, g.costHigh) ?? "on quote"}</span>
              </li>
            ))}
            {(r.standard ?? []).map((s) => (
              <li key={s.ruleId}>
                <span>{s.text}</span>
                <span className="mono">{range(s.costLow, s.costHigh) ?? "on quote"}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>For the designer to confirm</h2>
          <ul className="brief-list">
            {designer.map((f) => (
              <li key={f.ruleId}>
                <span>{f.title}</span>
              </li>
            ))}
          </ul>
          <h2>Next steps</h2>
          <ol className="brief-steps">
            {(r.steps ?? []).map((s) => (
              <li key={s.id}>
                <b>{s.title}</b> <span className="muted">{[s.who, s.time, range(s.costLow, s.costHigh)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className="brief-foot mono">
        Made from a phone video and public records by Basement Ready. Not an approval: the City decides. Sizes are estimates from the
        video; the designer confirms them. Rules checked {r.compiledAt}.
      </footer>
    </main>
  );
}
