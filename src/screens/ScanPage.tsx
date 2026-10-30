// /scans/:id. While the scan runs this is the live screen; once done, the same URL is the workspace.
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getScan } from "../api";
import { Logo } from "../components/Logo";
import { LiveScan } from "./LiveScan";
import { Workspace } from "./Workspace";

export function ScanPage() {
  const { scanId } = useParams({ from: "/scans/$scanId" });
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"loading" | "live" | "result" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    if (scanId === "sample") {
      setPhase("live");
      return;
    }
    getScan(scanId)
      .then((s) => !cancelled && setPhase(s.status === "done" ? "result" : "live"))
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
        <h1>We couldn't find that scan.</h1>
        <Link to="/" className="btn btn-primary">Scan a basement</Link>
      </main>
    );
  }
  if (phase === "live") return <LiveScan scanId={scanId} onDone={() => setPhase("result")} />;
  return <Workspace scanId={scanId} onRestart={() => navigate({ to: "/" })} />;
}
