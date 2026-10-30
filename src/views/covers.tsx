// One picture of each of several designs, for the layout cards: the design drawn from the real angle
// that shows it best (the same render as the pictures, src/views/AngleRender.tsx), made real by Muse
// Image and checked by SAM like every picture (server/views/photoreal.ts) when there's budget. Pictures
// already made show at once; the rest are drawn one design at a time through one hidden canvas.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { designHash } from "../../server/model/furniture";
import type { Design } from "../../server/model/types";
import type { Solid } from "../three/RealScan";
import type { AngleView, Snap } from "./AngleRender";
import { getViews, postPicture } from "./viewsApi";

const AngleRenderer = lazy(() => import("./AngleRender").then((m) => ({ default: m.AngleRenderer })));

// undefined: still coming; null: no angle of this scan shows this design.
export type Cover = { url: string; kind: "photo" | "render"; checked: string; making: boolean } | null;

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`frame ${url}`));
    img.src = url;
  });

export function useDesignCovers(scanId: string, designs: Design[]): { covers: Record<string, Cover | undefined>; renderer: ReactNode } {
  const [covers, setCovers] = useState<Record<string, Cover | undefined>>({});
  const [angles, setAngles] = useState<Record<string, AngleView>>({});
  const [queue, setQueue] = useState<string[]>([]);
  const [solid, setSolid] = useState<Solid | null | "none">(null);
  const [ceilingM, setCeilingM] = useState(2.3);
  const hashes = designs.map(designHash).join();
  const set = (id: string, c: Cover) => setCovers((m) => ({ ...m, [id]: c }));

  // Each design's best angle, and its picture when one was made before.
  useEffect(() => {
    let gone = false;
    setQueue([]);
    void (async () => {
      let meshUrl: string | null = null;
      for (const d of designs) {
        const v = await getViews(scanId, designHash(d), 4, d.id).catch(() => null);
        if (gone) return;
        const angle = v?.angles.find((a) => a.group === "design") ?? null;
        if (!v || !angle) {
          set(d.id, null);
          continue;
        }
        meshUrl ??= v.meshUrl;
        setCeilingM(v.ceilingM ?? 2.3);
        const made = v.pictures.find((p) => p.angleId === angle.id);
        if (made) set(d.id, { url: made.url, kind: made.kind, checked: made.checked, making: false });
        else {
          setAngles((a) => ({ ...a, [d.id]: angle }));
          setQueue((q) => [...q, d.id]);
        }
      }
      if (!meshUrl) return setSolid("none");
      const [buf, { parseMesh }] = await Promise.all([fetch(meshUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null), import("../three/RealScan")]);
      if (!gone) setSolid(buf ? parseMesh(buf) : "none");
    })();
    return () => {
      gone = true;
    };
    // The designs as drawn, not every change to which one is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, hashes]);

  const current = useMemo(() => designs.find((d) => d.id === queue[0]) ?? null, [designs, queue]);
  const onReady = useCallback(
    (snap: Snap | null, hash: string) => {
      if (!snap || !current || hash !== designHash(current)) return;
      const angle = angles[current.id];
      const id = current.id;
      void (async () => {
        try {
          const frame = await loadImage(angle.frameUrl);
          const r = await snap(angle, frame);
          set(id, { url: r.url, kind: "render", checked: "The 3D design drawn over your frame", making: true });
          postPicture(scanId, angle.id, r.guide, { designHash: r.hash, viewKey: r.view, items: r.items, walls: r.walls, finishes: current.finishes })
            .then((p) => set(id, p.url ? { url: p.url, kind: p.kind, checked: p.checked, making: false } : { url: r.url, kind: "render", checked: "The 3D design drawn over your frame", making: false }))
            .catch(() => set(id, { url: r.url, kind: "render", checked: "The 3D design drawn over your frame", making: false }));
        } catch {
          set(id, null);
        }
        setQueue((q) => q.filter((x) => x !== id));
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, angles, scanId],
  );

  const angle = current ? angles[current.id] : null;
  const renderer =
    current && angle && solid !== null ? (
      <Suspense fallback={null}>
        <AngleRenderer key="covers" design={current} solid={solid === "none" ? null : solid} ceilingM={ceilingM} size={[angle.intrinsics.width, angle.intrinsics.height]} onReady={onReady} scanId={scanId} />
      </Suspense>
    ) : null;
  return { covers, renderer };
}
