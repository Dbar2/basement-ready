// The app for a QA run: its own API (a fresh embedded database, local storage, no Meta key) and web
// server on ports `pnpm dev` and the end-to-end tests don't use. Recorded takes replay their saved
// Meta and 3D answers (server/replay.ts, once the end-to-end tests are on main), so nothing is spent.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, MEDIA_ROOT } from "./paths";

export const API_PORT = Number(process.env.QA_API_PORT ?? 48787);
export const WEB_PORT = Number(process.env.QA_WEB_PORT ?? 48173);

export const replayAvailable = () => existsSync(join(ROOT, "server/replay.ts"));
export const replayDirs = () => [join(MEDIA_ROOT, "private/replay"), join(ROOT, "tests/fixtures/replay")].filter((d) => existsSync(d));

function apiEnv(runDir: string): NodeJS.ProcessEnv {
  // Only what the server needs: never the Anthropic key, never the Meta key.
  const keep = ["PATH", "HOME", "TMPDIR", "SHELL", "USER", "LANG", "TERM"];
  const base = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));
  return {
    ...base,
    API_PORT: String(API_PORT),
    NODE_ENV: "development",
    PGLITE_DIR: join(runDir, "server/pglite"),
    LOCAL_STORAGE_DIR: join(runDir, "server/storage"),
    STORAGE: "local",
    DATABASE_URL: "",
    MODEL_API_KEY: "",
    RELAY_TOKEN: "",
    // Never reached: replay answers before a request goes out, and a miss fails instead of spending.
    META_API_BASE: "http://meta.qa.invalid/v1",
    SCAN3D_URL: "http://scan3d.qa.invalid",
    SCAN3D_TOKEN: "qa",
    META_CACHE: "replay",
    SCAN3D_CACHE: "replay",
    PUBLIC_CACHE: "replay",
    REPLAY_DIR: replayDirs().join(":"),
    REPLAY_LOG: join(runDir, "server/replay-log.jsonl"),
    REPLAY_MISS_LOG: join(runDir, "server/replay-misses.jsonl"),
    REPLAY_PACE: process.env.QA_PACE ?? "0",
    SCAN3D_PARALLEL: "3",
    SCANS_PER_IP_PER_HOUR: "1000",
    SCANS_PER_DAY: "1000",
    DAILY_COST_CAP_USD: "1000",
    CLERK_SECRET_KEY: "",
    CLERK_PUBLISHABLE_KEY: "",
  };
}

async function waitFor(url: string, ms: number, proc: ChildProcess, name: string) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error(`${name} exited with ${proc.exitCode}`);
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${name} didn't answer at ${url} within ${ms / 1000}s`);
}

export type Servers = { baseURL: string; stop: () => Promise<void>; logs: string[] };

// web "dev": Vite's dev server (fast). web "build": the production bundle through `vite preview`, which
// is what the live site serves.
export async function startServers(runDir: string, web: "dev" | "build"): Promise<Servers> {
  const logs: string[] = [];
  const procs: ChildProcess[] = [];
  const keepLog = (name: string) => (d: Buffer) => {
    for (const l of d.toString().split("\n")) if (l.trim()) logs.push(`[${name}] ${l}`);
    if (logs.length > 4000) logs.splice(0, logs.length - 4000);
  };
  const run = (name: string, args: string[], env: NodeJS.ProcessEnv) => {
    const p = spawn("pnpm", ["exec", ...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    p.stdout!.on("data", keepLog(name));
    p.stderr!.on("data", keepLog(name));
    procs.push(p);
    return p;
  };
  const stop = async () => {
    for (const p of procs) {
      if (p.exitCode === null && p.pid) {
        try {
          process.kill(-p.pid, "SIGTERM");
        } catch {
          p.kill("SIGTERM");
        }
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  };
  try {
    const api = run("api", ["tsx", "server/index.ts"], apiEnv(runDir));
    const webEnv = { ...apiEnv(runDir), API_PORT: String(API_PORT) };
    if (web === "build") {
      const out = join(runDir, "server/dist");
      const build = run("build", ["vite", "build", "--outDir", out, "--emptyOutDir"], webEnv);
      await new Promise<void>((res, rej) => build.on("exit", (code) => (code === 0 ? res() : rej(new Error(`vite build exited with ${code}`)))));
      run("web", ["vite", "preview", "--outDir", out, "--port", String(WEB_PORT), "--strictPort"], webEnv);
    } else {
      run("web", ["vite", "--port", String(WEB_PORT), "--strictPort"], webEnv);
    }
    const baseURL = `http://localhost:${WEB_PORT}`;
    await waitFor(`http://localhost:${API_PORT}/api/health`, 60_000, api, "API");
    await waitFor(baseURL, 60_000, procs[procs.length - 1], "web server");
    return { baseURL, stop, logs };
  } catch (e) {
    await stop();
    throw e;
  }
}
