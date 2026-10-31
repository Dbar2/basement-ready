// The money. A question card shows what its answer decides: each program, what it could be worth and
// its source (the answer itself is the guide's buttons). The "apply" card lays out the applications
// that go in before any work starts, filled in from what they've told us (server/apply), each marked
// sent or "not for me" so a loan they don't want never holds up the list.
import { useEffect, useState } from "react";
import { getApplications, downloadApplication, mailto, type Application } from "../../workspaceApi";
import type { CardProps } from "../mount";
import { dollars, save, stepFor, useBuild } from "./data";
import { CardFrame, Loading, Problem, SourceLink } from "./parts";

export function MoneyQuestionCard(props: CardProps) {
  return props.card.id === "apply" ? <ApplyCard {...props} /> : <DecidesCard {...props} />;
}

function DecidesCard({ scanId, card }: CardProps) {
  const { result } = useBuild(scanId);
  if (!result) return <CardFrame card={card} label="What this decides"><Loading /></CardFrame>;
  const programs = (result.grants ?? []).filter((g) => g.question === card.id);
  if (!programs.length) return null;
  return (
    <CardFrame card={card} label="What this decides">
      <ul className="gc-list">
        {programs.map((g) => (
          <li key={g.id}>
            <span className="gc-list-name">{g.shortName}</span>
            <span className="mono">{g.value === "cash" && g.amountCAD ? `up to ${dollars(g.amountCAD)}` : g.value === "financing" ? "a loan" : "saves fees"}</span>
            <SourceLink s={g.source} />
          </li>
        ))}
      </ul>
    </CardFrame>
  );
}

// Programs that want an application before the work starts (server/guide/build.ts asks the same).
const applyFirst = (g: { qualify: string; apply: { when: string } | null }) => g.qualify === "yes" && Boolean(g.apply) && (g.apply!.when === "before_work" || g.apply!.when === "at_permit");

function ApplyCard({ scanId, card, act }: CardProps) {
  const { result, ws } = useBuild(scanId);
  const [apps, setApps] = useState<Application[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grants = result?.grants ?? [];
  const first = grants.filter(applyFirst);
  const key = JSON.stringify([grants.map((g) => [g.id, g.qualify]), ws?.profile?.email]);
  useEffect(() => {
    if (!result) return;
    void getApplications(scanId, { grants, moneyAnswered: result.moneyAnswered ?? [] })
      .then(setApps)
      .catch(() => setApps([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, key]);
  if (!result || !ws || !apps) return <CardFrame card={card} label="Apply first"><Loading /></CardFrame>;
  const said = ws.state.apply ?? {};
  const example = scanId === "sample" || Boolean(result.demo);

  const mark = async (id: string, sent: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const apply = { ...said, [id]: { sentAt: sent ? new Date().toISOString() : null } };
      await save(scanId, { state: { apply } });
      if (first.every((g) => g.id in apply))
        act({
          type: "permitItem",
          itemId: stepFor("apply"),
          value: { said: first.map((g) => `${g.shortName}: ${apply[g.id]?.sentAt ? "sent" : example ? "seen" : "not for me"}`).join("; ") },
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <CardFrame card={card} label="Apply before work starts">
      <ul className="gc-apps">
        {first.map((g) => {
          const a = apps.find((x) => x.id === g.id);
          const answered = g.id in said;
          return (
            <li key={g.id} data-answered={answered || undefined}>
              <p className="gc-list-name">
                {g.shortName} <span className="mono">{a?.worth ?? ""}</span>
              </p>
              {a && <p className="field-help">{a.steps[0]}</p>}
              <div className="gc-row">
                {a?.pdf && (
                  <button
                    type="button"
                    className="chip"
                    disabled={busy !== null}
                    onClick={() => {
                      setBusy(`pdf:${g.id}`);
                      void downloadApplication(scanId, g.id, { grants, moneyAnswered: result.moneyAnswered ?? [] })
                        .catch((err) => setError(err instanceof Error ? err.message : "That didn't download."))
                        .finally(() => setBusy(null));
                    }}
                  >
                    {busy === `pdf:${g.id}` ? "Filling it in…" : "The filled form"}
                  </button>
                )}
                {a?.email?.to && !example && (
                  <a className="chip" href={mailto(a.email.to, a.email.subject, a.email.body)}>
                    Write the email
                  </a>
                )}
                {a?.email && !a.email.to && (
                  <button type="button" className="chip" onClick={() => void navigator.clipboard?.writeText(`${a.email!.subject}\n\n${a.email!.body}`)}>
                    Copy the email for your lender
                  </button>
                )}
                {a?.link && (
                  <a className="chip" href={a.link.url} target="_blank" rel="noreferrer">
                    {a.link.label}
                  </a>
                )}
              </div>
              {answered ? (
                <p className="status" data-status={said[g.id]?.sentAt ? "ok" : "check"}>
                  {said[g.id]?.sentAt ? "Sent" : example ? "Seen" : "Not for me"}
                </p>
              ) : (
                <div className="gc-row">
                  {example ? (
                    <button type="button" className="btn btn-ghost gc-btn" disabled={busy !== null} onClick={() => void mark(g.id, false)}>
                      Got it
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-ghost gc-btn" disabled={busy !== null} onClick={() => void mark(g.id, true)}>
                        I sent it
                      </button>
                      <button type="button" className="link-quiet" disabled={busy !== null} onClick={() => void mark(g.id, false)}>
                        Not for me
                      </button>
                    </>
                  )}
                </div>
              )}
              <SourceLink s={g.source} />
            </li>
          );
        })}
      </ul>
      {example && <p className="field-help">The example shows each application, but nothing made for it is sent.</p>}
      <Problem text={error} />
    </CardFrame>
  );
}
