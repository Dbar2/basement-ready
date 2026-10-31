// The workspace's API, mounted from server/index.ts: the owner profile and workspace state, the
// permit package and the filled forms, the materials list, the one-click applications, and the
// "Try this look" photos. The sample basement gets stateless versions: nothing it sends is saved.
// Anything with the owner's names, phone or email needs the owner (Clerk) or this browser's claim token.
// The sample and the demo house can't send anything: their applications come back flagged `example`.
import { existsSync, readFileSync } from "node:fs";
import type { Context, Hono } from "hono";
import { applications, type ApplyInput } from "./apply/applications";
import { fillRegionForm, REGION_FORM_URL, type RegionValues } from "./apply/regionForm";
import { diyPlan } from "./diy/plan";
import { lookKey, renderLook, sourcesFrom, STYLES } from "./ideas/looks";
import { cityPermit } from "./permit/data";
import { briefEmail, QUARTS } from "./permit/designer";
import { FIELD_MAPS, fetchOfficialPdf, fillAcroForm } from "./permit/forms";
import { bounds, permitModel } from "./permit/model";
import { buildPermitPackage, type Copy, formInputs, formValues, localDate, NotReady, permitStatus, projectFacts } from "./permit/package";
import { lookupSiteGeometry, type Property, type SiteGeometry } from "./property";
import { savedAnswers } from "./answers";
import { homesAfter } from "./eligibility";
import { areaText } from "./model/suite";
import { overSpend } from "./limits";
import { pricedForBasement, pricedSample } from "./priced";
import { keys, storage } from "./storage";
import { basementFor, cleanPatch, loadWorkspace, profileFromOtherBasements, saveWorkspace, StateSchema, ProfileSchema, type Profile, type StoredState } from "./workspace";
import { adminRead, requestClaims, shareKey } from "./privacy";

const UUID = /^[0-9a-f-]{36}$/;
const SAMPLE = "public/samples/sample";
// The sample's looks are committed with it, so it runs with no keys (scripts/sample-looks.ts makes them).
export const sampleLookFile = (style: string, n: number) => `${SAMPLE}/looks/${style}/${n}.jpg`;
// Each committed look as it was made, with what SAM's check found.
function committedLook(style: string): any | null {
  const file = `${SAMPLE}/looks/looks.json`;
  if (!existsSync(file)) return null;
  const look = JSON.parse(readFileSync(file, "utf8"))[style];
  return look?.items?.every((it: { n: number }) => existsSync(sampleLookFile(style, it.n))) ? look : null;
}
const OVER_SPEND = "Today's limit for new photos is used up. They come back at midnight, Eastern time.";
// A look still pending after this was cut off by a restart: it's offered again.
const LOOK_STALE_MS = 3 * 60 * 1000;

const siteCache = new Map<string, SiteGeometry | null>();
async function siteFor(property: Property | null): Promise<SiteGeometry | null> {
  if (!property) return null;
  const k = `${property.address}|${property.municipality}`;
  if (!siteCache.has(k)) {
    const g = await lookupSiteGeometry({ address: property.address, municipality: property.municipality, city: property.city, lon: property.lon, lat: property.lat, units: property.unitsRegistered, source: property.inRegion === false ? "ontario" : "region" }).catch(() => null);
    if (siteCache.size > 500) siteCache.clear();
    siteCache.set(k, g);
  }
  return siteCache.get(k) ?? null;
}

async function read(key: string) {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

const pdf = (bytes: Uint8Array, name: string) =>
  new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });

const slugOf = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "basement";

// The project's numbers every document shares: area, bedrooms and the scope of work, as the permit set
// and its forms have them (server/permit/package.ts projectFacts).
function project(result: any, state: StoredState) {
  const { areaM2, bedrooms, scope } = projectFacts(result, permitModel(result, state));
  return { areaM2, bedrooms: (bedrooms === 0 ? 0 : 1) as 0 | 1, scope };
}

async function favouriteImages(scanId: string, state: StoredState) {
  const out: { title: string; jpeg: Buffer }[] = [];
  for (const f of state.ideas?.favourites ?? []) {
    let jpeg: Buffer | null = null;
    if (f.source === "look" && f.style && scanId === "sample") jpeg = existsSync(sampleLookFile(f.style, f.n)) ? readFileSync(sampleLookFile(f.style, f.n)) : await read(lookKey(scanId, f.style, f.n));
    else if (f.source === "look" && f.style) jpeg = await read(lookKey(scanId, f.style, f.n));
    else if (scanId === "sample") jpeg = existsSync(`${SAMPLE}/concepts/${f.n}.jpg`) ? readFileSync(`${SAMPLE}/concepts/${f.n}.jpg`) : null;
    else jpeg = await read(keys.concept(scanId, f.n));
    if (jpeg) out.push({ title: f.title, jpeg });
  }
  return out;
}

function regionValues(profile: Profile | null, result: any, address: string, city: string, areaM2: number | null, bedrooms: 0 | 1): RegionValues {
  const told = Object.fromEntries((result?.moneyAnswered ?? []).map((q: { id: string; answer: unknown }) => [q.id, q.answer]));
  const owners = profile?.owners ?? [];
  return {
    owners,
    contactName: owners[0] ? `${owners[0].first} ${owners[0].last}`.trim() : "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    street: address,
    cityProvince: `${city}, Ontario`,
    postalCode: profile?.postalCode ?? "",
    bedrooms,
    areaText: areaM2 ? areaText(areaM2) : null,
    livesThere: typeof told.lives_there === "boolean" ? told.lives_there : null,
    mailing: profile?.mailingAddress || null,
    otherProperty: typeof told.other_home === "boolean" ? told.other_home : null,
    rent: typeof told.rent === "number" ? told.rent : null,
  };
}

// The example's answer, priced on the design its browser picked (server/priced.ts).
function sampleResult(state: StoredState = {}) {
  return pricedSample(JSON.parse(readFileSync(`${SAMPLE}/result.json`, "utf8")), state);
}

// What the sample's client sends: a workspace (validated) and, for money, its own re-checked grants.
function sampleBody(body: any): { profile: Profile | null; state: StoredState; grants?: any[]; moneyAnswered?: any[] } {
  const p = ProfileSchema.safeParse(body?.profile);
  const s = StateSchema.safeParse(body?.state ?? {});
  return {
    profile: p.success ? p.data : null,
    state: s.success ? s.data : {},
    grants: Array.isArray(body?.grants) ? body.grants.slice(0, 12) : undefined,
    moneyAnswered: Array.isArray(body?.moneyAnswered) ? body.moneyAnswered.slice(0, 12) : undefined,
  };
}

const lookRuns = new Set<string>();

// Looks left pending by a restart (the render ran in a process that's gone) read as failed, so the
// Ideas tab offers them again instead of waiting for ever.
function settledLooks(scanId: string, looks: StoredState["looks"]) {
  const out: NonNullable<StoredState["looks"]> = {};
  for (const [style, look] of Object.entries(looks ?? {})) {
    const stale = look.status === "pending" && !lookRuns.has(`${scanId}:${style}`) && Date.now() - Date.parse(look.at || "0") > LOOK_STALE_MS;
    out[style] = stale ? { ...look, status: "failed" } : look;
  }
  return out;
}

const asExample = <T extends object>(apps: T[]) => apps.map((a) => ({ ...a, example: true }));

// The copy a request asks for: ?copy=submit|share|review, or the older ?share=1.
const copyOf = (c: Context): Copy => {
  const q = c.req.query("copy");
  return q === "submit" || q === "share" || q === "review" ? q : c.req.query("share") === "1" ? "share" : "review";
};

// Where the permit set stands, for the Permit tab: the readiness list, what each item needs, the
// house's outline for placing the bedrooms upstairs, and the designer route.
function permitPayload(input: { result: any; municipality: string; state: StoredState; profile: Profile | null }, o: { address: string; packageUrl: string | null }) {
  const st = permitStatus(input);
  const m = st.model;
  const foot = m ? bounds(m.existing.rooms.flatMap((r) => r.polygon)) : null;
  const stair = m?.design.proposed.fixtures.find((f) => f.kind === "stairs") ?? null;
  const fw = foot ? foot.maxX - foot.minX : 1, fd = foot ? foot.maxZ - foot.minZ : 1;
  const { areaM2, bedrooms } = formInputs(input);
  const units = homesAfter(input.result?.property);
  return {
    left: st.readiness.left,
    items: st.readiness.items,
    reviewKey: st.reviewKey,
    canSubmit: st.readiness.left === 0,
    sheets: st.sheets,
    mainWalls: m?.mainWalls ?? [],
    windows: m?.windows ?? [],
    overhead: Boolean(m?.design.proposed.fixtures.some((f) => f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead")),
    footprint: foot
      ? {
          widthM: fw,
          depthM: fd,
          stair: stair?.sizeM ? { u0: (stair.at[0] - stair.sizeM[0] / 2 - foot.minX) / fw, v0: (stair.at[1] - stair.sizeM[1] / 2 - foot.minZ) / fd, u1: (stair.at[0] + stair.sizeM[0] / 2 - foot.minX) / fw, v1: (stair.at[1] + stair.sizeM[1] / 2 - foot.minZ) / fd } : null,
          storeys: Math.max(1, input.result?.property?.building?.storeys ?? 1),
        }
      : null,
    designer: {
      needed: st.need.needed,
      reasons: st.need.reasons,
      signer: st.place.ownerDraws ? ("owner" as const) : ("designer" as const),
      ownerAllowed: st.permit?.signer === "owner" && !st.need.needed,
      quarts: QUARTS,
      filters: st.quarts,
      email: o.packageUrl ? briefEmail({ address: o.address, city: st.city, packageUrl: o.packageUrl, reasons: st.need.reasons, units, areaM2, bedrooms }) : null,
    },
  };
}

export function mountWorkspace(app: Hono, currentUser: (c: Context) => Promise<string | null>) {
  async function access(c: Context) {
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id)) return null;
    const userId = await currentUser(c);
    const a = await basementFor(id, { userId, claims: requestClaims(c), admin: adminRead(c) });
    if (!a.basement) return null;
    // Every document here is priced on the design they picked: one quote, one list of fixes.
    const result = a.result?.findings && a.allowed ? await pricedForBasement(id, a.basement.id, { ...a.result, household: a.basement.household ?? a.result.household }, await savedAnswers(a.basement.id)) : a.result;
    return { ...a, result, userId, id };
  }

  // ---- The workspace itself ----

  app.get("/api/scans/:id/workspace", async (c) => {
    const a = await access(c);
    if (!a) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    const w = await loadWorkspace(a.basement.id);
    const looks = settledLooks(a.id, w.state.looks);
    if (JSON.stringify(looks) !== JSON.stringify(w.state.looks ?? {})) {
      w.state = { ...w.state, looks };
      await saveWorkspace(a.basement.id, { state: { looks } });
    }
    const site = await siteFor(a.basement.property as Property | null);
    return c.json({
      ...w,
      // No open parcel data carries the legal description, PIN or roll number: the owner adds them.
      prefill: {
        legalDescription: null,
        pin: null,
        rollNumber: null,
        fromOtherBasement: w.profile ? null : await profileFromOtherBasements(a.userId, a.basement.id),
      },
      site,
    });
  });

  app.put("/api/scans/:id/workspace", async (c) => {
    const a = await access(c);
    if (!a) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    const patch = cleanPatch(await c.req.json().catch(() => null));
    if ("error" in patch) return c.json({ error: patch.error }, 400);
    const saved = await saveWorkspace(a.basement.id, patch);
    // A changed plan is painted again for the as-built 3D (server/asBuilt.ts); an unchanged one is a no-op.
    if (patch.state?.model) void import("./asBuilt").then((m) => m.paintAsBuiltLater(a.id));
    return c.json(saved);
  });

  // ---- Permit package and forms ----

  app.get("/api/scans/:id/permit.pdf", async (c) => {
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    // The share copy (drawings only) is for the people the owner sends it to; the others are theirs.
    const copy = copyOf(c);
    if (copy !== "share" && !a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    const w = await loadWorkspace(a.basement.id);
    const property = a.basement.property as Property | null;
    try {
      const out = await buildPermitPackage({
        result: a.result,
        municipality: a.basement.municipality,
        address: property?.address ?? a.basement.address,
        profile: w.profile,
        state: w.state,
        site: await siteFor(property),
        aerialJpeg: null,
        favourites: copy === "review" ? await favouriteImages(a.id, w.state) : [],
        copy,
      });
      return pdf(out.bytes, `permit-${copy === "submit" ? "submit" : copy === "share" ? "drawings" : "review"}-${slugOf(property?.address ?? a.basement.address)}.pdf`);
    } catch (err) {
      if (err instanceof NotReady) return c.json({ error: err.message, left: err.left }, 409);
      throw err;
    }
  });

  app.get("/api/scans/:id/permit/status", async (c) => {
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    const w = await loadWorkspace(a.basement.id);
    const property = a.basement.property as Property | null;
    const address = property?.address ?? a.basement.address;
    // The designer's link: the share copy, signed so it opens for them (server/privacy.ts shareKey).
    const packageUrl = a.result?.demo ? null : `${new URL(c.req.url).origin}/api/scans/${a.id}/permit.pdf?copy=share&key=${shareKey(a.id, a.basement.claimToken)}`;
    return c.json(permitPayload({ result: a.result, municipality: a.basement.municipality, state: w.state, profile: w.profile }, { address, packageUrl }));
  });

  // One of the city's forms on its own, filled and still editable for signing.
  app.get("/api/scans/:id/forms/:form", async (c) => {
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    const formId = c.req.param("form").replace(/\.pdf$/, "");
    const { permit } = cityPermit(a.basement.municipality);
    const form = permit?.forms.find((f) => f.id === formId);
    const map = FIELD_MAPS[formId];
    if (!form?.url || !map) return c.json({ error: "Not a fillable form" }, 404);
    const bytes = await fetchOfficialPdf(form.url);
    if (!bytes) return c.json({ error: "The City's form didn't download. Try again later." }, 502);
    const w = await loadWorkspace(a.basement.id);
    const property = a.basement.property as Property | null;
    const { status, areaM2, bedrooms, scope } = formInputs({ result: a.result, municipality: a.basement.municipality, state: w.state, profile: w.profile });
    const values = formValues({ profile: w.profile, address: property?.address ?? a.basement.address, result: a.result, site: await siteFor(property), state: w.state }, property?.municipality ?? cityPermit(a.basement.municipality).city, scope, areaM2, bedrooms, localDate(), status.place);
    const filled = await fillAcroForm(bytes, map, values);
    return pdf(filled.bytes, `${formId}.pdf`);
  });

  // ---- Do it yourself ----

  app.get("/api/scans/:id/diy", async (c) => {
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    const w = await loadWorkspace(a.basement.id);
    return c.json(diyPlan(a.result, w.state, a.basement.municipality));
  });

  // ---- One-click applications ----

  async function applyInput(a: NonNullable<Awaited<ReturnType<typeof access>>>, w: { profile: Profile | null; state: StoredState }): Promise<ApplyInput> {
    const property = a.basement.property as Property | null;
    const site = await siteFor(property);
    const { areaM2, bedrooms, scope } = project(a.result, w.state);
    return { scanId: a.id, result: a.result, profile: w.profile, state: w.state, address: property?.address ?? a.basement.address, municipality: property?.municipality ?? cityPermit(a.basement.municipality).city, site, areaM2, bedrooms, scope };
  }

  app.get("/api/scans/:id/apply", async (c) => {
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    const apps = applications(await applyInput(a, await loadWorkspace(a.basement.id)));
    // The demo house isn't a real house: nothing it makes may reach a real inbox.
    return c.json({ applications: a.result?.demo ? asExample(apps) : apps });
  });

  app.get("/api/scans/:id/apply/:program", async (c) => {
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    if (c.req.param("program").replace(/\.pdf$/, "") !== "region_ontario_renovates_secondary_suites") return c.json({ error: "Not found" }, 404);
    const bytes = await fetchOfficialPdf(REGION_FORM_URL);
    if (!bytes) return c.json({ error: "The Region's form didn't download. Try again later." }, 502);
    const input = await applyInput(a, await loadWorkspace(a.basement.id));
    const filled = await fillRegionForm(bytes, regionValues(input.profile, a.result, input.address, input.municipality, input.areaM2, input.bedrooms));
    return pdf(filled.bytes, "ontario-renovates-application.pdf");
  });

  // ---- Try this look ----

  app.post("/api/scans/:id/looks", async (c) => {
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    const style = String((await c.req.json().catch(() => ({}))).style ?? "");
    if (!STYLES[style]) return c.json({ error: "Pick a look." }, 400);
    const w = await loadWorkspace(a.basement.id);
    const looks = settledLooks(a.id, w.state.looks);
    if (looks[style]?.status === "done" || lookRuns.has(`${a.id}:${style}`)) return c.json({ look: looks[style] ?? { style, status: "pending", items: [], at: new Date().toISOString() } });
    // A look still pending elsewhere waits; one that failed or was cut off can be tried again.
    if (looks[style]?.status === "pending") return c.json({ look: looks[style] });
    if (await overSpend()) return c.json({ error: OVER_SPEND }, 503);
    const frames = new Map<number, Buffer>();
    for (const it of a.result.concepts?.items ?? []) {
      const f = await read(keys.frame(a.id, it.frame));
      if (f) frames.set(it.frame, f);
    }
    const sources = sourcesFrom(a.result, frames);
    if (!sources.length) return c.json({ error: "There are no photos to restyle yet." }, 409);
    const pending = { style, status: "pending" as const, items: [], at: new Date().toISOString() };
    await saveWorkspace(a.basement.id, { state: { looks: { ...looks, [style]: pending } } });
    lookRuns.add(`${a.id}:${style}`);
    void renderLook(a.id, style, sources)
      .then(async (look) => {
        const now = await loadWorkspace(a.basement.id);
        await saveWorkspace(a.basement.id, { state: { looks: { ...(now.state.looks ?? {}), [style]: look } } });
      })
      .finally(() => lookRuns.delete(`${a.id}:${style}`));
    return c.json({ look: pending });
  });

  app.get("/api/scans/:id/looks/:style/:file", async (c) => {
    const id = c.req.param("id");
    const style = c.req.param("style");
    const n = Number.parseInt(c.req.param("file"), 10);
    if ((!UUID.test(id) && id !== "sample") || !STYLES[style] || !Number.isInteger(n) || n < 1 || n > 8) return c.json({ error: "Not found" }, 404);
    const committed = id === "sample" && existsSync(sampleLookFile(style, n)) ? readFileSync(sampleLookFile(style, n)) : null;
    const body = committed ?? (await read(lookKey(id, style, n)));
    if (!body) return c.json({ error: "Not found" }, 404);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": body[0] === 0x89 ? "image/png" : "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  });

  // ---- The sample basement: the same documents, nothing saved ----

  app.post("/api/sample/permit.pdf", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const b = sampleBody(body);
    const copy: Copy = body?.copy === "submit" || body?.copy === "share" ? body.copy : "review";
    try {
      const out = await buildPermitPackage({ result: sampleResult(b.state), municipality: "waterloo-on", address: "The sample basement", profile: b.profile, state: b.state, site: null, aerialJpeg: null, favourites: copy === "review" ? await favouriteImages("sample", b.state) : [], copy });
      return pdf(out.bytes, `permit-${copy}-sample.pdf`);
    } catch (err) {
      if (err instanceof NotReady) return c.json({ error: err.message, left: err.left }, 409);
      throw err;
    }
  });

  app.post("/api/sample/permit/status", async (c) => {
    const b = sampleBody(await c.req.json().catch(() => ({})));
    return c.json(permitPayload({ result: sampleResult(b.state), municipality: "waterloo-on", state: b.state, profile: b.profile }, { address: "The sample basement", packageUrl: null }));
  });

  app.post("/api/sample/diy", async (c) => {
    const b = sampleBody(await c.req.json().catch(() => ({})));
    return c.json(diyPlan(sampleResult(b.state), b.state, "waterloo-on"));
  });

  function sampleApplyInput(b: ReturnType<typeof sampleBody>): ApplyInput {
    const base = sampleResult(b.state);
    const result = { ...base, ...(b.grants ? { grants: b.grants } : {}), ...(b.moneyAnswered ? { moneyAnswered: b.moneyAnswered } : {}) };
    const { areaM2, bedrooms, scope } = project(result, b.state);
    return { scanId: "sample", result, profile: b.profile, state: b.state, address: "The sample basement", municipality: "Waterloo", site: null, areaM2, bedrooms, scope };
  }

  app.post("/api/sample/apply", async (c) => c.json({ applications: asExample(applications(sampleApplyInput(sampleBody(await c.req.json().catch(() => ({})))))) }));

  app.post("/api/sample/apply/:program", async (c) => {
    if (c.req.param("program").replace(/\.pdf$/, "") !== "region_ontario_renovates_secondary_suites") return c.json({ error: "Not found" }, 404);
    const input = sampleApplyInput(sampleBody(await c.req.json().catch(() => ({}))));
    const bytes = await fetchOfficialPdf(REGION_FORM_URL);
    if (!bytes) return c.json({ error: "The Region's form didn't download. Try again later." }, 502);
    const filled = await fillRegionForm(bytes, regionValues(input.profile, input.result, input.address, input.municipality, input.areaM2, input.bedrooms));
    return pdf(filled.bytes, "ontario-renovates-application-sample.pdf");
  });

  // Sample looks are made once per style and kept for everyone, so the sample costs nothing to replay.
  app.post("/api/sample/looks", async (c) => {
    const style = String((await c.req.json().catch(() => ({}))).style ?? "");
    if (!STYLES[style]) return c.json({ error: "Pick a look." }, 400);
    const committed = committedLook(style);
    if (committed) return c.json({ look: committed });
    const result = sampleResult();
    const items = (result.concepts?.items ?? []) as { n: number; frame: number; title: string }[];
    const ready = (await Promise.all(items.map(async (it) => (existsSync(sampleLookFile(style, it.n)) || (await storage.get(lookKey("sample", style, it.n))) ? it : null)))).filter(Boolean);
    if (ready.length === items.length && items.length) return c.json({ look: { style, status: "done", items: items.map((it) => ({ ...it, kept: true, checked: "Room shape kept" })), at: "" } });
    if (!process.env.MODEL_API_KEY && !process.env.RELAY_TOKEN) return c.json({ error: "Looks need the Muse Image key on this server." }, 503);
    if (await overSpend()) return c.json({ error: OVER_SPEND }, 503);
    const frames = new Map<number, Buffer>();
    for (const it of items) {
      const file = `${SAMPLE}/frames/${String(it.frame).padStart(4, "0")}.jpg`;
      if (existsSync(file)) frames.set(it.frame, readFileSync(file));
    }
    const look = await renderLook("sample", style, sourcesFrom(result, frames));
    return c.json({ look });
  });
}
