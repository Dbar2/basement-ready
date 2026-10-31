// The one-page plan to hand a designer: the decision, the suggested layout on the floor plan, what
// has to change and what it costs, what the homeowner wants, what's still to confirm, the money they
// qualify for and how to apply. Laid out for paper: "Save as PDF" is the browser's print dialog.
import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { aerialUrl, costLabel, getScan, type ScanResult } from "../api";
import { FloorPlan } from "../components/FloorPlan";
import { Logo } from "../components/Logo";
import { conceptUrl } from "../components/StagedViews";
import { worth } from "../components/Money";

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
  // The design they picked, as the answer shows it (its own checks, from the window's measured size);
  // before there's one, the starting layout.
  const plan = r.design?.plan ?? r.plan ?? null;
  const layout = r.design?.layout ?? r.layout ?? null;
  const today = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const designer = r.findings.filter((f) => f.status === "designer_checks" || f.status === "needs_measurement" || f.status === "needs_answer");
  const photos = (r.concepts?.items ?? []).filter((c) => c.kept);
  const wants = r.vision?.rooms ?? [];
  const upTo = r.money?.total ?? 0;
  const yes = (r.grants ?? []).filter((g) => g.qualify === "yes");
  const open = (r.grants ?? []).filter((g) => g.qualify === "ask");
  // Links stay clickable in a saved PDF; on paper the site name says where to go.
  const site = (url: string) => (/^https?:/.test(url) ? new URL(url).host.replace(/^www\./, "") : null);

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
          <p className="aside">Basement suite plan · {today}</p>
          <p className="mono">{p ? `${p.address}, ${p.municipality}` : r.city ?? ""}</p>
        </div>
      </header>

      <section className="brief-decision">
        <h1>{r.headline}</h1>
        {r.summary && <p>{r.summary}</p>}
        <dl>
          <div>
            <dt>{costLabel(r)}</dt>
            <dd data-total data-low={r.cost.low} data-high={r.cost.high}>{range(r.cost.low, r.cost.high) ?? "To be priced"}</dd>
          </div>
          {upTo > 0 && (
            <div>
              <dt>They may be eligible for</dt>
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
          {plan ? <FloorPlan plan={plan} units="m" layout={layout} /> : <p className="muted">No floor plan from this video.</p>}
          {layout && (
            <ul className="brief-checks">
              {layout.checks.map((c) => (
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
          {/* The fixes the headline counts, then the work any suite needs (as the answer has them). */}
          <h2>What has to change</h2>
          <ul className="brief-list" data-fixes={r.fixGroups.length}>
            {r.fixGroups.map((g) => (
              <li key={g.category}>
                <span>{g.title}</span>
                <span className="mono">{range(g.costLow, g.costHigh) ?? (g.priced === false ? "not priced yet" : "in the quote")}</span>
              </li>
            ))}
          </ul>
          {(r.standard ?? []).length > 0 && (
            <>
              <h2>What every basement suite needs</h2>
              <ul className="brief-list">
                {(r.standard ?? []).map((s) => (
                  <li key={s.ruleId}>
                    <span>{s.text}</span>
                    <span className="mono">{range(s.costLow, s.costHigh) ?? "in the quote"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
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
        </section>
      </div>

      <div className="brief-grid">
        <section>
          <h2>Money they may be eligible for</h2>
          <ul className="brief-list">
            {yes.map((g) => (
              <li key={g.id}>
                <span>
                  {g.shortName}
                  <span className="muted"> · {g.reason}</span>
                </span>
                <span className="mono">{worth(g)}</span>
              </li>
            ))}
            {open.map((g) => (
              <li key={g.id}>
                <span>
                  {g.shortName}
                  <span className="muted"> · not decided: {g.reason.toLowerCase()}</span>
                </span>
                <span className="mono">{worth(g)}</span>
              </li>
            ))}
            {!yes.length && !open.length && <li className="muted">No grants fit this plan.</li>}
          </ul>
        </section>
        <section>
          <h2>How to apply</h2>
          <ol className="brief-steps">
            {(r.steps ?? []).filter((s) => Array.isArray(s.tasks)).map((s) => (
              <li key={s.id}>
                <b>{s.title}</b> <span className="muted">{[s.when, s.who, s.time, range(s.costLow, s.costHigh)].filter(Boolean).join(" · ")}</span>
                <ul className="brief-tasks">
                  {s.tasks.map((t) => (
                    <li key={t.title}>
                      {t.title}
                      {t.links.map((l) => (
                        <span key={l.url} className="brief-link">
                          {" · "}
                          <a href={l.url}>{l.label}</a>
                          {site(l.url) && <span className="mono"> ({site(l.url)})</span>}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
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
