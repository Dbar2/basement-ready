// Post-deploy smoke test. Usage: pnpm smoke https://web-production-xxxx.up.railway.app [--scan path/to/video.mp4]
// Without --scan it only reads (free). With --scan it runs one real scan (~$0.15 of Meta API).
import { readFileSync } from "node:fs";
import { scanHeaders } from "./scanAccess";

const [base, flag, videoPath, city = "waterloo-on"] = process.argv.slice(2);
if (!base) {
  console.error("Usage: pnpm smoke <base-url> [--scan video.mp4]");
  process.exit(1);
}
let failed = 0;

async function check(name: string, fn: () => Promise<string>) {
  try {
    console.log(`PASS  ${name}  ${await fn()}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}  ${err instanceof Error ? err.message : err}`);
  }
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(new URL(path, base), { headers });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res;
}

await check("health", async () => {
  const h = await (await get("/api/health")).json();
  if (!h.ok || !h.metaKey || h.db !== "postgres") throw new Error(JSON.stringify(h));
  return JSON.stringify(h);
});
await check("homepage", async () => {
  const html = await (await get("/")).text();
  if (!html.includes("Basement Ready")) throw new Error("title missing");
  return `${html.length} bytes`;
});
await check("deep link served by the app", async () => {
  const html = await (await get("/scans/sample")).text();
  if (!html.includes('id="root"')) throw new Error("not the app shell");
  return "ok";
});
await check("sample assets", async () => {
  const r = await (await get("/samples/sample/result.json")).json();
  await get("/samples/sample-basement.mp4");
  return r.headline;
});
await check("unknown scan is a 404", async () => {
  const res = await fetch(new URL("/api/scans/00000000-0000-0000-0000-000000000000", base));
  if (res.status !== 404) throw new Error(`got ${res.status}`);
  return "404";
});

if (flag === "--scan" && videoPath) {
  await check("real scan end to end", async () => {
    const form = new FormData();
    form.append("video", new Blob([readFileSync(videoPath)], { type: "video/mp4" }), "basement.mp4");
    form.append("household", "relative");
    form.append("municipality", city);
    const created = await fetch(new URL("/api/scans", base), { method: "POST", body: form });
    if (!created.ok) throw new Error(`create → ${created.status} ${await created.text()}`);
    const made = await created.json();
    const { id } = made;
    // Scans are private: read it back as the device that made it.
    const mine = scanHeaders(made);
    const started = Date.now();
    for (;;) {
      const s = await (await get(`/api/scans/${id}`, mine)).json();
      if (s.status === "done") {
        const frame = s.result.detections[0]?.frame;
        if (frame !== undefined) await get(`/api/scans/${id}/frames/${frame}`, mine);
        if (s.result.municipality !== city) throw new Error(`answered for ${s.result.municipality}, expected ${city}`);
        return `${s.result.city}: ${s.result.headline} in ${Math.round((Date.now() - started) / 1000)} s → ${new URL(`/scans/${id}`, base)}`;
      }
      if (s.status === "error") throw new Error("scan failed");
      if (Date.now() - started > 240_000) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 3000));
    }
  });
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
