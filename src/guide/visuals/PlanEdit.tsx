// The plan to check, in the guide's visual pane (design.plan): the measured plan filling the pane, edited
// on the plan itself. Tap a wall and its length opens beside it on a leader, with the tape input and OK;
// the picked wall's green knobs drag it. Tap a room to name it, a door, window, beam or duct to size or
// place it. "+ Wall", Undo and m/ft sit on the plan's top edge, and dashed walls are our guesses. Nothing
// sits above or below the plan, and nothing is behind a button.
//
// A photo take opens with one tape number asked on its longest wall. Muse Wonder's check of the plan
// against the take (server/planCheck.ts) lands a little after the answer: each question is pinned on its
// room, the first one opened.
//
// Every change goes through the same edits as the studio (server/model/edit.ts) and is saved with the
// workspace a moment later (the example's in this browser). The guide's own actions land here too:
// applyToPlan() takes a wall's length typed or said in the thread ("setWall") and the "Looks right" that
// confirms the plan ("confirmPlan"), through the open editor when there is one, so undo takes them back.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { getScan, type ScanResult } from "../../api";
import { fmtArea, fmtLength, type Units } from "../../components/FloorPlan";
import { editExisting, withTape } from "../../../server/model/edit";
import { along, bounds, centroid, inPolygon, polygonArea, wallLength } from "../../../server/model/geometry";
import type { Edit, Existing, Fixture, Model, Pt, Room, RoomKind, Wall } from "../../../server/model/types";
import { designsFor, loadModel, saveModel } from "../../studio/api";
import { useHistory } from "../../studio/history";
import { placeCallout } from "../../studio/labels";
import { LengthInput } from "../../studio/LengthInput";
import { FIXTURE_NAME, frameOf, planScale, PlanSvg, type Fit, type Picked } from "../../studio/PlanSvg";
import "./plan-edit.css";

// The guide's actions this editor carries out (src/guide/types.ts, GuideAction).
export type PlanAction = { type: "setWall"; wallId: string; lengthM: number } | { type: "confirmPlan" };

const ROOM_KINDS: { kind: RoomKind; label: string }[] = [
  { kind: "bedroom", label: "Bedroom" },
  { kind: "living", label: "Living" },
  { kind: "bathroom", label: "Bathroom" },
  { kind: "kitchen", label: "Kitchen" },
  { kind: "laundry", label: "Laundry" },
  { kind: "mechanical", label: "Furnace room" },
  { kind: "storage", label: "Storage" },
  { kind: "closet", label: "Closet" },
  { kind: "stairs", label: "Stairs" },
  { kind: "other", label: "Open space" },
];
// A name the scan or a kind gave it, which picking a kind replaces; one they typed stays.
const GENERIC = new RegExp(`^(?:(?:room|area|space)(?: \\d+)?|(?:your )?basement|${ROOM_KINDS.map((k) => k.label).join("|")})$`, "i");

// The plan's top edge (the tools) and bottom edge (the hint and the area), kept clear of the drawing.
const EDGE = { top: 44, bottom: 30 };
const SAVE_AFTER_MS = 600;

// ---- the editor that's open, for the guide's actions ----

type Live = { model: () => Model; apply: (a: Extract<PlanAction, { type: "setWall" }>) => boolean; reset: (m: Model) => void; flush: () => Promise<void>; picked: () => string | null };
const live = new Map<string, Live>();

// A wall's length from the thread scales the plan to it, as the tape input does; "Looks right" confirms
// the plan and draws the designs on it. Returns the model as it now stands.
export async function applyToPlan(scanId: string, action: PlanAction): Promise<Model> {
  const ed = live.get(scanId);
  if (action.type === "setWall") {
    if (ed?.apply(action)) {
      await ed.flush();
      return ed.model();
    }
    const { model } = await loadModel(scanId);
    const next = { ...model, existing: withTape(model.existing, action.wallId, action.lengthM) };
    await saveModel(scanId, next);
    return next;
  }
  await ed?.flush();
  const next = await confirmed(ed ? ed.model() : (await loadModel(scanId)).model);
  await saveModel(scanId, next);
  ed?.reset(next);
  return next;
}

// The wall picked on the open plan, if any: "this wall is 5.5" means that one.
export const pickedWall = (scanId: string) => live.get(scanId)?.picked() ?? null;

// Yes, this is my basement: what's dashed is taken as drawn, and every design drawn again on it, keeping
// the kind of design they had picked if it's still on offer.
async function confirmed(model: Model): Promise<Model> {
  const existing: Existing = {
    ...model.existing,
    walls: model.existing.walls.map((w) => ({ ...w, guess: false })),
    fixtures: model.existing.fixtures.map((f) => ({ ...f, guess: false })),
    confirmedAt: new Date().toISOString(),
  };
  const designs = await designsFor(existing, model.mood.finishes, model.mood.colours);
  const was = model.designs.find((d) => d.chosen)?.id;
  const keep = designs.some((d) => d.id === was) ? was : designs[0]?.id;
  return { ...model, existing, designs: designs.map((d) => ({ ...d, chosen: d.id === keep })) };
}

// ---- the pane ----

export function PlanEdit({ scanId }: { scanId: string }) {
  const [model, setModel] = useState<Model | null>(null);
  const [photos, setPhotos] = useState(false);
  const [check, setCheck] = useState<ScanResult["planCheck"]>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let tries = 0;
    loadModel(scanId)
      .then((r) => !stop && setModel(r.model))
      .catch((e) => !stop && setError(e instanceof Error ? e.message : "We couldn't open your plan."));
    const look = () =>
      getScan(scanId)
        .then((s) => {
          if (stop) return;
          setPhotos(Boolean(s.result?.capture?.photos));
          setCheck(s.result?.planCheck ?? null);
          // The check lands a little after the answer, when the take was watched: look again for a minute.
          if (s.result?.watch && s.result.planCheck === undefined && ++tries < 15) setTimeout(look, 4000);
        })
        .catch(() => {});
    void look();
    return () => {
      stop = true;
    };
  }, [scanId]);
  if (error)
    return (
      <div className="plan-edit">
        <div className="plan-edit-error" role="alert">
          <p>{error}</p>
          <p>Without the plan there's nothing to check yet. Reload the page to try again.</p>
        </div>
      </div>
    );
  if (!model)
    return (
      <div className="plan-edit" aria-busy="true">
        <p className="plan-edit-busy">Opening your plan<i /></p>
      </div>
    );
  return <Editor key={scanId} scanId={scanId} model={model} photos={photos} check={check} />;
}

type Focus = NonNullable<Picked> | { kind: "question"; i: number };

function Editor({ scanId, model, photos, check }: { scanId: string; model: Model; photos: boolean; check: ScanResult["planCheck"] }) {
  const hist = useHistory<Existing>(model.existing);
  const e = hist.shown;
  const pane = useRef<HTMLDivElement>(null);
  const size = usePaneSize(pane);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [units, setUnits] = useState<Units>("m");
  const [saveFailed, setSaveFailed] = useState(false);
  // The opening asks (the tape number, the plan check's first question) until they're put aside.
  const [tapeLater, setTapeLater] = useState(false);
  const [checkLater, setCheckLater] = useState(false);
  const [answered, setAnswered] = useState<number[]>([]);
  // Opened from the keyboard: the callout takes the focus.
  const [enter, setEnter] = useState(false);

  // The plan fills the pane; it re-fits when a change is made, not while a drag is under way.
  const frame = useMemo(() => frameOf(hist.present, 0.3), [hist.present]);
  const fit: Fit | null = size && { w: size.w, h: size.h, ...EDGE };
  const { s, ox, oz, u } = planScale(frame, fit);
  const px = (p: Pt): [number, number] => [(ox + (p[0] - frame.minX) * s) / (u || 1), (oz + (p[1] - frame.minZ) * s) / (u || 1)];

  // ---- saving: a moment after each change, in order ----
  const base = useRef(model);
  const latest = useRef(hist.present);
  latest.current = hist.present;
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const save = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const next = { ...base.current, existing: latest.current };
    inflight.current = inflight.current.then(() => saveModel(scanId, next)).then(
      () => setSaveFailed(false),
      () => setSaveFailed(true),
    );
    return inflight.current;
  }, [scanId]);
  const flush = useCallback(() => (timer.current !== undefined ? save() : inflight.current), [save]);
  const loaded = useRef(hist.present);
  useEffect(() => {
    if (hist.present === loaded.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_AFTER_MS);
  }, [hist.present, save]);
  useEffect(() => () => void (timer.current !== undefined && save()), [save]);

  // ---- the guide's actions, through this editor while it's open ----
  const histRef = useRef(hist);
  histRef.current = hist;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const entry: Live = {
      model: () => ({ ...base.current, existing: latest.current }),
      apply: (a) => {
        const h = histRef.current;
        if (!h.present.walls.some((w) => w.id === a.wallId)) return false;
        h.commit(withTape(h.present, a.wallId, a.lengthM));
        setFocus({ kind: "wall", id: a.wallId });
        return true;
      },
      reset: (m) => {
        base.current = m;
        loaded.current = m.existing;
        histRef.current.reset(m.existing);
        setFocus(null);
      },
      flush,
      picked: () => (focusRef.current?.kind === "wall" ? focusRef.current.id : null),
    };
    live.set(scanId, entry);
    return () => {
      if (live.get(scanId) === entry) live.delete(scanId);
    };
  }, [scanId, flush]);

  const edit = (x: Edit, done = true) => (done ? hist.commit(editExisting(hist.present, x)) : hist.preview(editExisting(hist.present, x)));

  // ---- what's on the plan to ask ----
  const area = e.rooms.reduce((sum, r) => sum + polygonArea(r.polygon), 0);
  // The area rests on every wall, so while any wall is a guess it's only about that much.
  const rough = e.walls.some((w) => w.guess);
  const longest = useMemo(() => [...e.walls].filter((w) => w.kind === "foundation").sort((a, b) => wallLength(b) - wallLength(a))[0] ?? null, [e.walls]);
  // A photo take's sizes come from its 3D: one tape number on its longest outside wall fixes them all.
  const askTape = photos && e.scale.source !== "tape" && longest !== null && !tapeLater;
  const questions = (check?.questions ?? []).map((q, i) => ({ q, i })).filter(({ q, i }) => !answered.includes(i) && (!q.roomId || e.rooms.some((r) => r.id === q.roomId)));
  const answer = (i: number) => {
    setAnswered((a) => [...a, i]);
    setFocus(null);
  };
  // What the callout is about: what they picked, else what the plan asks first.
  const shown: Focus | null = focus ?? (drawing ? null : askTape ? { kind: "wall", id: longest!.id } : !checkLater && questions[0] ? { kind: "question", i: questions[0].i } : null);
  const tapeAsk = askTape && !focus;
  const picked: Picked = shown && shown.kind !== "question" ? shown : null;

  const select = (p: Picked) => {
    setEnter(false);
    if (!p && !focus) {
      if (askTape) setTapeLater(true);
      else if (shown?.kind === "question") setCheckLater(true);
    }
    setFocus(p);
  };
  const close = (fromKeys = false) => {
    const was = shown;
    select(null);
    // Back to the thing the callout was about.
    if (fromKeys && was && was.kind !== "question") pane.current?.querySelector<SVGElement>(`[data-${was.kind}="${was.id}"]`)?.focus();
  };
  const keys = (ev: KeyboardEvent) => {
    const typing = ev.target instanceof HTMLInputElement;
    if (ev.key === "Escape") {
      if (drawing) setDrawing(false);
      else if (shown) close(true);
      return;
    }
    if (typing || !(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== "z") return;
    ev.preventDefault();
    if (ev.shiftKey) hist.redo();
    else hist.undo();
  };

  const roomAt = (r: Room): Pt => {
    const c = centroid(r.polygon);
    if (inPolygon(c, r.polygon)) return c;
    const b = bounds(r.polygon);
    return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  };
  const all = e.walls.length ? bounds(e.walls.flatMap((w) => [w.a, w.b])) : frame;
  const middle: Pt = [(all.minX + all.maxX) / 2, (all.minZ + all.maxZ) / 2];
  const pinAt = (q: { roomId: string | null }): Pt => {
    const r = q.roomId ? e.rooms.find((x) => x.id === q.roomId) : null;
    if (!r) return [middle[0], all.minZ + 0.4];
    const b = bounds(r.polygon);
    return [Math.min(b.maxX - 0.3, roomAt(r)[0] + 0.9), Math.max(b.minZ + 0.3, roomAt(r)[1] - 0.5)];
  };
  const anchor = (f: Focus): Pt | null => {
    if (f.kind === "wall") {
      const w = e.walls.find((x) => x.id === f.id);
      return w ? [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2] : null;
    }
    if (f.kind === "room") {
      const r = e.rooms.find((x) => x.id === f.id);
      return r ? roomAt(r) : null;
    }
    if (f.kind === "opening") {
      const o = e.openings.find((x) => x.id === f.id);
      const w = o && e.walls.find((x) => x.id === o.wallId);
      return o && w ? along(w, o.offsetM) : null;
    }
    if (f.kind === "fixture") return e.fixtures.find((x) => x.id === f.id)?.at ?? null;
    const q = "i" in f ? check?.questions[f.i] : null;
    return q ? pinAt(q) : null;
  };

  const areaText = `${rough ? "About " : ""}${fmtArea(area, units)}`;
  const at = shown && size ? anchor(shown) : null;

  return (
    <div className="plan-edit" ref={pane} onKeyDown={keys}>
      {size && (
        <PlanSvg
          layer={e}
          frame={frame}
          fit={fit}
          units={units}
          label={`Your basement's plan, ${areaText.toLowerCase()}. Tab to a wall, room or find and press Enter to change it; arrow keys move it.`}
          selected={picked}
          onSelect={select}
          focusable
          onActivate={(p) => {
            setFocus(p);
            setEnter(true);
          }}
          knobs
          wallLength={hist.dragging}
          canDragWall={() => true}
          canDragOpening={() => true}
          canDragFixture={() => true}
          onWall={(id, a, b, done) => edit({ op: "move_wall", wallId: id, a, b }, done)}
          onOpening={(id, offsetM, done) => edit({ op: "move_opening", openingId: id, offsetM }, done)}
          onFixture={(id, p, done) => edit({ op: "set_fixture", fixtureId: id, at: p }, done)}
          drawing={drawing}
          onDraw={(a, b) => {
            const next = editExisting(hist.present, { op: "add_wall", wall: { id: "", a, b, thicknessM: 0.12, kind: "existing", rating: null } });
            hist.commit(next);
            setDrawing(false);
            setFocus({ kind: "wall", id: next.walls.at(-1)!.id });
          }}
        />
      )}

      {/* the plan check's questions, each pinned on its room */}
      {size &&
        questions.map(({ q, i }, n) => {
          const [x, y] = px(pinAt(q));
          const open = shown?.kind === "question" && shown.i === i;
          return (
            <button key={i} className="plan-pin" style={{ left: x, top: y }} aria-expanded={open} aria-label={`Question ${n + 1} about your plan: ${q.question}`} onClick={() => (open ? close() : (setFocus({ kind: "question", i }), setEnter(false)))}>
              ?
            </button>
          );
        })}

      <div className="plan-edit-tools">
        <button
          className="chip"
          aria-pressed={drawing}
          onClick={() => {
            setDrawing((d) => !d);
            setFocus(null);
          }}
        >
          {drawing ? "Cancel" : "+ Wall"}
        </button>
        <button className="chip" onClick={hist.undo} disabled={!hist.canUndo}>
          Undo
        </button>
        <div className="segmented small" role="group" aria-label="Units">
          <button aria-pressed={units === "m"} onClick={() => setUnits("m")}>m</button>
          <button aria-pressed={units === "ft"} onClick={() => setUnits("ft")}>ft</button>
        </div>
      </div>
      {saveFailed && <p className="plan-edit-save" role="alert">Not saved yet: check your connection.</p>}

      {drawing ? (
        <p className="plan-edit-cap" aria-live="polite">Drag across the plan to draw the wall</p>
      ) : !shown ? (
        <p className="plan-edit-cap">Tap a wall · drag the green knobs</p>
      ) : null}
      <p className="plan-edit-area">
        <span>
          {rough && "about "}
          <span className="mono">{fmtArea(area, units)}</span>
        </span>
        {e.ceilingM ? (
          <span>
            ceiling <span className="mono">{fmtLength(e.ceilingM, units)}</span>
          </span>
        ) : null}
      </p>

      {shown && at && size && (
        <CalloutFrame key={`${shown.kind}:${"id" in shown ? shown.id : shown.i}`} at={px(at)} pane={size} enter={enter} onClose={() => close()} className={tapeAsk ? "tape-ask" : undefined} title={title(shown)}>
          {body(shown)}
        </CalloutFrame>
      )}
    </div>
  );

  // ---- each callout's title and body ----
  function title(f: Focus): string {
    if (tapeAsk) return "One tape number";
    if (f.kind === "wall") return e.walls.find((x) => x.id === f.id)?.guess ? "A guessed wall, by tape" : "This wall, by tape";
    if (f.kind === "room") return "Name this room";
    if (f.kind === "opening") return e.openings.find((x) => x.id === f.id)?.kind === "door" ? "Door" : "Window";
    if (f.kind === "fixture") {
      const x = e.fixtures.find((y) => y.id === f.id);
      return x ? FIXTURE_NAME[x.kind] : "";
    }
    return "Checked against your " + (photos ? "photos" : "video");
  }

  function body(f: Focus): ReactNode {
    if (f.kind === "wall") {
      const w = e.walls.find((x) => x.id === f.id);
      return w ? <WallBody w={w} e={e} units={units} tapeAsk={tapeAsk} onTape={(m) => hist.commit(withTape(hist.present, w.id, m))} edit={edit} clear={() => setFocus(null)} /> : null;
    }
    if (f.kind === "room") {
      const r = e.rooms.find((x) => x.id === f.id);
      return r ? <RoomBody key={r.id} r={r} edit={edit} /> : null;
    }
    if (f.kind === "opening") {
      const o = e.openings.find((x) => x.id === f.id);
      if (!o) return null;
      return (
        <>
          <p>
            {o.guess ? "About " : ""}
            <span className="mono">{fmtLength(o.widthM, units)}</span> wide
            {o.heightM ? (
              <>
                , <span className="mono">{fmtLength(o.heightM, units)}</span> tall
              </>
            ) : null}
            . {o.guess && o.kind === "window" ? "Seen on the video, but not where it is: drag it to its place." : "Drag its knob along the wall."}
          </p>
          <LengthInput compact="label" label="Its width by tape" units={units} onSubmit={(m) => edit({ op: "set_opening", openingId: o.id, widthM: m })} cta="Set the width" />
          {o.kind === "window" && <LengthInput compact="label" label="Its height by tape" units={units} onSubmit={(m) => edit({ op: "set_opening", openingId: o.id, heightM: m })} cta="Set the height" />}
          <div className="plan-callout-links">
            <button className="link-quiet link-stop" onClick={() => (edit({ op: "remove_opening", openingId: o.id }), setFocus(null))}>
              It isn't there
            </button>
          </div>
        </>
      );
    }
    if (f.kind === "fixture") {
      const x = e.fixtures.find((y) => y.id === f.id);
      return x ? <FixtureBody f={x} e={e} units={units} edit={edit} clear={() => setFocus(null)} /> : null;
    }
    if (!("i" in f)) return null;
    const i = f.i, q = check?.questions[i];
    if (!q) return null;
    return (
      <>
        <p style={{ color: "var(--color-ink)" }}>
          {q.question}
          {q.atS != null && (
            <>
              {" "}
              <span className="mono">{clock(q.atS)}</span> in your {photos ? "photos" : "video"}.
            </>
          )}
        </p>
        <div className="plan-callout-links">
          {q.kind === "name" && q.name && q.roomId ? (
            <button className="chip" onClick={() => (edit({ op: "set_room", roomId: q.roomId!, name: q.name! }), answer(i))}>Call it {q.name}</button>
          ) : q.kind === "missing_room" || q.kind === "merged_rooms" ? (
            <button className="chip" onClick={() => (answer(i), setDrawing(true))}>Yes, add a wall</button>
          ) : q.kind === "extra_room" && q.roomId ? (
            <button className="chip" onClick={() => (edit({ op: "remove_room", roomId: q.roomId! }), answer(i))}>Yes, take it out</button>
          ) : q.roomId ? (
            <button className="chip" onClick={() => setFocus({ kind: "room", id: q.roomId! })}>Show me</button>
          ) : null}
          <button className="link-quiet" onClick={() => answer(i)}>No, it's right</button>
        </div>
      </>
    );
  }
}

// ---- each callout's words and controls ----

type EditFn = (x: Edit, done?: boolean) => void;

function WallBody({ w, e, units, tapeAsk, onTape, edit, clear }: { w: Wall; e: Existing; units: Units; tapeAsk: boolean; onTape: (m: number) => void; edit: EditFn; clear: () => void }) {
  const taped = e.scale.tapeM?.find((t) => t.wallId === w.id);
  return (
    <>
      {tapeAsk ? (
        <p>Photos can't measure exactly. Tape this wall: every size scales to it.</p>
      ) : taped ? (
        <p>
          Taped at <span className="mono">{fmtLength(taped.lengthM, units)}</span>: every size scales to it.
        </p>
      ) : null}
      <LengthInput compact label={tapeAsk ? "The longest wall, by tape" : "This wall's length by tape"} placeholder={fmtLength(wallLength(w), units)} units={units} onSubmit={onTape} cta="Scale everything to it" />
      {!tapeAsk && (
        <div className="plan-callout-links">
          {w.guess && (
            <button className="link-quiet" onClick={() => edit({ op: "set_wall", wallId: w.id, guess: false })}>
              It's right
            </button>
          )}
          <button className="link-quiet link-stop" onClick={() => (edit({ op: "remove_wall", wallId: w.id }), clear())}>
            Not there
          </button>
        </div>
      )}
    </>
  );
}

function RoomBody({ r, edit }: { r: Room; edit: EditFn }) {
  const [name, setName] = useState(r.name);
  const kinds = useRef<HTMLDivElement>(null);
  // The room's kind in view in its row.
  useLayoutEffect(() => {
    const row = kinds.current, on = row?.querySelector<HTMLElement>("[aria-checked=true]");
    if (row && on) row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
  }, []);
  return (
    <>
      <form
        className="plan-callout-row"
        onSubmit={(ev) => {
          ev.preventDefault();
          const n = name.trim();
          if (n && n !== r.name) edit({ op: "set_room", roomId: r.id, name: n });
        }}
      >
        <input className="input" aria-label="The room's name" value={name} maxLength={40} autoComplete="off" enterKeyHint="done" onChange={(ev) => setName(ev.target.value)} />
        <button className="ok" type="submit" disabled={!name.trim() || name.trim() === r.name}>
          OK
        </button>
      </form>
      <div className="plan-callout-kinds" role="radiogroup" aria-label="What it is" ref={kinds}>
        {ROOM_KINDS.map((k) => (
          <button
            key={k.kind}
            className="chip"
            role="radio"
            aria-checked={r.kind === k.kind}
            aria-pressed={r.kind === k.kind}
            onClick={() => {
              const rename = GENERIC.test(r.name.trim()) && r.name.trim() === name.trim();
              edit({ op: "set_room", roomId: r.id, kind: k.kind, ...(rename ? { name: k.label } : {}) });
              if (rename) setName(k.label);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
    </>
  );
}

function FixtureBody({ f, e, units, edit, clear }: { f: Fixture; e: Existing; units: Units; edit: EditFn; clear: () => void }) {
  const overhead = f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead";
  return (
    <>
      <p>
        {f.guess ? "We saw it on video but not exactly where it runs: drag it into place." : "Drag it if it's not quite there."}
        {f.heightM != null && (
          <>
            {" "}
            <span className="mono">{fmtLength(f.heightM, units)}</span> from the floor to its underside.
          </>
        )}
      </p>
      {overhead && (
        <>
          <div className="plan-callout-kinds" role="radiogroup" aria-label="What it is">
            {(["beam", "duct", "bulkhead"] as const).map((k) => (
              <button key={k} className="chip" role="radio" aria-checked={f.kind === k} aria-pressed={f.kind === k} onClick={() => edit({ op: "set_fixture", fixtureId: f.id, kind: k })}>
                {FIXTURE_NAME[k]}
              </button>
            ))}
          </div>
          <LengthInput compact="label" label="Floor to its underside, by tape" units={units} onSubmit={(m) => edit({ op: "set_fixture", fixtureId: f.id, heightM: m })} cta="Set it" />
        </>
      )}
      <div className="plan-callout-links">
        {overhead && (
          <button className="link-quiet" onClick={() => edit(turnAcross(e, f))}>
            It runs the other way
          </button>
        )}
        <button className="link-quiet link-stop" onClick={() => (edit({ op: "remove_fixture", fixtureId: f.id }), clear())}>
          That's not there
        </button>
      </div>
    </>
  );
}

// The callout on its leader, beside the point it's about and inside the pane.
function CalloutFrame({ at, pane, title, enter, onClose, className, children }: { at: [number, number]; pane: { w: number; h: number }; title: string; enter: boolean; onClose: () => void; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(132);
  const w = Math.min(232, pane.w - 16);
  useLayoutEffect(() => {
    if (box.current) setH(box.current.offsetHeight);
  });
  useEffect(() => {
    if (enter) box.current?.querySelector<HTMLElement>("input, button:not(.plan-callout-x)")?.focus();
  }, [enter]);
  const c = placeCallout(at, { w, h }, { w: pane.w, h: pane.h, top: EDGE.top, bottom: 8 });
  return (
    <>
      <svg className="plan-leader" width={pane.w} height={pane.h} aria-hidden="true">
        <polyline points={c.leader.map((p) => p.join(",")).join(" ")} />
        <circle cx={at[0]} cy={at[1]} r={3} />
      </svg>
      <div ref={box} className={`plan-callout${className ? ` ${className}` : ""}`} role="dialog" aria-label={title} style={{ left: c.x, top: c.y, width: w }}>
        <div className="plan-callout-head">
          <p>{title}</p>
          <button className="plan-callout-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

// The pane's size in CSS pixels, kept as it changes (a phone's keyboard, a turned phone).
function usePaneSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const take = (w: number, h: number) => setSize((s) => (s && s.w === Math.round(w) && s.h === Math.round(h) ? s : w > 0 && h > 0 ? { w: Math.round(w), h: Math.round(h) } : s));
    const r = el.getBoundingClientRect();
    take(r.width, r.height);
    const ro = new ResizeObserver(([entry]) => take(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// 52 -> "0:52": where in the video to look.
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// A beam or duct turned to run the other way, across the room it's in.
function turnAcross(e: Existing, f: Fixture): Edit {
  const r = e.rooms.find((x) => inPolygon(f.at, x.polygon)) ?? e.rooms[0];
  const b = bounds(r.polygon);
  const [sx, sz] = f.sizeM ?? [0.3, 0.3];
  const alongX = sx >= sz;
  return alongX
    ? { op: "set_fixture", fixtureId: f.id, sizeM: [sz, Math.round((b.maxZ - b.minZ) * 100) / 100], at: [f.at[0], (b.minZ + b.maxZ) / 2] }
    : { op: "set_fixture", fixtureId: f.id, sizeM: [Math.round((b.maxX - b.minX) * 100) / 100, sx], at: [(b.minX + b.maxX) / 2, f.at[1]] };
}
