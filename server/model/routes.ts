// The model's API, mounted from server/index.ts. The model itself is saved with the workspace
// (PUT /api/scans/:id/workspace, state.model); these routes seed it from the scan, draw the designs for
// a confirmed plan, and ask muse-spark for a described change. The sample gets the same, saved nowhere.
import { readFileSync } from "node:fs";
import type { Context, Hono } from "hono";
import { clientIp, metaKey, overSpend } from "../limits";
import { basementFor, loadWorkspace } from "../workspace";
import { adminRead, requestClaims } from "../privacy";
import { describeChange } from "./describe";
import { currentModel } from "./current";
import { DesignSchema, ExistingSchema, ModelSchema } from "./schema";
import { seedDesigns, seedModel } from "./seed";
import type { Design, Existing, Model } from "./types";

const UUID = /^[0-9a-f-]{36}$/;
const DESCRIBE_PER_IP_PER_HOUR = Number(process.env.DESCRIBE_PER_IP_PER_HOUR ?? 30);

let sample: Model | null = null;
function sampleModel(): Model | null {
  sample ??= seedModel(JSON.parse(readFileSync("public/samples/sample/result.json", "utf8")), {}, "2026-10-30T00:00:00.000Z");
  return sample;
}

const asks = new Map<string, number[]>();
function allowAsk(ip: string) {
  const now = Date.now();
  const recent = (asks.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= DESCRIBE_PER_IP_PER_HOUR) return false;
  asks.set(ip, [...recent, now]);
  if (asks.size > 5000) asks.clear();
  return true;
}

export function mountModel(app: Hono, currentUser: (c: Context) => Promise<string | null>) {
  async function access(c: Context) {
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id)) return null;
    const userId = await currentUser(c);
    const a = await basementFor(id, { userId, claims: requestClaims(c), admin: adminRead(c) });
    return a.basement ? a : null;
  }

  // The saved model, or a fresh one from the scan (not saved until the plan is confirmed).
  app.get("/api/scans/:id/model", async (c) => {
    if (c.req.param("id") === "sample") {
      const model = sampleModel();
      return model ? c.json({ model, saved: false }) : c.json({ error: "The example has no plan." }, 404);
    }
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    const w = await loadWorkspace(a.basement.id);
    const m = currentModel(a.result, w.state, c.req.param("id"));
    return m ? c.json(m) : c.json({ error: "This scan has no measured plan yet." }, 404);
  });

  // Designs for the basement as they confirmed it: every option drawn again on the corrected plan.
  app.post("/api/model/designs", async (c) => {
    const body = await c.req.json().catch(() => null);
    const existing = ExistingSchema.safeParse(body?.existing);
    if (!existing.success) return c.json({ error: "That plan didn't make sense. Try again." }, 400);
    const mood = ModelSchema.shape.mood.partial().safeParse({ finishes: body?.finishes ?? {}, colours: body?.colours ?? undefined });
    const { finishes, colours } = mood.success ? mood.data : {};
    return c.json({ designs: seedDesigns(existing.data as Existing, { finishes, colours }) });
  });

  // "Describe a change": muse-spark proposes edits; the studio shows them before anything is applied.
  app.post("/api/scans/:id/model/describe", async (c) => {
    if (c.req.param("id") !== "sample") {
      const a = await access(c);
      if (!a) return c.json({ error: "Not found" }, 404);
      if (!a.allowed) return c.json({ error: "Open this on the device you scanned with, or sign in." }, 403);
    }
    if (!metaKey()) return c.json({ error: "Describing a change needs the AI key on this server." }, 503);
    // Spark's tokens count toward the day's cap on paid calls (server/limits.ts, charged in server/meta.ts).
    if (await overSpend()) return c.json({ error: "That's all the changes we can make today. They come back at midnight, Eastern time." }, 429);
    const body = await c.req.json().catch(() => null);
    const ask = typeof body?.ask === "string" ? body.ask.trim().slice(0, 400) : "";
    const design = DesignSchema.safeParse(body?.design);
    const existing = ExistingSchema.safeParse(body?.existing);
    if (!ask) return c.json({ error: "Say what you'd like to change." }, 400);
    if (!design.success || !existing.success) return c.json({ error: "That design didn't make sense. Reload and try again." }, 400);
    if (!allowAsk(clientIp(c))) return c.json({ error: "That's a lot of changes for one hour. Try again later." }, 429);
    try {
      return c.json(await describeChange(design.data as Design, existing.data as Existing, ask));
    } catch (err) {
      console.error(`[model] describe failed: ${err instanceof Error ? err.message : err}`);
      return c.json({ error: "muse-spark didn't answer. Try again." }, 502);
    }
  });
}
