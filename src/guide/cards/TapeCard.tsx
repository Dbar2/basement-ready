// Tape numbers, in millimetres. "tape": the main walls, the ceiling and (with a beam or duct below it)
// the lowest one, all in one go. "lot": how far each wall with a new or bigger window is from the
// property line, from the survey. Saved as the Permit tab saved them (server/workspace.ts).
import { useState } from "react";
import type { CardProps } from "../mount";
import { metres, save, savePermit, upsert, useBuild } from "./data";
import { CardFrame, Loading, MmForm, Saved } from "./parts";

export function TapeCard({ scanId, card, act }: CardProps) {
  const { ws, status } = useBuild(scanId);
  const [editing, setEditing] = useState(false);
  if (!ws || !status) return <CardFrame card={card} label="Tape numbers"><Loading /></CardFrame>;
  const permit = ws.state.permit ?? {};

  if (card.id === "lot") {
    const windows = status.windows.filter((w) => w.change !== "keep");
    const done = status.items.filter((i) => i.group === "lot").every((i) => i.done);
    const said = windows.map((w) => `${w.tag} ${metres((permit.lotLines ?? []).find((l) => l.id === w.id)?.mm ?? 0)}`).join(", ");
    return (
      <CardFrame card={card} label="Distance to the property line">
        {done && !editing ? (
          <Saved onChange={() => setEditing(true)}>To the lot line: {said}</Saved>
        ) : (
          <MmForm
            fields={windows.map((w) => ({ key: w.id, label: `${w.tag}'s wall to the lot line`, value: (permit.lotLines ?? []).find((l) => l.id === w.id)?.mm }))}
            note="From the house wall straight out to the property line. Your survey shows it."
            onSave={async (v) => {
              let lotLines = permit.lotLines;
              for (const w of windows) lotLines = upsert(lotLines, { id: w.id, mm: v[w.id] });
              await savePermit(scanId, { lotLines });
              setEditing(false);
              act({ type: "permitItem", itemId: "lot", value: { said: windows.map((w) => `${w.tag} ${metres(v[w.id] ?? 0)}`).join(", ") } });
            }}
          />
        )}
      </CardFrame>
    );
  }

  const tape = ws.state.tape ?? {};
  const done = status.items.filter((i) => i.group === "tape").every((i) => i.done);
  const fields = [
    ...status.mainWalls.map((w) => ({
      key: `wall:${w.id}`,
      label: w.label.charAt(0).toUpperCase() + w.label.slice(1),
      value: (permit.walls ?? []).find((x) => x.id === w.id)?.mm,
      placeholder: `about ${Math.round(w.scanM * 1000)}`,
    })),
    { key: "ceilingMm", label: "Ceiling height", value: tape.ceilingMm },
    ...(status.overhead ? [{ key: "beamMm", label: "Under the lowest beam or duct", value: tape.beamMm }] : []),
  ];
  const summary = (v: Record<string, number | null>) =>
    [
      ...status.mainWalls.map((w) => `${w.label} ${metres(v[`wall:${w.id}`] ?? 0)}`),
      `ceiling ${metres(v.ceilingMm ?? 0)}`,
      ...(status.overhead ? [`under the lowest beam ${metres(v.beamMm ?? 0)}`] : []),
    ].join(", ");
  const savedNow = Object.fromEntries(fields.map((f) => [f.key, f.value ?? null]));
  return (
    <CardFrame card={card} label="Tape numbers">
      {done && !editing ? (
        <Saved onChange={() => setEditing(true)}>{summary(savedNow).replace(/^./, (c) => c.toUpperCase())}</Saved>
      ) : (
        <MmForm
          fields={fields}
          note={`Walls face to face, at the floor. Heights to the underside of the joists${status.overhead ? " and of the lowest beam" : ""}.`}
          onSave={async (v) => {
            let walls = permit.walls;
            for (const w of status.mainWalls) walls = upsert(walls, { id: w.id, mm: v[`wall:${w.id}`] });
            await save(scanId, { state: { tape: { ...tape, ceilingMm: v.ceilingMm, ...(status.overhead ? { beamMm: v.beamMm } : {}) }, permit: { ...permit, walls } } });
            setEditing(false);
            act({ type: "permitItem", itemId: "tape", value: { said: summary(v).replace(/^./, (c) => c.toUpperCase()) } });
          }}
        />
      )}
    </CardFrame>
  );
}
