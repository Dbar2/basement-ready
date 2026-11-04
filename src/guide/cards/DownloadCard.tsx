// The papers. "review": the review copy, sheet by sheet, and "every sheet matches my basement" (it
// comes back if the drawings change). "submit": the clean set with no draft marks, the City's portal,
// what to upload where, and "I've handed it in". "book": the whole thing in one PDF. The PDFs are made
// by the server as before (server/permit, server/book); nothing here sends anything.
import { useEffect, useState } from "react";
import { downloadBook } from "../../book/bookApi";
import { downloadForm, downloadPermit, getDiy, openSheet, useDrawingsLink, type DiyPlan } from "../../workspaceApi";
import type { CardProps } from "../mount";
import { savePermit, stepFor, useBuild } from "./data";
import { CardFrame, Loading, Problem, Saved } from "./parts";

export function DownloadCard(props: CardProps) {
  if (props.card.id === "review") return <ReviewCard {...props} />;
  if (props.card.id === "submit") return <SubmitCard {...props} />;
  return <BookCard {...props} />;
}

// "2026-10-31" as "Oct 31", read as a local day (a bare date would otherwise be read as UTC midnight).
function dayOf(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

// A download's button: busy while the server draws it, an error if it can't.
function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (key: string, f: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    void f()
      .catch((err) => setError(err instanceof Error ? err.message : "That didn't download. Try again."))
      .finally(() => setBusy(null));
  };
  return { busy, error, run };
}

function ReviewCard({ scanId, card, act }: CardProps) {
  const { status } = useBuild(scanId);
  const { busy, error, run } = useRun();
  const [editing, setEditing] = useState(false);
  if (!status) return <CardFrame card={card} label="Look over the drawings"><Loading /></CardFrame>;
  const done = status.items.filter((i) => i.group === "review").every((i) => i.done);
  if (done && !editing)
    return (
      <CardFrame card={card} label="Look over the drawings">
        <Saved onChange={() => setEditing(true)}>Every sheet matches your basement</Saved>
      </CardFrame>
    );
  return (
    <CardFrame card={card} label="Look over the drawings">
      <button type="button" className="btn btn-ghost gc-btn" disabled={busy !== null} onClick={() => run("review", () => downloadPermit(scanId, "review"))}>
        {busy === "review" ? "Drawing your review copy…" : "Download the review copy"}
      </button>
      <ul className="gc-sheets" aria-label="The sheets">
        {status.sheets.map((s, i) => (
          <li key={s.number}>
            <button type="button" className="link-quiet" disabled={busy !== null} onClick={() => run(s.number, () => openSheet(scanId, i + 1))}>
              <span className="mono">{s.number}</span> {s.title}
            </button>
          </li>
        ))}
      </ul>
      <Problem text={error} />
      <div className="gc-row">
        <button
          type="button"
          className="btn btn-primary gc-btn"
          disabled={busy !== null}
          onClick={() =>
            run("ok", async () => {
              await savePermit(scanId, { reviewed: status.sheets.map((s) => ({ sheet: s.number, key: status.reviewKey })) });
              setEditing(false);
              act({ type: "permitItem", itemId: stepFor("review"), value: { said: "Every sheet matches my basement" } });
            })
          }
        >
          Every sheet matches my basement
        </button>
        <button type="button" className="link-quiet" onClick={() => act({ type: "go", to: "design" })}>
          Something's off
        </button>
      </div>
    </CardFrame>
  );
}

function SubmitCard({ scanId, card, act }: CardProps) {
  const { ws, status, result } = useBuild(scanId);
  const { busy, error, run } = useRun();
  const [plan, setPlan] = useState<DiyPlan | null>(null);
  useEffect(() => {
    void getDiy(scanId).then(setPlan).catch(() => setPlan(null));
  }, [scanId]);
  if (!ws || !status || !result) return <CardFrame card={card} label="Hand it in"><Loading /></CardFrame>;
  const permit = plan?.permit ?? null;
  const example = scanId === "sample" || Boolean(result.demo);
  const ownerSigns = status.designer.signer === "owner";
  const forms = (permit?.forms ?? []).filter((f) => f.fill === "acroform" && f.url && !(f.required === "owner_designer" && !ownerSigns));
  const handedIn = ws.state.permit?.submittedAt;
  if (!status.canSubmit)
    return (
      <CardFrame card={card} label="Hand it in">
        <p className="field-help">
          {status.left} thing{status.left === 1 ? "" : "s"} left before the submit copy.
        </p>
      </CardFrame>
    );
  return (
    <CardFrame card={card} label="Hand it in">
      {/* Mint while it's the way on; a hairline once handed in, when the guide's next button is the one. */}
      <button type="button" className={handedIn ? "btn btn-ghost gc-btn" : "btn btn-primary gc-btn"} disabled={busy !== null} onClick={() => run("submit", () => downloadPermit(scanId, "submit"))}>
        {busy === "submit" ? "Making the submit copy…" : "Download the submit copy "}
        <span className="arrow" aria-hidden>
          ↓
        </span>
      </button>
      <p className="field-help">Sign each sheet's statement box{ownerSigns ? " as the designer" : ""}, then upload it.</p>
      {permit && (
        <>
          <a className="link-quiet" href={permit.portal.url} target="_blank" rel="noreferrer">
            Open the {permit.portal.label} <span aria-hidden>→</span>
          </a>
          {permit.upload.length > 0 && (
            <details className="gc-more">
              <summary>What to upload, and where it is in your set</summary>
              <ul className="gc-list gc-upload">
                {permit.upload.map((u) => (
                  <li key={u.what}>
                    <span className="gc-list-name">{u.what}</span>
                    <span className="field-help">{u.where}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {forms.length > 0 && !example && (
        <p className="gc-forms">
          <span className="field-help">The City's forms on their own, still editable:</span>{" "}
          {forms.map((f) => (
            <button key={f.id} type="button" className="link-quiet" disabled={busy !== null} onClick={() => run(f.id, () => downloadForm(scanId, f.id))}>
              {f.title}
            </button>
          ))}
        </p>
      )}
      <Problem text={error} />
      {handedIn ? (
        <Saved>{example ? "Done" : `Handed in ${dayOf(handedIn)}`}</Saved>
      ) : (
        <button
          type="button"
          className="link-quiet"
          disabled={busy !== null}
          onClick={() =>
            run("in", async () => {
              // Today here, not in UTC: a hand-in at 9 PM in Waterloo is still today.
              await savePermit(scanId, { submittedAt: new Date().toLocaleDateString("en-CA") });
              act({ type: "permitItem", itemId: stepFor("submit"), value: { said: example ? "Done with the example's permit set" : "I've handed it in" } });
            })
          }
        >
          {example ? "Done with the permit set" : "I've handed it in"}
        </button>
      )}
    </CardFrame>
  );
}

function BookCard({ scanId, card }: CardProps) {
  const { result } = useBuild(scanId);
  const { busy, error, run } = useRun();
  const [copied, setCopied] = useState(false);
  // The signed drawings link, looked up before the tap (src/workspaceApi.ts drawingsLink).
  const link = useDrawingsLink(scanId, scanId !== "sample" && !result?.demo);
  return (
    <CardFrame card={card} label="Your book">
      <button type="button" className="btn btn-ghost gc-btn" disabled={busy !== null} onClick={() => run("book", () => downloadBook(scanId))}>
        {busy === "book" ? "Putting your book together…" : "Download your book (PDF)"}
      </button>
      {link && (
        <button type="button" className="link-quiet" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
          {copied ? "Link copied: drawings only, no contact details" : "Copy a link to the drawings for a designer"}
        </button>
      )}
      <Problem text={error} />
    </CardFrame>
  );
}
