# Meta relay (Canada)

Basement Ready's Meta Model API key only works from Canada: tested Oct 28, 2026, a Toronto data centre lists all 9 models, while Railway's Virginia server lists none. Railway has no Canadian region, so the server sends its Meta calls through this Cloudflare Worker, which is pinned near AWS `ca-central-1` (Montreal).

- Secrets on the Worker: `MODEL_API_KEY` (the Meta key) and `RELAY_TOKEN` (a random shared secret).
- On Railway: `META_API_BASE=https://<worker>.workers.dev/v1` and the same `RELAY_TOKEN`.
- Check: `GET /health` shows the colo it runs in. The server logs `[meta] models available: …` at boot; if that list is empty, the relay isn't egressing from Canada.

Deploy: `wrangler deploy`, then `wrangler secret put MODEL_API_KEY` and `wrangler secret put RELAY_TOKEN`.
