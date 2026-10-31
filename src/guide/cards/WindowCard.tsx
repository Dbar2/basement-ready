// One window's clear opening and sill, in millimetres. The bedroom's escape window also feeds the
// materials list (state.tape), as the Permit tab did. Once saved, it says whether that opening is big
// enough to climb out of; a bedroom window that isn't comes back as a fix to the design.
import { useState } from "react";
import type { CardProps } from "../mount";
import { save, stepFor, upsert, useBuild } from "./data";
import { CardFrame, Loading, MmForm, Saved } from "./parts";

// The Code's escape window: at least 0.35 m² clear, and no side under 380 mm (server/permit/model.ts).
const escapes = (wMm: number, hMm: number) => (wMm / 1000) * (hMm / 1000) >= 0.35 && Math.min(wMm, hMm) >= 380;

export function WindowCard({ scanId, card, act }: CardProps) {
  const { ws, status } = useBuild(scanId);
  const [editing, setEditing] = useState(false);
  if (!ws || !status) return <CardFrame card={card} label="A window's size"><Loading /></CardFrame>;
  const w = status.windows.find((x) => x.id === card.id);
  if (!w) return <CardFrame card={card} label="A window's size"><p className="field-help">This window isn't on the plan any more.</p></CardFrame>;
  const permit = ws.state.permit ?? {};
  const tape = ws.state.tape ?? {};
  const now = (permit.windows ?? []).find((x) => x.id === w.id);
  const said = (v: { widthMm?: number | null; heightMm?: number | null; sillMm?: number | null }) => `${w.tag}: ${v.widthMm ?? "?"} × ${v.heightMm ?? "?"} mm open, sill ${v.sillMm ?? "?"} mm`;
  const fit = now?.widthMm && now?.heightMm ? escapes(now.widthMm, now.heightMm) : null;

  return (
    <CardFrame card={card} label={`Window ${w.tag}`}>
      {w.taped && !editing ? (
        <>
          <Saved onChange={() => setEditing(true)}>{said(now ?? {})}</Saved>
          {w.escape && fit != null && (
            <p className="status" data-status={fit ? "ok" : "fix"}>
              {fit ? "Big enough to climb out of" : "Too small to climb out of"}
            </p>
          )}
        </>
      ) : (
        <MmForm
          fields={[
            { key: "widthMm", label: "Clear width", value: now?.widthMm ?? (w.escape ? tape.egressWidthMm : null), placeholder: `about ${Math.round(w.widthM * 1000)}` },
            { key: "heightMm", label: "Clear height", value: now?.heightMm ?? (w.escape ? tape.egressHeightMm : null), placeholder: w.heightM ? `about ${Math.round(w.heightM * 1000)}` : undefined },
            { key: "sillMm", label: "Floor to sill", value: now?.sillMm ?? (w.escape ? tape.egressSillMm : null) },
          ]}
          note="The opening with the window open as far as it goes, not the frame; the sill from the floor to the bottom of the opening."
          onSave={async (v) => {
            const permitNext = { ...permit, windows: upsert(permit.windows, { id: w.id, widthMm: v.widthMm, heightMm: v.heightMm, sillMm: v.sillMm }) };
            await save(scanId, { state: { permit: permitNext, ...(w.escape ? { tape: { ...tape, egressWidthMm: v.widthMm, egressHeightMm: v.heightMm, egressSillMm: v.sillMm } } : {}) } });
            setEditing(false);
            act({ type: "permitItem", itemId: stepFor(`window:${w.id}`), value: { said: said(v) } });
          }}
        />
      )}
    </CardFrame>
  );
}
