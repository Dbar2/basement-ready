// The studio's calls: the model (seeded from the scan the first time, then saved with the workspace),
// the designs for a confirmed plan, and muse-spark's proposal for a described change. The sample keeps
// its model in this browser, like the rest of its workspace.
import { ModelSchema } from "../../server/model/schema";
import type { Design, Edit, Existing, Finishes, Model } from "../../server/model/types";
import { getWorkspace, headers, saveWorkspace } from "../workspaceApi";

export async function loadModel(scanId: string): Promise<{ model: Model; saved: boolean }> {
  if (scanId === "sample") {
    const ws = await getWorkspace(scanId);
    const kept = ModelSchema.safeParse(ws.state.model);
    if (kept.success) return { model: kept.data as Model, saved: true };
  }
  const res = await fetch(`/api/scans/${scanId}/model`, { headers: await headers() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "We couldn't open your basement's plan.");
  return body;
}

export async function saveModel(scanId: string, model: Model) {
  await saveWorkspace(scanId, { state: { model } });
}

// Every design drawn again on the plan as they confirmed it.
export async function designsFor(existing: Existing, finishes?: Partial<Finishes>): Promise<Design[]> {
  const res = await fetch("/api/model/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ existing, finishes }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "We couldn't draw the designs. Try again.");
  return body.designs;
}

export type Proposal = { summary: string; edits: Edit[]; dropped: string[] };

export async function describeChange(scanId: string, design: Design, existing: Existing, ask: string): Promise<Proposal> {
  const res = await fetch(`/api/scans/${scanId}/model/describe`, { method: "POST", headers: await headers(true), body: JSON.stringify({ design, existing, ask }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "That didn't work. Try again.");
  return body;
}
