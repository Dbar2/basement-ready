// The owner profile, asked once: who owns the house and how to reach them. It goes on the permit
// forms, the grant applications and the quote requests, so nobody types their name twice. The lot's
// legal description and PIN come filled in when the City's parcel data has them.
import { useState } from "react";
import type { Profile } from "../workspaceApi";
import type { TabProps } from "./Workspace";

export function ProfileForm({ initial, prefill, onSave, onCancel }: { initial: Profile | null; prefill: TabProps["ws"]["prefill"]; onSave: (p: Profile) => Promise<void>; onCancel?: () => void }) {
  const seed = initial ?? prefill.fromOtherBasement;
  const [owners, setOwners] = useState(seed?.owners.length ? seed.owners : [{ first: "", last: "" }]);
  const [phone, setPhone] = useState(seed?.phone ?? "");
  const [email, setEmail] = useState(seed?.email ?? "");
  const [postalCode, setPostal] = useState(seed?.postalCode ?? "");
  const [legal, setLegal] = useState(initial?.legalDescription ?? prefill.legalDescription ?? "");
  const [pin, setPin] = useState(initial?.pin ?? prefill.pin ?? "");
  const [away, setAway] = useState(Boolean(seed?.mailingAddress));
  const [mailing, setMailing] = useState(seed?.mailingAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const named = owners.map((o) => ({ first: o.first.trim(), last: o.last.trim() })).filter((o) => o.first || o.last);
    if (!named.length) return setError("Add the name of at least one owner.");
    if (!/\S+@\S+\.\S+/.test(email)) return setError("Add an email address.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Add a phone number with its area code.");
    setBusy(true);
    setError(null);
    try {
      await onSave({ owners: named, phone: phone.trim(), email: email.trim(), postalCode: postalCode.trim().toUpperCase() || null, legalDescription: legal.trim() || null, pin: pin.trim() || null, rollNumber: initial?.rollNumber ?? prefill.rollNumber ?? null, mailingAddress: away ? mailing.trim() || null : null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ws-profile" onSubmit={(e) => void submit(e)}>
      <fieldset>
        <legend>Who owns the house</legend>
        {owners.map((o, i) => (
          <div className="ws-row" key={i}>
            <label className="field">
              <span>First name</span>
              <input className="input" autoComplete={i ? "off" : "given-name"} value={o.first} onChange={(e) => setOwners(owners.map((x, j) => (j === i ? { ...x, first: e.target.value } : x)))} />
            </label>
            <label className="field">
              <span>Last name</span>
              <input className="input" autoComplete={i ? "off" : "family-name"} value={o.last} onChange={(e) => setOwners(owners.map((x, j) => (j === i ? { ...x, last: e.target.value } : x)))} />
            </label>
          </div>
        ))}
        {owners.length < 3 && (
          <button type="button" className="link-quiet" onClick={() => setOwners([...owners, { first: "", last: "" }])}>
            Add another owner
          </button>
        )}
        <p className="field-help">Everyone on the deed: the forms ask for each owner.</p>
      </fieldset>
      <div className="ws-row">
        <label className="field">
          <span>Phone</span>
          <input className="input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <div className="ws-row">
        <label className="field">
          <span>Postal code</span>
          <input className="input" autoComplete="postal-code" value={postalCode} onChange={(e) => setPostal(e.target.value)} />
        </label>
        <label className="field">
          <span>PIN (property number)</span>
          <input className="input" value={pin} onChange={(e) => setPin(e.target.value)} />
          {prefill.pin && <span className="field-help">From the City's parcel map.</span>}
        </label>
      </div>
      <label className="field">
        <span>Legal description (plan and lot)</span>
        <input className="input" value={legal} onChange={(e) => setLegal(e.target.value)} placeholder="For example: PLAN 1234 LOT 56" />
        <span className="field-help">{prefill.legalDescription ? "From the City's records." : "It's on your tax bill or deed. You can add it later."}</span>
      </label>
      <label className="ws-check">
        <input type="checkbox" checked={away} onChange={(e) => setAway(e.target.checked)} />
        <span>I don't live at this house</span>
      </label>
      {away && (
        <label className="field">
          <span>Your mailing address</span>
          <input className="input" autoComplete="street-address" value={mailing} onChange={(e) => setMailing(e.target.value)} />
        </label>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="ws-actions">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        {onCancel && (
          <button type="button" className="link-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function ProfileCard({ ws, save }: TabProps) {
  return (
    <section className="block ws-profile-card">
      <h2>First, who owns the house?</h2>
      <p className="lede">We put your names on the permit forms, the grant applications and the quote requests. You type them once.</p>
      <ProfileForm initial={null} prefill={ws.prefill} onSave={(profile) => save({ profile })} />
    </section>
  );
}

// The saved profile, small, with a way to change it.
export function ProfileLine({ ws, save }: TabProps) {
  const [editing, setEditing] = useState(false);
  const p = ws.profile;
  if (!p) return null;
  if (editing) return <ProfileForm initial={p} prefill={ws.prefill} onSave={async (profile) => { await save({ profile }); setEditing(false); }} onCancel={() => setEditing(false)} />;
  return (
    <p className="ws-profile-line">
      <span>
        {p.owners.map((o) => `${o.first} ${o.last}`.trim()).join(" and ")} · {p.phone} · {p.email}
      </span>
      <button className="link-quiet" onClick={() => setEditing(true)}>
        Change
      </button>
    </p>
  );
}
