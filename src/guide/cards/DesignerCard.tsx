// The designer who signs the drawings, where one has to: found on the province's public registry
// (QuARTS, never a business we pick), sent a short brief with a link to the drawings, then their name
// and BCIN go in every sheet's statement box. Where the City lets the owner sign, they can choose that.
import { useState, type FormEvent } from "react";
import { mailto, type PermitInputs } from "../../workspaceApi";
import type { CardProps } from "../mount";
import { savePermit, useBuild } from "./data";
import { CardFrame, Loading, Problem, Saved, SaveButton } from "./parts";

type Designer = NonNullable<PermitInputs["designer"]>;
const FIELDS: { key: keyof Designer; label: string; mode?: "numeric" | "email" | "tel"; wide?: boolean }[] = [
  { key: "name", label: "Designer's name", wide: true },
  { key: "bcin", label: "BCIN", mode: "numeric" },
  { key: "firm", label: "Firm (if any)" },
  { key: "firmBcin", label: "Firm's BCIN", mode: "numeric" },
  { key: "email", label: "Email", mode: "email" },
  { key: "phone", label: "Phone", mode: "tel" },
];

export function DesignerCard({ scanId, card, act }: CardProps) {
  const { ws, status, result } = useBuild(scanId);
  const [editing, setEditing] = useState(false);
  if (!ws || !status) return <CardFrame card={card} label="Your designer"><Loading /></CardFrame>;
  const d = ws.state.permit?.designer ?? {};
  const done = status.items.some((i) => i.group === "designer" && i.done);
  if (done && !editing)
    return (
      <CardFrame card={card} label="Your designer">
        <Saved onChange={() => setEditing(true)}>
          {d.name}, BCIN {d.bcin}
        </Saved>
      </CardFrame>
    );
  const D = status.designer;
  // The example and the demo house can't send anything.
  const canSend = scanId !== "sample" && !result?.demo;
  return (
    <CardFrame card={card} label="Your designer">
      <p className="gc-lead">
        Find one on the province's registry:{" "}
        <a href={D.quarts} target="_blank" rel="noreferrer">
          QuARTS, qualified designers <span aria-hidden>→</span>
        </a>
      </p>
      {D.filters.length > 0 && (
        <dl className="gc-facts">
          {D.filters.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <DesignerForm
        initial={d}
        brief={canSend ? D.email : null}
        onSave={async (clean) => {
          await savePermit(scanId, { signer: "designer", designer: clean });
          setEditing(false);
          act({ type: "permitItem", itemId: "designer", value: { said: `${clean.name}, BCIN ${clean.bcin}` } });
        }}
      />
      {D.ownerAllowed && (
        <button
          type="button"
          className="link-quiet"
          onClick={() => void savePermit(scanId, { signer: "owner" }).then(() => act({ type: "permitItem", itemId: "designer", value: { said: "I'll sign the drawings myself" } }))}
        >
          I'll sign them myself instead
        </button>
      )}
    </CardFrame>
  );
}

function DesignerForm({ initial, brief, onSave }: { initial: Designer; brief: { subject: string; body: string } | null; onSave: (d: Designer) => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, initial[f.key] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const clean = Object.fromEntries(FIELDS.map((f) => [f.key, draft[f.key].trim() || null])) as Designer;
    void onSave(clean)
      .catch((err) => setError(err instanceof Error ? err.message : "That didn't save. Try again."))
      .finally(() => setBusy(false));
  };
  return (
    <form className="gc-form" onSubmit={send}>
      <div className="gc-row gc-two">
        {FIELDS.map((f) => (
          <label key={f.key} className={`gc-field${f.wide ? " gc-wide" : ""}`}>
            <span>{f.label}</span>
            <input className="input" inputMode={f.mode} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
          </label>
        ))}
      </div>
      {brief && draft.email.trim() && (
        <a className="link-quiet" href={mailto(draft.email.trim(), brief.subject, brief.body)}>
          Email them the brief, with a link to the drawings
        </a>
      )}
      <Problem text={error} />
      <SaveButton busy={busy} disabled={!draft.name.trim() || !draft.bcin.trim()}>
        Put them on the drawings
      </SaveButton>
    </form>
  );
}
