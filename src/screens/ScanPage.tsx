// /scans/:id. While the scan runs this is the wait screen (step 1 of the flow, src/flow/flow.ts). Once
// it's done, the person who filmed it lands on the step they left off on (the plan check the first
// time); ?tab= opens the workspace (the book, the decision, the permit, money and build tabs). A
// shared link reads the workspace. The example replays its wait screen the first time, then resumes.
import { Link, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getScan } from "../api";
import { Logo } from "../components/Logo";
import { lastStep, stepUrl } from "../flow/flow";
import { LiveScan } from "./LiveScan";
import { Workspace } from "./Workspace";

export function ScanPage() {
  const { scanId } = useParams({ from: "/scans/$scanId" });
  const navigate = useNavigate();
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "live" | "result" | "missing">("loading");
  const [owner, setOwner] = useState(scanId === "sample");

  useEffect(() => {
    let cancelled = false;
    const tab = new URLSearchParams(window.location.search).get("tab");
    // Done: the workspace when a tab is asked for or it's a shared link; else where they left off.
    const land = async (canEdit: boolean) => {
      if (tab || !canEdit) return setPhase("result");
      const step = await lastStep(scanId);
      if (cancelled) return;
      if (step === "book") {
        // The workspace, with its tab in the address so a refresh stays on it.
        window.history.replaceState(window.history.state, "", stepUrl(scanId, "book"));
        return setPhase("result");
      }
      if (!step && scanId === "sample") return setPhase("live");
      router.history.replace(stepUrl(scanId, step ?? "plan"));
    };
    if (scanId === "sample") void land(true);
    else
      getScan(scanId)
        .then((s) => {
          if (cancelled) return;
          setOwner(Boolean(s.canEdit));
          if (s.status === "done") void land(Boolean(s.canEdit));
          else setPhase("live");
        })
        .catch(() => !cancelled && setPhase("missing"));
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  if (phase === "loading") return <main className="result-loading"><Logo /></main>;
  if (phase === "missing") {
    return (
      <main className="not-found">
        <Logo />
        <h1>We couldn't open that scan.</h1>
        <p className="muted">Scans are private: open it on the phone or computer you filmed with, or sign in to the account you saved it to.</p>
        <Link to="/" className="btn btn-primary">Scan a basement</Link>
      </main>
    );
  }
  // The wait screen hands on to the plan check; someone only watching gets the answer.
  if (phase === "live") return <LiveScan scanId={scanId} onDone={() => (owner ? router.history.push(stepUrl(scanId, "plan")) : setPhase("result"))} />;
  return <Workspace scanId={scanId} onRestart={() => navigate({ to: "/" })} />;
}
