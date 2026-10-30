// "Pick a layout": three or four floor plans for their basement, each with a picture of one real
// corner as it would look in it, finished the way their board reads, how many of its checks pass, and
// its price once the quote can give one. On a phone they swipe between them; on a computer they sit
// side by side. The one they pick is saved as their design.
import { useEffect, useMemo, useState } from "react";
import type { Layout, Plan } from "../api";
import { LayoutShapes } from "../components/FloorPlan";
import { STYLES, type StyleId } from "../../server/ideas/styles";
import { chooseLayout, cornerPicture, frameSrc, getLayouts, type Card, type LayoutOption, type Mood } from "./api";
import { Picture } from "./Picture";
import "./ideas.css";

type Corner = { url: string | null; note: string | null };

// The example has no server to make pictures: a card from its deck that shows the same corner as the
// same room, in their style when there is one. Never a living room captioned as the bedroom.
function cardFor(cards: Card[], o: LayoutOption, mood: Mood): Card | null {
  const c = o.corner;
  if (!c) return null;
  const same = cards.filter((k) => k.frame === c.frame && k.tags.use === c.use);
  return same.find((k) => k.tags.style === mood.style) ?? same[0] ?? null;
}

const cad = (n: number) => `$${Math.round(n / 1000)}k`;

// `renderFor`: a picture of the layout's design itself, rendered from the 3D (server/views, the design
// pictures). When it gives one, the card shows that; until then, the real corner restyled.
type Props = {
  scanId: string;
  mood: Mood;
  cards: Card[];
  onPicked?: (option: LayoutOption) => void;
  renderFor?: (option: LayoutOption, mood: Mood) => Promise<string | null>;
};

export function LayoutPicker({ scanId, mood, cards, onPicked, renderFor }: Props) {
  const [data, setData] = useState<{ plan: Plan | null; options: LayoutOption[] } | null>(null);
  const [corners, setCorners] = useState<Record<string, Corner>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finishes = useMemo(() => JSON.stringify(mood.finishes), [mood.finishes]);

  useEffect(() => {
    let live = true;
    getLayouts(scanId).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [scanId]);

  // Each corner, finished the way the board reads now. A new board gets new pictures. The design's own
  // render first, when there is one; else the real corner restyled (the example: a card of its deck).
  useEffect(() => {
    if (!data) return;
    let live = true;
    const show = (o: LayoutOption, corner: Corner) => live && setCorners((c) => ({ ...c, [o.id]: corner }));
    const restyled = async (o: LayoutOption): Promise<Corner> => {
      if (scanId === "sample") {
        const k = cardFor(cards, o, mood);
        return k ? { url: k.url, note: null } : { url: frameSrc(scanId, o.corner!.frame), note: `This corner today: the ${o.corner!.zone.toLowerCase()} goes here` };
      }
      const r = await cornerPicture(scanId, o.id, mood.finishes);
      return "error" in r ? { url: null, note: r.error } : { url: r.url, note: null };
    };
    for (const o of data.options.filter((x) => x.corner)) {
      show(o, { url: null, note: null });
      void (async () => {
        const url = renderFor ? await renderFor(o, mood).catch(() => null) : null;
        show(o, url ? { url, note: null } : await restyled(o));
      })();
    }
    return () => {
      live = false;
    };
    // The board's finishes, not every swipe, decide the pictures.
  }, [data, scanId, finishes, cards.length]);

  const pick = async (o: LayoutOption) => {
    setSaving(o.id);
    setError(null);
    const r = await chooseLayout(scanId, o.id, mood);
    setSaving(null);
    if ("error" in r) return setError(r.error);
    setPicked(o.id);
    onPicked?.(o);
  };

  if (!data) return <section className="layouts" aria-busy="true" aria-label="Pick a layout" />;
  if (!data.plan || !data.options.length) {
    return (
      <section className="layouts">
        <h2>Pick a layout</h2>
        <p className="layouts-lede">The layouts need your floor plan first.</p>
      </section>
    );
  }
  const plan = data.plan;
  const label = mood.style ? STYLES[mood.style as StyleId].label : null;
  const style = label ? label.charAt(0).toLowerCase() + label.slice(1) : null;

  return (
    <section className="layouts" aria-labelledby="layouts-title">
      <h2 id="layouts-title">Pick a layout</h2>
      <p className="layouts-lede">
        {data.options.length} ways to lay out your basement, each with one real corner as it would look{style ? `, finished ${style}` : ""}.
        {!mood.style && " Love a few cards first to finish them your way."}
      </p>
      <ul className="layout-row">
        {data.options.map((o) => {
          const corner = corners[o.id];
          const chosen = picked === o.id;
          return (
            <li key={o.id} className="layout-card" data-chosen={chosen || undefined}>
              <PlanThumb plan={plan} layout={o.layout as Layout} name={o.name} />
              {o.corner && (
                <figure className="layout-corner">
                  <Picture from={frameSrc(scanId, o.corner.frame)} src={corner?.url} aspect={o.corner.aspect} alt={`${o.corner.zone} in this layout, virtually staged`} />
                  <figcaption className="mono">{corner?.note ?? (corner?.url ? `${o.corner.zone} · virtually staged` : `${o.corner.zone} · restyling…`)}</figcaption>
                </figure>
              )}
              <h3>{o.name}</h3>
              <p className="layout-facts mono">
                <span data-ok={o.checks.passed === o.checks.total || undefined}>
                  {o.checks.passed} of {o.checks.total} checks pass
                </span>
                <span>{o.price ? `${cad(o.price.lowCAD)}–${cad(o.price.highCAD)}` : "Priced with your quote"}</span>
              </p>
              <ul className="layout-checks">
                {o.layout.checks.map((c) => (
                  <li key={c.label} data-ok={c.ok === true ? "yes" : c.ok === false ? "no" : "ask"}>
                    {c.label}
                  </li>
                ))}
              </ul>
              <button type="button" className={chosen ? "btn btn-primary" : "btn btn-ghost"} onClick={() => pick(o)} disabled={saving !== null} aria-pressed={chosen}>
                {chosen ? "Picked ✓" : saving === o.id ? "Saving…" : "Pick this layout"}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="layouts-error">{error}</p>}
      {picked && (
        <p className="layouts-done" aria-live="polite">
          Saved: {data.options.find((o) => o.id === picked)?.name}. Next, your basement designed in 3D.
        </p>
      )}
    </section>
  );
}

// The layout drawn small: the room, its new walls and rooms, the stairs and the window.
function PlanThumb({ plan, layout, name }: { plan: Plan; layout: Layout; name: string }) {
  const b = plan.box;
  const W = 420;
  const pad = 14;
  const s = (W - 2 * pad) / Math.max(plan.widthM, plan.depthM);
  const H = Math.round(plan.depthM * s + 2 * pad);
  const X = (x: number) => pad + (W - 2 * pad - plan.widthM * s) / 2 + (x - b.minX) * s;
  const Z = (z: number) => pad + (z - b.minZ) * s;
  const win = layout.window;
  const winLine = (() => {
    if (!win) return null;
    const along = win.side === "minZ" || win.side === "maxZ";
    const a = (along ? b.minX : b.minZ) + win.atM;
    const h = win.widthM / 2;
    if (along) {
      const z = win.side === "minZ" ? b.minZ : b.maxZ;
      return { x1: X(a - h), y1: Z(z), x2: X(a + h), y2: Z(z) };
    }
    const x = win.side === "minX" ? b.minX : b.maxX;
    return { x1: X(x), y1: Z(a - h), x2: X(x), y2: Z(a + h) };
  })();
  return (
    <svg className="plan layout-thumb" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Floor plan: ${name}`}>
      <rect x={0} y={0} width={W} height={H} className="plan-paper" />
      <LayoutShapes layout={layout} units="m" X={X} Z={Z} s={s} />
      {plan.stairs.map((st) => (
        <g key={st.detectionId} className="plan-stairs">
          <rect x={X(st.x0)} y={Z(st.z0)} width={(st.x1 - st.x0) * s} height={(st.z1 - st.z0) * s} />
        </g>
      ))}
      <rect x={X(b.minX)} y={Z(b.minZ)} width={plan.widthM * s} height={plan.depthM * s} className="layout-thumb-wall" />
      {winLine && <line {...winLine} className="layout-thumb-window" />}
    </svg>
  );
}
