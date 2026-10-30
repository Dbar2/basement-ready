// Record and replay for the paid services (Meta's models and the 3D service), so end-to-end tests run
// for free and the same every time. META_CACHE and SCAN3D_CACHE each take:
//   off     the real service, nothing saved (the default; production never sets these)
//   record  a saved answer when there is one, otherwise the real service, and its answer is saved
//   replay  saved answers only; a missing one throws and is logged, and the network is never called
// An answer is keyed by a hash of the service, route, model and request body, with image, video and
// audio bytes hashed. Saved files hold the status, the content type, the body and how long the call
// took. No headers and no keys are ever saved: the key is added after the hash, only for the network.
// REPLAY_DIR lists where answers live, colon-separated: replay reads them all, record writes the first.
// See tests/e2e/README.md.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

// "public": the free public data (city maps, the aerial photo, city forms), only in tests (tests/e2e/support/net-guard.ts).
export type Service = "meta" | "scan3d" | "public";
export type CacheMode = "off" | "record" | "replay";

const ENV: Record<Service, string> = { meta: "META_CACHE", scan3d: "SCAN3D_CACHE", public: "PUBLIC_CACHE" };

export function cacheMode(service: Service): CacheMode {
  const v = (process.env[ENV[service]] ?? "off").toLowerCase();
  if (v === "record" || v === "replay") return v;
  return "off";
}

const dirs = () => (process.env.REPLAY_DIR ?? "tests/fixtures/replay").split(":").filter(Boolean);
// Bodies bigger than this go in their own gzipped file beside the entry.
const INLINE_MAX = 64 * 1024;

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

// A data URL stands for its bytes: same picture, same key, and the saved request stays small.
const DATA_URL = /^data:([^;,]+)(;base64)?,(.*)$/s;
function normalizeValue(v: unknown): unknown {
  if (typeof v === "string") {
    const m = DATA_URL.exec(v);
    if (m) {
      const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
      return { dataUrl: m[1], sha256: sha(bytes), bytes: bytes.length };
    }
    return v;
  }
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, normalizeValue((v as Record<string, unknown>)[k])]));
  }
  return v;
}

async function normalizeBody(body: unknown): Promise<unknown> {
  if (body == null) return null;
  if (typeof body === "string") {
    try {
      return { json: normalizeValue(JSON.parse(body)) };
    } catch {
      return { text: body };
    }
  }
  if (body instanceof FormData) {
    const parts: unknown[] = [];
    for (const [field, value] of body.entries()) {
      if (typeof value === "string") {
        let parsed: unknown = value;
        try {
          parsed = normalizeValue(JSON.parse(value));
        } catch {}
        parts.push({ field, value: parsed });
      } else {
        const bytes = new Uint8Array(await value.arrayBuffer());
        // A JSON part (transcribe's request) keyed by what it says, not its bytes.
        if (value.type === "application/json") parts.push({ field, json: normalizeValue(JSON.parse(Buffer.from(bytes).toString("utf8"))) });
        else parts.push({ field, name: value.name, type: value.type, sha256: sha(bytes), bytes: bytes.length });
      }
    }
    return { form: parts };
  }
  throw new Error(`replay: can't key a ${Object.prototype.toString.call(body)} body`);
}

// The model a call asks for, and what it's about, for the saved entry and for miss messages.
function describe(route: string, request: any): { model: string | null; about: string | null; input: string | null } {
  const json = request?.json;
  const form: any[] = request?.form ?? [];
  const field = (name: string) => form.find((p) => p.field === name);
  const model = json?.model ?? field("model")?.value ?? field("request")?.json?.model ?? null;
  const text = json?.input?.[0]?.content?.find?.((c: any) => c.type === "input_text")?.text;
  const about =
    (typeof text === "string" && model === "sam-3.1" ? text : null) ??
    (typeof field("prompt")?.value === "string" ? String(field("prompt").value).slice(0, 80) : null) ??
    (route === "/scan" ? `${form.filter((p) => p.field === "frames").length} frames` : null) ??
    (route === "/files" ? `${field("file")?.name} ${field("file")?.bytes} bytes` : null);
  // A SAM call on a whole video or on one picture: priced differently.
  const first = json?.input?.[0]?.content;
  const parts: any[] = Array.isArray(first) ? first : [];
  const input = parts.some((c) => c?.type === "input_video") ? "video" : parts.some((c) => c?.type === "input_image") ? "image" : null;
  return { model: typeof model === "string" ? model : null, about, input };
}

type Entry = {
  key: string;
  service: Service;
  method: string;
  route: string;
  model: string | null;
  about: string | null;
  status: number;
  contentType: string | null;
  body?: string; // utf-8, when small
  bodyFile?: string; // gzipped, beside the entry
  bytes: number;
  ms: number;
  recordedAt: string;
  request: unknown; // what was keyed, bytes hashed and long text cut
};

// Very long text cut down for the saved copy (the key used the whole of it). The rest is kept, so two
// requests that should have matched can be compared.
function shorten(v: unknown): unknown {
  if (typeof v === "string") return v.length > 20_000 ? `${v.slice(0, 2000)}… (${v.length} chars, sha256 ${sha(v).slice(0, 12)})` : v;
  if (Array.isArray(v)) return v.map(shorten);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x)]));
  return v;
}

export class ReplayMiss extends Error {}

function log(file: string | undefined, line: object) {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...line }) + "\n");
}

// Pacing: REPLAY_PACE=0 answers at once (the default); 0.1 takes a tenth of the recorded time.
const pace = () => Math.max(0, Number(process.env.REPLAY_PACE ?? 0) || 0);

function find(key: string): { entry: Entry; dir: string } | null {
  for (const dir of dirs()) {
    const path = join(dir, `${key}.json`);
    if (existsSync(path)) return { entry: JSON.parse(readFileSync(path, "utf8")), dir };
  }
  return null;
}

function toResponse(entry: Entry, dir: string): Response {
  const body = entry.bodyFile ? gunzipSync(readFileSync(join(dir, entry.bodyFile))) : Buffer.from(entry.body ?? "", "utf8");
  return new Response(entry.status === 204 ? null : new Uint8Array(body), {
    status: entry.status,
    headers: entry.contentType ? { "content-type": entry.contentType } : {},
  });
}

// fetch for a paid service. `route` is the path after the service's base URL, so the Canada relay and
// the direct API (or Modal and the Mac runner) share answers. `secret` holds the auth headers: they're
// only added when the call really goes out, through `transport`.
export async function serviceFetch(
  service: Service,
  base: string,
  route: string,
  init: RequestInit,
  secret: () => Record<string, string>,
  transport: typeof fetch = fetch,
): Promise<Response> {
  const mode = cacheMode(service);
  const send = () => transport(`${base}${route}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...secret() } });
  if (mode === "off") return send();

  const method = (init.method ?? "GET").toUpperCase();
  const request = await normalizeBody(init.body);
  const key = sha(JSON.stringify({ service, method, route, request })).slice(0, 40);
  const { model, about, input } = describe(route, request);
  const what = `${service} ${method} ${route}${model ? ` ${model}` : ""}${about ? ` "${about}"` : ""}`;

  const saved = find(key);
  if (saved) {
    const wait = saved.entry.ms * pace();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    log(process.env.REPLAY_LOG, { event: "hit", key, service, route, model, about, input, ms: saved.entry.ms });
    return toResponse(saved.entry, saved.dir);
  }
  if (mode === "replay") {
    log(process.env.REPLAY_LOG, { event: "miss", key, service, route, model, about });
    log(process.env.REPLAY_MISS_LOG, { key, service, route, model, about, request: shorten(request) });
    console.error(`[replay] MISSING ${what} (key ${key}). Record it with ${ENV[service]}=record.`);
    throw new ReplayMiss(`Replay has no saved answer for ${what} (key ${key})`);
  }

  // record: the real call, then save its answer.
  const started = Date.now();
  const res = await send();
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ms = Date.now() - started;
  const contentType = res.headers.get("content-type");
  log(process.env.REPLAY_LOG, { event: "recorded", key, service, route, model, about, input, ms, status: res.status, bytes: bytes.length });
  // Failures aren't saved: a hiccup shouldn't replay forever.
  if (res.ok) {
    const dir = dirs()[0];
    mkdirSync(dir, { recursive: true });
    const text = contentType && /json|text/.test(contentType) && bytes.length <= INLINE_MAX ? Buffer.from(bytes).toString("utf8") : null;
    const entry: Entry = {
      key,
      service,
      method,
      route,
      model,
      about,
      status: res.status,
      contentType,
      ...(text != null ? { body: text } : { bodyFile: `${key}.body.gz` }),
      bytes: bytes.length,
      ms,
      recordedAt: new Date().toISOString(),
      request: shorten(request),
    };
    if (text == null) writeFileSync(join(dir, `${key}.body.gz`), gzipSync(bytes));
    writeFileSync(join(dir, `${key}.json`), JSON.stringify(entry, null, 1) + "\n");
  }
  return new Response(res.status === 204 ? null : bytes, { status: res.status, headers: contentType ? { "content-type": contentType } : {} });
}
