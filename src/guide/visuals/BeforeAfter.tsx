// Before and after (track E): their own steady frame, and the same view finished as the chosen design in
// the chosen look, one over the other with a line to drag (src/views/BeforeAfter.tsx). The frames are the
// design's own angles from the views API (server/views/routes.ts: only steady, level, well-lit frames,
// server/views/stable.ts), each with its `before`. A picture already made shows at once; the rest are
// drawn in a hidden canvas and finished by Muse Image (the photo, checked by SAM) as the pictures always
// were. The after is only ever that photo: until it lands their frame shows with a progress line, and
// where none could be made (SAM turned it down twice, today's budget is used up, or the example has none
// for that look) the frame says the picture is coming. Never the 3D laid over the photo. Under it, the
// four looks (a tap is `setLook`) and, with more than one angle, a thumbnail of each.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { designHash } from "../../../server/model/furniture";
import type { Design, Model } from "../../../server/model/types";
import { withLook } from "../../../server/views/finishWords";
import type { Solid } from "../../three/RealScan";
import { loadModel } from "../../studio/api";
import type { Snap } from "../../views/AngleRender";
import { BeforeAfter } from "../../views/BeforeAfter";
import { getViews, postPicture, type ViewsData } from "../../views/viewsApi";
import type { VisualProps } from "../mount";
import { LookPicker, lookName } from "./LookPicker";
import "./design.css";

const AngleRenderer = lazy(() => import("../../views/AngleRender").then((m) => ({ default: m.AngleRenderer })));

const ANGLES = 4; // at most, the design's own
// An angle's after: the photo (`url`), still being made, or none to show (`url` null, not making).
type After = { url: string | null; making: boolean };

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`frame ${url}`));
    img.src = url;
  });

export function BeforeAfterVisual({ scanId, visual, act }: VisualProps<"beforeAfter">) {
  const [model, setModel] = useState<Model | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    // Loaded again as the thread moves: a described look changes the design's finishes.
    loadModel(scanId)
      .then((r) => !gone && setModel(r.model))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [scanId, visual.designId, visual.look]);
  const base = model?.designs.find((d) => d.id === visual.designId) ?? model?.designs.find((d) => d.chosen) ?? model?.designs[0] ?? null;
  // The design in the look: "custom" is the design's own finishes, as they described them.
  const design = useMemo<Design | null>(() => (base ? (visual.look === "custom" ? base : withLook(base, visual.look)) : null), [base, visual.look]);
  const hash = design ? designHash(design) : null;

  const [data, setData] = useState<ViewsData | null>(null);
  const [afters, setAfters] = useState<Map<string, After>>(new Map());
  const [current, setCurrent] = useState<string | null>(visual.angleId ?? null);
  useEffect(() => {
    if (!design || !hash) return;
    let gone = false;
    setData(null);
    setAfters(new Map());
    getViews(scanId, hash, ANGLES, design.id)
      .then((d) => {
        if (gone) return;
        setData(d);
        setAfters(new Map(d.pictures.map((p) => [p.angleId, { url: p.kind === "photo" ? p.url : null, making: false }])));
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
    // The design as drawn (its hash), not every new object for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, hash]);
  const angles = useMemo(() => (data?.angles ?? []).filter((a) => a.group === "design").slice(0, ANGLES), [data]);
  const angle = angles.find((a) => a.id === current) ?? angles.find((a) => a.id === visual.angleId) ?? angles[0] ?? null;

  // The ones not made yet: drawn, then sent for their photo, the one showing first.
  const missing = useMemo(() => (data ? [...angles].sort((a, b) => Number(b.id === angle?.id) - Number(a.id === angle?.id)).filter((a) => !afters.has(a.id)) : []), [data, angles, afters, angle]);
  const [solid, setSolid] = useState<Solid | null | "none">(null);
  useEffect(() => {
    if (!data || !missing.length || solid !== null) return;
    let gone = false;
    Promise.all([fetch(data.meshUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null), import("../../three/RealScan")]).then(([buf, { parseMesh }]) => !gone && setSolid(buf ? parseMesh(buf) : "none"));
    return () => {
      gone = true;
    };
  }, [data, missing.length, solid]);
  const [snap, setSnap] = useState<{ fn: Snap; hash: string } | null>(null);
  const onReady = useCallback((fn: Snap | null, h: string) => setSnap((s) => (fn ? { fn, hash: h } : s?.hash === h ? null : s)), []);
  const running = useRef<string | null>(null);
  const anyMissing = missing.length > 0;
  useEffect(() => {
    if (!snap || !design || snap.hash !== hash || !missing.length || running.current === hash) return;
    running.current = hash;
    let stop = false;
    (async () => {
      for (const a of missing) {
        if (stop) return;
        const frame = await loadImage(a.frameUrl).catch(() => null);
        if (!frame || stop) continue;
        const r = await snap.fn(a, frame).catch(() => null);
        if (!r || stop) continue;
        setAfters((m) => new Map(m).set(a.id, { url: null, making: true }));
        postPicture(scanId, a.id, r.guide, { designHash: r.hash, viewKey: r.view, items: r.items, walls: r.walls, doors: r.doors, finishes: design.finishes })
          // Only a photo that passed SAM's check is an after.
          .then((p) => !stop && setAfters((m) => new Map(m).set(a.id, { url: p.url && p.kind === "photo" ? p.url : null, making: false })))
          .catch(() => !stop && setAfters((m) => new Map(m).set(a.id, { url: null, making: false })));
      }
    })().finally(() => {
      if (running.current === hash) running.current = null;
    });
    return () => {
      stop = true;
      running.current = null;
    };
    // `missing` only says whether there's anything left to draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, hash, anyMissing, scanId]);

  const pickLook = (look: Parameters<typeof lookName>[0]) => look !== "custom" && act({ type: "setLook", look });
  const looks = <LookPicker look={visual.look} onPick={pickLook} />;
  if (failed) return <div className="gs-ba" data-state="error"><p className="gs-ba-note" role="alert">The pictures didn't load. Refresh to try again.</p>{looks}</div>;
  if (!design || !data) return <div className="gs-ba" data-state="loading"><p className="gs-ba-note">Finding your steadiest frames, a few seconds</p>{looks}</div>;
  if (!angle) return <div className="gs-ba" data-state="none"><p className="gs-ba-note">None of your video's frames is steady and level enough to picture {design.name}. A slower walk-through gives me some.</p>{looks}</div>;

  const after = afters.get(angle.id);
  const ratio = angle.intrinsics.width / angle.intrinsics.height;
  const state = after?.url ? "photo" : !after || after.making ? "making" : "coming";
  return (
    <div className="gs-ba" data-state={state} data-angle={angle.id} data-look={visual.look}>
      <div className="gs-ba-stage">
        <div className="gs-ba-fit" style={{ ["--ratio" as string]: `${ratio}` }}>
          {after?.url ? (
            <BeforeAfter
              key={`${angle.id}:${after.url}`}
              before={angle.frameUrl}
              after={after.url}
              alt={`${design.name} in ${lookName(visual.look)}, virtually staged in your basement`}
              ratio={`${ratio}`}
              afterLabel="After · virtually staged"
            />
          ) : (
            <img className="gs-ba-frame" src={angle.frameUrl} alt="Your basement, as you filmed it" draggable={false} />
          )}
        </div>
        {state === "making" && <p className="gs-ba-progress">Finishing it in {lookName(visual.look)}, about 20 seconds</p>}
        {state === "coming" && <p className="gs-ba-progress gs-ba-coming">Picture coming: this look isn't finished for this angle yet</p>}
      </div>
      <div className="gs-ba-bar">
        {looks}
        {angles.length > 1 && (
          <div className="gs-ba-thumbs" role="group" aria-label="Angles">
            {angles.map((a, i) => (
              <button key={a.id} type="button" className="gs-ba-thumb" aria-pressed={a.id === angle.id} aria-label={`Angle ${i + 1}`} onClick={() => setCurrent(a.id)}>
                <img src={afters.get(a.id)?.url ?? a.frameUrl} alt="" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
      {missing.length > 0 && solid !== null && (
        <Suspense fallback={null}>
          <AngleRenderer design={design} solid={solid === "none" ? null : solid} ceilingM={data.ceilingM ?? 2.3} size={[angle.intrinsics.width, angle.intrinsics.height]} onReady={onReady} />
        </Suspense>
      )}
    </div>
  );
}

