// The Permit tab: the permit set, made the way a designer would. What's left before it can be
// submitted, one tap each: tape numbers for the main walls, the ceiling and each window, the owner's
// details, the bedrooms upstairs, a window wall's distance to the lot line, each sheet looked over,
// and a BCIN designer where one is needed. Then the clean submit copy, the City's portal, and what to
// upload where. The entrance and parking are traced on the aerial photo for the site plan.
import { useEffect, useRef, useState } from "react";
import { aerialUrl } from "../api";
import { downloadForm, downloadPermit, getDiy, getPermitStatus, mailto, openSheet, shareLink, type DiyPlan, type PermitInputs, type PermitStatus, type ReadyItem, type SiteFeature } from "../workspaceApi";
import type { TabProps } from "./Workspace";
import { ProfileForm, ProfileLine } from "./WorkspaceProfile";

const mm = (v: number | null | undefined) => (v == null ? "" : String(v));
const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s))) || null);

function Source({ s }: { s: { title: string; url: string; section?: string | null } }) {
  return (
    <a className="ws-source" href={s.url} target="_blank" rel="noreferrer">
      {s.section ? `${s.title}, ${s.section}` : s.title}
    </a>
  );
}

type EditorProps = TabProps & { status: PermitStatus; item: ReadyItem; savePermit: (patch: Partial<PermitInputs>) => Promise<void>; done: () => void };

// Numbers in millimetres, saved together.
function MmFields({ fields, onSave }: { fields: { key: string; label: string; value: number | null | undefined; help?: string }[]; onSave: (v: Record<string, number | null>) => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, mm(f.value)])));
  const [busy, setBusy] = useState(false);
  const ready = fields.every((f) => (draft[f.key] ?? "").trim() !== "");
  return (
    <form
      className="ws-ready-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onSave(Object.fromEntries(fields.map((f) => [f.key, num(draft[f.key] ?? "")]))).finally(() => setBusy(false));
      }}
    >
      <div className="ws-tape">
        {fields.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <span className="ws-mm">
              <input className="input" inputMode="numeric" value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value.replace(/[^0-9]/g, "") })} />
              <span className="mono">mm</span>
            </span>
            {f.help && <span className="field-help">{f.help}</span>}
          </label>
        ))}
      </div>
      <button className="btn btn-ghost" disabled={busy || !ready}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

const upsert = <T extends { id: string }>(list: T[] | undefined, item: T) => [...(list ?? []).filter((x) => x.id !== item.id), item];

// Tap where each bedroom of unit 1 is, over the house's outline (the basement's, with its stair).
function Upstairs({ ws, status, savePermit, done }: EditorProps) {
  const fp = status.footprint;
  const up = ws.state.permit?.upstairs ?? { bedrooms: [] };
  const [floor, setFloor] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  if (!fp) return <p className="muted">There's no outline of the house to tap on yet.</p>;
  const W = 1000, H = Math.round((1000 * fp.depthM) / fp.widthM);
  const floors = Math.max(1, Math.min(3, fp.storeys));
  const tap = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current!.getBoundingClientRect();
    const at: [number, number] = [Math.round(((e.clientX - box.left) / box.width) * 1000) / 1000, Math.round(((e.clientY - box.top) / box.height) * 1000) / 1000];
    const near = up.bedrooms.findIndex((b) => b.floor === floor && Math.hypot((b.at[0] - at[0]) * W, (b.at[1] - at[1]) * H) < 60);
    const bedrooms = near >= 0 ? up.bedrooms.filter((_, i) => i !== near) : [...up.bedrooms, { floor, at }];
    void savePermit({ upstairs: { bedrooms, none: false } });
  };
  const s = fp.stair;
  return (
    <div className="ws-upstairs">
      {floors > 1 && (
        <div className="ws-chips" role="tablist">
          {Array.from({ length: floors }, (_, i) => (
            <button key={i} className="chip" aria-pressed={floor === i + 1} onClick={() => setFloor(i + 1)}>
              {i === 0 ? "Main floor" : i === 1 ? "Second floor" : "Third floor"}
            </button>
          ))}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onPointerDown={tap} role="img" aria-label="The house's outline: tap where each bedroom is">
        <rect x={4} y={4} width={W - 8} height={H - 8} className="ws-up-house" />
        {s && <rect x={s.u0 * W} y={s.v0 * H} width={(s.u1 - s.u0) * W} height={(s.v1 - s.v0) * H} className="ws-up-stair" />}
        {s && (
          <text x={((s.u0 + s.u1) / 2) * W} y={((s.v0 + s.v1) / 2) * H + 10} textAnchor="middle" className="ws-up-label">
            Stairs
          </text>
        )}
        {up.bedrooms
          .filter((b) => b.floor === floor)
          .map((b, i) => (
            <g key={i}>
              <rect x={b.at[0] * W - 90} y={b.at[1] * H - 90} width={180} height={180} className="ws-up-bed" />
              <text x={b.at[0] * W} y={b.at[1] * H + 12} textAnchor="middle" className="ws-up-label">
                Bedroom
              </text>
            </g>
          ))}
      </svg>
      <div className="ws-actions">
        <button className="btn btn-ghost" disabled={!up.bedrooms.length} onClick={done}>
          Done
        </button>
        <label className="ws-check">
          <input type="checkbox" checked={Boolean(up.none)} onChange={(e) => void savePermit({ upstairs: { bedrooms: e.target.checked ? [] : up.bedrooms, none: e.target.checked } })} />
          <span>Unit 1 has no bedrooms</span>
        </label>
      </div>
      <p className="field-help">Tap a bedroom again to take it away. Each gets a smoke alarm on the drawings, and one goes outside them.</p>
    </div>
  );
}

function Designer({ scanId, ws, status, savePermit }: EditorProps) {
  const d = ws.state.permit?.designer ?? {};
  const [draft, setDraft] = useState({ name: d.name ?? "", bcin: d.bcin ?? "", firm: d.firm ?? "", firmBcin: d.firmBcin ?? "", email: d.email ?? "", phone: d.phone ?? "" });
  const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof draft, label: string, inputMode?: "numeric" | "email" | "tel") => (
    <label className="field">
      <span>{label}</span>
      <input className="input" inputMode={inputMode} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );
  const email = status.designer.email;
  return (
    <div className="ws-designer">
      {status.designer.reasons.length > 0 && (
        <ul className="ws-checklist">
          {status.designer.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p>
        Find one on the province's registry, QuARTS:{" "}
        <a href={status.designer.quarts} target="_blank" rel="noreferrer">
          search qualified designers <span aria-hidden>→</span>
        </a>
      </p>
      <dl className="ws-filters">
        {status.designer.filters.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {email && scanId !== "sample" && (
        <p>
          <a className="btn btn-ghost" href={mailto(draft.email, email.subject, email.body)}>
            Email them the brief
          </a>{" "}
          <span className="muted">With a link to the drawings: no forms, no phone or email.</span>
        </p>
      )}
      <form
        className="ws-ready-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          const clean = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim() || null]));
          void savePermit({ signer: "designer", designer: clean }).finally(() => setBusy(false));
        }}
      >
        <div className="ws-row">
          {field("name", "Designer's name")}
          {field("bcin", "BCIN", "numeric")}
          {field("firm", "Firm (if any)")}
          {field("firmBcin", "Firm's BCIN", "numeric")}
          {field("email", "Email", "email")}
          {field("phone", "Phone", "tel")}
        </div>
        <button className="btn btn-ghost" disabled={busy || !draft.name.trim() || !draft.bcin.trim()}>
          {busy ? "Saving…" : "Put them on the drawings"}
        </button>
      </form>
    </div>
  );
}

function Editor(props: EditorProps) {
  const { item, status, ws, scanId, save, savePermit, done } = props;
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, id] = item.id.split(/:(.*)/s);
  if (kind === "wall") {
    const w = status.mainWalls.find((x) => x.id === id);
    return <MmFields fields={[{ key: "mm", label: w ? `Taped length, ${w.label}` : "Taped length", value: (ws.state.permit?.walls ?? []).find((x) => x.id === id)?.mm }]} onSave={async (v) => { await savePermit({ walls: upsert(ws.state.permit?.walls, { id, mm: v.mm }) }); done(); }} />;
  }
  if (kind === "heights") {
    const t = ws.state.tape ?? {};
    const fields = [{ key: "ceilingMm", label: "Ceiling height", value: t.ceilingMm, help: "Floor to the underside of the joists, where unit 2's ceiling goes." }];
    if (status.overhead) fields.push({ key: "beamMm", label: "Under the lowest beam or duct", value: t.beamMm, help: "Floor to the bottom of the lowest beam or duct in unit 2." });
    return <MmFields fields={fields} onSave={async (v) => { await save({ state: { tape: { ...t, ...v } } }); done(); }} />;
  }
  if (kind === "window") {
    const w = status.windows.find((x) => x.id === id);
    const now = (ws.state.permit?.windows ?? []).find((x) => x.id === id);
    const t = ws.state.tape ?? {};
    return (
      <MmFields
        fields={[
          { key: "widthMm", label: `${w?.tag ?? "Window"}: clear width`, value: now?.widthMm ?? (w?.escape ? t.egressWidthMm : null), help: "The opening, with the window open as far as it goes." },
          { key: "heightMm", label: "Clear height", value: now?.heightMm ?? (w?.escape ? t.egressHeightMm : null) },
          { key: "sillMm", label: "Floor to sill", value: now?.sillMm ?? (w?.escape ? t.egressSillMm : null), help: "From the finished floor to the bottom of the opening." },
        ]}
        onSave={async (v) => {
          await savePermit({ windows: upsert(ws.state.permit?.windows, { id, widthMm: v.widthMm, heightMm: v.heightMm, sillMm: v.sillMm }) });
          // The escape window's sizes feed the materials list too.
          if (w?.escape) await save({ state: { tape: { ...t, egressWidthMm: v.widthMm, egressHeightMm: v.heightMm, egressSillMm: v.sillMm } } });
          done();
        }}
      />
    );
  }
  if (kind === "lot") {
    const now = (ws.state.permit?.lotLines ?? []).find((x) => x.id === id);
    return <MmFields fields={[{ key: "mm", label: "Wall to the lot line", value: now?.mm }]} onSave={async (v) => { await savePermit({ lotLines: upsert(ws.state.permit?.lotLines, { id, mm: v.mm }) }); done(); }} />;
  }
  if (kind === "owner") {
    if (!ws.profile) return <ProfileForm initial={null} prefill={ws.prefill} onSave={async (profile) => { await save({ profile }); done(); }} />;
    return <ProfileForm initial={ws.profile} prefill={ws.prefill} onSave={async (profile) => { await save({ profile }); done(); }} onCancel={done} />;
  }
  if (kind === "upstairs") return <Upstairs {...props} />;
  if (kind === "designer") return <Designer {...props} />;
  if (kind === "sheet") {
    const page = status.sheets.findIndex((s) => s.number === id) + 1;
    const reviewed = ws.state.permit?.reviewed ?? [];
    return (
      <div className="ws-actions">
        <button
          className="btn btn-ghost"
          disabled={opening}
          onClick={() => {
            setOpening(true);
            setError(null);
            void openSheet(scanId, page)
              .catch((e) => setError(e instanceof Error ? e.message : "That didn't open."))
              .finally(() => setOpening(false));
          }}
        >
          {opening ? "Opening…" : `Open ${id}`}
        </button>
        <button className="btn btn-ghost" onClick={() => void savePermit({ reviewed: [...reviewed.filter((r) => r.sheet !== id), { sheet: id, key: status.reviewKey }] }).then(done)}>
          It matches my basement
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    );
  }
  return null;
}

const GROUPS: { group: ReadyItem["group"]; title: string }[] = [
  { group: "tape", title: "Tape numbers" },
  { group: "windows", title: "Windows" },
  { group: "owner", title: "You" },
  { group: "upstairs", title: "Upstairs" },
  { group: "lot", title: "Lot line" },
  { group: "designer", title: "Designer" },
  { group: "review", title: "Look over each sheet" },
];

// "N things left before you can submit", one tap each.
function Readiness(props: TabProps & { status: PermitStatus }) {
  const { status, ws, save } = props;
  const [open, setOpen] = useState<string | null>(null);
  const savePermit = (patch: Partial<PermitInputs>) => save({ state: { permit: { ...(ws.state.permit ?? {}), ...patch } } });
  const total = status.items.length;
  return (
    <div className="ws-ready">
      <div className="ws-ready-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={total - status.left}>
        <span style={{ width: `${((total - status.left) / Math.max(1, total)) * 100}%` }} />
      </div>
      {GROUPS.map(({ group, title }) => {
        const items = status.items.filter((i) => i.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="ws-ready-group">
            <h3>{title}</h3>
            <ul>
              {items.map((item) => (
                <li key={item.id} data-done={item.done || undefined} data-open={open === item.id || undefined}>
                  <button className="ws-ready-item" aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? null : item.id)}>
                    <span className="ws-ready-tick" aria-hidden>
                      {item.done ? "✓" : ""}
                    </span>
                    <span>{item.label}</span>
                    <span className="ws-ready-state">{item.done ? "Done" : "To do"}</span>
                  </button>
                  {open === item.id && (
                    <div className="ws-ready-edit">
                      {item.group !== "review" && item.group !== "owner" && <p className="field-help">{item.detail}</p>}
                      <Editor {...props} item={item} savePermit={savePermit} done={() => setOpen(null)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const KINDS: { kind: SiteFeature["kind"]; label: string; help: string }[] = [
  { kind: "entrance", label: "Entrance", help: "Tap where the unit's door is." },
  { kind: "parking", label: "Parking", help: "Tap the corners of each parking space, then Done." },
  { kind: "walkway", label: "Walkway", help: "Tap along the path to the unit's door, then Done." },
];

// The lot, the house and what the owner traces, over the 2024 aerial photo.
function SiteTracer({ ws, save, r }: TabProps) {
  const site = ws.site;
  const p = r.property;
  const [mode, setMode] = useState<SiteFeature["kind"] | null>(null);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const features = ws.state.site?.features ?? [];
  const svgRef = useRef<SVGSVGElement>(null);
  if (!p || !site) return null;
  const hw = site.aerial.halfWidthM, hh = site.aerial.halfHeightM;
  // Metres around the address point to the photo's 0..1 frame (and back).
  const toUV = ([x, y]: [number, number]) => [(x / hw + 1) / 2, (1 - y / hh) / 2];
  const pts = (ring: [number, number][]) => ring.map((q) => toUV(q).map((v) => v * 1000).join(",")).join(" ");
  const commit = (next: SiteFeature[]) => void save({ state: { site: { features: next } } });
  const tap = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!mode) return;
    const box = svgRef.current!.getBoundingClientRect();
    const uv: [number, number] = [Math.round(((e.clientX - box.left) / box.width) * 1000) / 1000, Math.round(((e.clientY - box.top) / box.height) * 1000) / 1000];
    if (mode === "entrance") {
      commit([...features, { kind: "entrance", points: [uv] }]);
      setMode(null);
    } else setDraft([...draft, uv]);
  };
  const done = () => {
    if (mode && draft.length >= (mode === "parking" ? 3 : 2)) commit([...features, { kind: mode, points: draft }]);
    setDraft([]);
    setMode(null);
  };
  return (
    <section className="block">
      <h2>Mark the outside</h2>
      <p className="lede">The site plan needs the unit's entrance, the parking and the path between them. The lot and the house come from the City's maps.</p>
      <div className="ws-site">
        <div className="ws-site-map">
          <img src={aerialUrl(p)} alt={`${p.address} from above`} />
          <svg ref={svgRef} viewBox="0 0 1000 1000" onPointerDown={tap} data-mode={mode ?? undefined} role="img" aria-label="Lot, house and what you marked">
            {site.parcel && <polygon points={pts(site.parcel)} className="ws-lot" />}
            {site.footprint && <polygon points={pts(site.footprint)} className="ws-house" />}
            {features.map((f, i) =>
              f.kind === "entrance" ? (
                <circle key={i} cx={f.points[0][0] * 1000} cy={f.points[0][1] * 1000} r={14} className="ws-f-entrance" />
              ) : f.kind === "parking" ? (
                <polygon key={i} points={f.points.map((q) => `${q[0] * 1000},${q[1] * 1000}`).join(" ")} className="ws-f-parking" />
              ) : (
                <polyline key={i} points={f.points.map((q) => `${q[0] * 1000},${q[1] * 1000}`).join(" ")} className="ws-f-walkway" />
              ),
            )}
            {draft.length > 0 && <polyline points={draft.map((q) => `${q[0] * 1000},${q[1] * 1000}`).join(" ")} className="ws-f-draft" />}
          </svg>
        </div>
        <div className="ws-site-tools">
          {mode ? (
            <>
              <p>{KINDS.find((k) => k.kind === mode)!.help}</p>
              <div className="ws-actions">
                {mode !== "entrance" && (
                  <button className="btn btn-ghost" onClick={done}>
                    Done
                  </button>
                )}
                <button className="link-quiet" onClick={() => { setDraft([]); setMode(null); }}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="ws-chips">
              {KINDS.map((k) => (
                <button key={k.kind} className="chip" onClick={() => setMode(k.kind)}>
                  Add {k.label.toLowerCase()}
                </button>
              ))}
            </div>
          )}
          {features.length > 0 && (
            <ul className="ruled ws-features">
              {features.map((f, i) => (
                <li key={i}>
                  <span>{KINDS.find((k) => k.kind === f.kind)!.label}</span>
                  <button className="link-quiet" onClick={() => commit(features.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="note">Lot and house outlines: {site.sources.join("; ")}. Aerial photo: Region of Waterloo, 2024. Not a survey.</p>
        </div>
      </div>
    </section>
  );
}

export function PermitTab(props: TabProps) {
  const { r, scanId, ws, save } = props;
  const [plan, setPlan] = useState<DiyPlan | null>(null);
  const [status, setStatus] = useState<PermitStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusTry, setStatusTry] = useState(0);
  const statusAsk = useRef(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void getDiy(scanId).then(setPlan).catch(() => setPlan(null));
  }, [scanId, ws.state.tape, ws.state.ideas]);
  // What's left, asked again whenever the workspace changes. Only the newest answer counts (a save
  // fires several asks), and an ask that fails keeps what we knew: it never reads as "nothing left".
  useEffect(() => {
    const ask = ++statusAsk.current;
    setStatusFailed(false);
    void getPermitStatus(scanId)
      .then((s) => ask === statusAsk.current && setStatus(s))
      .catch(() => ask === statusAsk.current && setStatusFailed(true));
  }, [scanId, ws.state, ws.profile, statusTry]);
  const permit = plan?.permit ?? null;
  const run = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await f();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't download.");
    } finally {
      setBusy(null);
    }
  };
  const ownerSigns = status?.designer.signer === "owner";
  const fillable = (permit?.forms ?? []).filter((f) => f.fill === "acroform" && f.url && !(f.required === "owner_designer" && !ownerSigns));

  return (
    <div className="ws-permit">
      <section className="block">
        <h2>{!status ? "Your permit set" : status.left ? `${status.left} thing${status.left === 1 ? "" : "s"} left before you can submit` : "Ready to submit"}</h2>
        <p className="lede">
          {!status
            ? statusFailed
              ? "We couldn't check what's left just now."
              : "Checking what's left before you can submit…"
            : status.left
              ? `Drawings to scale from your scan, the City of ${plan?.city ?? r.city ?? "your city"}'s forms filled in. Answer each one below; the submit copy comes when nothing is left.`
              : `The clean set for the City of ${plan?.city ?? r.city ?? "your city"}: no draft marks, nothing left to fill in. Sign the statement box on each sheet, then upload it.`}
          {statusFailed && (
            <>
              {" "}
              <button className="link-quiet" onClick={() => setStatusTry((n) => n + 1)}>
                Try again
              </button>
            </>
          )}
        </p>
        {ws.profile && <ProfileLine {...props} />}
        {status && <Readiness {...props} status={status} />}
        <div className="ws-download">
          {status?.canSubmit && (
            <button className="btn btn-primary" disabled={busy !== null} onClick={() => void run("submit", () => downloadPermit(scanId, "submit"))}>
              {busy === "submit" ? "Making the submit copy…" : "Download the submit copy"}
            </button>
          )}
          <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void run("review", () => downloadPermit(scanId, "review"))}>
            {busy === "review" ? "Making your review copy…" : "Download the review copy"}
          </button>
          {permit && (
            <a className="btn btn-ghost" href={permit.portal.url} target="_blank" rel="noreferrer">
              Open the city portal <span className="arrow" aria-hidden>→</span>
            </a>
          )}
          {scanId !== "sample" && (
            <button
              className="link-quiet"
              onClick={() => {
                void navigator.clipboard?.writeText(shareLink(scanId)).then(() => setCopied(true));
              }}
            >
              {copied ? "Link copied: drawings only, no contact details" : "Copy a link to the drawings"}
            </button>
          )}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {fillable.length > 0 && scanId !== "sample" && (
          <p className="ws-forms">
            <span className="aside">Forms on their own, still editable:</span>
            {fillable.map((f) => (
              <button key={f.id} className="link-quiet" disabled={busy !== null} onClick={() => void run(f.id, () => downloadForm(scanId, f.id))}>
                {f.title}
              </button>
            ))}
          </p>
        )}
        {permit && status && (
          <div className="ws-signer">
            <h3>Who signs the drawings</h3>
            <p>{ownerSigns ? "You do, as the homeowner: the Code lets you design a unit in your own house. Schedule 1 says \"Homeowner\"." : status.designer.needed ? "A BCIN designer checks, finishes and signs them." : "Your designer signs them: their name and BCIN go in each sheet's statement box."}</p>
            {!permit.signerVerified && <p className="muted">The City's own pages disagree on this. Ask before you submit.</p>}
            <Source s={permit.signerSource} />
            {status.designer.ownerAllowed && (
              <label className="ws-check">
                <input type="checkbox" checked={ws.state.permit?.signer === "designer"} onChange={(e) => void save({ state: { permit: { ...(ws.state.permit ?? {}), signer: e.target.checked ? "designer" : "owner" } } })} />
                <span>I'd rather a designer finished and signed it</span>
              </label>
            )}
          </div>
        )}
      </section>

      <SiteTracer {...props} />

      {permit && (
        <section className="block">
          <h2>Submit it</h2>
          <p className="lede">On the {permit.portal.label}. What to upload, and where it is in your package:</p>
          <ul className="ruled ws-upload">
            {permit.upload.map((u) => (
              <li key={u.what}>
                <b>{u.what}</b> <span className="muted">{u.where}</span>
              </li>
            ))}
          </ul>
          <h3 className="ws-sub">What the City asks the drawings to show</h3>
          <ul className="ws-checklist">
            {permit.drawings.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <Source s={permit.drawingsSource} />
          {permit.scaleRule && <p className="muted">Drawn at {permit.scaleRule} where the basement fits on 11 x 17 paper.</p>}
        </section>
      )}

      {plan && (
        <section className="block">
          <h2>What needs a licensed pro</h2>
          <p className="lede">The rest you can draw, and much of it you can build. These you can't.</p>
          <ul className="ruled">
            {plan.needsPro.map((n) => (
              <li key={n.id} data-live={n.live || undefined}>
                <h3>{n.title}</h3>
                <p className="ws-who">{n.who}</p>
                <p>{n.detail}</p>
                {!n.live && <p className="muted">Only if your plan includes this.</p>}
                <p>
                  <Source s={n.source} />
                  {n.citySource && (
                    <>
                      {" · "}
                      <Source s={n.citySource} />
                    </>
                  )}
                  {n.registry && (
                    <>
                      {" · "}
                      <a href={n.registry.url} target="_blank" rel="noreferrer">
                        {n.registry.label}
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {permit && (
        <section className="block">
          <h2>Inspections, in order</h2>
          <p className="lede">Book each one before the work is covered up.</p>
          <ol className="ws-inspections">
            {permit.inspections.map((i) => (
              <li key={i.id}>
                <b>{i.title}</b> <span className="muted">{i.when}</span>
              </li>
            ))}
            <li>
              <b>ESA rough-in and final</b> <span className="muted">Booked with the Electrical Safety Authority, not the City</span>
            </li>
          </ol>
          <Source s={permit.inspectionsSource} />
        </section>
      )}
    </div>
  );
}
