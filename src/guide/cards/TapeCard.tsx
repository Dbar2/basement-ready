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
            fields={windows.map((w) => ({ key: w.id, label: `Window ${w.tag}'s wall to the lot line`, value: (permit.lotLines ?? []).find((l) => l.id === w.id)?.mm, help: "Straight out from the house wall to the property line." }))}
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
      label: `The ${w.label}`,
      value: (permit.walls ?? []).find((x) => x.id === w.id)?.mm,
      hint: `The video says about ${w.scanM.toFixed(2)} m.`,
      help: "Wall face to wall face, at the floor.",
    })),
    { key: "ceilingMm", label: "Ceiling height", value: tape.ceilingMm, help: "Floor to the underside of the joists." },
    ...(status.overhead ? [{ key: "beamMm", label: "Under the lowest beam or duct", value: tape.beamMm, help: "Floor to the bottom of the lowest one." }] : []),
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
