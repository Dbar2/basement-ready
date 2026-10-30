// The book and the quote over HTTP, mounted with one line in server/index.ts:
//   GET  /api/scans/:id/book.pdf      the book (the sample's works offline, with nothing saved)
//   GET  /api/scans/:id/book          what's in it, for the book page
//   GET  /api/scans/:id/quote         the chosen design's quote (?design= for another)
//   POST /api/sample/book(.pdf)       the sample's, with the design it picked in this browser ({ state })
// Anything with the address needs the owner (Clerk) or this browser's claim token.
import { readFileSync } from "node:fs";
import type { Context, Hono } from "hono";
import { localDate } from "../permit/package";
import { chosenDesign, modelFor } from "../quote/fromScan";
import { quote } from "../quote/quote";
import { picturesOfDesign } from "../views/routes";
import { basementFor, loadWorkspace, parseClaims, StateSchema, type StoredState } from "../workspace";
import { buildBook, readinessFrom, timeline } from "./book";
import { loadPictures, picturesFor, type Picture } from "./pictures";

const UUID = /^[0-9a-f-]{36}$/;
const SAMPLE = "public/samples/sample";

const slugOf = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "basement";

export function mountBook(app: Hono, currentUser: (c: Context) => Promise<string | null>) {
  // The scan, its workspace and where it is; the sample needs no one's permission and saves nothing.
  async function project(c: Context, sampleState: StoredState = {}) {
    const id = c.req.param("id") ?? "sample";
    if (id === "sample") {
      const result = JSON.parse(readFileSync(`${SAMPLE}/result.json`, "utf8"));
      return { ok: true as const, id, result, state: sampleState, municipality: "waterloo-on", address: "The sample basement" };
    }
    if (!UUID.test(id)) return { ok: false as const, status: 404 as const, error: "Not found" };
    const a = await basementFor(id, { userId: await currentUser(c), claims: parseClaims(c.req.header("x-claims")) });
    if (!a.basement || !a.result) return { ok: false as const, status: 404 as const, error: "Not found" };
    if (!a.allowed) return { ok: false as const, status: 403 as const, error: "Open this on the device you scanned with, or sign in." };
    const w = await loadWorkspace(a.basement.id);
    const property = a.basement.property as { address?: string } | null;
    return { ok: true as const, id, basementId: a.basement.id, result: a.result, state: w.state, municipality: a.basement.municipality, address: property?.address || a.basement.address || "Your basement" };
  }

  // The pictures of the chosen design itself (server/views) lead the book's pictures.
  async function designPictures(id: string, model: ReturnType<typeof modelFor>): Promise<Picture[]> {
    const design = chosenDesign(model);
    if (!design) return [];
    const made = await picturesOfDesign(id, design).catch(() => []);
    return made.map((p, i) => ({ title: `${design.name}, view ${i + 1}`, kind: "design" as const, url: p.url, caption: p.kind === "photo" ? "Virtually staged" : "Virtually staged · 3D render", load: p.load }));
  }

  async function pdf(c: Context, sampleState?: StoredState) {
    const p = await project(c, sampleState);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    const model = modelFor(p.result, p.state);
    if (!model) return c.json({ error: "There's no measured plan to put in a book yet." }, 409);
    const { pictures, mood } = await picturesFor(p.id, p.result, p.state, model, await designPictures(p.id, model));
    const out = await buildBook({ address: p.address, municipality: p.municipality, result: p.result, model, pictures: await loadPictures(pictures.slice(0, 12)), mood: await loadPictures(mood), state: p.state, today: localDate() });
    return new Response(new Uint8Array(out.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="basement-book-${slugOf(p.address)}.pdf"`, "Cache-Control": "no-store" } });
  }

  async function book(c: Context, sampleState?: StoredState) {
    const p = await project(c, sampleState);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    const model = modelFor(p.result, p.state);
    const design = chosenDesign(model);
    const q = model && design ? quote(model, design, { municipality: p.municipality }) : null;
    const { pictures, mood } = await picturesFor(p.id, p.result, p.state, model, await designPictures(p.id, model));
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
      pictures: pictures.map(({ title, kind, url, caption }) => ({ title, kind, url, caption })),
      mood: mood.map(({ title, url }) => ({ title, url })),
      pdf: `/api/scans/${p.id}/book.pdf`,
    });
  }

  // The sample keeps its workspace in the browser: it sends it, and nothing is saved.
  const sampleState = async (c: Context): Promise<StoredState> => {
    const body = await c.req.json().catch(() => null);
    const s = StateSchema.safeParse(body?.state ?? {});
    return s.success ? s.data : {};
  };

  app.get("/api/scans/:id/book.pdf", (c) => pdf(c));
  app.get("/api/scans/:id/book", (c) => book(c));
  app.post("/api/sample/book.pdf", async (c) => pdf(c, await sampleState(c)));
  app.post("/api/sample/book", async (c) => book(c, await sampleState(c)));

  app.get("/api/scans/:id/quote", async (c) => {
    const p = await project(c);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    const model = modelFor(p.result, p.state);
    const want = c.req.query("design");
    const design = (want && model?.designs.find((d) => d.id === want)) || chosenDesign(model);
    if (!model || !design) return c.json({ error: "No design yet" }, 409);
    return c.json({ design: design.id, quote: quote(model, design, { municipality: p.municipality }) });
  });
}
