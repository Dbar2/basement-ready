// The book and the quote over HTTP, mounted with one line in server/index.ts:
//   GET  /api/scans/:id/book.pdf      the book (the sample's works offline, with nothing saved)
//   GET  /api/scans/:id/book          what's in it, for the book page
//   GET  /api/scans/:id/quote         the chosen design's quote (?design= for another)
//   POST /api/sample/book(.pdf)       the sample's, with the design it picked in this browser ({ state })
// Anything with the address needs the owner (Clerk) or this browser's claim token.
import { readFileSync } from "node:fs";
import type { Context, Hono } from "hono";
import { localDate, permitStatus } from "../permit/package";
import { chosenDesign, modelFor } from "../quote/fromScan";
import { quote } from "../quote/quote";
import { answerFor, savedAnswers } from "../answers";
import { pricedForBasement, pricedSample } from "../priced";
import type { Answers } from "../recheck";
import { packFor } from "../rules";
import { picturesOfDesign } from "../views/routes";
import { basementFor, loadWorkspace, parseClaims, ProfileSchema, StateSchema, type Profile, type StoredState } from "../workspace";
import { buildBook, timeline } from "./book";
import { STYLES, type StyleId } from "../ideas/styles";
import { fromVideo, loadPictures, named, picturesFor, type Picture } from "./pictures";

// The studio's finishes by name (src/studio/Studio.tsx).
const FINISH_NAME: Record<string, string> = { light: "Light oak", warm: "Warm wood", deep: "Deep green" };

const UUID = /^[0-9a-f-]{36}$/;
const SAMPLE = "public/samples/sample";

const slugOf = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "basement";

export function mountBook(app: Hono, currentUser: (c: Context) => Promise<string | null>) {
  // The scan, its workspace and where it is; the sample needs no one's permission and saves nothing.
  // The answer in every book is priced on the design they picked (server/priced.ts), like every screen.
  async function project(c: Context, sample: { state: StoredState; profile: Profile | null; answers?: Answers } = { state: {}, profile: null }) {
    const id = c.req.param("id") ?? "sample";
    if (id === "sample") {
      const result = pricedSample(JSON.parse(readFileSync(`${SAMPLE}/result.json`, "utf8")), sample.state, sample.answers);
      return { ok: true as const, id, result, state: sample.state, profile: sample.profile, municipality: "waterloo-on", address: "The sample basement" };
    }
    if (!UUID.test(id)) return { ok: false as const, status: 404 as const, error: "Not found" };
    const a = await basementFor(id, { userId: await currentUser(c), claims: parseClaims(c.req.header("x-claims")) });
    if (!a.basement || !a.result) return { ok: false as const, status: 404 as const, error: "Not found" };
    if (!a.allowed) return { ok: false as const, status: 403 as const, error: "Open this on the device you scanned with, or sign in." };
    const w = await loadWorkspace(a.basement.id);
    const property = a.basement.property as { address?: string } | null;
    const result = a.result.findings ? await pricedForBasement(id, a.basement.id, { ...a.result, household: a.basement.household ?? a.result.household }, await savedAnswers(a.basement.id)) : a.result;
    return { ok: true as const, id, basementId: a.basement.id, result, state: w.state, profile: w.profile, municipality: a.basement.municipality, address: property?.address || a.basement.address || "Your basement" };
  }

  // The city its quote is worked for: the answer's, as server/priced.ts prices it.
  const cityOf = (p: { result: any; municipality: string }) => p.result?.municipality ?? p.municipality;

  // The pictures of the chosen design itself (server/views) lead the book's pictures.
  async function designPictures(id: string, model: ReturnType<typeof modelFor>): Promise<Picture[]> {
    const design = chosenDesign(model);
    if (!design) return [];
    const made = await picturesOfDesign(id, design).catch(() => []);
    // Its name, its finish and where in the video each view was taken from (angle "<room>-<frame>").
    const finish = FINISH_NAME[design.finishes.style] ?? (STYLES[design.finishes.style as StyleId]?.label ?? null);
    return made.map((p) => ({ title: named(design.name, finish, fromVideo(Number(p.angleId.split("-")[1]))), kind: "design" as const, url: p.url, caption: p.kind === "photo" ? "Virtually staged" : "Virtually staged · 3D render", load: p.load }));
  }

  // The permit's own readiness list (server/permit/readiness.ts), so the book counts what the Permit tab counts.
  const readinessOf = (p: { result: any; municipality: string; state: StoredState; profile: Profile | null }) =>
    permitStatus(p).readiness.items.map((i) => ({ label: i.label, ok: i.done, detail: i.detail }));

  async function pdf(c: Context, sample?: { state: StoredState; profile: Profile | null; answers?: Answers }) {
    const p = await project(c, sample);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    const model = modelFor(p.result, p.state);
    if (!model) return c.json({ error: "There's no measured plan to put in a book yet." }, 409);
    const { pictures, mood } = await picturesFor(p.id, p.result, p.state, model, await designPictures(p.id, model));
    const out = await buildBook({ address: p.address, municipality: cityOf(p), result: p.result, model, pictures: await loadPictures(pictures.slice(0, 12)), mood: await loadPictures(mood), state: p.state, readiness: readinessOf(p), today: localDate() });
    return new Response(new Uint8Array(out.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="basement-book-${slugOf(p.address)}.pdf"`, "Cache-Control": "no-store" } });
  }

  async function book(c: Context, sample?: { state: StoredState; profile: Profile | null; answers?: Answers }) {
    const p = await project(c, sample);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    const model = modelFor(p.result, p.state);
    const design = chosenDesign(model);
    const q = model && design ? quote(model, design, { municipality: cityOf(p) }) : null;
    const { pictures, mood } = await picturesFor(p.id, p.result, p.state, model, await designPictures(p.id, model));
    return c.json({
      address: p.address,
      municipality: cityOf(p),
      verdict: p.result?.verdict ?? null,
      headline: p.result?.headline ?? null,
      model,
      quote: q,
      readiness: readinessOf(p),
      money: (p.result?.grants ?? []).filter((g: any) => g.qualify !== "no").map((g: any) => ({ id: g.id, name: g.shortName ?? g.name, amount: g.amount, qualify: g.qualify, paidWhen: g.apply?.paidWhen ?? null, source: g.source ?? null })),
      timeline: timeline(p.result, cityOf(p), q),
      steps: p.result?.steps ?? [],
      pictures: pictures.map(({ title, kind, url, caption }) => ({ title, kind, url, caption })),
      mood: mood.map(({ title, url }) => ({ title, url })),
      pdf: `/api/scans/${p.id}/book.pdf`,
    });
  }

  // The sample keeps its workspace in the browser: it sends it, and nothing is saved.
  const sampleWorkspace = async (c: Context): Promise<{ state: StoredState; profile: Profile | null; answers: Answers }> => {
    const body = await c.req.json().catch(() => null);
    const s = StateSchema.safeParse(body?.state ?? {});
    const profile = ProfileSchema.safeParse(body?.profile);
    // What the example's visitor answered, as the answer tab applied it.
    const { pack } = packFor("waterloo-on");
    const answers: Answers = Object.fromEntries(Object.entries((body?.answers ?? {}) as Record<string, unknown>).map(([k, v]) => [k, answerFor(k, v, pack)]));
    return { state: s.success ? s.data : {}, profile: profile.success ? (profile.data as Profile) : null, answers };
  };

  app.get("/api/scans/:id/book.pdf", (c) => pdf(c));
  app.get("/api/scans/:id/book", (c) => book(c));
  app.post("/api/sample/book.pdf", async (c) => pdf(c, await sampleWorkspace(c)));
  app.post("/api/sample/book", async (c) => book(c, await sampleWorkspace(c)));

  app.get("/api/scans/:id/quote", async (c) => {
    const p = await project(c);
    if (!p.ok) return c.json({ error: p.error }, p.status);
    const model = modelFor(p.result, p.state);
    const want = c.req.query("design");
    const design = (want && model?.designs.find((d) => d.id === want)) || chosenDesign(model);
    if (!model || !design) return c.json({ error: "No design yet" }, 409);
    return c.json({ design: design.id, quote: quote(model, design, { municipality: cityOf(p) }) });
  });
}
