// The book and the quote over HTTP, mounted with one line in server/index.ts:
//   GET  /api/scans/:id/book.pdf      the book (the sample's works offline, with nothing saved)
//   GET  /api/scans/:id/book          what's in it, for the book page
//   GET  /api/scans/:id/quote         the chosen design's quote (?design= for another)
//   POST /api/scans/:id/renders       a picture of the design from the 3D studio, to restyle
//   GET  /api/scans/:id/renders/:n    one of those pictures
// Anything with the address needs the owner (Clerk) or this browser's claim token.
import { existsSync, readFileSync } from "node:fs";
import type { Context, Hono } from "hono";
import { lookKey } from "../ideas/looks";
import { localDate } from "../permit/package";
import { chosenDesign, modelFor } from "../quote/fromScan";
import { quote } from "../quote/quote";
import { keys, storage } from "../storage";
import { basementFor, loadWorkspace, parseClaims, type StoredState } from "../workspace";
import type { Model } from "../model/types";
import { buildBook, readinessFrom, timeline, type BookPicture } from "./book";
import { MAX_RENDERS, renderIndex, renderKey, reserveRender, restyleRender } from "./renders";

const UUID = /^[0-9a-f-]{36}$/;
const SAMPLE = "public/samples/sample";

async function read(key: string) {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

const slugOf = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "basement";

// The idea cards they swiped right on (server/ideas/cards.ts keeps them at scans/<id>/cards/<n>.jpg).
const cardKey = (scanId: string, n: number) => `scans/${scanId}/cards/${n}.jpg`;
const cardNumber = (id: string) => Number.parseInt(/(\d+)$/.exec(id)?.[1] ?? "", 10);

type Pic = { title: string; kind: BookPicture["kind"]; url: string; load: () => Promise<Buffer | null> };

// Every picture there is for this basement, best first: their design rendered, what they saved,
// the looks, then the scan's own "what it could look like" photos. Loaded only when the PDF needs them.
async function pictures(scanId: string, result: any, state: StoredState, model: Model | null): Promise<{ pics: Pic[]; mood: Pic[] }> {
  const pics: Pic[] = [];
  const seen = new Set<string>();
  const push = (p: Pic) => {
    if (seen.has(p.url)) return;
    seen.add(p.url);
    pics.push(p);
  };
  const sample = scanId === "sample";
  const conceptPic = (n: number, title: string, kind: BookPicture["kind"]): Pic =>
    sample
      ? { title, kind, url: `/samples/sample/concepts/${n}.jpg`, load: async () => (existsSync(`${SAMPLE}/concepts/${n}.jpg`) ? readFileSync(`${SAMPLE}/concepts/${n}.jpg`) : null) }
      : { title, kind, url: `/api/scans/${scanId}/concepts/${n}`, load: () => read(keys.concept(scanId, n)) };
  const lookPic = (style: string, n: number, title: string, kind: BookPicture["kind"]): Pic => ({ title, kind, url: `/api/scans/${scanId}/looks/${style}/${n}`, load: () => read(lookKey(scanId, style, n)) });

  if (!sample) for (const r of (await renderIndex(scanId)).filter((r) => r.status === "done")) push({ title: r.title, kind: "render", url: `/api/scans/${scanId}/renders/${r.n}`, load: () => read(renderKey(scanId, r.n)) });
  for (const f of state.ideas?.favourites ?? []) push(f.source === "look" && f.style ? lookPic(f.style, f.n, f.title, "favourite") : conceptPic(f.n, f.title, "favourite"));
  for (const look of Object.values(state.looks ?? {})) if (look.status === "done") for (const it of look.items) push(lookPic(look.style, it.n, it.title, "look"));
  for (const c of result?.concepts?.items ?? []) push(conceptPic(c.n, c.title, "concept"));

  const mood: Pic[] = sample
    ? []
    : (model?.mood.liked ?? [])
        .map(cardNumber)
        .filter((n) => Number.isInteger(n))
        .slice(0, 12)
        .map((n) => ({ title: `Card ${n}`, kind: "favourite" as const, url: `/api/scans/${scanId}/cards/${n}.jpg`, load: () => read(cardKey(scanId, n)) }));
  return { pics, mood };
}

async function loaded(ps: Pic[]) {
  const out: { title: string; jpeg: Buffer; kind: BookPicture["kind"] }[] = [];
  for (const p of ps) {
    const jpeg = await p.load().catch(() => null);
    if (jpeg) out.push({ title: p.title, jpeg, kind: p.kind });
  }
  return out;
}

export function mountBook(app: Hono, currentUser: (c: Context) => Promise<string | null>) {
  // The scan, its workspace and where it is; the sample needs no one's permission and saves nothing.
  async function project(c: Context) {
    const id = c.req.param("id") ?? "";
    if (id === "sample") {
      const result = JSON.parse(readFileSync(`${SAMPLE}/result.json`, "utf8"));
      return { ok: true as const, id, result, state: {} as StoredState, municipality: "waterloo-on", address: "The sample basement" };
    }
    if (!UUID.test(id)) return { ok: false as const, status: 404 as const, error: "Not found" };
    const a = await basementFor(id, { userId: await currentUser(c), claims: parseClaims(c.req.header("x-claims")) });
    if (!a.basement || !a.result) return { ok: false as const, status: 404 as const, error: "Not found" };
    if (!a.allowed) return { ok: false as const, status: 403 as const, error: "Open this on the device you scanned with, or sign in." };
    const w = await loadWorkspace(a.basement.id);
    const property = a.basement.property as { address?: string } | null;
    return { ok: true as const, id, basementId: a.basement.id, result: a.result, state: w.state, municipality: a.basement.municipality, address: property?.address || a.basement.address || "Your basement" };
  }

  app.get("/api/scans/:id/book.pdf", async (c) => {
    const p = await project(c);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    const model = modelFor(p.result, p.state);
    if (!model) return c.json({ error: "There's no measured plan to put in a book yet." }, 409);
    const { pics, mood } = await pictures(p.id, p.result, p.state, model);
    const out = await buildBook({ address: p.address, municipality: p.municipality, result: p.result, model, pictures: await loaded(pics.slice(0, 12)), mood: (await loaded(mood)).map((m) => ({ title: m.title, jpeg: m.jpeg })), state: p.state, today: localDate() });
    return new Response(new Uint8Array(out.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="basement-book-${slugOf(p.address)}.pdf"`, "Cache-Control": "no-store" } });
  });

  app.get("/api/scans/:id/book", async (c) => {
    const p = await project(c);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    const model = modelFor(p.result, p.state);
    const design = chosenDesign(model);
    const q = model && design ? quote(model, design, { municipality: p.municipality }) : null;
    const { pics, mood } = await pictures(p.id, p.result, p.state, model);
    return c.json({
      address: p.address,
      municipality: p.municipality,
      verdict: p.result?.verdict ?? null,
      headline: p.result?.headline ?? null,
      model,
      quote: q,
      readiness: readinessFrom(p.result, design),
      money: (p.result?.grants ?? []).filter((g: any) => g.qualify !== "no").map((g: any) => ({ id: g.id, name: g.shortName ?? g.name, amount: g.amount, qualify: g.qualify, paidWhen: g.apply?.paidWhen ?? null, source: g.source ?? null })),
      timeline: timeline(p.result, p.municipality, q),
      steps: p.result?.steps ?? [],
      pictures: pics.map(({ title, kind, url }) => ({ title, kind, url })),
      mood: mood.map(({ title, url }) => ({ title, url })),
      pdf: `/api/scans/${p.id}/book.pdf`,
    });
  });

  app.get("/api/scans/:id/quote", async (c) => {
    const p = await project(c);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    const model = modelFor(p.result, p.state);
    const want = c.req.query("design");
    const design = (want && model?.designs.find((d) => d.id === want)) || chosenDesign(model);
    if (!model || !design) return c.json({ error: "No design yet" }, 409);
    return c.json({ design: design.id, quote: quote(model, design, { municipality: p.municipality }) });
  });

  // ---- Pictures of the final design ----
  // The 3D studio renders the design from one of the spots the camera stood (so the room matches a
  // real frame), sends the canvas (`toBlob`), and the server restyles it with Muse Image into a photo,
  // then checks with SAM that every window, door and stair is still where the render put it.

  app.post("/api/scans/:id/renders", async (c) => {
    const p = await project(c);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    if (p.id === "sample") return c.json({ error: "Render your own basement to keep its pictures." }, 403);
    const body = await c.req.parseBody();
    const image = body.image;
    if (!(image instanceof File) || !/^image\/(png|jpeg)$/.test(image.type) || image.size > 8 * 1024 * 1024) return c.json({ error: "Send the render as a PNG or JPEG under 8 MB." }, 400);
    const model = modelFor(p.result, p.state);
    const design = chosenDesign(model);
    const spot = body.spot != null && Number.isFinite(Number(body.spot)) ? Number(body.spot) : null;
    const entry = await reserveRender(p.id, { title: String(body.title ?? "").slice(0, 80) || "Your design", spot, designId: design?.id ?? null, at: new Date().toISOString() });
    if (!entry) return c.json({ error: "That's every picture for this basement." }, 429);
    const raw = Buffer.from(await image.arrayBuffer());
    void restyleRender(p.id, entry, raw, image.type, design?.finishes ?? null);
    return c.json({ render: entry }, 202);
  });

  app.get("/api/scans/:id/renders", async (c) => {
    const p = await project(c);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    return c.json({ renders: p.id === "sample" ? [] : await renderIndex(p.id) });
  });

  app.get("/api/scans/:id/renders/:n", async (c) => {
    const id = c.req.param("id");
    const n = Number.parseInt(c.req.param("n"), 10);
    if (!UUID.test(id) || !Number.isInteger(n) || n < 1 || n > MAX_RENDERS) return c.json({ error: "Not found" }, 404);
    const body = await read(renderKey(id, n));
    if (!body) return c.json({ error: "Not found" }, 404);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  });
}
