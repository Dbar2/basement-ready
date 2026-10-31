// The guide's thread from the server (GET/POST /api/scans/:id/guide, server/guide/routes.ts): the thread
// as it stands, and an action on it. A real scan's thread is kept on its workspace; the example's lives in
// this browser and goes with each action, with the workspace its cards saved here (src/workspaceApi.ts).
import { authHeaders } from "../api";
import { getWorkspace } from "../workspaceApi";
import type { GuideAction, GuideMessage, GuideState } from "./types";

const SAMPLE_KEY = "br-guide-sample";

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

// `fresh`: ask the server even for the example (it starts over).
export async function getGuide(scanId: string, fresh = false): Promise<GuideState> {
  if (scanId === "sample" && !fresh) {
    const kept = readSample();
    if (kept) return kept;
  }
  const res = await fetch(`/api/scans/${scanId}/guide`, { headers: await authHeaders() });
  if (!res.ok) throw await errorOf(res, "Your guide didn't load. Refresh to try again.");
  const state = (await res.json()) as GuideState;
  if (scanId === "sample") keepSample(state);
  return state;
}

// The example sends its thread and its workspace along, since the server keeps nothing for it.
export async function postGuide(scanId: string, action: GuideAction, state?: GuideState | null): Promise<{ messages: GuideMessage[]; state: GuideState }> {
  const sample = async () => {
    const { profile, state: workspace } = await getWorkspace("sample");
    return { action, state: state ?? readSample(), workspace: { profile, state: workspace } };
  };
  const res = await fetch(`/api/scans/${scanId}/guide`, {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify(scanId === "sample" ? await sample() : { action }),
  });
  if (!res.ok) throw await errorOf(res, "That didn't go through. Try again.");
  const sent = (await res.json()) as { messages: GuideMessage[]; state: GuideState };
  if (scanId === "sample") keepSample(sent.state);
  return sent;
}

// Their question said aloud: the recorded clip, as the browser made it, to Muse Voice Transcribe on the
// server (server/guide/voice.ts). Returns the words for the ask box.
export async function hearGuide(scanId: string, clip: Blob): Promise<string> {
  const res = await fetch(`/api/scans/${scanId}/guide/voice`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": clip.type || "application/octet-stream" },
    body: clip,
  });
  if (!res.ok) throw await errorOf(res, "I couldn't hear that. Try again, or type it.");
  return ((await res.json()) as { text: string }).text;
}
