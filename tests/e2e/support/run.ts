// One test run: its mode, its folder under tmp/e2e, its ports and the server's environment.
// Shared by playwright.config.ts, the fixtures and the reporter (they run in different processes, so
// everything here comes from the environment, which the config fixes before any worker starts).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type Mode = "replay" | "record";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const mode: Mode = process.env.E2E_MODE === "record" ? "record" : "replay";

// The first process to load this names the run; workers inherit it.
process.env.E2E_RUN ??= `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${mode}`;
export const runId = process.env.E2E_RUN;
export const runDir = join(ROOT, "tmp/e2e", runId);

// Not the ports `pnpm dev` uses, so a dev server that's already running is left alone.
export const API_PORT = Number(process.env.E2E_API_PORT ?? 47873);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 47173);
export const baseURL = `http://localhost:${WEB_PORT}`;

// Saved answers: the small committed set, then the private ones (David's own takes), gitignored.
export const COMMITTED_REPLAY = join(ROOT, "tests/fixtures/replay");
// Local media (gitignored): the main checkout's, also when this runs from a worktree in .claude/worktrees.
export const MEDIA_ROOT = process.env.E2E_MEDIA ?? [join(ROOT, "media"), join(ROOT, "../../../media")].find((p) => existsSync(p)) ?? join(ROOT, "media");
export const PRIVATE_REPLAY = join(MEDIA_ROOT, "private/replay");
// Recording writes to the first folder: private unless E2E_RECORD_TO=committed.
const replayDirs = process.env.E2E_RECORD_TO === "committed" ? [COMMITTED_REPLAY, PRIVATE_REPLAY] : [PRIVATE_REPLAY, COMMITTED_REPLAY];
export const RECORD_DIR = replayDirs[0];

export const files = {
  replayLog: join(runDir, "replay-log.jsonl"),
  missLog: join(runDir, "replay-misses.jsonl"),
  steps: join(runDir, "steps.jsonl"),
  timing: join(runDir, "timing.jsonl"),
  report: join(runDir, "report.html"),
};

// The keys stay in the main checkout's .env; only record mode reads them, and only in the server.
const envFile = process.env.E2E_ENV_FILE ?? [join(ROOT, ".env"), join(ROOT, "../../../.env")].find((p) => existsSync(p));

export function apiCommand() {
  const preload = `--import ${JSON.stringify(join(ROOT, "tests/e2e/support/net-guard.ts"))}`;
  const env = mode === "record" && envFile ? `--env-file=${JSON.stringify(envFile)} ` : "";
  return `pnpm exec tsx ${env}${preload} server/index.ts`;
}

export function apiEnv(): Record<string, string> {
  const shared = {
    API_PORT: String(API_PORT),
    NODE_ENV: "development",
    PGLITE_DIR: join(runDir, "pglite"),
    LOCAL_STORAGE_DIR: join(runDir, "storage"),
    REPLAY_DIR: replayDirs.join(":"),
    REPLAY_LOG: files.replayLog,
    REPLAY_MISS_LOG: files.missLog,
    // A test makes many scans; the public limits (and session A's daily one) stay out of the way.
    SCANS_PER_IP_PER_HOUR: "1000",
    SCANS_PER_DAY: "1000",
    DAILY_COST_CAP_USD: "1000",
    DATABASE_URL: "",
    STORAGE: "local",
  };
  if (mode === "record") {
    return {
      ...shared,
      META_CACHE: "record",
      SCAN3D_CACHE: "record",
      PUBLIC_CACHE: "record",
      // The Mac runner by default (free); E2E_SCAN3D_URL for Modal. The token comes from the env file.
      SCAN3D_URL: process.env.E2E_SCAN3D_URL ?? "http://127.0.0.1:8790",
      SCAN3D_TOKEN: process.env.E2E_SCAN3D_TOKEN ?? "dev",
    };
  }
  return {
    ...shared,
    META_CACHE: "replay",
    SCAN3D_CACHE: "replay",
    PUBLIC_CACHE: "replay",
    // Never used to reach anything: replay answers before a request is made.
    SCAN3D_URL: "http://scan3d.replay.invalid",
    SCAN3D_TOKEN: "replay",
    MODEL_API_KEY: "",
    RELAY_TOKEN: "",
    META_API_BASE: "http://meta.replay.invalid/v1",
    CLERK_SECRET_KEY: "",
    CLERK_PUBLISHABLE_KEY: "",
  };
}
