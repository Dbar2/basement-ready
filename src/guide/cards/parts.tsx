// The pieces every Build card is made of: a frame, number fields in millimetres, a save button (ink,
// never mint: the thread's one mint button is the guide's way on), and the line a card folds to once
// its answer is saved, with a way to change it.
import { useState, type FormEvent, type ReactNode } from "react";
import type { CardProps } from "../mount";
import { mmText, mmValue } from "./data";

export function CardFrame({ card, children, label }: { card: CardProps["card"]; children: ReactNode; label: string }) {
  return (
    <section className="gs-card gc" data-card={card.kind} aria-label={label}>
      {children}
    </section>
  );
}

// What's saved, in one line, and "Change" to open the card again.
export function Saved({ children, onChange }: { children: ReactNode; onChange?: () => void }) {
  return (
    <div className="gc-saved">
      <span className="status" data-status="ok">
        Saved
      </span>
      <span className="gc-saved-text">{children}</span>
      {onChange && (
        <button type="button" className="link-quiet" onClick={onChange}>
          Change
        </button>
      )}
    </div>
  );
}

export function SaveButton({ busy, disabled, children = "Save" }: { busy: boolean; disabled?: boolean; children?: ReactNode }) {
  return (
    <button className="gc-save" disabled={busy || disabled}>
      {busy ? "Saving…" : children}
    </button>
  );
}

export function Problem({ text }: { text: string | null }) {
  return text ? (
    <p className="field-error" role="alert">
      {text}
    </p>
  ) : null;
}

export type MmField = { key: string; label: string; value: number | null | undefined; placeholder?: string };

// Numbers in millimetres, one line each (what, the box, mm), typed together and saved together. The
// placeholder is what the video says; `note` is one line of how to measure, under them all.
export function MmForm({ fields, note, submit, onSave }: { fields: MmField[]; note?: string; submit?: string; onSave: (v: Record<string, number | null>) => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, mmText(f.value)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = fields.every((f) => (draft[f.key] ?? "").trim() !== "");
  const send = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    void onSave(Object.fromEntries(fields.map((f) => [f.key, mmValue(draft[f.key] ?? "")])))
      .catch((err) => setError(err instanceof Error ? err.message : "That didn't save. Try again."))
      .finally(() => setBusy(false));
  };
  return (
    <form className="gc-form" onSubmit={send}>
      <div className="gc-mm-rows">
        {fields.map((f) => (
          <label key={f.key} className="gc-mm">
            <span className="gc-mm-label">{f.label}</span>
            <input className="input" inputMode="numeric" autoComplete="off" placeholder={f.placeholder} value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value.replace(/[^0-9]/g, "") })} />
            <span className="mono" aria-hidden>
              mm
            </span>
          </label>
        ))}
      </div>
      {note && <p className="field-help">{note}</p>}
      <Problem text={error} />
      <SaveButton busy={busy} disabled={!ready}>
        {submit ?? "Save"}
      </SaveButton>
    </form>
  );
}

export function SourceLink({ s }: { s: { title: string; url: string; section?: string | null } }) {
  return (
    <a className="gc-source" href={s.url} target="_blank" rel="noreferrer">
      {s.section ? `${s.title}, ${s.section}` : s.title}
    </a>
  );
}

export function Loading() {
  return <p className="gc-loading">Opening your permit set…</p>;
}
