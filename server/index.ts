import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { jobs, newJob, runScan } from "./pipeline";
import type { Household } from "./rules";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true, metaKey: Boolean(process.env.MODEL_API_KEY) }));

app.post("/api/scan", async (c) => {
  const body = await c.req.parseBody();
  const video = body.video;
  if (!(video instanceof File)) return c.json({ error: "Send the video as 'video'." }, 400);
  const household = (["relative", "renter", "unsure"].includes(String(body.household)) ? body.household : "unsure") as Household;
  const job = newJob(household, String(body.address ?? ""));
  const ext = (video.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  const input = join(job.dir, `input.${ext}`);
  writeFileSync(input, Buffer.from(await video.arrayBuffer()));
  void runScan(job, input);
  return c.json({ id: job.id });
});

// Live scan events: replays what already happened, then streams the rest.
app.get("/api/scan/:id/events", (c) => {
  const job = jobs.get(c.req.param("id"));
  if (!job) return c.json({ error: "Not found" }, 404);
  return streamSSE(c, async (stream) => {
    for (const e of job.events) await stream.writeSSE({ data: JSON.stringify(e) });
    if (job.status !== "running") return;
    await new Promise<void>((resolve) => {
      const listener = (e: (typeof job.events)[number]) => {
        // Close only after the final event is written, or the client never sees "done".
        void stream.writeSSE({ data: JSON.stringify(e) }).then(() => {
          if (e.type === "done" || e.type === "error") finish();
        });
      };
      const finish = () => {
        job.listeners.delete(listener);
        resolve();
      };
      job.listeners.add(listener);
      stream.onAbort(finish);
    });
  });
});

app.get("/api/scan/:id", (c) => {
  const job = jobs.get(c.req.param("id"));
  if (!job) return c.json({ error: "Not found" }, 404);
  return c.json({ status: job.status, result: job.result ?? null });
});

app.get("/api/scan/:id/frame/:n", (c) => {
  const job = jobs.get(c.req.param("id"));
  const n = Number.parseInt(c.req.param("n"), 10);
  if (!job || !Number.isFinite(n)) return c.json({ error: "Not found" }, 404);
  const path = join(job.dir, "frames", `${String(n).padStart(4, "0")}.jpg`);
  if (!existsSync(path)) return c.json({ error: "Not found" }, 404);
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
});

// In production the built web app is served from the same process.
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

// API_PORT wins in dev, where the preview launcher sets PORT for the web server.
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`api on :${port}`));
