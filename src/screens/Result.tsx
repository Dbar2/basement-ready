// The answer (brand/explorations/M3-decision-plan.png): a decision first, then the plan to get there,
// the money, and only then the detail behind it. Nothing here asks a homeowner what a designer knows.
import { useEffect, useState } from "react";
import { ANALYSIS_FPS, aerialUrl, answerQuestion, frameUrl, getScan, sampleEarlyAnswers, type AnswerValue, type Detection, type ScanResult } from "../api";
import { Answered, Questions } from "../components/Questions";
import { AccountNav, SaveCta } from "../auth";
import { Logo } from "../components/Logo";
import { SiteFooter } from "../marketing/parts";
import { ScanViews } from "../components/ScanViews";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const range = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo == null || hi == null ? null : lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
const two = (n: number) => String(n).padStart(2, "0");
const checkedOn = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-CA", { month: "short", year: "numeric" });

const FIT_TEXT = { fits: "Fits your plan", depends: "Depends", no: "Doesn't fit", cancelled: "Cancelled" } as const;
const STATUS = {
  likely_ok: "looks right",
  likely_fix: "needs work",
  needs_measurement: "needs a measurement",
  needs_answer: "needs an answer",
  standard: "standard work",
  designer_checks: "your designer checks",
} as const;

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

async function sharePlan() {
  const url = window.location.href;
  if (navigator.share) await navigator.share({ title: "Our basement plan", url }).catch(() => {});
  else await navigator.clipboard?.writeText(url).catch(() => {});
}

export function Result({ scanId, onRestart }: { scanId: string; onRestart: () => void }) {
  const [r, setR] = useState<ScanResult | null>(null);
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const [changes, setChanges] = useState<{ before: string; after: string; lines: string[] } | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  // The sample isn't saved anywhere, so its answers live here.
  const [sampleAnswers, setSampleAnswers] = useState<Record<string, AnswerValue | null>>({});
  useEffect(() => {
    void getScan(scanId).then(async (s) => {
      // The sample's answers from the wait screen, applied the way a real scan applies them.
      const early = scanId === "sample" ? sampleEarlyAnswers() : {};
      if (s.result && Object.keys(early).length) {
        const res = await fetch("/api/recheck", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: s.result, answers: early }) });
        if (res.ok) {
          setSampleAnswers(early);
          return setR((await res.json()).result);
        }
      }
      setR(s.result);
    });
  }, [scanId]);

  const answer = async (ruleId: string, value: AnswerValue | null) => {
    if (!r) return;
    setBusyRule(ruleId);
    setAnswerError(null);
    try {
      const next = await answerQuestion(scanId, r, sampleAnswers, ruleId, value);
      if (scanId === "sample") setSampleAnswers((a) => ({ ...a, [ruleId]: value }));
      // Say what moved, in plain words.
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
  const questions = r.findings.filter((f) => f.status === "needs_answer" && !f.answer);
  const answered = r.findings.filter((f) => f.answer && (f.answer.outcome !== "unknown" || f.answer.value === "unsure"));
  const designer = r.findings.filter((f) => (f.status === "designer_checks" || f.status === "needs_measurement") && !f.answer);
  const fine = r.findings.filter((f) => f.status === "likely_ok" && !f.answer);
  const standard = r.standard ?? [];
  const grants = r.grants.filter((g) => g.fit === "fits" || g.fit === "depends").sort((a, b) => (a.fit === b.fit ? 0 : a.fit === "fits" ? -1 : 1));
  const upTo = r.money ? r.money.fits || r.money.possible : 0;
  const rooms = (r.rooms ?? []).filter((x) => x.has3d || x.plan);
  // Filmed room by room, the rules use one room's numbers: say which.
  const mainRoomName = (r.rooms?.length ?? 0) > 1 ? r.rooms!.find((x) => x.index === r.mainRoom)?.name : undefined;
  const p = r.property;

  return (
    <main className="result" data-verdict={r.verdict}>
      <header className="nav">
        <Logo />
        <span className="nav-right">
          <button className="link-quiet" onClick={onRestart}>New scan</button>
          <AccountNav />
        </span>
      </header>

      <section className="decision">
        <p className="eyebrow mono">
          {r.verdict === "no" ? "Not likely" : "Likely"} · {r.city ?? "Waterloo"} rules checked {checkedOn(r.compiledAt)}
          {p && ` · ${p.address}`}
        </p>
        {r.coverage === "provincial" && <p className="note-inline">We haven't researched your city's own rules yet, so this uses Ontario's building code. Confirm zoning with your city.</p>}
        {changes && (
          <div className="changed" role="status" key={changes.after + changes.lines.join()}>
            <b>{changes.before === changes.after ? "Re-checked with your answer." : "Updated from your answer."}</b>
            {changes.lines.length > 0 && <span> {changes.lines.join(" · ")}</span>}
          </div>
        )}
        <h1 key={r.headline} className="verdict-line">{r.headline}</h1>
        {r.summary && <p className="summary">{r.summary}</p>}
        <dl className="decision-facts">
          <div>
            <dt>Rough cost, all in</dt>
            <dd className="mono">{range(r.cost.low, r.cost.high) ?? "To be priced"}</dd>
          </div>
          {upTo > 0 && (
            <div>
              <dt>Money you may get</dt>
              <dd className="mono">up to {money(upTo)}</dd>
            </div>
          )}
          {/* A rough 3D reading isn't a headline fact: the designer confirms it below. */}
          {r.measurements?.ceilingHeightM != null && (r.measurements.trusted || r.measurements.scaleSource !== "model") && (
            <div>
              <dt>Ceiling{mainRoomName && `, ${mainRoomName}`}</dt>
              <dd className="mono">about {r.measurements.ceilingHeightM.toFixed(1)} m</dd>
            </div>
          )}
        </dl>
        {scanId !== "sample" && <SaveCta />}
      </section>

      {(questions.length > 0 || answered.length > 0) && (
        <section className="block" id="questions">
          <h2>{questions.length === 1 ? "One thing only you know" : questions.length ? `${questions.length} things only you know` : "What you told us"}</h2>
          {questions.length > 0 && <p className="lede">The answer re-checks as soon as you tap. Not sure is fine: your designer will check.</p>}
          {answerError && <p className="error" role="alert">{answerError}</p>}
          <Questions findings={questions} busyRule={busyRule} onAnswer={(id, v) => void answer(id, v)} />
          <Answered findings={answered} busyRule={busyRule} onClear={(id) => void answer(id, null)} />
        </section>
      )}

      {r.steps && r.steps.length > 0 && (
        <section className="block plan-steps">
          <h2>Your plan</h2>
          <ol className="timeline">
            {r.steps.map((s, i) => (
              <li key={s.id}>
                <span className="timeline-num">{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p className="timeline-meta mono">{[s.who, s.time, range(s.costLow, s.costHigh)].filter(Boolean).join(" · ")}</p>
                  <p className="muted">{s.detail}</p>
                  {s.items && s.items.length > 0 && (
                    <ul className="timeline-items">
                      {s.items.map((it) => (
                        <li key={it}>{it}</li>
                      ))}
                    </ul>
                  )}
                  {s.source?.url && (
                    <a className="timeline-source" href={s.source.url} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="block">
        <h2>Money you can get</h2>
        {upTo > 0 && (
          <div className="money-total">
            <span className="mono">Up to</span>
            <strong>{money(upTo)}</strong>
            <span>{r.money?.fits ? "from programs that fit your plan" : "if your plan fits these programs"}</span>
          </div>
        )}
        {r.household === "unsure" && <p className="lede">Tell us who it's for and we'll show only what fits.</p>}
        <ul className="ruled grants">
          {grants.map((g) => (
            <li key={g.id} data-fit={g.fit}>
              <span className="fit">{FIT_TEXT[g.fit]}</span>
              <div>
                <h3>{g.name}</h3>
                <p>{g.amount}</p>
                {g.nextStep && <p className="muted">Next: {g.nextStep}</p>}
                {g.source?.url && (
                  <a href={g.source.url} target="_blank" rel="noreferrer">
                    Source
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="note">Checked {r.compiledAt}. “Fits” means it looks eligible, not that it's approved.</p>
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
                <span className="cost mono">{range(g.costLow, g.costHigh) ?? "Price on quote"}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {standard.length > 0 && (
        <section className="block">
          <h2>What every basement suite needs</h2>
          <p className="lede">Not problems with your basement: the work any second home needs to be legal. It's in the cost above.</p>
          <ul className="ruled standard">
            {standard.map((s) => (
              <li key={s.ruleId}>
                <span>{s.text}</span>
                <span className="cost mono">{range(s.costLow, s.costHigh) ?? "On quote"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {designer.length > 0 && (
        <section className="block">
          <h2>Your designer confirms</h2>
          <p className="lede">Sizes and details a video can't settle. A designer checks them when drawing the plans, so you don't need a tape measure.</p>
          <ul className="ruled">
            {designer.map((f) => (
              <li key={f.ruleId}>
                <b>{f.title}</b> <span className="muted">{f.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p && (
        <section className="block records">
          <h2>From public records</h2>
          <div className="records-body">
            <img src={aerialUrl(p)} alt={`${p.address} from above`} loading="lazy" />
            <ul className="ruled">
              {p.zone && (
                <li>
                  <b>Zone {p.zone.code}</b> <span className="muted">{[p.zone.label, p.zone.bylaw].filter(Boolean).join(" · ")}</span>
                </li>
              )}
              {p.lotAreaM2 && (
                <li>
                  <b>Lot {p.lotAreaM2.toLocaleString("en-CA")} m²</b>
                </li>
              )}
              {p.building?.storeys && (
                <li>
                  <b>House: {p.building.storeys} storey{p.building.storeys === 1 ? "" : "s"}</b>{" "}
                  {p.building.floorAreaM2 && <span className="muted">{p.building.floorAreaM2} m² of floor</span>}
                </li>
              )}
              <li>
                <b>{p.unitsRegistered ? `${p.unitsRegistered} apartment${p.unitsRegistered === 1 ? "" : "s"} registered` : "No apartment registered"}</b>
              </li>
              <li className="muted">{p.sources.join(" · ")}. Aerial photo: Region of Waterloo, 2026.</li>
            </ul>
          </div>
        </section>
      )}

      <ScanViews scanId={scanId} plan={r.plan ?? null} has3d={Boolean(r.has3d)} rooms={r.rooms} mainRoom={r.mainRoom} />
      {rooms.length > 1 && <p className="note">{rooms.length} rooms scanned, each on its own.</p>}

      <section className="block">
        <h2>What you want</h2>
        {r.vision && (r.vision.rooms.length > 0 || r.vision.style || r.vision.mustHaves.length > 0) ? (
          <>
            <p className="lede">From what you said and tapped while filming. Your layouts are planned around this.</p>
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
          <p className="lede">We didn't hear plans this time. Next time the guide asks in each room: just say it, or tap an idea.</p>
        )}
      </section>

      {fine.length > 0 && (
        <section className="block">
          <h2>Already looks right</h2>
          <ul className="ruled">
            {fine.map((f) => (
              <li key={f.ruleId}>
                <b>{f.title}</b> <span className="muted">{f.why}</span>
                {f.records && <span className="tag-mono measured-tag">Public records</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="block" id="get-it-done">
        <h2>Get it done</h2>
        <p className="lede">Step 2 of your plan is a registered designer. Ontario's public registry lists them: filter by “House” and your city.</p>
        <div className="actions">
          <a className="btn btn-primary" href={r.pros.registry.url} target="_blank" rel="noreferrer">
            Find a registered designer <span className="arrow" aria-hidden>→</span>
          </a>
          <button className="btn btn-ghost" onClick={() => void sharePlan()}>Share my plan</button>
          <button className="link-quiet" onClick={() => window.print()}>Print</button>
        </div>
      </section>

      {r.heldBack > 0 && <p className="note">We held back {r.heldBack} claim{r.heldBack === 1 ? "" : "s"} the video couldn't prove.</p>}
      <SiteFooter />

      <div className="result-bar">
        <a className="btn btn-primary" href={r.pros.registry.url} target="_blank" rel="noreferrer">
          Get a designer
        </a>
        <button className="btn btn-ghost" onClick={() => void sharePlan()}>
          Share my plan
        </button>
      </div>
    </main>
  );
}
