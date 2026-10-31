// /scans/:id/plan, "Is this your basement?" (step 2 of the flow), until the guide takes the route over:
// the guide's plan editor (src/guide/visuals/PlanEdit.tsx) on its own sheet, with the old flow's way back
// and "Yes, this is my basement", which confirms the plan and draws the designs on it, then on to the
// layouts.
import { useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FlowFoot, FlowHead, FlowLink } from "../flow/FlowNav";
import { stepUrl } from "../flow/flow";
import { applyToPlan, PlanEdit } from "../guide/visuals/PlanEdit";
import "./studio.css";

export function PlanConfirm() {
  const { scanId } = useParams({ from: "/scans/$scanId/plan" });
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = "Is this your basement? | Basement Ready";
  }, []);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await applyToPlan(scanId, { type: "confirmPlan" });
      router.history.push(stepUrl(scanId, "layouts"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="flow-page studio-page">
      <FlowHead scanId={scanId} step="plan" />
      <div className="studio-body confirm flow-body">
        <section className="studio-main">
          <div className="studio-title">
            <h1>Is this your basement?</h1>
            <p className="lede">Tap a wall to type its length from a tape, drag the green knobs, tap a room to name it. Dashed walls are our guesses.</p>
          </div>
          <div className="plan-stage plan-stage-edit">
            <PlanEdit scanId={scanId} />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      </div>
      <FlowFoot
        scanId={scanId}
        step="plan"
        next={{ label: busy ? "Drawing your designs…" : "Yes, this is my basement", onClick: () => void confirm(), disabled: busy }}
        extra={<FlowLink className="link-quiet flow-skip" href={stepUrl(scanId, "layouts")}>Not now</FlowLink>}
      />
    </div>
  );
}
