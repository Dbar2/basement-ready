// A picture of each layout in clean 3D, for the layout cards (src/ideas/LayoutPicker.tsx): the basement as
// built with the design's walls and furniture inside, from above at an angle (src/views/LayoutShotCanvas.tsx).
// Nothing is drawn over a photo. One hidden canvas draws the designs one at a time; each picture is kept
// for the visit, so going back to the layouts shows them at once.
//
//   const { shots, renderer } = useLayoutShots(scanId, model);
//   shots[design.id]: a picture's URL, null if it couldn't be drawn, undefined while it's coming.
//   {renderer} goes anywhere on the page (it's hidden).
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { designHash } from "../../server/model/furniture";
import type { Model } from "../../server/model/types";

const LayoutShots = lazy(() => import("./LayoutShotCanvas"));

const kept = new Map<string, string | null>();
const keyOf = (scanId: string, hash: string) => `${scanId}:${hash}`;

export function useLayoutShots(scanId: string, model: Model | null): { shots: Record<string, string | null | undefined>; renderer: ReactNode } {
  const designs = useMemo(() => model?.designs ?? [], [model]);
  const keys = useMemo(() => new Map(designs.map((d) => [d.id, keyOf(scanId, designHash(d))])), [designs, scanId]);
  const [shots, setShots] = useState<Record<string, string | null | undefined>>({});
  useEffect(() => {
    setShots(Object.fromEntries(designs.map((d) => [d.id, kept.get(keys.get(d.id)!)])));
  }, [designs, keys]);
  const current = designs.find((d) => shots[d.id] === undefined && !kept.has(keys.get(d.id)!)) ?? null;
  const onShot = useCallback(
    (blob: Blob | null, painted: boolean) => {
      if (!current) return;
      const url = blob ? URL.createObjectURL(blob) : null;
      const key = keys.get(current.id)!;
      // A plain picture while the paint is still being made is shown but drawn again next visit.
      if (painted) kept.set(key, url);
      // Every design that draws the same (the same rooms and furniture) shares the picture.
      setShots((s) => ({ ...s, ...Object.fromEntries(designs.filter((d) => keys.get(d.id) === key).map((d) => [d.id, url])) }));
    },
    [current, keys, designs],
  );
  const renderer =
    model && current ? (
      <Suspense fallback={null}>
        <LayoutShots scanId={scanId} existing={model.existing} design={current} onShot={onShot} />
      </Suspense>
    ) : null;
  return { shots, renderer };
}
