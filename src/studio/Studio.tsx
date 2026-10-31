// /scans/:id/studio, "Your basement, designed" (step 4 of the flow): the layout they picked inside their
// real scan, permit-ready from the start. Walk it, drag walls and doors in the 3D or on the plan, tap a
// fix, or describe a change for muse-spark to propose. The checks and the quote follow every edit; it
// saves as you go. Then the pictures.
import { useParams } from "@tanstack/react-router";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkDesign, tally } from "../../server/model/checks";
import { fixCount, fixesWord } from "../../server/model/fixes";
import { applyEdit, applyEdits } from "../../server/model/edit";
import { wallLength } from "../../server/model/geometry";
import type { Check, Design, Edit, Model, Opening, Pt, Wall } from "../../server/model/types";
import { FlowFoot, FlowHead, FlowLink } from "../flow/FlowNav";
import { stepUrl } from "../flow/flow";
import { fmtLength, type Units } from "../components/FloorPlan";
import { lazy3d, View3DBoundary } from "../components/View3D";
import { getScan } from "../api";
import { describeChange, loadModel, saveModel, type Proposal } from "./api";
import { basisOf, cad, quoteFor } from "./cost";
import { useHistory } from "./history";
import { frameOf, PlanSvg, type Picked } from "./PlanSvg";
import type { View } from "./Studio3D";
import "./studio.css";

const Studio3D = lazy3d(() => import("./Studio3D").then((m) => m.Studio3D));

const FINISHES = [
  { key: "light", label: "Light oak" },
  { key: "warm", label: "Warm wood" },
  { key: "deep", label: "Deep green" },
] as const;
type FinishKey = (typeof FINISHES)[number]["key"];

function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function Studio() {
  const { scanId } = useParams({ from: "/scans/$scanId/studio" });
  const [model, setModel] = useState<Model | null>(null);
  const [municipality, setMunicipality] = useState<string | undefined>(undefined);
  // The basement's own fixes from the answer: the studio counts them with the design's, as the headline does.
  const [base, setBase] = useState<{ category: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = "Your basement, designed | Basement Ready";
    loadModel(scanId)
      .then((r) => setModel(r.model))
      .catch((e) => setError(e instanceof Error ? e.message : "We couldn't open your design."));
    void getScan(scanId)
      .then((s) => {
        setMunicipality(s.result?.municipality);
        setBase((s.result?.fixGroups ?? []).filter((g) => !g.fromDesign));
      })
      .catch(() => {});
  }, [scanId]);
  return (
    <MotionConfig reducedMotion="user">
      <div className="flow-page studio-page">
        <FlowHead scanId={scanId} step="studio" />
        {error ? (
          <p className="error studio-wait">{error}</p>
        ) : model && model.designs.length ? (
          <Editor scanId={scanId} initial={model} municipality={municipality} base={base} />
        ) : model ? (
          <p className="studio-wait muted">There's no design for this basement yet: it needs a measured plan.</p>
        ) : (
          <div className="studio-wait flow-body" aria-busy="true">
            <div className="skeleton skeleton-3d" />
          </div>
        )}
        <FlowFoot scanId={scanId} step="studio" next={{ label: "See it in pictures", href: stepUrl(scanId, "pictures"), disabled: !model?.designs.length }} />
      </div>
    </MotionConfig>
  );
}

function Editor({ scanId, initial, municipality, base }: { scanId: string; initial: Model; municipality?: string; base: { category: string }[] | null }) {
  const reduced = useReducedMotion();
  const [model, setModel] = useState(initial);
  const first = initial.designs.find((d) => d.chosen) ?? initial.designs[0];
  const hist = useHistory<Design>(first);
  const design = hist.shown;
  const existing = model.existing;
  const frame = useMemo(() => frameOf(existing, 0.6), [existing]);
  const [view, setView] = useState<View>("overview");
  const [layer, setLayer] = useState<"built" | "scan">("built");
  const [pane, setPane] = useState<"3d" | "plan">("3d");
  const [units, setUnits] = useState<Units>("m");
  const [picked, setPicked] = useState<Picked>(null);
  const [marker, setMarker] = useState<Pt | null>(null);
  const [panel, setPanel] = useState<"checks" | "cost" | "describe" | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");

  // The checks follow what's committed; the cost follows the finger.
  const checks = useMemo(() => checkDesign(hist.present, existing), [hist.present, existing]);
  const count = tally(checks);
  const fixes = useMemo(() => (base ? fixCount(base, hist.present, existing) : null), [base, hist.present, existing]);
  const quote = useMemo(() => quoteFor(model, design, municipality), [model, design, municipality]);

  // Each committed change goes into the model, which saves itself a moment later.
  const loaded = useRef(true);
  useEffect(() => {
    setModel((m) => ({ ...m, designs: m.designs.map((d) => (d.id === hist.present.id ? { ...hist.present, chosen: true } : { ...d, chosen: false })) }));
  }, [hist.present]);
  useEffect(() => {
    if (loaded.current) {
      loaded.current = false;
      return;
    }
    setSaved("saving");
    const t = window.setTimeout(() => {
      saveModel(scanId, model)
        .then(() => setSaved("saved"))
        .catch(() => setSaved("error"));
    }, 700);
    return () => clearTimeout(t);
  }, [model, scanId]);

  const edit = useCallback((e: Edit, done = true) => (done ? hist.commit(applyEdit(hist.present, e)) : hist.preview(applyEdit(hist.present, e))), [hist]);
  const pick = (d: Design) => {
    if (d.id === hist.present.id) return;
    setPicked(null);
    setMarker(null);
    hist.reset({ ...(model.designs.find((x) => x.id === d.id) ?? d), chosen: true });
  };
  const canDragWall = useCallback((w: Wall) => w.kind === "new", []);
  const canDragOpening = useCallback((o: Opening) => o.kind === "door" && design.proposed.walls.some((w) => w.id === o.wallId && w.kind === "new"), [design]);
  const finish = (FINISHES.some((f) => f.key === design.finishes.style) ? design.finishes.style : "light") as FinishKey;
  const showMe = (c: Check) => {
    setMarker(c.at ?? null);
    if (window.matchMedia("(max-width: 899px)").matches) setPane("plan");
  };

  const wall = picked?.kind === "wall" ? design.proposed.walls.find((w) => w.id === picked.id) : null;
  const door = picked?.kind === "opening" ? design.proposed.openings.find((o) => o.id === picked.id && o.kind === "door") : null;

  return (
    <div className="studio-body flow-body">
      <section className="studio-main">
        <div className="studio-title">
          <div>
            <h1>Your basement, designed</h1>
            <p className="lede">Drag a wall or a door, walk through it, or describe a change.</p>
          </div>
          <div className="ws-chips" role="radiogroup" aria-label="Design">
            {model.designs.map((d) => (
              <button key={d.id} className="chip" role="radio" aria-checked={d.id === hist.present.id} aria-pressed={d.id === hist.present.id} onClick={() => pick(d)}>
                {d.name}
              </button>
            ))}
            {!existing.confirmedAt && (
              <FlowLink href={stepUrl(scanId, "plan")} className="link-quiet">
                Check the plan
              </FlowLink>
            )}
          </div>
        </div>

        <div className="studio-panes" data-pane={pane}>
          <div className="segmented small pane-switch" role="tablist" aria-label="View">
            <button role="tab" aria-selected={pane === "3d"} onClick={() => setPane("3d")}>3D</button>
            <button role="tab" aria-selected={pane === "plan"} onClick={() => setPane("plan")}>Plan</button>
          </div>
          <div className="studio-3d" data-shown={pane === "3d"}>
            <View3DBoundary>
              <Suspense fallback={<p className="viewer-empty">Building your basement in 3D…</p>}>
                <Studio3D
                  scanId={scanId}
                  existing={existing}
                  design={design}
                  view={view}
                  layer={layer}
                  finish={finish}
                  selected={picked}
                  marker={marker}
                  reduced={reduced}
                  canDragWall={canDragWall}
                  onSelect={setPicked}
                  onWall={(id, a, b, done) => edit({ op: "move_wall", wallId: id, a, b }, done)}
                  onOpening={(id, offsetM, done) => edit({ op: "move_opening", openingId: id, offsetM }, done)}
                />
              </Suspense>
            </View3DBoundary>
            <div className="stage-tools">
              <div className="segmented small" role="group" aria-label="How to look">
                <button aria-pressed={view === "overview"} onClick={() => setView("overview")}>From above</button>
                <button aria-pressed={view === "walk"} onClick={() => setView("walk")}>Walk</button>
              </div>
              <div className="segmented small" role="group" aria-label="3D model">
                <button aria-pressed={layer === "built"} onClick={() => setLayer("built")}>As built</button>
                <button aria-pressed={layer === "scan"} onClick={() => setLayer("scan")}>Scan</button>
              </div>
              {design.proposed.walls.some((w) => w.rating) && (
                // What the red on top of a wall means.
                <p className="studio-key">
                  <i aria-hidden /> 30-min fire separation
                </p>
              )}
            </div>
            <p className="viewer-hint">{view === "walk" ? "Drag to look · tap the floor to walk" : "Drag a wall or a green knob · drag elsewhere to turn"}</p>
          </div>
          <div className="studio-plan" data-shown={pane === "plan"}>
            <PlanSvg
              layer={design.proposed}
              frame={frame}
              units={units}
              label={`Plan of ${design.name}. Pick a new wall or door and drag it; arrow keys move it.`}
              selected={picked}
              onSelect={setPicked}
              canDragWall={canDragWall}
              canDragOpening={canDragOpening}
              onWall={(id, a, b, done) => edit({ op: "move_wall", wallId: id, a, b }, done)}
              onOpening={(id, offsetM, done) => edit({ op: "move_opening", openingId: id, offsetM }, done)}
              marker={marker}
            />
            <div className="plan-tools">
              <div className="segmented small" role="group" aria-label="Units">
                <button aria-pressed={units === "m"} onClick={() => setUnits("m")}>m</button>
                <button aria-pressed={units === "ft"} onClick={() => setUnits("ft")}>ft</button>
              </div>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {(wall || door) && (
            <motion.div className="picked" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
              {wall && (
                <>
                  <b>{wall.rating ? "Fire separation wall" : wall.kind === "new" ? "New wall" : "The house's wall"}</b>
                  <span className="mono muted">{fmtLength(wallLength(wall), units)}</span>
                  {wall.kind === "new" && (
                    <>
                      <button className="chip" onClick={() => edit({ op: "add_opening", opening: { id: "", wallId: wall.id, kind: "door", offsetM: wallLength(wall) / 2, widthM: 0.81, heightM: 2.03, status: "new", swing: "left", rating: wall.rating ? "20min" : null } })}>
                        Add a door
                      </button>
                      <button className="chip" onClick={() => (edit({ op: "remove_wall", wallId: wall.id }), setPicked(null))}>Remove it</button>
                    </>
                  )}
                </>
              )}
              {door && (
                <>
                  <b>Door</b>
                  {[0.81, 0.86, 0.91].map((w) => (
                    <button key={w} className="chip" aria-pressed={Math.abs(door.widthM - w) < 0.005} onClick={() => edit({ op: "set_opening", openingId: door.id, widthM: w })}>
                      {Math.round(w * 100)} cm
                    </button>
                  ))}
                  <button className="chip" onClick={() => (edit({ op: "remove_opening", openingId: door.id }), setPicked(null))}>Remove it</button>
                </>
              )}
              <button className="link-quiet" onClick={() => setPicked(null)}>Done</button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <aside className="studio-side" aria-label="Checks and cost">
        <div className="studio-bar">
          <button className="status-chip" data-state={fixes ? "fix" : "ok"} aria-expanded={panel === "checks"} onClick={() => setPanel((p) => (p === "checks" ? null : "checks"))}>
            <span className="dot" />
            Meets {count.ok} checks{fixes != null ? ` · ${fixesWord(fixes)}` : ""}
          </button>
          <button className="status-chip" data-state="cost" aria-expanded={panel === "cost"} onClick={() => setPanel((p) => (p === "cost" ? null : "cost"))}>
            <span data-total data-low={quote.totalLow} data-high={quote.totalHigh}>{cad(quote.totalLow)}–{cad(quote.totalHigh)} hired out</span>
          </button>
          <button className="status-chip" data-state="ask" aria-expanded={panel === "describe"} onClick={() => setPanel((p) => (p === "describe" ? null : "describe"))}>
            Describe a change
          </button>
          <div className="history" role="group" aria-label="Undo">
            <button className="chip" onClick={hist.undo} disabled={!hist.canUndo}>Undo</button>
            <button className="chip" onClick={hist.redo} disabled={!hist.canRedo}>Redo</button>
            <span className="aside save-state" aria-live="polite">{saved === "saving" ? "Saving…" : saved === "error" ? "Not saved" : "Saved"}</span>
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {panel === "checks" && (
            <motion.div key="checks" className="side-card" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <Checks checks={checks} onFix={(c) => (hist.commit(applyEdits(hist.present, c.fix!.edits)), setMarker(null))} onShow={showMe} />
            </motion.div>
          )}
          {panel === "cost" && (
            <motion.div key="cost" className="side-card" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <h2>What it costs</h2>
              <ul className="trades">
                {quote.byTrade.filter((t) => t.high > 0).map((t) => (
                  <li key={t.trade}>
                    <span>{t.label}</span>
                    <span className="mono">{cad(t.low)}–{cad(t.high)}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">{basisOf(quote)}</p>
            </motion.div>
          )}
          {panel === "describe" && (
            <motion.div key="describe" className="side-card" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <Describe scanId={scanId} design={hist.present} model={model} municipality={municipality} base={base} onPreview={hist.preview} onApply={(d) => hist.commit(d)} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="side-card">
          <h2>Finishes</h2>
          <div className="ws-chips" role="radiogroup" aria-label="Finish">
            {FINISHES.map((f) => (
              <button key={f.key} className="chip" role="radio" aria-checked={finish === f.key} aria-pressed={finish === f.key} onClick={() => edit({ op: "set_finishes", finishes: { style: f.key } })}>
                {f.label}
              </button>
            ))}
          </div>
          <p className="muted small">The furniture is virtually staged, to show the size of the rooms.</p>
        </div>
      </aside>
    </div>
  );
}

function Checks({ checks, onFix, onShow }: { checks: Check[]; onFix: (c: Check) => void; onShow: (c: Check) => void }) {
  const groups: { title: string; items: Check[]; state: string }[] = [
    { title: "To fix", items: checks.filter((c) => c.ok === false), state: "fix" },
    { title: "For you to confirm", items: checks.filter((c) => c.ok === null), state: "check" },
    { title: "Met", items: checks.filter((c) => c.ok === true), state: "ok" },
  ];
  return (
    <>
      <h2>Checks</h2>
      {groups.map((g) =>
        g.items.length ? (
          <details key={g.title} className="check-group" open={g.state !== "ok"}>
            <summary>
              {g.title} <span className="mono muted">{g.items.length}</span>
            </summary>
            <ul className="checks">
              {g.items.map((c) => (
                <li key={c.id} data-state={g.state}>
                  <b>{c.label}</b>
                  <span className="muted">{c.detail}</span>
                  {(c.fix || c.at) && (
                    <span className="check-actions">
                      {c.fix && c.ok === false && (
                        <button className="btn btn-ghost btn-small" onClick={() => onFix(c)}>
                          {c.fix.label}
                        </button>
                      )}
                      {c.at && (
                        <button className="link-quiet" onClick={() => onShow(c)}>
                          Show me
                        </button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ) : null,
      )}
    </>
  );
}

// "Describe a change": their words, muse-spark's proposal, what it does to the checks and the cost,
// then Apply. The proposal shows in the 3D and the plan while it's open.
function Describe({ scanId, design, model, municipality, base, onPreview, onApply }: { scanId: string; design: Design; model: Model; municipality?: string; base: { category: string }[] | null; onPreview: (d: Design | null) => void; onApply: (d: Design) => void }) {
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<(Proposal & { result: Design }) | null>(null);
  useEffect(() => () => onPreview(null), [onPreview]);
  const before = useMemo(() => tally(checkDesign(design, model.existing)), [design, model.existing]);
  const after = useMemo(() => (proposal ? tally(checkDesign(proposal.result, model.existing)) : null), [proposal, model.existing]);
  const fixesBefore = useMemo(() => (base ? fixCount(base, design, model.existing) : null), [base, design, model.existing]);
  const fixesAfter = useMemo(() => (base && proposal ? fixCount(base, proposal.result, model.existing) : null), [base, proposal, model.existing]);
  const costBefore = useMemo(() => quoteFor(model, design, municipality), [model, design, municipality]);
  const costAfter = useMemo(() => (proposal ? quoteFor(model, proposal.result, municipality) : null), [model, proposal, municipality]);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await describeChange(scanId, design, model.existing, ask);
      const result = applyEdits(design, p.edits);
      setProposal({ ...p, result });
      if (p.edits.length) onPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setProposal(null);
    onPreview(null);
  };
  return (
    <>
      <h2>Describe a change</h2>
      <form
        className="describe"
        onSubmit={(e) => {
          e.preventDefault();
          if (ask.trim()) void send();
        }}
      >
        <textarea className="input" rows={3} maxLength={400} placeholder="Make the bedroom a bit bigger" value={ask} onChange={(e) => setAsk(e.target.value)} aria-label="The change you'd like" />
        <button className="btn btn-ghost" type="submit" disabled={busy || !ask.trim()}>
          {busy ? "Thinking…" : "Propose it"}
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {proposal && (
        <div className="proposal" role="status">
          <p>{proposal.summary}</p>
          {proposal.edits.length > 0 && after && costAfter && (
            <p className="muted small">
              Checks met {before.ok} → {after.ok}
              {fixesBefore != null && fixesAfter != null && fixesAfter !== fixesBefore ? `, fixes ${fixesBefore} → ${fixesAfter}` : ""} · cost {cad(costBefore.totalLow)} → {cad(costAfter.totalLow)}
            </p>
          )}
          {proposal.dropped.length > 0 && <p className="muted small">Left out: {proposal.dropped.join(" ")}</p>}
          <div className="ws-actions">
            {proposal.edits.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  onApply(proposal.result);
                  setProposal(null);
                  setAsk("");
                }}
              >
                Apply
              </button>
            )}
            <button className="link-quiet" onClick={close}>
              {proposal.edits.length ? "Not this" : "OK"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
