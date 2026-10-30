// The Ideas tab, the heart of the result: what their basement could be. Switch between a one-bedroom
// and a studio, move the bedroom to another wall and walk the result in 3D; restyle their own photos
// in a look they choose (Muse Image, all photos at once); heart the ones they love. The layout, the
// finish and the hearted photos go into the permit package as the proposed look.
import { Suspense, useEffect, useMemo, useState } from "react";
import type { Layout, Plan, PlanSide } from "../api";
import { lazy3d, View3DBoundary } from "../components/View3D";
import { conceptUrl } from "../components/StagedViews";
import { suggestLayout } from "../../server/layout";
import { LOOKS, lookUrl, startLook, type Favourite, type Look } from "../workspaceApi";
import type { TabProps } from "./Workspace";

const StagedBasement = lazy3d(() => import("../three/StagedBasement").then((m) => m.StagedBasement));

const SIDE_WORDS: Record<PlanSide, string> = { minZ: "the top wall", maxZ: "the bottom wall", minX: "the left wall", maxX: "the right wall" };
const FINISHES = [
  { key: "light", label: "Light oak" },
  { key: "warm", label: "Warm wood" },
  { key: "deep", label: "Deep green" },
] as const;

export function IdeasTab({ r, scanId, ws, save, reload }: TabProps) {
  const plan = r.plan ?? null;
  const ideas = ws.state.ideas ?? {};
  const kind = ideas.kind ?? null;
  const side = ideas.side ?? null;
  const layout: Layout | null = useMemo(() => {
    if (!plan) return r.layout ?? null;
    if (!kind && !side) return r.layout ?? (suggestLayout(plan as never) as unknown as Layout);
    return suggestLayout(plan as never, { kind, side }) as unknown as Layout;
  }, [plan, kind, side, r.layout]);
  const shown = layout?.kind ?? "one_bedroom";
  const bedroomSide = layout?.window?.side ?? side ?? null;
  const windowSides = new Set((plan?.openings ?? []).filter((o) => o.kind === "window").map((o) => o.side));
  const setIdeas = (patch: Partial<NonNullable<typeof ws.state.ideas>>) => void save({ state: { ideas: { ...ideas, ...patch } } });

  // "Try this look": the sample's looks live in this tab; a real scan's come back with the workspace.
  const [sampleLooks, setSampleLooks] = useState<Record<string, Look>>({});
  const [lookError, setLookError] = useState<string | null>(null);
  const [trying, setTrying] = useState<string | null>(null);
  const looks: Record<string, Look> = scanId === "sample" ? sampleLooks : (ws.state.looks ?? {});
  const pending = Object.values(looks).some((l) => l.status === "pending");
  useEffect(() => {
    if (!pending || scanId === "sample") return;
    const id = window.setInterval(() => void reload(), 4000);
    return () => clearInterval(id);
  }, [pending, scanId, reload]);
  const tryLook = async (style: string) => {
    setTrying(style);
    setLookError(null);
    try {
      const look = await startLook(scanId, style);
      if (scanId === "sample") setSampleLooks((l) => ({ ...l, [style]: look }));
      else await reload();
    } catch (err) {
      setLookError(err instanceof Error ? err.message : "That look didn't work.");
    } finally {
      setTrying(null);
    }
  };

  const favs = ideas.favourites ?? [];
  const isFav = (f: Favourite) => favs.some((x) => x.source === f.source && x.n === f.n && (x.style ?? null) === (f.style ?? null));
  const toggle = (f: Favourite) => setIdeas({ favourites: isFav(f) ? favs.filter((x) => !(x.source === f.source && x.n === f.n && (x.style ?? null) === (f.style ?? null))) : [...favs, f].slice(-12) });
  const photos = r.concepts?.items ?? [];

  return (
    <div className="ws-ideas">
      <section className="block">
        <h2>Make it yours</h2>
        <p className="lede">Your real basement at its measured size. Try a different layout and walk through it; what you pick here is what we draw on the permit plans.</p>
        {plan && (
          <div className="ws-options">
            <div className="segmented" role="radiogroup" aria-label="Kind of unit">
              <button role="radio" aria-checked={shown === "one_bedroom"} aria-pressed={shown === "one_bedroom"} onClick={() => setIdeas({ kind: "one_bedroom" })}>
                One bedroom
              </button>
              <button role="radio" aria-checked={shown === "studio"} aria-pressed={shown === "studio"} onClick={() => setIdeas({ kind: "studio" })}>
                Studio
              </button>
            </div>
            <div className="ws-chips" role="radiogroup" aria-label="Where the bedroom goes">
              <span className="mono">Bedroom on</span>
              {(Object.keys(SIDE_WORDS) as PlanSide[]).map((s) => (
                <button key={s} className="chip" role="radio" aria-checked={bedroomSide === s} aria-pressed={bedroomSide === s} onClick={() => setIdeas({ side: s })}>
                  {SIDE_WORDS[s]}
                  {windowSides.has(s) ? " (window)" : ""}
                </button>
              ))}
              {(kind || side) && (
                <button className="link-quiet" onClick={() => setIdeas({ kind: null, side: null })}>
                  Back to our suggestion
                </button>
              )}
            </div>
          </div>
        )}
        {plan && layout ? (
          <>
            <View3DBoundary>
              <Suspense fallback={<p className="viewer-empty mono">Building your basement in 3D…</p>}>
                <StagedBasement key={`${layout.kind}-${layout.window?.side ?? side ?? "auto"}`} plan={plan as Plan} layout={layout} />
              </Suspense>
            </View3DBoundary>
            <ul className="stage-checks">
              {layout.checks.map((c) => (
                <li key={c.label} data-ok={c.ok === null ? "unknown" : c.ok}>
                  <b>{c.label}</b> <span className="muted">{c.detail}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">The 3D and layouts need a measured plan: film the basement and they appear here.</p>
        )}
        <div className="ws-chips ws-finish" role="radiogroup" aria-label="Finish for your package">
          <span className="mono">Finish in your package</span>
          {FINISHES.map((f) => (
            <button key={f.key} className="chip" role="radio" aria-checked={(ideas.finish ?? "light") === f.key} aria-pressed={(ideas.finish ?? "light") === f.key} onClick={() => setIdeas({ finish: f.key })}>
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>Try this look</h2>
        <p className="lede">Your own photos, restyled. Virtually staged: the room, windows and stairs stay yours; heart the ones you love and they go in your package.</p>
        {photos.length === 0 ? (
          <p className="muted">{r.concepts?.status === "pending" ? "Your photos are still being made." : "There are no photos to restyle for this scan."}</p>
        ) : (
          <>
            <div className="ws-chips">
              {LOOKS.map((l) => (
                <button key={l.key} className="chip" aria-pressed={Boolean(looks[l.key])} disabled={trying !== null || looks[l.key]?.status === "pending"} onClick={() => void tryLook(l.key)}>
                  {trying === l.key || looks[l.key]?.status === "pending" ? `${l.label}…` : l.label}
                </button>
              ))}
            </div>
            {lookError && <p className="error" role="alert">{lookError}</p>}
            <div className="ws-looks">
              <LookRow title="Our first take" items={photos.map((c) => ({ n: c.n, title: c.title, checked: c.checked, kept: c.kept, src: conceptUrl(scanId, c.n), fav: { source: "concept" as const, n: c.n, title: c.title } }))} isFav={isFav} toggle={toggle} />
              {LOOKS.filter((l) => looks[l.key]).map((l) => {
                const look = looks[l.key];
                return look.status === "done" ? (
                  <LookRow key={l.key} title={l.label} items={look.items.map((c) => ({ n: c.n, title: c.title, checked: c.checked, kept: c.kept, src: lookUrl(scanId, l.key, c.n), fav: { source: "look" as const, n: c.n, style: l.key, title: `${c.title}, ${l.label.toLowerCase()}` } }))} isFav={isFav} toggle={toggle} />
                ) : look.status === "pending" ? (
                  <p key={l.key} className="viewer-empty mono concepts-wait">Restyling every photo as {l.label.toLowerCase()}…</p>
                ) : (
                  <p key={l.key} className="muted">{l.label} didn't work this time.</p>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

type Item = { n: number; title: string; checked: string; kept: boolean; src: string; fav: Favourite };

function LookRow({ title, items, isFav, toggle }: { title: string; items: Item[]; isFav: (f: Favourite) => boolean; toggle: (f: Favourite) => void }) {
  return (
    <div className="ws-look">
      <h3>{title}</h3>
      <div className="concepts">
        {items.map((c) => (
          <figure key={c.src} className="concept">
            <img src={c.src} alt={`${c.title}, virtually staged from your own video`} loading="lazy" />
            <span className="concept-label mono">Virtually staged</span>
            <button className="ws-heart" aria-pressed={isFav(c.fav)} aria-label={isFav(c.fav) ? "Remove from your package" : "Add to your package"} onClick={() => toggle(c.fav)}>
              {isFav(c.fav) ? "♥" : "♡"}
            </button>
            <figcaption>
              <b>{c.title}</b>
              <span className={c.kept ? "concept-check" : "concept-check concept-check--warn"}>{c.checked}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
