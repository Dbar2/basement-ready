// The guide's thread from the server (GET/POST /api/scans/:id/guide). Track B owns this file and the server
// behind it; this first version reads and posts as the contract says.
import { authHeaders } from "../api";
import type { GuideAction, GuideMessage, GuideState } from "./types";

export async function getGuide(scanId: string): Promise<GuideState> {
  const res = await fetch(`/api/scans/${scanId}/guide`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Your guide didn't load. Refresh to try again.");
  return res.json();
}

export async function postGuide(scanId: string, action: GuideAction): Promise<{ messages: GuideMessage[]; state: GuideState }> {
  const res = await fetch(`/api/scans/${scanId}/guide`, { method: "POST", headers: await authHeaders(true), body: JSON.stringify({ action }) });
  if (!res.ok) throw new Error("That didn't go through. Try again.");
  return res.json();
}
