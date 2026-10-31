// Who owns the house, asked once: names, phone, email and postal code, for the permit forms, the grant
// applications and the quote requests. Someone who already gave them for another basement just
// confirms. The lot's legal description, PIN and a mailing address are optional, folded away.
import { useState, type FormEvent } from "react";
import type { Profile } from "../../workspaceApi";
import type { CardProps } from "../mount";
import { save, stepFor, useBuild } from "./data";
import { CardFrame, Loading, Problem, Saved, SaveButton } from "./parts";

const names = (p: Profile) => p.owners.map((o) => `${o.first} ${o.last}`.trim()).filter(Boolean).join(" and ");

export function OwnerCard({ scanId, card, act }: CardProps) {
  const { ws, status } = useBuild(scanId);
  const [editing, setEditing] = useState(false);
  if (!ws || !status) return <CardFrame card={card} label="The owners"><Loading /></CardFrame>;
  const done = status.items.some((i) => i.group === "owner" && i.done);
  const finish = async (p: Profile) => {
    await save(scanId, { profile: p });
    setEditing(false);
    act({ type: "permitItem", itemId: stepFor("owner"), value: { said: `${names(p)}, ${p.phone}, ${p.email}` } });
  };
  if (done && ws.profile && !editing)
    return (
      <CardFrame card={card} label="The owners">
        <Saved onChange={() => setEditing(true)}>
          {names(ws.profile)} · {ws.profile.email}
        </Saved>
      </CardFrame>
    );
  const other = !ws.profile ? ws.prefill.fromOtherBasement : null;
  return (
    <CardFrame card={card} label="The owners">
      {other && !editing ? <SameAsBefore p={other} onUse={() => finish({ ...other, legalDescription: ws.prefill.legalDescription, pin: ws.prefill.pin, rollNumber: ws.prefill.rollNumber })} onEdit={() => setEditing(true)} /> : <OwnerForm initial={ws.profile ?? other} prefill={ws.prefill} onSave={finish} />}
    </CardFrame>
  );
}

function SameAsBefore({ p, onUse, onEdit }: { p: Profile; onUse: () => Promise<void>; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="gc-form">
      <p className="gc-lead">The same as your other basement?</p>
      <p className="gc-quoted">
        {names(p)}
        <br />
        {p.phone} · {p.email}
      </p>
      <div className="gc-row">
        <button
          type="button"
          className="btn btn-primary gc-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onUse().finally(() => setBusy(false));
          }}
        >
          {busy ? "Saving…" : "Yes, use these"}
        </button>
        <button type="button" className="link-quiet" onClick={onEdit}>
          Change them
        </button>
      </div>
    </div>
  );
}

function OwnerForm({ initial, prefill, onSave }: { initial: Profile | null; prefill: { legalDescription: string | null; pin: string | null; rollNumber: string | null }; onSave: (p: Profile) => Promise<void> }) {
  const [owners, setOwners] = useState(initial?.owners.length ? initial.owners : [{ first: "", last: "" }]);
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [postalCode, setPostal] = useState(initial?.postalCode ?? "");
  const [legal, setLegal] = useState(initial?.legalDescription ?? prefill.legalDescription ?? "");
  const [pin, setPin] = useState(initial?.pin ?? prefill.pin ?? "");
  const [mailing, setMailing] = useState(initial?.mailingAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const named = owners.map((o) => ({ first: o.first.trim(), last: o.last.trim() })).filter((o) => o.first || o.last);
    if (!named.length) return setError("Add the name of at least one owner.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Add a phone number with its area code.");
    if (!/\S+@\S+\.\S+/.test(email)) return setError("Add an email address.");
    if (!postalCode.trim()) return setError("Add the house's postal code.");
    setBusy(true);
    setError(null);
    void onSave({
      owners: named,
      phone: phone.trim(),
      email: email.trim(),
      postalCode: postalCode.trim().toUpperCase(),
      legalDescription: legal.trim() || null,
      pin: pin.trim() || null,
      rollNumber: initial?.rollNumber ?? prefill.rollNumber ?? null,
      mailingAddress: mailing.trim() || null,
    })
      .catch((err) => setError(err instanceof Error ? err.message : "That didn't save. Try again."))
      .finally(() => setBusy(false));
  };
  return (
    <form className="gc-form" onSubmit={submit}>
      {owners.map((o, i) => (
        <div className="gc-row gc-two" key={i}>
          <label className="gc-field">
            <span>{i ? `Owner ${i + 1}, first name` : "First name"}</span>
            <input className="input" autoComplete={i ? "off" : "given-name"} value={o.first} onChange={(e) => setOwners(owners.map((x, j) => (j === i ? { ...x, first: e.target.value } : x)))} />
          </label>
          <label className="gc-field">
            <span>Last name</span>
            <input className="input" autoComplete={i ? "off" : "family-name"} value={o.last} onChange={(e) => setOwners(owners.map((x, j) => (j === i ? { ...x, last: e.target.value } : x)))} />
          </label>
        </div>
      ))}
      {owners.length < 3 && (
        <button type="button" className="link-quiet gc-add" onClick={() => setOwners([...owners, { first: "", last: "" }])}>
          Add another owner
        </button>
      )}
      <div className="gc-row gc-two">
        <label className="gc-field">
          <span>Phone</span>
          <input className="input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="gc-field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <label className="gc-field gc-short">
        <span>Postal code</span>
        <input className="input" autoComplete="postal-code" value={postalCode} onChange={(e) => setPostal(e.target.value)} />
      </label>
      <details className="gc-more">
        <summary>More for the forms (you can add it later)</summary>
        <label className="gc-field">
          <span>Legal description (plan and lot)</span>
          <input className="input" value={legal} onChange={(e) => setLegal(e.target.value)} placeholder="PLAN 1234 LOT 56" />
          <span className="field-help">It's on your tax bill or deed.</span>
        </label>
        <label className="gc-field gc-short">
          <span>PIN (property number)</span>
          <input className="input" value={pin} onChange={(e) => setPin(e.target.value)} />
        </label>
        <label className="gc-field">
          <span>Your mailing address, if you don't live there</span>
          <input className="input" autoComplete="street-address" value={mailing} onChange={(e) => setMailing(e.target.value)} />
        </label>
      </details>
      <p className="field-help">Only for your forms. Nothing is sent until you send it.</p>
      <Problem text={error} />
      <SaveButton busy={busy} />
    </form>
  );
}
