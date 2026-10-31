// Step 3, /scans/:id/layouts, "Pick a layout": the designs drawn on their confirmed plan, each with a
// picture of it in their basement, its checks and its price, and the decision beside them. Tapping a
// card picks it (saved at once); the way on is the 3D studio, open on the one they picked.
import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { costLabel, DEMO_LABEL, EXAMPLE_LABEL, getScan, type ScanResult } from "../api";
import { LayoutPicker } from "../ideas/LayoutPicker";
import { loadModel, saveModel } from "../studio/api";
import type { Model } from "../../server/model/types";
import { stepUrl } from "./flow";
import { FlowFoot, FlowHead, FlowLink } from "./FlowNav";
import "../studio/studio.css";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

export function LayoutsPage() {
  const { scanId } = useParams({ from: "/scans/$scanId/layouts" });
  const [model, setModel] = useState<Model | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"saved" | "saving" | "error">("saved");

  useEffect(() => {
    document.title = "Pick a layout | Basement Ready";
    loadModel(scanId)
      .then((r) => setModel(r.model))
      .catch((e) => setError(e instanceof Error ? e.message : "We couldn't open your layouts."));
    void getScan(scanId).then((s) => setResult(s.result ?? null)).catch(() => {});
  }, [scanId]);

  const pick = (id: string) => {
    if (!model) return;
    const next = { ...model, designs: model.designs.map((d) => ({ ...d, chosen: d.id === id })) };
    setModel(next);
    setSaving("saving");
    saveModel(scanId, next)
      .then(() => {
        setSaving("saved");
        // The answer is priced on the picked design: its cost and money follow the pick.
        return getScan(scanId).then((s) => setResult(s.result ?? null));
      })
      .catch(() => setSaving("error"));
  };
  const chosen = model?.designs.find((d) => d.chosen) ?? null;

  return (
    <div className="flow-page">
      <FlowHead scanId={scanId} step="layouts" />
      <main className="layouts-page">
        <div className="flow-title">
          <h1>Pick a layout</h1>
          <p className="lede">
            {model ? `${model.designs.length} ways to lay out your basement, drawn on your plan.` : "Drawing the layouts on your plan…"}
            {model && !model.existing.confirmedAt && " Check the plan first to make them exact."}
          </p>
        </div>
        {error ? (
          <div>
            <p className="error">{error}</p>
            <FlowLink className="btn btn-primary" href={`/scans/${scanId}?tab=decision`}>See the answer</FlowLink>
          </div>
        ) : model ? (
          <LayoutPicker scanId={scanId} model={model} municipality={result?.municipality} fixes={result?.fixGroups} onPick={pick} />
        ) : (
          <div className="skeleton skeleton-plan" aria-busy="true" />
        )}
        {result && <Decision scanId={scanId} r={result} />}
      </main>
      <FlowFoot
        scanId={scanId}
        step="layouts"
        next={{ label: "Design it in 3D", href: stepUrl(scanId, "studio"), disabled: !chosen }}
        extra={<span className="aside save-state" aria-live="polite">{saving === "saving" ? "Saving…" : saving === "error" ? "Not saved" : ""}</span>}
      />
    </div>
  );
}

// The answer so far, beside the layouts: the verdict, what it means, and the money they may qualify for.
function Decision({ scanId, r }: { scanId: string; r: ScanResult }) {
  const upTo = r.money?.total ?? 0;
  return (
    <aside className="decision-card" data-verdict={r.verdict} aria-label="Your answer">
      <p className="eyebrow">{r.verdict === "no" ? "Not likely as it is" : r.verdict === "fix" ? "Likely, after fixes" : "Likely"} · {scanId === "sample" ? "the example" : r.demo ? "the demo house" : (r.city ?? "your basement")}</p>
      {scanId === "sample" && <p className="muted small">{EXAMPLE_LABEL}</p>}
      {r.demo && <p className="muted small">{DEMO_LABEL}</p>}
      <h2>{r.headline}</h2>
      {r.summary && <p className="muted">{r.summary}</p>}
      <dl>
        {r.cost.high > 0 && (
          <>
            <dt>{costLabel(r)}</dt>
            <dd data-total data-low={r.cost.low} data-high={r.cost.high}>{money(r.cost.low)}–{money(r.cost.high)}</dd>
          </>
        )}
        {upTo > 0 && (
          <>
            <dt>You may be eligible for</dt>
            <dd>up to {money(upTo)}</dd>
          </>
        )}
      </dl>
      <FlowLink className="link-quiet" href={`/scans/${scanId}?tab=decision`}>Why, and what has to change</FlowLink>
    </aside>
  );
}
