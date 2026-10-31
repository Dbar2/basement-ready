// The Build tab: hire it, do it yourself, or a mix. No recommended businesses: the homeowner picks
// people from the public registries (QuARTS, ESA, TSSA), the workspace writes each a quote request
// and keeps track until there are three quotes from WSIB-covered contractors (the Region's loan needs
// them). For doing it yourself: who may do which work in Ontario, the materials list with local
// prices, the permits and pros you still pay, and the build order lined up with the inspections.
import { useEffect, useMemo, useState } from "react";
import { getDiy, mailto, shareLink, type DiyPlan, type Line, type Pro } from "../workspaceApi";
import type { TabProps } from "./Workspace";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const cents = (n: number) => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const range = (lo: number | null, hi: number | null) => (lo == null || hi == null ? "To be priced" : lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`);

const ROLES: { role: Pro["role"]; label: string }[] = [
  { role: "general", label: "General contractor" },
  { role: "designer", label: "Designer (BCIN)" },
  { role: "electrician", label: "Electrician" },
  { role: "plumber", label: "Plumber" },
  { role: "gas", label: "Gas fitter" },
  { role: "hvac", label: "Heating" },
  { role: "engineer", label: "Engineer" },
];

const WSIB_LOOKUP = "https://clearances.wsib.ca/Clearances/eclearance/start?lang=en";

function quoteBody(p: Pro, t: TabProps, scope: string) {
  const who = t.ws.profile?.owners.map((o) => `${o.first} ${o.last}`.trim()).join(" and ") || "[your name]";
  const addr = t.r.property ? `${t.r.property.address}, ${t.r.property.municipality}` : "our house";
  const role = ROLES.find((x) => x.role === p.role)?.label.toLowerCase() ?? "work";
  return [
    `Hello ${p.name},`,
    "",
    `We're adding a legal second unit in the basement at ${addr} and would like a quote for the ${role}.`,
    "",
    scope,
    "",
    t.scanId !== "sample" ? `Drawings and the measured plan: ${shareLink(t.scanId)}` : "",
    "",
    "Please include your WSIB clearance certificate and proof of liability insurance with the quote.",
    "",
    "Thank you,",
    who,
    t.ws.profile?.phone ?? "",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

function People(props: TabProps & { scope: string }) {
  const { r, ws, save } = props;
  const pros = ws.state.build?.pros ?? [];
  const [adding, setAdding] = useState<Pro["role"] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [registryId, setRegistryId] = useState("");
  const commit = (next: Pro[]) => void save({ state: { build: { ...(ws.state.build ?? {}), pros: next } } });
  const update = (id: string, patch: Partial<Pro>) => commit(pros.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = () => {
    if (!adding || !name.trim()) return;
    commit([...pros, { id: `${Date.now()}`, role: adding, name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, registryId: registryId.trim() || null, wsib: null, insured: null }]);
    setAdding(null);
    setName("");
    setEmail("");
    setPhone("");
    setRegistryId("");
  };
  const covered = pros.filter((p) => p.quoteCAD != null && p.wsib === true).length;
  const regionLoan = (r.grants ?? []).some((g) => g.id === "region_ontario_renovates_secondary_suites" && g.qualify !== "no");
  const reg = r.pros.registry;
  const trades = r.pros.trades ?? [];
  const links: { label: string; url: string; role: Pro["role"] }[] = [
    { label: "Designers registered for houses (QuARTS)", url: reg.searchUrl ?? reg.url, role: "designer" },
    ...trades.filter((t) => /electric/i.test(t.title)).map((t) => ({ label: t.label, url: t.url, role: "electrician" as const })),
    ...trades.filter((t) => /gas/i.test(t.title)).map((t) => ({ label: t.label, url: t.url, role: "gas" as const })),
  ];

  return (
    <section className="block">
      <h2>The people who build it</h2>
      <p className="lede">We don't recommend businesses. Look people up on the public registries, add the ones you like, and we'll write each a quote request with your drawings.</p>
      <ul className="ws-registries">
        {links.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noreferrer">
              {l.label} <span aria-hidden>→</span>
            </a>
          </li>
        ))}
        <li>
          <a href={WSIB_LOOKUP} target="_blank" rel="noreferrer">
            Check a contractor's WSIB clearance <span aria-hidden>→</span>
          </a>
        </li>
      </ul>
      {regionLoan && (
        <div className="ws-progress" data-done={covered >= 3 || undefined}>
          <span className="mono">{covered} of 3</span>
          <span>quotes from WSIB-covered contractors with liability insurance. The Region's forgivable loan needs three.</span>
        </div>
      )}
      {pros.length > 0 && (
        <ul className="ruled ws-pros">
          {pros.map((p) => (
            <li key={p.id}>
              <div className="ws-pro-head">
                <h3>{p.name}</h3>
                <span className="tag-mono">{ROLES.find((x) => x.role === p.role)?.label}</span>
              </div>
              <p className="muted">{[p.registryId, p.email, p.phone].filter(Boolean).join(" · ")}</p>
              <div className="ws-pro-actions">
                {p.email ? (
                  <>
                    {/* Opening the email isn't sending it: they say when they have. */}
                    <a className="btn btn-ghost" href={mailto(p.email, `Quote request: basement second unit${r.property ? `, ${r.property.address}` : ""}`, quoteBody(p, props, props.scope))}>
                      {p.requestedAt ? "Write again" : "Ask for a quote"}
                    </a>
                    <button className="link-quiet sent-it" aria-pressed={Boolean(p.requestedAt)} onClick={() => update(p.id, { requestedAt: p.requestedAt ? null : new Date().toISOString() })}>
                      {p.requestedAt ? "Not sent after all" : "I sent it"}
                    </button>
                  </>
                ) : (
                  <span className="muted">Add an email to send a quote request.</span>
                )}
                {p.requestedAt && <span className="ws-sent">Asked {new Date(p.requestedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</span>}
              </div>
              <div className="ws-quote">
                <label className="field">
                  <span>Their quote</span>
                  <input className="input" inputMode="numeric" defaultValue={p.quoteCAD ?? ""} placeholder="$" onBlur={(e) => update(p.id, { quoteCAD: e.target.value ? Number(e.target.value.replace(/[^0-9.]/g, "")) || null : null, quoteAt: e.target.value ? new Date().toISOString() : null })} />
                </label>
                <label className="ws-check">
                  <input type="checkbox" checked={p.wsib === true} onChange={(e) => update(p.id, { wsib: e.target.checked })} />
                  <span>WSIB clearance seen</span>
                </label>
                <label className="ws-check">
                  <input type="checkbox" checked={p.insured === true} onChange={(e) => update(p.id, { insured: e.target.checked })} />
                  <span>Liability insurance seen</span>
                </label>
                <button className="link-quiet" onClick={() => commit(pros.filter((x) => x.id !== p.id))}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="ws-add">
          <div className="ws-row">
            <label className="field">
              <span>Name or business</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>BCIN, ESA licence or TSSA number</span>
              <input className="input" value={registryId} onChange={(e) => setRegistryId(e.target.value)} />
            </label>
          </div>
          <div className="ws-row">
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
          <div className="ws-actions">
            <button className="btn btn-ghost" onClick={add} disabled={!name.trim()}>
              Add
            </button>
            <button className="link-quiet" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="ws-chips">
          {ROLES.map((x) => (
            <button key={x.role} className="chip" onClick={() => setAdding(x.role)}>
              Add {x.label.charAt(0).toLowerCase() + x.label.slice(1)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Materials({ plan }: { plan: DiyPlan }) {
  const t = plan.takeoff;
  const groups = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of t.lines) m.set(l.group, [...(m.get(l.group) ?? []), l]);
    return [...m.entries()];
  }, [t.lines]);
  return (
    <div className="ws-materials">
      {t.assumptions.map((a) => (
        <p key={a} className="note-inline">
          {a}
        </p>
      ))}
      {groups.map(([group, lines]) => (
        <details key={group} className="ws-group" open={group === "Framing"}>
          <summary>
            <span>{group}</span>
            <span className="mono">{money(lines.filter((l) => !l.only).reduce((s, l) => s + (l.totalCAD ?? 0), 0))}</span>
          </summary>
          <table className="ws-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Need</th>
                <th>Waste</th>
                <th>Buy</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={`${l.id}-${i}`} data-only={l.only ? true : undefined}>
                  <td>
                    <b>{l.item}</b>
                    <span className="muted ws-basis">{l.basis}</span>
                    {l.only && <span className="tag-mono">{l.only}</span>}
                  </td>
                  <td className="mono">
                    {l.need} {l.needUnit}
                  </td>
                  <td className="mono">{Math.round(l.waste * 100)}%</td>
                  <td className="mono">
                    {l.buy} {l.buyUnit}
                  </td>
                  <td>
                    {l.price ? (
                      <a href={l.price.url} target="_blank" rel="noreferrer" title={l.price.product}>
                        {cents(l.unitPriceCAD!)} · {l.price.retailer}
                      </a>
                    ) : (
                      <span className="muted">No local price found</span>
                    )}
                    {l.price && <span className="muted ws-basis">{l.price.store.split("(")[0].trim()}, {l.price.checked}</span>}
                  </td>
                  <td className="mono">{l.totalCAD != null ? money(l.totalCAD) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      <p className="note">Shelf prices before the 13% HST, checked {t.checked} at stores in Waterloo Region. Prices change; check before you buy.</p>
    </div>
  );
}

function Diy({ plan }: { plan: DiyPlan }) {
  const t = plan.totals;
  const OWNER = { yes: "You can", with_permit: "You can, with a permit", ask: "Ask your City first", no: "Hire a pro" } as const;
  return (
    <>
      <section className="block">
        <h2>Do it yourself</h2>
        <p className="lede">You can apply for the permit as the owner, draw the plans for your own house and be your own builder. Here's who may do which part.</p>
        {plan.ownerBuilder && (
          <p className="ws-owner-builder">
            {plan.ownerBuilder.detail}{" "}
            <a className="ws-source" href={plan.ownerBuilder.source.url} target="_blank" rel="noreferrer">
              {plan.ownerBuilder.source.title}
            </a>
          </p>
        )}
        <ul className="ruled ws-trades">
          {plan.trades.map((tr) => (
            <li key={tr.id} data-owner={tr.owner}>
              <div className="ws-pro-head">
                <h3>{tr.title}</h3>
                <span className="tag-mono">{OWNER[tr.owner]}</span>
              </div>
              <p>{tr.detail}</p>
              {!tr.verified && <p className="muted">{tr.notes ?? "Not fully confirmed: ask your City."}</p>}
              <p>
                <a className="ws-source" href={tr.source.url} target="_blank" rel="noreferrer">
                  {tr.source.section ? `${tr.source.title}, ${tr.source.section}` : tr.source.title}
                </a>
                {tr.registry && (
                  <>
                    {" · "}
                    <a href={tr.registry.url} target="_blank" rel="noreferrer">
                      {tr.registry.label}
                    </a>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <h2>Doing it yourself: about {range(t.diyLow, t.diyHigh)}</h2>
        <dl className="decision-facts ws-totals">
          <div>
            <dt>Do it yourself</dt>
            <dd className="mono">{range(t.diyLow, t.diyHigh)}</dd>
          </div>
          <div>
            <dt>Hired out</dt>
            <dd className="mono">{range(t.hiredLow, t.hiredHigh)}</dd>
          </div>
        </dl>
        <p className="lede">
          {t.fromQuote
            ? "Your quote's two totals, as your book has them. Doing it yourself: the materials, the permits and the pros the law still needs, with contingency and HST; your own time isn't counted. Hiring out: the whole job done by trades."
            : `Doing it yourself: every material for the finished unit (${money(plan.takeoff.materialsCAD)} plus ${money(plan.takeoff.hstCAD)} HST), the permits, and the pros you still pay; your own time isn't counted. Hiring out is the rough cost on your plan for the code work.`}
        </p>
        <ul className="ruled ws-costs">
          {[...plan.permits, ...plan.hires].map((c) => (
            <li key={c.id} data-only={c.only ? true : undefined}>
              <span>
                <b>{c.item}</b>
                {c.only && <span className="muted"> {c.only}</span>}
                {c.source && (
                  <a className="ws-source" href={c.source.url} target="_blank" rel="noreferrer">
                    {c.source.title}
                    {c.estimate ? " (estimate)" : ""}
                  </a>
                )}
              </span>
              <span className="mono">{range(c.lowCAD, c.highCAD)}</span>
            </li>
          ))}
        </ul>
        <h3 className="ws-sub">The materials list</h3>
        <Materials plan={plan} />
        {!plan.electrical.verified && <p className="note">Receptacle spacing: {plan.electrical.text}</p>}
      </section>

      <section className="block">
        <h2>The order to build in</h2>
        <p className="lede">Each step ends with the inspection that has to pass before anything gets covered.</p>
        <ol className="timeline ws-build-order">
          {plan.steps.map((s) => (
            <li key={s.n}>
              <span className="timeline-num">{s.n}</span>
              <div>
                <h3>{s.title}</h3>
                <p className="timeline-meta aside">{s.who}</p>
                <p className="muted">{s.detail}</p>
                {s.inspection && <p className="ws-inspection">Inspection: {s.inspection}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

export function BuildTab(props: TabProps) {
  const { scanId, ws, save, r } = props;
  const [plan, setPlan] = useState<DiyPlan | null>(null);
  const path = ws.state.build?.path ?? null;
  useEffect(() => {
    void getDiy(scanId).then(setPlan).catch(() => setPlan(null));
  }, [scanId, ws.state.tape, ws.state.ideas]);
  const scope = `The plan: ${r.layout?.kind === "studio" ? "a studio" : "a one-bedroom"} unit${r.plan ? ` of about ${Math.round(r.plan.areaM2)} m²` : ""}, with a bathroom, a kitchen, a fire separation between the homes and interconnected alarms. ${r.summary ?? ""}`.trim();
  const pick = (p: "hire" | "diy" | "mix") => void save({ state: { build: { ...(ws.state.build ?? {}), path: p } } });
  return (
    <div className="ws-build">
      <section className="block">
        <h2>Who builds it?</h2>
        <div className="ws-paths" role="radiogroup" aria-label="Who builds it">
          {(
            [
              ["hire", "Hire it out", "A general contractor runs it; you approve the quote."],
              ["mix", "A mix", "You run the job and do some of it; licensed trades do the rest."],
              ["diy", "Do it yourself", "You're the builder: materials list, permits and the order to build in."],
            ] as const
          ).map(([id, title, text]) => (
            <button key={id} role="radio" aria-checked={path === id} className="ws-path" onClick={() => pick(id)}>
              <b>{title}</b>
              <span>{text}</span>
            </button>
          ))}
        </div>
      </section>
      <People {...props} scope={scope} />
      {plan ? (path === "hire" ? <details className="block ws-diy-more"><summary>Thinking of doing some of it yourself?</summary><Diy plan={plan} /></details> : <Diy plan={plan} />) : <p className="viewer-empty mono ws-wait">Counting the materials…</p>}
    </div>
  );
}
