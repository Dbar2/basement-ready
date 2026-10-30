// Client for the swipe deck and the layout picker (server/ideas/routes.ts). The example ("sample")
// reads its deck from public/samples/sample/cards and keeps its pick in this tab.
import type { Card, Deck, Slot } from "../../server/ideas/deck";
import type { LayoutOption } from "../../server/ideas/layouts";
import type { Design, Finishes, Mood } from "../../server/model/types";
import type { Plan } from "../api";

export type { Card, Deck, LayoutOption, Mood, Slot };

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

export async function getLayouts(scanId: string): Promise<{ plan: Plan | null; options: LayoutOption[] }> {
  const res = await fetch(`/api/scans/${scanId}/layouts`, { cache: "no-store" });
  return res.ok ? res.json() : { plan: null, options: [] };
}

// A layout's real corner with their board's finishes. Takes a few seconds the first time.
export async function cornerPicture(scanId: string, option: string, finishes: Partial<Finishes>): Promise<{ url: string; checked: string } | { error: string }> {
  const res = await fetch(`/api/scans/${scanId}/corner`, { method: "POST", headers: await headers(true), body: JSON.stringify({ option, finishes }) });
  const body = await res.json().catch(() => ({}));
  return res.ok ? body : { error: body.error ?? "No picture this time." };
}

// What their board reads, saved as they swipe (the example keeps it in this tab).
export async function saveMood(scanId: string, mood: Mood): Promise<void> {
  if (isSample(scanId)) return;
  await fetch(`/api/scans/${scanId}/mood`, { method: "POST", headers: await headers(true), body: JSON.stringify(mood) }).catch(() => {});
}

const SAMPLE_PICK = "br-sample-design";

// The layout they picked, saved as a design in the model with the board it came from.
export async function chooseLayout(scanId: string, option: string, mood: Mood): Promise<{ design: Pick<Design, "id" | "name"> } | { error: string }> {
  if (isSample(scanId)) {
    try {
      sessionStorage.setItem(SAMPLE_PICK, JSON.stringify({ option, mood }));
    } catch {
      // Private mode: the pick lasts as long as the page.
    }
    return { design: { id: option, name: option } };
  }
  const res = await fetch(`/api/scans/${scanId}/design`, { method: "POST", headers: await headers(true), body: JSON.stringify({ option, mood }) });
  const body = await res.json().catch(() => ({}));
  return res.ok ? body : { error: body.error ?? "That didn't save. Try again." };
}

export const frameSrc = (scanId: string, frame: number) =>
  isSample(scanId) ? `/samples/sample/frames/${String(frame).padStart(4, "0")}.jpg` : `/api/scans/${scanId}/frames/${frame}`;
