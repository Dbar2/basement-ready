// Kitchener only: how the two units' water is metered, and where the meter is (Kitchener Utilities,
// City of Kitchener Building Bulletin BB 2026-04). It goes on A1 and A2.
import { useState, type FormEvent } from "react";
import type { CardProps } from "../mount";
import { savePermit, stepFor, useBuild } from "./data";
import { CardFrame, Loading, Problem, Saved, SaveButton } from "./parts";

const OPTIONS = [
  { id: "single", label: "One meter for both", help: "Where it is now, or will be, and how the City reaches it (for example, in unit 1's furnace room)." },
  { id: "room", label: "One each, in a meter room", help: "Where the room is; it opens from outside or a shared space, not through either unit." },
  { id: "compartment", label: "One each, in an outside compartment", help: "Which wall, and where along it (Kitchener Utilities drawing WMSD-302)." },
] as const;
type Option = (typeof OPTIONS)[number]["id"];
const labelOf = (id: string | null | undefined) => OPTIONS.find((o) => o.id === id)?.label ?? "";

export function WaterMeterCard({ scanId, card, act }: CardProps) {
  const { ws, status } = useBuild(scanId);
  const [editing, setEditing] = useState(false);
  if (!ws || !status) return <CardFrame card={card} label="The water meter"><Loading /></CardFrame>;
  const now = ws.state.permit?.waterMeter;
  const done = status.items.some((i) => i.group === "water" && i.done);
  return (
    <CardFrame card={card} label="The water meter">
      {done && !editing ? (
        <Saved onChange={() => setEditing(true)}>
          {labelOf(now?.option)}: {now?.where}
        </Saved>
      ) : (
        <MeterForm
          initial={now}
          onSave={async (option, where) => {
            await savePermit(scanId, { waterMeter: { option, where } });
            setEditing(false);
            act({ type: "permitItem", itemId: stepFor("water"), value: { said: `${labelOf(option)}: ${where}` } });
          }}
        />
      )}
    </CardFrame>
  );
}

function MeterForm({ initial, onSave }: { initial: { option?: string | null; where?: string | null } | undefined; onSave: (option: Option, where: string) => Promise<void> }) {
  const [option, setOption] = useState<Option | "">((initial?.option as Option | undefined) ?? "");
  const [where, setWhere] = useState(initial?.where ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = OPTIONS.find((o) => o.id === option);
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!option) return;
    setBusy(true);
    setError(null);
    void onSave(option, where.trim())
      .catch((err) => setError(err instanceof Error ? err.message : "That didn't save. Try again."))
      .finally(() => setBusy(false));
  };
  return (
    <form className="gc-form" onSubmit={send}>
      <div className="gc-row" role="group" aria-label="How the water is metered">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" className="chip" aria-pressed={option === o.id} onClick={() => setOption(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      <label className="gc-field">
        <span>Where is it?</span>
        <input className="input" value={where} maxLength={160} onChange={(e) => setWhere(e.target.value)} />
        {chosen && <span className="field-help">{chosen.help}</span>}
      </label>
      <Problem text={error} />
      <SaveButton busy={busy} disabled={!option || !where.trim()} />
    </form>
  );
}
