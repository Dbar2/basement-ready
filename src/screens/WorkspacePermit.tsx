// The Permit tab: we make the permit package here, the way a permit service would. Who draws and
// signs it in this city, three measurements only a tape can give, the entrance and parking traced on
// the aerial photo, then one PDF to download (drawings, the city's forms filled in, how to submit)
// and the city's portal with what to upload where.
import { useEffect, useRef, useState } from "react";
import { aerialUrl } from "../api";
import { downloadForm, downloadPermit, getDiy, shareLink, type DiyPlan, type SiteFeature } from "../workspaceApi";
import type { TabProps } from "./Workspace";
import { ProfileLine } from "./WorkspaceProfile";

const mm = (v: number | null | undefined) => (v == null ? "" : String(v));

function Source({ s }: { s: { title: string; url: string; section?: string | null } }) {
  return (
    <a className="ws-source" href={s.url} target="_blank" rel="noreferrer">
      {s.section ? `${s.title}, ${s.section}` : s.title}
    </a>
  );
}

function Tape(props: TabProps & { egressWidthM: number | null }) {
  const { ws, save, egressWidthM } = props;
  const t = ws.state.tape ?? {};
  const [draft, setDraft] = useState({ egressWidthMm: mm(t.egressWidthMm), egressHeightMm: mm(t.egressHeightMm), egressSillMm: mm(t.egressSillMm), ceilingMm: mm(t.ceilingMm), beamMm: mm(t.beamMm) });
  const fields: { key: keyof typeof draft; label: string; help: string }[] = [
    { key: "egressWidthMm", label: "Bedroom window: clear width", help: egressWidthM ? `The video says about ${Math.round(egressWidthM * 1000)} mm. Measure the opening, not the frame.` : "The opening, not the frame." },
    { key: "egressHeightMm", label: "Bedroom window: clear height", help: "With the window open as far as it goes." },
    { key: "egressSillMm", label: "Bedroom window: floor to sill", help: "From the finished floor to the bottom of the opening." },
    { key: "ceilingMm", label: "Ceiling height", help: "Floor to the underside of the joists, where the unit's ceiling will be." },
    { key: "beamMm", label: "Under the lowest beam or duct", help: "Floor to the bottom of the lowest beam or duct in the unit." },
  ];
  const commit = () => {
    const n = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.min(5000, Math.round(Number(s)))) || null);
    void save({ state: { tape: { egressWidthMm: n(draft.egressWidthMm), egressHeightMm: n(draft.egressHeightMm), egressSillMm: n(draft.egressSillMm), ceilingMm: n(draft.ceilingMm), beamMm: n(draft.beamMm) } } });
  };
  return (
    <section className="block">
      <h2>Five numbers from a tape</h2>
      <p className="lede">The video can't measure these closely enough for a permit. In millimetres; they go straight onto the drawings.</p>
      <div className="ws-tape">
        {fields.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <span className="ws-mm">
              <input className="input" inputMode="numeric" value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value.replace(/[^0-9]/g, "") })} onBlur={commit} />
              <span className="mono">mm</span>
            </span>
            <span className="field-help">{f.help}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

const KINDS: { kind: SiteFeature["kind"]; label: string; help: string }[] = [
  { kind: "entrance", label: "Entrance", help: "Tap where the unit's door is." },
  { kind: "parking", label: "Parking", help: "Tap the corners of each parking space, then Done." },
  { kind: "walkway", label: "Walkway", help: "Tap along the path to the unit's door, then Done." },
];

// The lot, the house and what the owner traces, over the 2026 aerial photo.
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
                  <button className="btn btn-primary" onClick={done}>
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
          <p className="note">Lot and house outlines: {site.sources.join("; ")}. Aerial photo: Region of Waterloo, 2026. Not a survey.</p>
        </div>
      </div>
    </section>
  );
}

export function PermitTab(props: TabProps) {
  const { r, scanId, ws, save } = props;
  const [plan, setPlan] = useState<DiyPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void getDiy(scanId).then(setPlan).catch(() => setPlan(null));
  }, [scanId, ws.state.tape, ws.state.ideas]);
  const permit = plan?.permit ?? null;
  const designer = ws.state.permit?.signer === "designer" || permit?.signer === "brief";
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
  const egress = r.layout?.window ?? null;
  const fillable = (permit?.forms ?? []).filter((f) => f.fill === "acroform" && f.url && !(f.required === "owner_designer" && designer));

  return (
    <div className="ws-permit">
      <section className="block">
        <h2>Your permit package</h2>
        <p className="lede">Drawings to scale from your scan, the City of {plan?.city ?? r.city ?? "your city"}'s forms filled in, and how to submit. You apply as the owner.</p>
        {ws.profile && <ProfileLine {...props} />}
        {permit && (
          <div className="ws-signer">
            <h3>Who draws and signs it</h3>
            <p>{designer && permit.signer === "owner" ? "A designer finishes and signs these drawings: the package becomes their design brief." : permit.signerNote}</p>
            {!permit.signerVerified && <p className="muted">The City's own pages disagree on this. Ask before you submit.</p>}
            <Source s={permit.signerSource} />
            {permit.signer === "owner" && (
              <label className="ws-check">
                <input type="checkbox" checked={ws.state.permit?.signer === "designer"} onChange={(e) => void save({ state: { permit: { ...(ws.state.permit ?? {}), signer: e.target.checked ? "designer" : "owner" } } })} />
                <span>A designer will finish and sign it</span>
              </label>
            )}
          </div>
        )}
        <div className="ws-download">
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => void run("all", () => downloadPermit(scanId))}>
            {busy === "all" ? "Making your package…" : "Download permit package"}
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
        {!ws.profile && <p className="muted">Add who owns the house above and the forms come filled in with your names.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {fillable.length > 0 && scanId !== "sample" && (
          <p className="ws-forms">
            <span className="mono">Forms on their own, still editable:</span>
            {fillable.map((f) => (
              <button key={f.id} className="link-quiet" disabled={busy !== null} onClick={() => void run(f.id, () => downloadForm(scanId, f.id))}>
                {f.title}
              </button>
            ))}
          </p>
        )}
      </section>

      <Tape {...props} egressWidthM={egress?.widthM ?? null} />
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
                <p className="mono ws-who">{n.who}</p>
                <p>{n.detail}</p>
                {!n.live && <p className="muted">Only if your plan includes this.</p>}
                <p>
                  <Source s={n.source} />
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
