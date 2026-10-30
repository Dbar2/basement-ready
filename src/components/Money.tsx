// The money and the road to it, on the answer page: what they may be eligible for (decided in code from
// each program's written conditions; the program decides), the one answer that settles the rest, "How
// to apply" in the order it happens, and who draws and builds it. Never a recommended business: public
// registries only. Opening an email or a form never counts as sending it: they tell us with "I sent it".
// The example and the demo house show their emails but can't send them.
import { useEffect, useState } from "react";
import type { Grant, MoneyQuestion, MoneyValue, PlanStep, ScanResult } from "../api";
import { downloadApplication, getApplications, mailto, type Application, type Profile, type WorkspaceState } from "../workspaceApi";
import { MoneyQuestionCard } from "./Questions";
import "../styles/money.css";

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const range = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo == null || hi == null ? null : lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;

const KIND: Record<string, string> = {
  grant: "grant",
  forgivable_loan: "forgivable loan",
  refundable_tax_credit: "tax credit",
};

// "$20,000 grant", "Saves fees", "Financing".
export function worth(g: Grant) {
  if (g.value === "cash" && g.amountCAD != null) return `${money(g.amountCAD)} ${KIND[g.kind] ?? ""}`.trim();
  if (g.value === "financing") return "Financing";
  return "Saves fees";
}

function Program({ g }: { g: Grant }) {
  return (
    <li className="program" data-qualify={g.qualify} data-value={g.value}>
      <div className="program-head">
        <h3>{g.shortName}</h3>
        <span className="program-worth mono">{worth(g)}</span>
      </div>
      <p>{g.reason}</p>
      {g.commitments.length > 0 && (
        <details className="program-terms">
          <summary>What you agree to</summary>
          <ul>
            {g.commitments.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      )}
      {g.note && <p className="muted program-note">{g.note}</p>}
      <a className="program-source" href={g.source.url} target="_blank" rel="noreferrer">
        {g.verified ? "Source" : "Source (one detail still unconfirmed)"}
      </a>
    </li>
  );
}

type Answer = (id: string, value: MoneyValue | null) => void;

export function MoneySection({ r, busy, readOnly, example, onAnswer }: { r: ScanResult; busy: string | null; readOnly?: boolean; example?: boolean; onAnswer: Answer }) {
  const grants = r.grants ?? [];
  const yes = grants.filter((g) => g.qualify === "yes");
  const no = grants.filter((g) => g.qualify === "no");
  const questions = r.moneyQuestions ?? [];
  const total = r.money?.total ?? 0;
  const ifYes = r.money?.ifYes ?? 0;
  const cash = yes.filter((g) => g.value === "cash");
  // Answered questions that no longer decide anything still show, so any answer can be changed.
  const answered = (r.moneyAnswered ?? []).filter((a) => !questions.some((q) => q.id === a.id));

  return (
    <section className="block money" id="money">
      <h2>Money you can get</h2>
      <div className="money-total" data-none={total === 0 || undefined}>
        {total > 0 ? (
          <>
            <span className="mono">You may be eligible for up to</span>
            <strong>{money(total)}</strong>
            <span>
              {cash.length === 1 ? `From the ${cash[0].shortName}.` : `From ${cash.length} programs, listed below.`}
              {ifYes > 0 && ` Answer ${questions.length === 1 ? "one question" : `${questions.length} questions`} to see if ${money(ifYes)} more applies.`}
            </span>
          </>
        ) : ifYes > 0 ? (
          <>
            <span className="mono">Up to {money(ifYes)} is one answer away</span>
            <span>{readOnly ? "The owner's answers decide it." : "Answer below and we'll show what you may be eligible for."}</span>
          </>
        ) : (
          <>
            <span className="mono">No grants for this plan</span>
            <span>{yes.length ? "But the savings and financing below still apply." : "The reasons are below."}</span>
          </>
        )}
      </div>

      {yes.length > 0 && (
        <ul className="programs">
          {yes.map((g) => (
            <Program key={g.id} g={g} />
          ))}
        </ul>
      )}

      {questions.length > 0 && readOnly && <p className="read-only">Only the person who filmed this can answer the money questions.</p>}
      {questions.length > 0 && !readOnly && (
        <div className="money-ask">
          <h3>One answer away</h3>
          <ul className="ruled questions money-questions">
            {questions.map((q) => (
              <MoneyQuestionCard
                key={q.id}
                q={q}
                busy={busy === q.id}
                decides={grants.filter((g) => g.question === q.id)}
                onAnswer={(v) => onAnswer(q.id, v)}
              />
            ))}
          </ul>
        </div>
      )}

      {no.length > 0 && (
        <details className="money-no">
          <summary>
            {no.length === 1 ? "1 program you don't qualify for" : `${no.length} programs you don't qualify for`}
          </summary>
          <ul className="ruled">
            {no.map((g) => (
              <li key={g.id}>
                <b>{g.shortName}</b> <span className="muted">{g.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {answered.length > 0 && !readOnly && <MoneyAnswers answered={answered} busy={busy} onAnswer={onAnswer} title={example ? "The example household's answers" : "What you told us"} />}
      <p className="note">
        Decided from each program's written rules, checked {r.compiledAt}. The program makes the final call when you apply.
      </p>
      {r.disclaimer && <p className="note rules-disclaimer">{r.disclaimer}</p>}
    </section>
  );
}

const said = (q: MoneyQuestion) => q.options.find((o) => o.value === q.answer)?.label ?? String(q.answer);

// What they told us about the money, one tap to change.
function MoneyAnswers({ answered, busy, onAnswer, title }: { answered: MoneyQuestion[]; busy: string | null; onAnswer: Answer; title: string }) {
  return (
    <details className="money-told">
      <summary>{title}</summary>
      <ul className="ruled questions money-questions">
        {answered.map((q) => (
          <MoneyQuestionCard key={q.id} q={q} busy={busy === q.id} decides={[]} onAnswer={(v) => onAnswer(q.id, v)} label={said(q)} />
        ))}
      </ul>
    </details>
  );
}

// `example`: email addresses show as text, so nothing made for the example reaches a real inbox.
function Links({ links, example }: { links: { label: string; url: string }[]; example?: boolean }) {
  if (!links.length) return null;
  return (
    <p className="task-links">
      {links.map((l) =>
        example && l.url.startsWith("mailto:") ? (
          <span key={l.url} className="muted" title="The example can't send email">
            {l.label} <span className="tag-mono">example: not sent</span>
          </span>
        ) : (
          <a key={l.url} href={l.url} target={l.url.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer">
            {l.label}
          </a>
        ),
      )}
    </p>
  );
}

export function HowToApply({ steps, example }: { steps: PlanStep[]; example?: boolean }) {
  // Results from before the timeline have no tasks; they show nothing rather than half a plan.
  const usable = steps.filter((s) => Array.isArray(s.tasks));
  if (!usable.length) return null;
  return (
    <section className="block plan-steps" id="how-to-apply">
      <h2>How to apply</h2>
      <p className="lede">In the order it happens, from today to move-in: where to go, what to bring, who does it.</p>
      <ol className="timeline">
        {usable.map((s, i) => (
          <li key={s.id} data-step={s.id}>
            <span className="timeline-num">{i + 1}</span>
            <div>
              <p className="timeline-when mono">{s.when}</p>
              <h3>{s.title}</h3>
              <p className="timeline-meta mono">{[s.who, s.time, range(s.costLow, s.costHigh)].filter(Boolean).join(" · ")}</p>
              {s.costNote && <p className="timeline-cost">{s.costNote}</p>}
              <p className="muted">{s.detail}</p>
              {s.tasks.length > 0 && (
                <ul className="tasks">
                  {s.tasks.map((t) => (
                    <li key={t.title} className="task" data-qualify={t.program?.qualify}>
                      <p className="task-title">
                        <b>{t.title}</b>
                        {t.program?.qualify === "ask" && <span className="tag-mono">If you're eligible</span>}
                      </p>
                      {t.detail && <p className="muted">{t.detail}</p>}
                      {t.bring && t.bring.length > 0 && (
                        <div className="task-bring">
                          <span className="mono">Bring</span>
                          <ul>
                            {t.bring.map((b) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <Links links={t.links} example={example} />
                    </li>
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
  );
}

// Who draws it and who builds it: the owner's own drawings, the public designer registry, the trade
// registries, and the one-page plan to send.
export function GetItDone({ r, scanId, onShare }: { r: ScanResult; scanId: string; onShare: () => void }) {
  const { registry, selfDraw, designerCost, trades, cityNote } = r.pros;
  const designerUrl = registry.searchUrl ?? registry.url;
  const inPlay = (id?: string) => !id || (r.grants ?? []).some((g) => g.id === id && g.qualify !== "no");
  const hires = (trades ?? []).filter((t) => inPlay(t.program));
  return (
    <section className="block" id="get-it-done">
      <h2>Get it done</h2>
      <div className="paths">
        {selfDraw && (
          <article className="path">
            <p className="mono path-tag">Free</p>
            <h3>Draw the plans yourself</h3>
            <p>{selfDraw.detail}</p>
            {selfDraw.note && <p className="muted">{selfDraw.note}</p>}
            <Links links={[selfDraw.checklist, selfDraw.rule].filter((l): l is { label: string; url: string } => Boolean(l))} />
          </article>
        )}
        <article className="path">
          <p className="mono path-tag">{designerCost ? `${range(designerCost.lowCAD, designerCost.highCAD)}` : "Registered"}</p>
          <h3>Hire a registered designer</h3>
          {designerCost?.note && <p className="muted">{designerCost.note}</p>}
          {registry.howToSearch && <p>{registry.howToSearch}</p>}
          <a className="btn btn-primary" href={designerUrl} target="_blank" rel="noreferrer">
            Find a BCIN designer <span className="arrow" aria-hidden>→</span>
          </a>
          {registry.searchLinks && registry.searchLinks.length > 1 && <Links links={registry.searchLinks.slice(1)} />}
          {designerCost?.source?.url && (
            <a className="path-source" href={designerCost.source.url} target="_blank" rel="noreferrer">
              Cost source
            </a>
          )}
        </article>
        <article className="path">
          <p className="mono path-tag">Your plan</p>
          <h3>Send your plan to a designer</h3>
          <p>One page with the floor plan, the fixes, the money and these steps, ready to email or print.</p>
          <div className="path-actions">
            <a className="btn btn-ghost" href={`/scans/${scanId}/brief`}>
              One-page plan (PDF)
            </a>
            <button className="link-quiet" onClick={onShare}>
              Share my plan
            </button>
          </div>
        </article>
      </div>

      {hires.length > 0 && (
        <>
          <h3 className="trades-head">Check the trades you hire</h3>
          <ul className="ruled trades">
            {hires.map((t) => (
              <li key={t.url}>
                <div>
                  <b>{t.title}</b> <span className="muted">{t.detail}</span>
                </div>
                <a href={t.url} target="_blank" rel="noreferrer">
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="note">{cityNote ? `${cityNote} ` : ""}We don't recommend businesses either: these are public registries, so you can check anyone you hire.</p>
    </section>
  );
}

// One-click applications (server/apply/applications.ts): for each program they qualify for, the
// filled PDF, a ready email, or the online form's answers to copy, with the documents ticked off.
export function Applications({ scanId, r, profile, state, example, onSent }: { scanId: string; r: ScanResult; profile: Profile | null; state: WorkspaceState; example?: boolean; onSent: (id: string, sent: boolean) => void }) {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const money = { grants: r.grants ?? [], moneyAnswered: r.moneyAnswered ?? [] };
  const key = JSON.stringify([r.grants?.map((g) => [g.id, g.qualify]), profile, state.build?.pros?.length, state.build?.path]);
  useEffect(() => {
    void getApplications(scanId, money).then(setApps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, key]);
  if (!apps?.length) return null;
  const copy = async (label: string, value: string) => {
    await navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  };
  return (
    <section className="block apps" id="apply">
      <h2>Apply in a click or two</h2>
      <p className="lede">Filled in from what you've told us. You check it, sign it and send it.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="ruled">
        {apps.map((a) => {
          const sent = state.apply?.[a.id]?.sentAt;
          // The server flags the example's and the demo house's applications; the page knows too.
          const noSend = a.example || example;
          const sends = Boolean(a.pdf || a.email || a.link);
          return (
            <li key={a.id} className="app" data-qualify={a.qualify}>
              <div className="program-head">
                <h3>{a.shortName}</h3>
                <span className="program-worth mono">{a.worth}</span>
              </div>
              <p className="mono app-when">
                {a.when}
                {a.qualify === "ask" ? " · if you're eligible" : ""}
                {sent ? ` · sent ${new Date(sent).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : ""}
              </p>
              <ol className="app-steps">
                {a.steps.map((st) => (
                  <li key={st}>{st}</li>
                ))}
              </ol>
              <div className="app-actions">
                {a.pdf && (
                  <button
                    className="btn btn-primary"
                    disabled={busy !== null}
                    onClick={() => {
                      setBusy(a.id);
                      setError(null);
                      void downloadApplication(scanId, a.id, money)
                        .catch((err) => setError(err instanceof Error ? err.message : "That didn't download."))
                        .finally(() => setBusy(null));
                    }}
                  >
                    {busy === a.id ? "Filling it in…" : "Download the filled form"}
                  </button>
                )}
                {a.email && a.email.to && !noSend && (
                  <a className={a.pdf ? "btn btn-ghost" : "btn btn-primary"} href={mailto(a.email.to, a.email.subject, a.email.body)}>
                    Write the email
                  </a>
                )}
                {a.email && a.email.to && noSend && (
                  <button className={a.pdf ? "btn btn-ghost" : "btn btn-primary"} disabled title="The example can't send email">
                    Write the email
                  </button>
                )}
                {a.email && !a.email.to && (
                  <button className="btn btn-ghost" onClick={() => void copy(a.id, `${a.email!.subject}\n\n${a.email!.body}`)}>
                    {copied === a.id ? "Copied" : "Copy the email for your lender"}
                  </button>
                )}
                {a.link && (
                  <a className={a.pdf || a.email ? "link-quiet" : "btn btn-primary"} href={a.link.url} target="_blank" rel="noreferrer">
                    {a.link.label}
                  </a>
                )}
                {sends && !noSend && (
                  <button className="link-quiet sent-it" aria-pressed={Boolean(sent)} onClick={() => onSent(a.id, !sent)}>
                    {sent ? "Not sent after all" : "I sent it"}
                  </button>
                )}
              </div>
              {a.email && a.email.to && noSend && (
                <p className="app-example">
                  <span className="tag-mono">Example</span> It would go to <b>{a.email.to}</b>. Nothing made for the example or the demo house is sent.
                </p>
              )}
              {a.form && (
                <details className="app-form" open>
                  <summary>Your answers for the form</summary>
                  {a.form.sections.map((sec) => (
                    <div key={sec.title}>
                      <p className="mono app-section">{sec.title}</p>
                      <dl>
                        {sec.fields.map((f) => (
                          <div key={f.label}>
                            <dt>{f.label}</dt>
                            <dd>
                              {f.value ? (
                                <button className="app-copy" onClick={() => void copy(f.label, f.value!)} title="Copy">
                                  {f.value} <span className="mono">{copied === f.label ? "copied" : "copy"}</span>
                                </button>
                              ) : (
                                <span className="muted">Fill in yourself</span>
                              )}
                              {f.note && <span className="muted app-note">{f.note}</span>}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </details>
              )}
              {a.documents.length > 0 && (
                <ul className="app-docs">
                  {a.documents.map((d) => (
                    <li key={d.label} data-have={d.have || undefined}>
                      <span aria-hidden>{d.have ? "✓" : "○"}</span>
                      <span>
                        <b>{d.label}</b> <span className="muted">{d.how}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {a.warnings.map((w) => (
                <p key={w} className="note-inline">
                  {w}
                </p>
              ))}
              <a className="program-source" href={a.source.url} target="_blank" rel="noreferrer">
                Source
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
