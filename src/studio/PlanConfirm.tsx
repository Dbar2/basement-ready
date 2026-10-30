// /scans/:id/plan, "Is this your basement?": the measured plan drawn cleanly with what SAM found.
// They fix what's off (drag a wall, name a room, add a wall we missed, drag a duct to where it runs),
// can lock the scale with one tape number, and say yes. That plan is the model every design is drawn on.
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { editExisting, withTape } from "../../server/model/edit";
import { bounds, inPolygon, polygonArea, wallLength } from "../../server/model/geometry";
import type { Edit, Existing, Fixture, Model, RoomKind } from "../../server/model/types";
import { Logo } from "../components/Logo";
import { fmtArea, fmtLength, type Units } from "../components/FloorPlan";
import { designsFor, loadModel, saveModel } from "./api";
import { useHistory } from "./history";
import { FIXTURE_NAME, frameOf, PlanSvg, type Picked } from "./PlanSvg";
import { LengthInput } from "./LengthInput";
import "./studio.css";

const ROOM_KINDS: { kind: RoomKind; label: string }[] = [
  { kind: "other", label: "Open space" },
  { kind: "living", label: "Living" },
  { kind: "bedroom", label: "Bedroom" },
  { kind: "bathroom", label: "Bathroom" },
  { kind: "kitchen", label: "Kitchen" },
  { kind: "laundry", label: "Laundry" },
  { kind: "mechanical", label: "Furnace room" },
  { kind: "storage", label: "Storage" },
  { kind: "closet", label: "Closet" },
  { kind: "stairs", label: "Stairs" },
];

export function PlanConfirm() {
  const { scanId } = useParams({ from: "/scans/$scanId/plan" });
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = "Is this your basement? | Basement Ready";
    loadModel(scanId)
      .then((r) => setModel(r.model))
      .catch((e) => setError(e instanceof Error ? e.message : "We couldn't open your plan."));
  }, [scanId]);
  return (
    <main className="studio-page">
      <header className="studio-head">
        <Logo />
        <Link to="/scans/$scanId" params={{ scanId }} className="link-quiet">Back to your answer</Link>
      </header>
      {error ? (
        <p className="error studio-wait">{error}</p>
      ) : model ? (
        <Confirm scanId={scanId} model={model} />
      ) : (
        <div className="studio-wait" aria-busy="true">
          <div className="skeleton skeleton-plan" />
        </div>
      )}
    </main>
  );
}

function Confirm({ scanId, model }: { scanId: string; model: Model }) {
  const navigate = useNavigate();
  const hist = useHistory<Existing>(model.existing);
  const e = hist.shown;
  const frame = useMemo(() => frameOf(model.existing, 0.8), [model.existing]);
  const [picked, setPicked] = useState<Picked>(null);
  const [drawing, setDrawing] = useState(false);
  const [units, setUnits] = useState<Units>("m");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (x: Edit, done = true) => (done ? hist.commit(editExisting(hist.present, x)) : hist.preview(editExisting(hist.present, x)));
  const finds = [...e.fixtures, ...e.openings.map((o) => ({ ...o, find: true as const }))];
  const wall = picked?.kind === "wall" ? e.walls.find((w) => w.id === picked.id) : null;
  const room = picked?.kind === "room" ? e.rooms.find((r) => r.id === picked.id) : null;
  const fixture = picked?.kind === "fixture" ? e.fixtures.find((f) => f.id === picked.id) : null;
  const opening = picked?.kind === "opening" ? e.openings.find((o) => o.id === picked.id) : null;
  const guesses = e.walls.filter((w) => w.guess).length + e.fixtures.filter((f) => f.guess).length;
  const area = e.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
  const taped = e.scale.source === "tape";

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const existing: Existing = {
        ...hist.present,
        walls: hist.present.walls.map((w) => ({ ...w, guess: false })),
        fixtures: hist.present.fixtures.map((f) => ({ ...f, guess: false })),
        confirmedAt: new Date().toISOString(),
      };
      const designs = await designsFor(existing, model.mood.finishes);
      // Keep the kind of design they had picked, if it's still on offer.
      const was = model.designs.find((d) => d.chosen)?.id;
      const keep = designs.some((d) => d.id === was) ? was : designs[0]?.id;
      await saveModel(scanId, { ...model, existing, designs: designs.map((d) => ({ ...d, chosen: d.id === keep })) });
      navigate({ to: "/scans/$scanId/studio", params: { scanId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="studio-body confirm">
      <section className="studio-main">
        <div className="studio-title">
          <h1>Is this your basement?</h1>
          <p className="lede">
            Measured from your video. Drag a wall that's off, tap a room to name it, add a wall we missed.
            {guesses > 0 && ` ${guesses === 1 ? "One thing is" : `${guesses} things are`} dashed: we couldn't see ${guesses === 1 ? "it" : "them"} clearly.`}
          </p>
        </div>
        <div className="plan-stage">
          <PlanSvg
            layer={e}
            frame={frame}
            units={units}
            label={`Your basement's plan, ${fmtArea(area, units)}. Pick a wall, room or find; arrow keys move it.`}
            selected={picked}
            onSelect={setPicked}
            canDragWall={() => true}
            canDragOpening={() => true}
            canDragFixture={() => true}
            onWall={(id, a, b, done) => edit({ op: "move_wall", wallId: id, a, b }, done)}
            onOpening={(id, offsetM, done) => edit({ op: "move_opening", openingId: id, offsetM }, done)}
            onFixture={(id, at, done) => edit({ op: "set_fixture", fixtureId: id, at }, done)}
            drawing={drawing}
            onDraw={(a, b) => {
              const next = editExisting(hist.present, { op: "add_wall", wall: { id: "", a, b, thicknessM: 0.12, kind: "existing", rating: null } });
              hist.commit(next);
              setDrawing(false);
              setPicked({ kind: "wall", id: next.walls.at(-1)!.id });
            }}
          />
          <div className="plan-tools">
            <div className="segmented small" role="group" aria-label="Units">
              <button aria-pressed={units === "m"} onClick={() => setUnits("m")}>m</button>
              <button aria-pressed={units === "ft"} onClick={() => setUnits("ft")}>ft</button>
            </div>
            <button className="chip" aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}>
              {drawing ? "Drag to draw it" : "Add a wall"}
            </button>
            <div className="history" role="group" aria-label="Undo">
              <button className="chip" onClick={hist.undo} disabled={!hist.canUndo}>Undo</button>
              <button className="chip" onClick={hist.redo} disabled={!hist.canRedo}>Redo</button>
            </div>
          </div>
        </div>
      </section>

      <aside className="studio-side" aria-label="Your basement">
        <div className="side-card">
          <p className="mono side-eyebrow">{taped ? "Scaled to your tape" : e.scale.source === "arkit" ? "Measured by the iPhone app" : "From the video, give or take a little"}</p>
          <p className="side-big">{fmtArea(area, units)}</p>
          <p className="muted">Ceiling {e.ceilingM ? fmtLength(e.ceilingM, units) : "not measured"}</p>
        </div>

        {wall ? (
          <div className="side-card" key={wall.id}>
            <h2>{wall.kind === "foundation" ? "Outside wall" : "Wall"}</h2>
            <p className="muted">{fmtLength(wallLength(wall), units)} on the plan. Drag it, or pick it and use the arrow keys.</p>
            <LengthInput
              label="Its length by tape (optional)"
              units={units}
              onSubmit={(m) => {
                hist.commit(withTape(hist.present, wall.id, m));
              }}
              cta="Scale everything to it"
            />
            <button className="link-quiet" onClick={() => (edit({ op: "remove_wall", wallId: wall.id }), setPicked(null))}>
              This wall isn't there
            </button>
          </div>
        ) : room ? (
          <div className="side-card" key={room.id}>
            <h2>What is this room?</h2>
            <div className="ws-chips" role="radiogroup" aria-label="Room">
              {ROOM_KINDS.map((k) => (
                <button key={k.kind} className="chip" role="radio" aria-checked={room.kind === k.kind} aria-pressed={room.kind === k.kind} onClick={() => edit({ op: "set_room", roomId: room.id, kind: k.kind })}>
                  {k.label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Its name</span>
              <input className="input" defaultValue={room.name} maxLength={40} onBlur={(ev) => ev.target.value.trim() && ev.target.value !== room.name && edit({ op: "set_room", roomId: room.id, name: ev.target.value.trim() })} />
            </label>
          </div>
        ) : fixture ? (
          <FixtureCard f={fixture} units={units} edit={edit} clear={() => setPicked(null)} turn={() => turnAcross(e, fixture)} />
        ) : opening ? (
          <div className="side-card" key={opening.id}>
            <h2>{opening.kind === "door" ? "Door" : "Window"}</h2>
            <p className="muted">{Math.round(opening.widthM * 100)} cm wide{opening.heightM ? `, ${Math.round(opening.heightM * 100)} cm tall` : ""}. Drag it along its wall.</p>
            <LengthInput label="Its width by tape" units={units} onSubmit={(m) => edit({ op: "set_opening", openingId: opening.id, widthM: m })} cta="Set the width" />
            {opening.kind === "window" && <LengthInput label="Its height by tape" units={units} onSubmit={(m) => edit({ op: "set_opening", openingId: opening.id, heightM: m })} cta="Set the height" />}
            <button className="link-quiet" onClick={() => (edit({ op: "remove_opening", openingId: opening.id }), setPicked(null))}>
              It isn't there
            </button>
          </div>
        ) : (
          <div className="side-card">
            <h2>What we found</h2>
            <ul className="finds">
              {finds.map((f) => (
                <li key={f.id}>
                  <button className="find-pick" onClick={() => setPicked({ kind: "find" in f ? "opening" : "fixture", id: f.id })}>
                    <i data-kind={"find" in f ? (f.kind === "door" ? "exit" : "window") : f.kind} />
                    <span>{"find" in f ? (f.kind === "door" ? "Door" : "Window") : FIXTURE_NAME[(f as Fixture).kind]}</span>
                    <span className="mono muted">
                      {"find" in f ? `${Math.round(f.widthM * 100)} cm` : (f as Fixture).heightM != null ? `${fmtLength((f as Fixture).heightM!, units)} clear` : ""}
                      {(f as Fixture).guess ? " · place it" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted small">Tap a wall to type its length from a tape. One number makes every size exact.</p>
          </div>
        )}

        <div className="side-cta">
          {model.existing.confirmedAt && <p className="muted small">You confirmed this before. Saying yes again draws the designs fresh on this plan.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn btn-primary" onClick={confirm} disabled={busy || hist.dragging}>
            {busy ? "Drawing your designs…" : "Yes, this is my basement"}
          </button>
          <Link to="/scans/$scanId/studio" params={{ scanId }} className="link-quiet">Not now, show me the design</Link>
        </div>
      </aside>
    </div>
  );
}

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

function FixtureCard({ f, units, edit, clear, turn }: { f: Fixture; units: Units; edit: (x: Edit) => void; clear: () => void; turn: () => Edit }) {
  const overhead = f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead";
  return (
    <div className="side-card" key={f.id}>
      <h2>{FIXTURE_NAME[f.kind]}</h2>
      <p className="muted">
        {f.guess ? "We saw it on video but not exactly where it runs: drag it into place." : "Drag it if it's not quite there."}
        {f.heightM != null && ` ${fmtLength(f.heightM, units)} from the floor to its underside.`}
      </p>
      {overhead && (
        <>
          <div className="ws-chips" role="radiogroup" aria-label="What it is">
            {(["beam", "duct", "bulkhead"] as const).map((k) => (
              <button key={k} className="chip" role="radio" aria-checked={f.kind === k} aria-pressed={f.kind === k} onClick={() => edit({ op: "set_fixture", fixtureId: f.id, kind: k })}>
                {FIXTURE_NAME[k]}
              </button>
            ))}
          </div>
          <LengthInput label="Floor to its underside, by tape" units={units} onSubmit={(m) => edit({ op: "set_fixture", fixtureId: f.id, heightM: m })} cta="Set it" />
          <button className="link-quiet" onClick={() => edit(turn())}>
            It runs the other way
          </button>
        </>
      )}
      <button className="link-quiet" onClick={() => (edit({ op: "remove_fixture", fixtureId: f.id }), clear())}>
        That's not there
      </button>
    </div>
  );
}
