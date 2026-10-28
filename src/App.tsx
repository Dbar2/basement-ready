import { useState } from "react";
import type { Household } from "./api";
import { LiveScan } from "./screens/LiveScan";
import { Result } from "./screens/Result";
import { Start } from "./screens/Start";
import "./styles/global.css";

type State =
  | { stage: "start" }
  | { stage: "scan"; video: File | null; household: Household; address: string }
  | { stage: "result"; scanId: string };

export function App() {
  const [state, setState] = useState<State>({ stage: "start" });

  if (state.stage === "start") return <Start onStart={(input) => setState({ stage: "scan", ...input })} />;

  if (state.stage === "scan") {
    return (
      <LiveScan
        video={state.video}
        household={state.household}
        address={state.address}
        onDone={(scanId) => setState({ stage: "result", scanId })}
      />
    );
  }

  return <Result scanId={state.scanId} onRestart={() => setState({ stage: "start" })} />;
}
