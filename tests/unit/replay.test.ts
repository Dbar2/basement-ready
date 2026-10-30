import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplayMiss, serviceFetch } from "../../server/replay";

const SECRET = "sk-test-do-not-save";
const auth = () => ({ Authorization: `Bearer ${SECRET}` });
const json = (body: unknown) => JSON.stringify(body);
const sam = (image: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: json({ model: "sam-3.1", input: [{ role: "user", content: [{ type: "input_text", text: "basement window" }, { type: "input_image", image_url: image }] }] }),
});
const png = (bytes: number[]) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

let dir: string;
let real: ReturnType<typeof vi.fn>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "replay-test-"));
  process.env.REPLAY_DIR = join(dir, "answers");
  process.env.REPLAY_MISS_LOG = join(dir, "misses.jsonl");
  real = vi.fn(async () => new Response(json({ output_text: "<box>" }), { status: 200, headers: { "content-type": "application/json" } }));
});
afterEach(() => {
  delete process.env.META_CACHE;
  rmSync(dir, { recursive: true, force: true });
});

describe("record and replay", () => {
  it("off: calls the service with its key, saves nothing", async () => {
    await serviceFetch("meta", "https://api.example", "/responses", sam(png([1, 2, 3])), auth, real as any);
    expect(real).toHaveBeenCalledOnce();
    expect((real.mock.calls[0] as any[])[1].headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(() => readdirSync(join(dir, "answers"))).toThrow();
  });

  it("record saves the answer without the key; replay gives it back without the network", async () => {
    process.env.META_CACHE = "record";
    const first = await serviceFetch("meta", "https://api.example", "/responses", sam(png([1, 2, 3])), auth, real as any);
    expect(await first.json()).toEqual({ output_text: "<box>" });
    const saved = readdirSync(join(dir, "answers"));
    expect(saved).toHaveLength(1);
    const text = readFileSync(join(dir, "answers", saved[0]), "utf8");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("Authorization");
    // The picture is saved as its hash, not its bytes.
    expect(text).not.toContain(Buffer.from([1, 2, 3]).toString("base64"));
    expect(JSON.parse(text)).toMatchObject({ service: "meta", route: "/responses", model: "sam-3.1", about: "basement window", status: 200 });

    process.env.META_CACHE = "replay";
    const again = await serviceFetch("meta", "https://elsewhere.example", "/responses", sam(png([1, 2, 3])), () => {
      throw new Error("replay must not ask for the key");
    }, real as any);
    expect(await again.json()).toEqual({ output_text: "<box>" });
    expect(real).toHaveBeenCalledOnce();
  });

  it("replay: a different picture is a miss, thrown and logged, with no network call", async () => {
    process.env.META_CACHE = "record";
    await serviceFetch("meta", "https://api.example", "/responses", sam(png([1, 2, 3])), auth, real as any);
    process.env.META_CACHE = "replay";
    await expect(serviceFetch("meta", "https://api.example", "/responses", sam(png([9, 9, 9])), auth, real as any)).rejects.toBeInstanceOf(ReplayMiss);
    expect(real).toHaveBeenCalledOnce();
    const miss = JSON.parse(readFileSync(join(dir, "misses.jsonl"), "utf8").trim());
    expect(miss).toMatchObject({ service: "meta", route: "/responses", model: "sam-3.1", about: "basement window" });
  });

  it("keys a form by its fields and file bytes, and replays a multipart answer", async () => {
    const form = (bytes: number[]) => {
      const f = new FormData();
      f.append("options", json({ maxFrames: 48 }));
      f.append("frames", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "0000.jpg");
      return f;
    };
    const reply = new FormData();
    reply.append("scan", new Blob([json({ room: { widthM: 4.2 } })], { type: "application/json" }), "scan.json");
    reply.append("points", new Blob([new Uint8Array([7, 7, 7, 7])]), "points.ply");
    const service = vi.fn(async () => new Response(reply));
    process.env.SCAN3D_CACHE = "record";
    await serviceFetch("scan3d", "http://127.0.0.1:8790", "/scan", { method: "POST", body: form([1, 2]) }, auth, service as any);
    process.env.SCAN3D_CACHE = "replay";
    const parts = await (await serviceFetch("scan3d", "https://modal.example", "/scan", { method: "POST", body: form([1, 2]) }, auth, service as any)).formData();
    expect(JSON.parse(await (parts.get("scan") as File).text())).toEqual({ room: { widthM: 4.2 } });
    expect([...new Uint8Array(await (parts.get("points") as File).arrayBuffer())]).toEqual([7, 7, 7, 7]);
    await expect(serviceFetch("scan3d", "https://modal.example", "/scan", { method: "POST", body: form([1, 3]) }, auth, service as any)).rejects.toBeInstanceOf(ReplayMiss);
    expect(service).toHaveBeenCalledOnce();
    delete process.env.SCAN3D_CACHE;
  });

  it("keys a Spark read, whose first message is plain text", async () => {
    process.env.META_CACHE = "record";
    const spark = { method: "POST", body: json({ model: "muse-spark-1.3", input: [{ role: "developer", content: "rules" }, { role: "user", content: [{ type: "input_text", text: "{}" }] }] }) };
    await serviceFetch("meta", "https://api.example", "/responses", spark, auth, real as any);
    process.env.META_CACHE = "replay";
    expect((await serviceFetch("meta", "https://api.example", "/responses", spark, auth, real as any)).status).toBe(200);
  });

  it("doesn't save a failed call", async () => {
    process.env.META_CACHE = "record";
    const failing = vi.fn(async () => new Response("busy", { status: 503 }));
    const res = await serviceFetch("meta", "https://api.example", "/responses", sam(png([4])), auth, failing as any);
    expect(res.status).toBe(503);
    expect(() => readdirSync(join(dir, "answers"))).toThrow();
  });
});
