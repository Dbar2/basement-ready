// Meta Model API relay, pinned to Canada.
// Our Meta key only works from Canada, and Railway has no Canadian region, so the
// server sends its Meta calls here and this Worker forwards them from a Canadian data centre.
// Only callers with RELAY_TOKEN get through; the Meta key never leaves this Worker.
const UPSTREAM = "https://api.meta.ai";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true, colo: req.cf?.colo, country: req.cf?.country });
    if (!env.RELAY_TOKEN || req.headers.get("x-relay-token") !== env.RELAY_TOKEN) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!url.pathname.startsWith("/v1/")) return new Response("Not found", { status: 404 });

    const headers = new Headers(req.headers);
    headers.delete("x-relay-token");
    headers.delete("host");
    headers.set("authorization", `Bearer ${env.MODEL_API_KEY}`);
    return fetch(UPSTREAM + url.pathname + url.search, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    });
  },
};
