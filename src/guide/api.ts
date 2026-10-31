// The guide's two calls (server/guide/routes.ts): the thread as it stands, and an action on it. A real
// scan's thread is kept on its workspace; the example's lives in this browser and goes with each action.
import { authHeaders } from "../api";
import type { GuideAction, GuideMessage, GuideState } from "./types";

const SAMPLE_KEY = "br-guide-sample";

export type Sent = { messages: GuideMessage[]; state: GuideState };

function readSample(): GuideState | null {
  try {
    const raw = localStorage.getItem(SAMPLE_KEY);
    return raw ? (JSON.parse(raw) as GuideState) : null;
  } catch {
    return null;
  }
}

function keepSample(state: GuideState) {
  try {
    localStorage.setItem(SAMPLE_KEY, JSON.stringify(state));
  } catch {
    // Private windows can refuse: the example still works, it just starts over on reload.
  }
}

// Starts the example again from its first question.
export function forgetSample() {
  try {
    localStorage.removeItem(SAMPLE_KEY);
  } catch {
    // Nothing kept.
  }
}

async function errorOf(res: Response, fallback: string) {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? fallback);
}

export async function loadGuide(scanId: string): Promise<GuideState> {
  if (scanId === "sample") {
    const kept = readSample();
    if (kept) return kept;
  }
  const res = await fetch(`/api/scans/${scanId}/guide`, { headers: await authHeaders() });
  if (!res.ok) throw await errorOf(res, "We couldn't open your guide. Try again.");
  const state = (await res.json()) as GuideState;
  if (scanId === "sample") keepSample(state);
  return state;
}

export async function sendGuide(scanId: string, action: GuideAction, state: GuideState): Promise<Sent> {
  const res = await fetch(`/api/scans/${scanId}/guide`, {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify(scanId === "sample" ? { action, state } : { action }),
  });
  if (!res.ok) throw await errorOf(res, "That didn't go through. Try again.");
  const sent = (await res.json()) as Sent;
  if (scanId === "sample") keepSample(sent.state);
  return sent;
}
