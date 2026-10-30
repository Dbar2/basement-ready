// /scans/:id/book: the book on screen, the same sections as the PDF (server/book/book.ts). The quote
// is worked out here in the browser from the model, so picking another layout reprices it at once.
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { Design } from "../../server/model/types";
import { Logo } from "../components/Logo";
import { chosen, downloadBook, getBook, quote, type BookData } from "./bookApi";
import "./book.css";

const cad = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const range = (lo: number, hi: number) => (lo === hi ? cad(lo) : `${cad(lo)}–${cad(hi)}`);
const VERDICT = { yes: "Yes", fix: "Yes, after fixes", no: "Not as it is" } as const;

export function BookPage() {
  const { scanId } = useParams({ from: "/scans/$scanId/book" });
  const [b, setB] = useState<BookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBook(scanId).then(setB, (e: Error) => setError(e.message));
  }, [scanId]);
  useEffect(() => {
    if (b) document.title = `Your basement book · ${b.address}`;
  }, [b]);

  const design = useMemo(() => b?.model?.designs.find((d) => d.id === pick) ?? chosen(b?.model ?? null), [b, pick]);
  const q = useMemo(() => (b?.model && design ? quote(b.model, design, { municipality: b.municipality }) : null), [b, design]);
  const layouts = useMemo(() => (b?.model ? b.model.designs.map((d) => ({ d, q: quote(b.model!, d, { municipality: b.municipality }) })) : []), [b]);

  if (error) return <main className="book"><Logo /><p className="book-error">{error}</p></main>;
  if (!b) return <main className="result-loading"><Logo /></main>;

  const ready = b.readiness.filter((r) => r.ok === true).length;
  const download = async () => {
    setBusy(true);
    try {
      await downloadBook(scanId, `basement-book-${scanId === "sample" ? "sample" : "yours"}.pdf`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="book">
      <div className="book-actions">
        <a className="link-quiet" href={`/scans/${scanId}`}>Back to your basement</a>
        <button className="btn btn-primary" onClick={() => void download()} disabled={busy}>
          {busy ? "Making the book…" : "Download the book (PDF)"}
        </button>
      </div>

      <header className="book-cover" data-verdict={b.verdict ?? undefined}>
        <p className="book-kicker">Your basement, the book</p>
        <h1>{b.address}</h1>
        {b.verdict && <span className="book-verdict">{VERDICT[b.verdict]}</span>}
        {b.headline && <p className="book-headline">{b.headline}</p>}
        <dl className="book-facts">
          {design && <div><dt>The design</dt><dd>{design.name}</dd></div>}
          {q && <div><dt>Hired out</dt><dd>{range(q.totalLow, q.totalHigh)}</dd></div>}
          {q && <div><dt>Built yourself</dt><dd>{range(q.diy.low, q.diy.high)}</dd></div>}
          {b.readiness.length > 0 && <div><dt>Permit</dt><dd>{ready} of {b.readiness.length} checks ready</dd></div>}
        </dl>
      </header>

      {design && (
        <section className="book-section">
          <h2>The design</h2>
          {layouts.length > 1 && (
            <div className="book-designs" role="tablist" aria-label="Layouts">
              {layouts.map(({ d, q: dq }) => (
                <button key={d.id} role="tab" aria-selected={d.id === design.id} onClick={() => setPick(d.id)}>
                  {d.name}
                  <span className="mono">{range(dq.totalLow, dq.totalHigh)}</span>
                </button>
              ))}
            </div>
          )}
          <PlanSvg design={design} />
          <p className="book-key"><span className="k-found" /> Foundation <span className="k-new" /> New wall <span className="k-rated" /> 30-minute fire separation <span className="k-alarm" /> Alarm</p>
        </section>
      )}

      <section className="book-section">
        <h2>Pictures</h2>
        {b.pictures.length ? (
          <div className="book-pictures">
            {b.pictures.map((p) => (
              <figure key={p.url}>
                <img src={p.url} alt={p.title} loading="lazy" />
                <figcaption>{p.title}<span className="mono">{p.kind === "design" ? `Your design · ${p.caption}` : p.caption}</span></figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="muted">No pictures yet. Swipe your style or try a look, and pictures of your design join them once it's drawn.</p>
        )}
      </section>

      <section className="book-section">
        <h2>Mood board</h2>
        <div className="book-chips">
          {[b.model?.mood.style ?? design?.finishes.style, design?.finishes.floor && `Floor: ${design.finishes.floor}`, design?.finishes.walls && `Walls: ${design.finishes.walls}`].filter(Boolean).map((c) => <span key={c as string}>{c}</span>)}
        </div>
        {b.mood.length ? (
          <div className="book-board">{b.mood.map((m) => <img key={m.url} src={m.url} alt={m.title} loading="lazy" />)}</div>
        ) : (
          <p className="muted">Swipe right on the cards while your basement measures and the ones you love fill this board.</p>
        )}
      </section>

      {q && (
        <section className="book-section">
          <h2>The quote, by trade</h2>
          <table className="book-quote">
            <thead><tr><th>Trade</th><th>Hired out</th><th>Built yourself</th></tr></thead>
            <tbody>
              {q.byTrade.map((t) => (
                <tr key={t.trade}>
                  <td>
                    <details>
                      <summary>{t.label}</summary>
                      <ul>
                        {t.lines.map((l) => (
                          <li key={l.id}>
                            <strong>{l.item}</strong> <span className="mono">{range(l.low, l.high)}</span>
                            <p>{l.qty.toLocaleString("en-CA")} {l.unit}. {l.basis}</p>
                            {l.missing.length > 0 && <p className="book-missing">No price found: {l.missing.join(", ")}</p>}
                            <p className="book-sources">{l.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.store ?? s.title}</a>)}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td>{range(t.low, t.high)}</td>
                  <td>{range(t.diyLow, t.diyHigh)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>Contingency {q.contingency.pctLow}–{q.contingency.pctHigh}%</td><td>{range(q.contingency.low, q.contingency.high)}</td><td>{range(q.diy.contingency.low, q.diy.contingency.high)}</td></tr>
              <tr><td>HST {q.hst.pct}%</td><td>{range(q.hst.low, q.hst.high)}</td><td>{range(q.diy.hst.low, q.diy.hst.high)}</td></tr>
              <tr className="book-total"><td>Total</td><td>{range(q.hired.low, q.hired.high)}</td><td>{range(q.diy.low, q.diy.high)}</td></tr>
            </tfoot>
          </table>
          {q.missing.length > 0 && <p className="book-missing">No price found, so not in the total: {q.missing.join(" · ")}</p>}
          {q.furniture.lines.length > 0 && (
            <div className="book-furniture">
              <h3>Furniture, if you buy it</h3>
              <p className="muted">Optional, and not in the build total or the permit.</p>
              <table className="book-quote">
                <tbody>
                  {q.furniture.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.count > 1 ? `${l.count} × ` : ""}
                        {l.label}
                        <p className="book-sources">{l.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.store}</a>)}</p>
                      </td>
                      <td>{l.price ? range(l.low, l.high) : <span className="book-missing">No price found</span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="book-total"><td>With HST</td><td>{range(q.furniture.total.low, q.furniture.total.high)}</td></tr>
                </tfoot>
              </table>
              {q.furniture.inBuild.length > 0 && <p className="muted">Already in the build: {q.furniture.inBuild.join(", ").toLowerCase()}.</p>}
            </div>
          )}
          <p className="muted">Shelf prices checked {q.checked} and later, before HST. Labour from published rates; hours on hourly trades are our estimate.</p>
        </section>
      )}

      <section className="book-section">
        <h2>Permit readiness</h2>
        <p className="book-ready"><strong>{ready}</strong> of {b.readiness.length} checks ready</p>
        <ul className="book-checks">
          {b.readiness.map((r) => (
            <li key={r.label} data-ok={r.ok === null ? "ask" : String(r.ok)}>
              {r.label}
              {r.detail && <span>{r.detail}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="book-section">
        <h2>Money you may qualify for</h2>
        {b.money.length ? (
          <ul className="book-money">
            {b.money.map((m) => (
              <li key={m.id}>
                <strong>{m.name}</strong>
                <span className="mono">{m.qualify === "yes" ? "You qualify" : "You may qualify"}</span>
                <p>{m.amount}{m.paidWhen ? ` Paid ${m.paidWhen}.` : ""}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Answer the money questions and the programs that fit show here.</p>
        )}
      </section>

      <section className="book-section">
        <h2>From applying to moving in</h2>
        <ol className="book-timeline">
          {b.timeline.map((s) => (
            <li key={s.title}>
              <span className="mono">{s.when}</span>
              <strong>{s.title}</strong>
              <p>{s.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="book-section">
        <h2>What to do next</h2>
        <ol className="book-steps">
          {b.steps.map((s) => (
            <li key={s.id}>
              <strong>{s.title}</strong> <span className="mono">{s.when}</span>
              {s.tasks.length > 0 && <ul>{s.tasks.map((t) => <li key={t.title}>{t.title}</li>)}</ul>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

// The design as a plan: rooms, walls by kind, the fire separation, doors, windows and alarms.
function PlanSvg({ design }: { design: Design }) {
  const P = design.proposed;
  const pts = [...P.walls.flatMap((w) => [w.a, w.b]), ...P.rooms.flatMap((r) => r.polygon)];
  if (!pts.length) return null;
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minZ = Math.min(...pts.map((p) => p[1])), maxZ = Math.max(...pts.map((p) => p[1]));
  const pad = 0.4;
  const walls = new Map(P.walls.map((w) => [w.id, w]));
  const area = (p: [number, number][]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0)) / 2;
  return (
    <svg className="book-plan" viewBox={`${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}`} role="img" aria-label={`Plan of ${design.name}`}>
      {P.rooms.map((r) => <polygon key={r.id} points={r.polygon.map((p) => p.join(",")).join(" ")} className={`room room-${r.kind}`} />)}
      {P.walls.map((w) => <line key={w.id} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} className={`wall wall-${w.kind}${w.rating ? " wall-rated" : ""}`} />)}
      {P.openings.map((o) => {
        const w = walls.get(o.wallId);
        if (!w) return null;
        const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
        const u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
        const c = [w.a[0] + u[0] * o.offsetM, w.a[1] + u[1] * o.offsetM];
        const h = o.widthM / 2;
        return <line key={o.id} x1={c[0] - u[0] * h} y1={c[1] - u[1] * h} x2={c[0] + u[0] * h} y2={c[1] + u[1] * h} className={`opening opening-${o.kind}${o.rating ? " opening-rated" : ""}`} />;
      })}
      {P.alarms.map((a) => <circle key={a.id} cx={a.at[0]} cy={a.at[1]} r={0.14} className={`alarm alarm-${a.kind}`}><title>{a.why}</title></circle>)}
      {P.rooms.map((r) => {
        const cx = r.polygon.reduce((s, p) => s + p[0], 0) / r.polygon.length;
        const cz = r.polygon.reduce((s, p) => s + p[1], 0) / r.polygon.length;
        return (
          <text key={`t${r.id}`} x={cx} y={cz} className="room-label">
            {r.name}
            <tspan x={cx} dy={0.32} className="room-area">{area(r.polygon).toFixed(1)} m²</tspan>
          </text>
        );
      })}
    </svg>
  );
}
