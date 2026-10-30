// Record mode only: wake the 3D service and keep it awake while takes are recorded. The scan asks
// /health with a 3-second limit before using the 3D, and a cold Modal container takes about 28 s to
// answer, so without this a recording could quietly have no 3D in it.
import { apiEnv, mode } from "./run";

export default async function globalSetup() {
  if (mode !== "record") return;
  const { SCAN3D_URL: url, SCAN3D_TOKEN: token } = apiEnv() as Record<string, string | undefined>;
  if (!url) return;
  const ping = (timeout: number) => fetch(`${url}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeout) });
  const started = Date.now();
  const res = await ping(180_000).catch((err) => {
    throw new Error(`The 3D service didn't answer at ${new URL(url).host}: ${err instanceof Error ? err.message : err}`);
  });
  if (!res.ok) throw new Error(`The 3D service said ${res.status} at ${new URL(url).host}`);
  console.log(`[e2e] 3D service awake in ${((Date.now() - started) / 1000).toFixed(1)} s; keeping it awake while recording`);
  const timer = setInterval(() => void ping(60_000).catch(() => {}), 30_000);
  return () => clearInterval(timer);
}
