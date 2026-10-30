// Step 5, /scans/:id/pictures: the design they made in the studio, pictured from the best spots in
// their own video. Tap anything to change it; the change goes into the model, so the studio, the quote,
// the book and the permit set all follow.
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Design, Model } from "../../server/model/types";
import { FlowFoot, FlowHead } from "../flow/FlowNav";
import { loadModel, saveModel } from "../studio/api";
import { DesignPictures } from "./DesignPictures";
import "../flow/flow.css";

export function PicturesPage() {
  const { scanId } = useParams({ from: "/scans/$scanId/pictures" });
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const timer = useRef(0);

  useEffect(() => {
    document.title = "Your design, from where you stood | Basement Ready";
    loadModel(scanId)
      .then((r) => setModel(r.model))
      .catch((e) => setError(e instanceof Error ? e.message : "We couldn't open your design."));
  }, [scanId]);

  const design = model?.designs.find((d) => d.chosen) ?? model?.designs[0] ?? null;
  const change = (next: Design) => {
    if (!model) return;
    const m = { ...model, designs: model.designs.map((d) => (d.id === next.id ? { ...next, chosen: true } : { ...d, chosen: false })) };
    setModel(m);
    setSaved("saving");
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      saveModel(scanId, m)
        .then(() => setSaved("saved"))
        .catch(() => setSaved("error"));
    }, 600);
  };

  return (
    <div className="flow-page">
      <FlowHead scanId={scanId} step="pictures" />
      <main className="views-page">
        <h1>{design ? `${design.name}, from where you stood` : "Your design, from where you stood"}</h1>
        <p className="views-page-lede">The same design from the best spots in your {scanId === "sample" ? "video" : "take"}. Tap anything to change it.</p>
        {error ? <p className="error">{error}</p> : design ? <DesignPictures key={design.id} scanId={scanId} design={design} onDesignChange={change} view="swipe" /> : <div className="views-skeleton" aria-busy="true" />}
      </main>
      <FlowFoot scanId={scanId} step="pictures" extra={<span className="aside save-state" aria-live="polite">{saved === "saving" ? "Saving…" : saved === "error" ? "Not saved" : ""}</span>} />
    </div>
  );
}
