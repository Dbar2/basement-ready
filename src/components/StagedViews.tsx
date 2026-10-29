// "What it could look like": the real room finished in 3D to a starting layout, and photos of the
// homeowner's own frames finished by Muse Image (always labelled virtually staged, checked by SAM).
import { Suspense, useState } from "react";
import type { Concept, Layout, Plan } from "../api";
import { lazy3d, View3DBoundary } from "./View3D";

const StagedBasement = lazy3d(() => import("../three/StagedBasement").then((m) => m.StagedBasement));

export const conceptUrl = (scanId: string, n: number) => (scanId === "sample" ? `/samples/sample/concepts/${n}.jpg` : `/api/scans/${scanId}/concepts/${n}.jpg`);

export function StagedViews(props: {
  scanId: string;
  plan: Plan | null;
  layout: Layout | null;
  concepts: { status: "pending" | "done" | "failed"; items: Concept[] } | null;
}) {
  const { scanId, plan, layout, concepts } = props;
  const has3d = Boolean(plan && layout);
  const photos = concepts?.items ?? [];
  const [view, setView] = useState<"3d" | "photos">(has3d ? "3d" : "photos");
  if (!has3d && !concepts) return null;
  const shown = view === "3d" && has3d ? "3d" : "photos";

  return (
    <section className="block staged">
      <div className="scan-views-head">
        <h2>What it could look like</h2>
        <div className="segmented" role="tablist" aria-label="View">
          {has3d && (
            <button role="tab" aria-selected={shown === "3d"} onClick={() => setView("3d")}>
              Walk through
            </button>
          )}
          <button role="tab" aria-selected={shown === "photos"} onClick={() => setView("photos")}>
            Photos
          </button>
        </div>
      </div>
      <p className="lede">
        {shown === "3d"
          ? "Your real room, at its measured size, with its windows, door and stairs where they are: finished to a starting layout a designer can build from."
          : "Your own footage, finished. Virtually staged: the room shape, windows and stairs are yours, the finishes are a suggestion."}
      </p>

      {/* Both stay mounted once shown: tearing the 3D down breaks its labels. */}
      {has3d && (
        <div hidden={shown !== "3d"}>
          <View3DBoundary>
            <Suspense fallback={<p className="viewer-empty mono">Building your finished basement in 3D…</p>}>
              <StagedBasement plan={plan!} layout={layout!} />
            </Suspense>
          </View3DBoundary>
          <ul className="stage-checks">
            {layout!.checks.map((c) => (
              <li key={c.label} data-ok={c.ok === null ? "unknown" : c.ok}>
                <b>{c.label}</b> <span className="muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div hidden={shown !== "photos"}>
        {concepts?.status === "pending" && photos.length === 0 ? (
          <p className="viewer-empty mono concepts-wait">Picturing your finished basement…</p>
        ) : photos.length === 0 ? (
          <p className="muted">We couldn't make photos this time. The 3D view shows the same layout.</p>
        ) : (
          <div className="concepts">
            {photos.map((c) => (
              <figure key={c.n} className="concept">
                <img src={conceptUrl(scanId, c.n)} alt={`${c.title}, virtually staged from your own video`} loading="lazy" />
                <span className="concept-label mono">Virtually staged</span>
                <figcaption>
                  <b>{c.title}</b>
                  <span className={c.kept ? "concept-check" : "concept-check concept-check--warn"}>{c.checked}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
