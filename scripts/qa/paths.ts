// Where things live. ROOT is the checkout (a worktree under .claude/worktrees works too: its .env and
// media are read from the main checkout when it has none of its own).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
const MAIN = resolve(ROOT, "../../..");
const first = (...p: string[]) => p.find((x) => existsSync(x));

export const MEDIA_ROOT = process.env.QA_MEDIA ?? first(join(ROOT, "media"), join(MAIN, "media")) ?? join(ROOT, "media");
export const QA_DIR = join(ROOT, "tmp/qa");
export const CACHE_DIR = join(QA_DIR, "cache");

// ANTHROPIC_API_KEY from the environment, else from the checkout's .env (only that one line is read).
// The value is returned to the caller and never logged.
export function anthropicKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return process.env.ANTHROPIC_API_KEY.trim();
  const file = first(join(ROOT, ".env"), join(MAIN, ".env"));
  if (!file) return null;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => /^\s*(export\s+)?ANTHROPIC_API_KEY\s*=/.test(l));
  const v = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  return v || null;
}
