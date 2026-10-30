// The book, the quote and the design's pictures, from the browser. The quote itself runs here too:
// `quote(model, design)` (server/quote/quote.ts) is pure and carries its own dated catalog, so the
// 3D studio prices every edit without a round trip.
import type { Design, Model } from "../../server/model/types";
import { quote, type Quote } from "../../server/quote/quote";

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
  pictures: { title: string; kind: "render" | "favourite" | "look" | "concept"; url: string }[];
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

export async function getBook(scanId: string): Promise<BookData> {
  const res = await fetch(`/api/scans/${scanId}/book`, { headers: await headers() });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "We couldn't open the book.");
  return res.json();
}

export async function downloadBook(scanId: string, name = "basement-book.pdf") {
  const res = await fetch(`/api/scans/${scanId}/book.pdf`, { headers: await headers() });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "The book didn't download. Try again.");
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type Render = { n: number; title: string; spot: number | null; designId: string | null; status: "pending" | "done" | "failed"; kept: boolean | null; checked: string; at: string };

// A picture of the design for the book. The 3D studio renders the design from one of the spots the
// camera stood (`spot`: the frame number), `canvas.toBlob(...)` hands this the PNG or JPEG, and the
// server restyles it into a photo, checked by SAM so no window, door or stair moves. It answers at
// once with the render pending; `getRenders` says when it's done.
export async function postRender(scanId: string, image: Blob, o: { spot?: number | null; title?: string } = {}): Promise<Render> {
  const form = new FormData();
  form.append("image", image, image.type === "image/png" ? "render.png" : "render.jpg");
  if (o.spot != null) form.append("spot", String(o.spot));
  if (o.title) form.append("title", o.title);
  const res = await fetch(`/api/scans/${scanId}/renders`, { method: "POST", headers: await headers(), body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That picture didn't send.");
  return body.render;
}

export async function getRenders(scanId: string): Promise<Render[]> {
  const res = await fetch(`/api/scans/${scanId}/renders`, { headers: await headers() });
  return res.ok ? (await res.json()).renders : [];
}

export const chosen = (m: Model | null): Design | null => m?.designs.find((d) => d.chosen) ?? m?.designs[0] ?? null;
