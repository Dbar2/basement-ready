// The design's layouts in clean 3D (track E): each design drawn in their basement as built, painted
// with their video, with its new walls and furniture inside, seen from above at an angle
// (src/views/layoutShots.tsx). No photo under it. The suite's rooms are named on the picture; chips switch
// between the designs; under the picture, the shown design's reason (server/model/seed.ts whyOf) and its
// rough price hired out (server/quote). The guide's thread offers "Use …" for the one it recommends; for
// another design shown here, the button under it does the same (`chooseDesign`).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Design, Model } from "../../../server/model/types";
import { getScan } from "../../api";
import { loadModel } from "../../studio/api";
import { quoteFor } from "../../studio/cost";
import { useLayoutShots, type LayoutShot } from "../../views/layoutShots";
import type { VisualProps } from "../mount";
import "./design.css";

const k = (n: number) => `$${Math.round(n / 1000)}k`;
const RATIO = 4 / 3; // the shots' (src/views/LayoutShotCanvas.tsx SHOT_SIZE)

export function Layouts({ scanId, visual, act }: VisualProps<"layouts">) {
  const [model, setModel] = useState<Model | null>(null);
  const [municipality, setMunicipality] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(visual.designId);
  useEffect(() => setShown(visual.designId), [visual.designId]);
  useEffect(() => {
    let gone = false;
    loadModel(scanId)
      .then((r) => !gone && setModel(r.model))
      .catch(() => !gone && setFailed(true));
    getScan(scanId)
      .then((s) => !gone && setMunicipality(s.result?.municipality))
      .catch(() => {});
    return () => {
      gone = true;
    };
    // The thread moving on (a design chosen, one described) can change the designs: load them again.
  }, [scanId, visual.designId]);
  const { shots, renderer } = useLayoutShots(scanId, model);
  const design = model?.designs.find((d) => d.id === shown) ?? model?.designs.find((d) => d.id === visual.designId) ?? model?.designs[0] ?? null;
  const price = useMemo(() => (model && design ? quoteFor(model, design, municipality) : null), [model, design, municipality]);

  if (failed) return <div className="gs-lay" data-state="error"><p className="gs-lay-note" role="alert">The layouts didn't load. Refresh to try again.</p></div>;
  if (!model || !design) return <div className="gs-lay" data-state="loading"><p className="gs-lay-note">Drawing your layouts in 3D, a few seconds</p></div>;

  const shot = shots[design.id];
  const why = design.why ?? (model.recommended?.designId === design.id ? model.recommended.reason : "");
  return (
    <div className="gs-lay" data-state={shot ? "ready" : "drawing"} data-design={design.id}>
      <div className="gs-lay-stage">
        {shot ? <Shot shot={shot} name={design.name} /> : <p className="gs-lay-note">{shot === null ? "This layout couldn't be drawn in 3D." : `Drawing ${design.name} in 3D, a few seconds`}</p>}
      </div>
      <div className="gs-lay-about">
        <p className="gs-lay-why">
          <b>{design.name}</b>
          {why ? <span> · {why.replace(/\.$/, "")}</span> : null}
        </p>
        {price && (
          <p className="gs-lay-price">
            <span className="mono" data-low={price.totalLow} data-high={price.totalHigh}>
              {k(price.totalLow)}–{k(price.totalHigh)}
            </span>{" "}
            hired out, rough
          </p>
        )}
        {design.id !== visual.designId && (
          <button type="button" className="gs-choice gs-lay-use" onClick={() => act({ type: "chooseDesign", designId: design.id })}>
            Use {design.name}
          </button>
        )}
      </div>
      {model.designs.length > 1 && <Chips designs={model.designs} shown={design.id} recommended={visual.designId} onShow={setShown} />}
      {renderer}
    </div>
  );
}

// The shot, as big as the pane allows, with the suite's rooms named where they are. Where names would
// overlap (each other, the reason and price, or the edge), the bigger room keeps its name.
function Shot({ shot, name }: { shot: LayoutShot; name: string }) {
  const fig = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useLayoutEffect(() => {
    const el = fig.current;
    if (!el) return;
    const place = () => {
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right + 2 && b.left < a.right + 2 && a.top < b.bottom + 2 && b.top < a.bottom + 2;
      const box = el.getBoundingClientRect();
      const kept = [...(el.closest(".gs-lay")?.querySelectorAll(".gs-lay-about > *, .gs-lay-chips") ?? [])].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
      const out = new Set<string>();
      for (const l of [...shot.labels].sort((a, b) => b.areaM2 - a.areaM2)) {
        const r = el.querySelector<HTMLElement>(`[data-room="${CSS.escape(l.roomId)}"]`)?.getBoundingClientRect();
        if (!r) continue;
        const outside = r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom;
        if (outside || kept.some((k) => hit(r, k))) out.add(l.roomId);
        else kept.push(r);
      }
      setHidden((h) => (h.size === out.size && [...out].every((id) => h.has(id)) ? h : out));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shot]);
  return (
    <figure ref={fig} className="gs-lay-pic" style={{ ["--ratio" as string]: `${RATIO}` }}>
      <img src={shot.url} alt={`${name}, drawn in 3D in your basement`} draggable={false} />
      {shot.labels.map((l) => (
        <span key={l.roomId} data-room={l.roomId} className="gs-lay-room" aria-hidden={hidden.has(l.roomId) || undefined} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, visibility: hidden.has(l.roomId) ? "hidden" : undefined }}>
          <b>{l.name}</b> <span className="mono">{Math.round(l.areaM2)} m²</span>
        </span>
      ))}
    </figure>
  );
}

function Chips({ designs, shown, recommended, onShow }: { designs: Design[]; shown: string; recommended: string; onShow: (id: string) => void }) {
  return (
    <div className="gs-chips gs-lay-chips" role="group" aria-label="Layouts">
      {designs.map((d) => (
        <button key={d.id} type="button" className="gs-chip" aria-pressed={d.id === shown} onClick={() => onShow(d.id)}>
          {d.name}
          {d.id === recommended && designs.length > 1 ? <span className="visually-hidden"> (the one I'd start with)</span> : null}
        </button>
      ))}
    </div>
  );
}
