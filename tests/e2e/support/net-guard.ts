// Loaded into the test server before the app (`tsx --import`). Meta's models and the 3D service have their
// own record and replay (server/replay.ts); this does the same for everything else the server fetches
// from the internet (city maps, the aerial photo, city forms), so a replay run makes no network calls at
// all. In replay, an unrecorded request throws and is logged, like a missing model answer.
import { serviceFetch } from "../../../server/replay";

const realFetch = globalThis.fetch;
const local = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
// Calls that already went through server/replay.ts reach here only in record mode, to go out for real.
const handled = [process.env.META_API_BASE ?? "https://api.meta.ai/v1", process.env.SCAN3D_URL, process.env.SCAN3D_TEXTURE_URL].filter((b): b is string => Boolean(b));

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (local(url.hostname) || handled.some((b) => url.href.startsWith(b))) return realFetch(input, init);
  // Keyed by the whole URL: public data comes from many hosts.
  return serviceFetch("public", "", url.href, { ...init, method: init?.method ?? (input instanceof Request ? input.method : "GET") }, () => ({}), realFetch);
};
