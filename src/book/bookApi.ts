// The book and the quote, from the browser. The quote itself runs here too:
// `quote(model, design)` (server/quote/quote.ts) is pure and carries its own dated catalog, so the
// 3D studio prices every edit without a round trip.
import type { Design, Model } from "../../server/model/types";
import { quote, type Quote } from "../../server/quote/quote";
import { getWorkspace } from "../workspaceApi";

export { quote, type Quote };

export type BookData = {
  address: string;
  municipality: string;
  verdict: "yes" | "fix" | "no" | null;
  headline: string | null;
  model: Model | null;
  quote: Quote | null;
  readiness: { label: string; ok: boolean | null; detail?: string }[];
  money: { id: string; name: string; amount: string; qualify: string; paidWhen: string | null; source: { title: string; url: string } | null }[];
  timeline: { when: string; title: string; detail: string }[];
  steps: { id: string; when: string; title: string; detail?: string | null; tasks: { title: string; detail?: string | null }[] }[];
  pictures: { title: string; kind: "design" | "favourite" | "look" | "concept"; url: string; caption: string }[];
  mood: { title: string; url: string }[];
  pdf: string;
};

// This browser's claim tokens and, when signed in, the Clerk session: what the server checks.
async function headers(): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  try {
    const claims = localStorage.getItem("br-claims");
    if (claims) h["x-claims"] = encodeURIComponent(claims);
  } catch {
    // Private mode: only a signed-in owner can open it.
  }
  const clerk = (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string | null> } | null } }).Clerk;
  const token = await clerk?.session?.getToken().catch(() => null);
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// The sample's workspace lives in this browser: its book is asked for with it, so it shows the design
// picked here.
async function fetchBook(scanId: string, pdf: boolean) {
  if (scanId === "sample") {
    const { state, profile } = await getWorkspace("sample");
    return fetch(`/api/sample/book${pdf ? ".pdf" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, profile }) });
  }
  return fetch(`/api/scans/${scanId}/book${pdf ? ".pdf" : ""}`, { headers: await headers() });
}

export async function getBook(scanId: string): Promise<BookData> {
  const res = await fetchBook(scanId, false);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "We couldn't open the book.");
  return res.json();
}

export async function downloadBook(scanId: string, name = "basement-book.pdf") {
  const res = await fetchBook(scanId, true);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "The book didn't download. Try again.");
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const chosen = (m: Model | null): Design | null => m?.designs.find((d) => d.chosen) ?? m?.designs[0] ?? null;
