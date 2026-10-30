// Client for the swipe deck and the board (server/ideas/routes.ts). The example ("sample") reads its
// deck from public/samples/sample/cards and keeps its board in this browser.
import type { BoardMood, Card, Deck, Slot } from "../../server/ideas/deck";
import type { Design, Finishes } from "../../server/model/types";
import type { Plan } from "../api";
import { getWorkspace, saveWorkspace } from "../workspaceApi";

// The board's read: the model's Mood plus the furniture colours it sets.
export type Mood = BoardMood;
export type { Card, Deck, Slot };

const isSample = (scanId: string) => scanId === "sample";

// This browser's claim tokens and, when signed in, the Clerk session: what the server checks.
async function headers(json = false): Promise<Record<string, string>> {
  const h: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
  try {
    const claims = localStorage.getItem("br-claims");
    if (claims) h["x-claims"] = encodeURIComponent(claims);
  } catch {
    // Private mode: only a signed-in owner can start the deck.
  }
  const clerk = (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string | null> } | null } }).Clerk;
  const token = await clerk?.session?.getToken().catch(() => null);
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export const emptyDeck: Deck = { status: "waiting", slots: [], cards: [], dropped: [] };

export async function sampleDeck(): Promise<Deck> {
  const res = await fetch("/samples/sample/cards/deck.json");
  return res.ok ? res.json() : { ...emptyDeck, status: "failed" };
}

// Opening the deck starts it on the server; afterwards it's read as it fills.
export async function startDeck(scanId: string): Promise<Deck | { error: string }> {
  if (isSample(scanId)) return sampleDeck();
  const res = await fetch(`/api/scans/${scanId}/cards`, { method: "POST", headers: await headers() });
  const body = await res.json().catch(() => ({ error: "The cards didn't start. Try again." }));
  return res.ok ? body : { error: body.error ?? "The cards didn't start. Try again." };
}

export async function readDeck(scanId: string): Promise<Deck> {
  if (isSample(scanId)) return sampleDeck();
  const res = await fetch(`/api/scans/${scanId}/cards`, { cache: "no-store" });
  return res.ok ? res.json() : emptyDeck;
}

export const SAMPLE_MOOD = "br-sample-mood";

// What their board reads, saved as they swipe, into the model (the example's lives in this browser).
export async function saveMood(scanId: string, mood: Mood): Promise<void> {
  if (isSample(scanId)) {
    const { state } = await getWorkspace(scanId);
    if (state.model) await saveWorkspace(scanId, { state: { model: { ...state.model, mood } } });
    try {
      localStorage.setItem(SAMPLE_MOOD, JSON.stringify(mood));
    } catch {
      // Private mode: the board lasts as long as the page.
    }
    return;
  }
  await fetch(`/api/scans/${scanId}/mood`, { method: "POST", headers: await headers(true), body: JSON.stringify(mood) }).catch(() => {});
}

export const frameSrc = (scanId: string, frame: number) =>
  isSample(scanId) ? `/samples/sample/frames/${String(frame).padStart(4, "0")}.jpg` : `/api/scans/${scanId}/frames/${frame}`;
