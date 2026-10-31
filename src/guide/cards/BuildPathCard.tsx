// Who builds it: hire a contractor, run it with licensed trades for some of it, or do it all. Then the
// people, from the public registries only (QuARTS, ESA, TSSA; never a business we pick): each gets a
// quote request written from the drawings, and their quote is tracked, with the WSIB clearance the
// Region's loan asks for. Doing it yourself shows the materials and what you still pay pros for.
import { useEffect, useState } from "react";
import type { ScanResult } from "../../api";
import { getDiy, mailto, shareLink, type DiyPlan, type Pro, type Profile } from "../../workspaceApi";
import type { CardProps } from "../mount";
import { dollars, save, useBuild } from "./data";
import { CardFrame, Loading, Saved } from "./parts";

type Path = "hire" | "mix" | "diy";
const PATHS: { id: Path; title: string; text: string }[] = [
  { id: "hire", title: "Hire it out", text: "A general contractor runs it; you approve the quote." },
  { id: "mix", title: "A mix", text: "You run the job and do some of it; licensed trades do the rest." },
  { id: "diy", title: "Do it yourself", text: "You're the builder: the materials, the permits and the order to build in." },
];
const ROLES: { role: Pro["role"]; label: string }[] = [
  { role: "general", label: "General contractor" },
  { role: "designer", label: "Designer (BCIN)" },
  { role: "electrician", label: "Electrician" },
  { role: "plumber", label: "Plumber" },
  { role: "gas", label: "Gas fitter" },
  { role: "hvac", label: "Heating" },
];
const WSIB_LOOKUP = "https://clearances.wsib.ca/Clearances/eclearance/start?lang=en";
const REGION_LOAN = "region_ontario_renovates_secondary_suites";

export function BuildPathCard({ scanId, card, act }: CardProps) {
  const { ws, result } = useBuild(scanId);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ws || !result) return <CardFrame card={card} label="Who builds it"><Loading /></CardFrame>;
  const build = ws.state.build ?? {};
  const path = build.path ?? null;
  const choose = async (p: Path) => {
    setBusy(true);
    try {
      await save(scanId, { state: { build: { ...build, path: p } } });
      setEditing(false);
      act({ type: "permitItem", itemId: "path", value: { said: PATHS.find((x) => x.id === p)!.title } });
    } finally {
      setBusy(false);
    }
  };
  if (!path || editing)
    return (
      <CardFrame card={card} label="Who builds it">
        <div className="gc-options" role="group" aria-label="Who builds it">
          {PATHS.map((p) => (
            <button key={p.id} type="button" className="gc-option" aria-pressed={path === p.id} disabled={busy} onClick={() => void choose(p.id)}>
              <span className="gc-option-title">{p.title}</span>
              <span className="gc-option-text">{p.text}</span>
            </button>
          ))}
        </div>
      </CardFrame>
    );
  return (
    <CardFrame card={card} label="Who builds it">
      <Saved onChange={() => setEditing(true)}>{PATHS.find((x) => x.id === path)!.title}</Saved>
      {path !== "hire" && <DiySummary scanId={scanId} />}
      <People scanId={scanId} r={result} pros={build.pros ?? []} profile={ws.profile} onPros={(pros) => save(scanId, { state: { build: { ...build, pros } } })} />
    </CardFrame>
  );
}

function DiySummary({ scanId }: { scanId: string }) {
  const [plan, setPlan] = useState<DiyPlan | null>(null);
  useEffect(() => {
    void getDiy(scanId).then(setPlan).catch(() => setPlan(null));
  }, [scanId]);
  if (!plan) return null;
  const t = plan.totals;
  return (
    <p className="gc-lead">
      Doing it yourself comes to about <span className="mono">{dollars(t.diyLow)}–{dollars(t.diyHigh)}</span>, with materials from local stores and the pros you still pay ({plan.needsPro.length} jobs need a licensed trade). The full list is in your book.
    </p>
  );
}

function quoteBody(p: Pro, r: ScanResult, profile: Profile | null, scanId: string) {
  const who = profile?.owners.map((o) => `${o.first} ${o.last}`.trim()).join(" and ") || "[your name]";
  const addr = r.property ? `${r.property.address}, ${r.property.municipality}` : "our house";
  const role = ROLES.find((x) => x.role === p.role)?.label.toLowerCase() ?? "work";
  const scope = `The plan: ${r.design?.name ? r.design.name.toLowerCase() : "a one-bedroom unit"}${r.plan ? ` of about ${Math.round(r.plan.areaM2)} m²` : ""}, with a bathroom, a kitchen, a fire separation between the homes and interconnected alarms.`;
  return [`Hello ${p.name},`, "", `We're adding a legal second unit in the basement at ${addr} and would like a quote for the ${role}.`, "", scope, "", scanId !== "sample" ? `Drawings and the measured plan: ${shareLink(scanId)}` : "", "", "Please include your WSIB clearance certificate and proof of liability insurance with the quote.", "", "Thank you,", who, profile?.phone ?? ""]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

function People({ scanId, r, pros, profile, onPros }: { scanId: string; r: ScanResult; pros: Pro[]; profile: Profile | null; onPros: (pros: Pro[]) => Promise<void> }) {
  const [adding, setAdding] = useState<Pro["role"] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [registryId, setRegistryId] = useState("");
  const example = scanId === "sample" || Boolean(r.demo);
  const update = (id: string, patch: Partial<Pro>) => void onPros(pros.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = () => {
    if (!adding || !name.trim()) return;
    void onPros([...pros, { id: `${Date.now()}`, role: adding, name: name.trim(), email: email.trim() || null, registryId: registryId.trim() || null, wsib: null, insured: null }]);
    setAdding(null);
    setName("");
    setEmail("");
    setRegistryId("");
  };
  const reg = r.pros.registry;
  const trades = r.pros.trades ?? [];
  const links = [{ label: "Designers registered for houses (QuARTS)", url: reg.searchUrl ?? reg.url }, ...trades.filter((t) => /electric|gas/i.test(t.title)).map((t) => ({ label: t.label, url: t.url })), { label: "Check a contractor's WSIB clearance", url: WSIB_LOOKUP }];
  const covered = pros.filter((p) => p.quoteCAD != null && p.wsib === true).length;
  const regionLoan = (r.grants ?? []).some((g) => g.id === REGION_LOAN && g.qualify !== "no");
  return (
    <div className="gc-people">
      <p className="field-help">We don't recommend businesses. Look people up on the public registries, add the ones you like, and I'll write each a quote request.</p>
      <ul className="gc-links">
        {links.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noreferrer">
              {l.label} <span aria-hidden>→</span>
            </a>
          </li>
        ))}
      </ul>
      {regionLoan && (
        <p className="gc-lead">
          <span className="mono">{covered} of 3</span> quotes from WSIB-covered contractors. The Region's forgivable loan needs three.
        </p>
      )}
      {pros.length > 0 && (
        <ul className="gc-list gc-pros">
          {pros.map((p) => (
            <li key={p.id}>
              <span className="gc-list-name">
                {p.name} <span className="field-help">{ROLES.find((x) => x.role === p.role)?.label}</span>
              </span>
              <div className="gc-row">
                {p.email && !example ? (
                  <a className="chip" href={mailto(p.email, `Quote request: basement second unit${r.property ? `, ${r.property.address}` : ""}`, quoteBody(p, r, profile, scanId))}>
                    {p.requestedAt ? "Write again" : "Ask for a quote"}
                  </a>
                ) : null}
                {p.email && !example && (
                  <button type="button" className="link-quiet" aria-pressed={Boolean(p.requestedAt)} onClick={() => update(p.id, { requestedAt: p.requestedAt ? null : new Date().toISOString() })}>
                    {p.requestedAt ? "Not sent after all" : "I sent it"}
                  </button>
                )}
                <label className="gc-quote">
                  <span className="visually-hidden">Their quote</span>
                  <input className="input" inputMode="numeric" defaultValue={p.quoteCAD ?? ""} placeholder="Their quote, $" onBlur={(e) => update(p.id, { quoteCAD: e.target.value ? Number(e.target.value.replace(/[^0-9.]/g, "")) || null : null, quoteAt: e.target.value ? new Date().toISOString() : null })} />
                </label>
                <label className="gc-check">
                  <input type="checkbox" checked={p.wsib === true} onChange={(e) => update(p.id, { wsib: e.target.checked })} />
                  <span>WSIB seen</span>
                </label>
                <button type="button" className="link-quiet" onClick={() => void onPros(pros.filter((x) => x.id !== p.id))}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="gc-form">
          <div className="gc-row gc-two">
            <label className="gc-field">
              <span>Name or business</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label className="gc-field">
              <span>BCIN, ESA or TSSA number</span>
              <input className="input" value={registryId} onChange={(e) => setRegistryId(e.target.value)} />
            </label>
            <label className="gc-field gc-wide">
              <span>Email</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>
          <div className="gc-row">
            <button type="button" className="gc-save" onClick={add} disabled={!name.trim()}>
              Add
            </button>
            <button type="button" className="link-quiet" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="gc-row" role="group" aria-label="Add someone">
          {ROLES.map((x) => (
            <button key={x.role} type="button" className="chip" onClick={() => setAdding(x.role)}>
              + {x.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
