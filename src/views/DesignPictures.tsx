// Pictures of one design from the best real angles of the scan, all agreeing: the bed is in the same
// spot in every one, because every one is the same model drawn from a different real camera. Tap
// anything to change it (swap a sofa for a desk, pick a colour, slide it along its wall, take it out)
// and every angle is drawn again; each old picture stays until its new one lands.
//
// The flow's pictures step draws the model's chosen design and saves each change into it:
//   <DesignPictures scanId={id} design={design} onDesignChange={save} view="swipe" />
// Without `design` it pictures the model's chosen design as the server has it and keeps edits in this browser.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { designHash, lookOf, nudgeFurniture, SPECS, swapFurniture, SWAPS } from "../../server/model/furniture";
import type { Design, Edit, FurnitureKind } from "../../server/model/types";
import type { Solid } from "../three/RealScan";
import type { AngleView, Rendered, Snap } from "./AngleRender";
import { colourHex, FABRICS } from "./fabrics";
import { idAtTap, idBoxes } from "./objectId";
import { applyViewEdits, getViews, postPicture, type Picture, type ViewsData } from "./viewsApi";
import "./views.css";

const AngleRenderer = lazy(() => import("./AngleRender").then((m) => ({ default: m.AngleRenderer })));

const FLOORS = ["light oak vinyl plank", "warm wood plank"];
const WALLS = ["warm white", "soft sage", "pale greige", "cool light grey"];
const EDIT_SETTLE_MS = 500;

// `made`: the server's picture of this design from this angle (not the render shown while it's made).
type Shown = { url: string; kind: "photo" | "render"; checked: string; hash: string; made?: boolean };
type Selected = { angleId: string; id: string };

const storeKey = (scanId: string) => `br-views-design:${scanId}`;
function loadStored(scanId: string, seedHash: string | null): Design | null {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(scanId)) ?? "null");
    return raw?.seed === seedHash ? (raw.design as Design) : null;
  } catch {
    return null;
  }
}
function saveStored(scanId: string, seedHash: string | null, design: Design) {
  try {
    localStorage.setItem(storeKey(scanId), JSON.stringify({ seed: seedHash, design }));
  } catch {
    // Private mode: edits last until the page closes.
  }
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`frame ${url}`));
    img.src = url;
  });

// Two stacked images: the new one fades in over the old once it has loaded.
function Fade({ url, alt }: { url: string; alt: string }) {
  const [layers, setLayers] = useState<{ below: string | null; above: string; ready: boolean }>({ below: null, above: url, ready: true });
  useEffect(() => {
    setLayers((l) => (l.above === url ? l : { below: l.above, above: url, ready: false }));
  }, [url]);
  return (
    <>
      {layers.below && <img className="views-img" src={layers.below} alt="" draggable={false} />}
      <img
        className="views-img views-img-top"
        data-ready={layers.ready}
        src={layers.above}
        alt={alt}
        draggable={false}
        onLoad={() => setLayers((l) => (l.above === url ? { ...l, ready: true } : l))}
      />
    </>
  );
}

export function DesignPictures({
  scanId,
  design: controlled,
  onDesignChange,
  view: initialView = "swipe",
  rooms = "design",
  limit,
  editable = true,
  palette = FABRICS,
}: {
  scanId: string;
  design?: Design | null;
  onDesignChange?: (design: Design) => void;
  view?: "swipe" | "grid";
  rooms?: "design" | "all";
  limit?: number;
  editable?: boolean;
  palette?: { name: string; hex: string }[];
}) {
  const [data, setData] = useState<ViewsData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [own, setOwn] = useState<Design | null>(null);
  const [solid, setSolid] = useState<Solid | null>(null);
  const [view, setView] = useState(initialView);
  const [renders, setRenders] = useState<Map<string, Rendered>>(new Map());
  const [shown, setShown] = useState<Map<string, Shown>>(new Map());
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [making, setMaking] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [snap, setSnap] = useState<{ fn: Snap; hash: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const design = controlled ?? own;
  const hash = useMemo(() => (design ? designHash(design) : null), [design]);
  const hashRef = useRef(hash);
  hashRef.current = hash;

  useEffect(() => {
    let gone = false;
    getViews(scanId, controlled ? designHash(controlled) : undefined, 5, controlled?.id)
      .then((d) => {
        if (gone) return;
        setData(d);
        if (!controlled && d.design) setOwn(loadStored(scanId, d.designHash) ?? d.design);
        // Pictures already made of the seeded design show at once.
        setShown(new Map(d.pictures.map((p) => [p.angleId, { url: p.url, kind: p.kind, checked: p.checked, hash: p.designHash, made: true }])));
        return Promise.all([fetch(d.meshUrl).then((r) => (r.ok ? r.arrayBuffer() : null)), import("../three/RealScan")]).then(([buf, { parseMesh }]) => !gone && buf && setSolid(parseMesh(buf)));
      })
      .catch((err) => !gone && setFailed(err instanceof Error ? err.message : String(err)));
    return () => {
      gone = true;
    };
    // `controlled` only decides whether to seed our own copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const angles = useMemo(() => {
    if (!data) return [];
    // The design's own set; "all": every room's angles too, each once.
    const own = data.angles.filter((a) => a.group === "design");
    const list = rooms === "all" ? [...new Map(data.angles.map((a) => [a.id, a])).values()] : own.length ? own : data.angles.filter((a) => a.group === data.angles[0]?.group);
    return limit ? list.slice(0, limit) : list;
  }, [data, rooms, limit]);

  const onReady = useCallback((fn: Snap | null, h: string) => setSnap((s) => (fn ? { fn, hash: h } : s?.hash === h ? null : s)), []);

  // Draw every angle of this design, then ask for its photo. A newer design stops an older run; an
  // edit waits a moment, so a few quick taps make one set of pictures.
  useEffect(() => {
    if (!snap || !design || snap.hash !== hash || !angles.length) return;
    let stop = false;
    const run = async () => {
      if (renders.size) await new Promise((r) => setTimeout(r, EDIT_SETTLE_MS));
      for (const a of angles) {
        if (stop || hashRef.current !== snap.hash) return;
        const frame = await loadImage(a.frameUrl).catch(() => null);
        if (!frame || stop) continue;
        const r = await snap.fn(a, frame);
        if (stop) return;
        setRenders((m) => new Map(m).set(a.id, r));
        // Its picture is made already (the example's are committed): drawn only for tap-to-change.
        const had = shownRef.current.get(a.id);
        if (had?.made && had.hash === r.hash) continue;
        // Nothing to show yet: the render shows while the photo is made.
        setShown((m) => (m.has(a.id) ? m : new Map(m).set(a.id, { url: r.url, kind: "render", checked: "Making it look real…", hash: r.hash })));
        setMaking((s) => new Set(s).add(a.id));
        postPicture(scanId, a.id, r.guide, { designHash: r.hash, viewKey: r.view, items: r.items, walls: r.walls, finishes: design.finishes })
          .then((p: Picture) => {
            if (hashRef.current !== p.designHash) return;
            // Nothing kept on the server (the example, past its committed pictures): the render stays.
            setShown((m) => new Map(m).set(a.id, p.url ? { url: p.url, kind: p.kind, checked: p.checked, hash: p.designHash, made: true } : { url: r.url, kind: "render", checked: "The 3D design drawn over your frame", hash: r.hash }));
          })
          .catch(() => setShown((m) => new Map(m).set(a.id, { url: r.url, kind: "render", checked: "The 3D design drawn over your frame", hash: r.hash })))
          .finally(() => hashRef.current === r.hash && setMaking((s) => {
            const n = new Set(s);
            n.delete(a.id);
            return n;
          }));
      }
    };
    run();
    return () => {
      stop = true;
    };
    // renders.size only tells a first run from an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, hash, angles, scanId]);

  const change = useCallback(
    (edits: Edit[] | null, refused?: string) => {
      if (!design) return;
      if (!edits) {
        setNotice(refused ?? "That doesn't fit there.");
        return;
      }
      setNotice(null);
      const next = applyViewEdits(design, edits);
      if (onDesignChange) onDesignChange(next);
      if (!controlled) {
        setOwn(next);
        saveStored(scanId, data?.designHash ?? null, next);
      }
    },
    [design, onDesignChange, controlled, scanId, data],
  );

  const tap = (angleId: string, e: React.MouseEvent<HTMLElement>) => {
    if (!editable) return;
    const r = renders.get(angleId);
    if (!r) return;
    const box = e.currentTarget.getBoundingClientRect();
    const id = idAtTap(r.ids, { x: e.clientX - box.left, y: e.clientY - box.top }, box);
    setNotice(null);
    setSelected(id ? { angleId, id } : null);
  };

  if (failed) return <p className="views-empty mono">The pictures aren't available for this scan.</p>;
  if (!data) return <div className="views-skeleton" aria-busy="true" />;
  if (!design || !angles.length) return <p className="views-empty mono">No angles from this scan are good enough to picture yet.</p>;

  const size: [number, number] = [angles[0].intrinsics.width, angles[0].intrinsics.height];
  const piece = selected ? design.proposed.furniture.find((f) => f.id === selected.id) ?? null : null;
  const picked = selected && !piece ? selected.id : null;
  const outline = selected ? (() => {
    const r = renders.get(selected.angleId);
    return r ? idBoxes(r.ids).get(selected.id)?.box ?? null : null;
  })() : null;
  const updating = making.size > 0 || [...renders.values()].some((r) => r.hash !== hash);

  return (
    <section className="views" data-view={view}>
      <div className="views-head">
        <p className="views-status mono" aria-live="polite">
          {updating ? "Updating every angle…" : `${angles.length} angles from where you filmed`}
        </p>
        <div className="segmented small" role="group" aria-label="Show as">
          <button aria-pressed={view === "swipe"} onClick={() => setView("swipe")}>
            Swipe
          </button>
          <button aria-pressed={view === "grid"} onClick={() => setView("grid")}>
            Grid
          </button>
        </div>
      </div>
      <div className="views-strip">
        {angles.map((a) => {
          const s = shown.get(a.id);
          return (
            <figure key={a.id} className="views-card" data-angle={a.id} data-shows={renders.get(a.id)?.items.map((i) => `${i.id}:${i.share.toFixed(3)}`).join(" ")}>
              <button className="views-hit" style={{ aspectRatio: `${a.intrinsics.width} / ${a.intrinsics.height}` }} onClick={(e) => tap(a.id, e)} aria-label={editable ? "Tap something in this picture to change it" : "Picture of the design"} disabled={!editable}>
                {s ? <Fade url={s.url} alt="The design, virtually staged in your basement" /> : <img className="views-img views-frame" src={a.frameUrl} alt="" />}
                {outline && selected?.angleId === a.id && (
                  <span className="views-outline" style={{ left: `${outline.x * 100}%`, top: `${outline.y * 100}%`, width: `${outline.w * 100}%`, height: `${outline.h * 100}%` }} />
                )}
              </button>
              <figcaption>
                <span className="views-label">Virtually staged</span>
                <span className="views-checked mono">{making.has(a.id) && s?.kind === "render" ? "Making it look real…" : s?.checked ?? "Drawing the design…"}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>

      {editable && (piece || picked) && (
        <div className="views-sheet" role="dialog" aria-label="Change it">
          <div className="views-sheet-head">
            <b>{piece ? SPECS[lookOf(piece)].label : picked!.startsWith("floor") ? "Floor" : "Walls"}</b>
            <button className="link-quiet" onClick={() => setSelected(null)}>
              Done
            </button>
          </div>
          {piece && SWAPS.includes(piece.kind) && (
            <div className="views-row">
              <span>Swap for</span>
              <div className="chips">
                {SWAPS.filter((k) => k !== piece.kind).map((k: FurnitureKind) => (
                  <button key={k} className="chip" onClick={() => change(swapFurniture(design, piece.id, k), `A ${SPECS[lookOf({ kind: k, id: k })].label.toLowerCase()} doesn't fit there.`)}>
                    {SPECS[lookOf({ kind: k, id: k })].label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {piece && lookOf(piece) !== "kitchen" && (
            <div className="views-row">
              <span>Colour</span>
              <div className="chips">
                {palette.map((c) => (
                  <button
                    key={c.name}
                    className="views-swatch"
                    aria-pressed={piece.colour === c.name}
                    title={c.name}
                    aria-label={c.name}
                    style={{ background: colourHex(c.name) ?? c.hex }}
                    onClick={() => change([{ op: "set_furniture", furnitureId: piece.id, colour: c.name }])}
                  />
                ))}
              </div>
            </div>
          )}
          {piece && (
            <div className="views-row">
              <span>Move</span>
              <div className="chips">
                <button className="chip" onClick={() => change(nudgeFurniture(design, piece.id, -0.5))} aria-label="Slide left along the wall">
                  ‹ Slide
                </button>
                <button className="chip" onClick={() => change(nudgeFurniture(design, piece.id, 0.5))} aria-label="Slide right along the wall">
                  Slide ›
                </button>
                <button
                  className="chip"
                  onClick={() => {
                    change([{ op: "remove_furniture", furnitureId: piece.id }]);
                    setSelected(null);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          )}
          {picked?.startsWith("floor") && (
            <div className="views-row">
              <span>Floor</span>
              <div className="chips">
                {FLOORS.map((f) => (
                  <button key={f} className="chip" aria-pressed={design.finishes.floor === f} onClick={() => change([{ op: "set_finishes", finishes: { floor: f } }])}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}
          {picked?.startsWith("wall") && (
            <div className="views-row">
              <span>Walls</span>
              <div className="chips">
                {WALLS.map((w) => (
                  <button key={w} className="chip" aria-pressed={design.finishes.walls === w} onClick={() => change([{ op: "set_finishes", finishes: { walls: w } }])}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
          )}
          {notice && <p className="views-notice">{notice}</p>}
          <p className="views-hint mono">Every angle changes with it.</p>
        </div>
      )}
      {editable && !selected && <p className="views-hint mono">Tap anything in a picture to change it.</p>}

      <Suspense fallback={null}>
        <AngleRenderer design={design} solid={solid} ceilingM={data.ceilingM ?? 2.3} size={size} onReady={onReady} scanId={scanId} />
      </Suspense>
    </section>
  );
}
