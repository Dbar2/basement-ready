// The command line, parsed without a library. `pnpm qa --help` prints USAGE.
import { BROWSERS, type Browser, type Viewport } from "./plan";
import type { Effort } from "./review";

export const USAGE = `pnpm qa [options]          capture every screen, review with Opus, write the report
pnpm qa:capture [options]  capture and free checks only (no model calls)
pnpm qa:review [options]   review the latest capture again (or --from <run>)

  --only a,b         screens, groups (journey, 3d, docs, marketing) or prefixes (workspace-*)
  --all              include the opt-in screens (marketing pages)
  --budget 3         dollars a run may spend on Opus (default 3)
  --browsers chromium,webkit   --viewports phone,desktop
  --scan sample      scans to capture (default sample); --take <id> adds a recorded take (replay)
  --effort medium    Opus effort: low | medium | high | xhigh | max
  --concurrency 4    review requests at once
  --base-url URL     use a server that's already running instead of starting one
  --web dev|build    the web server to start: Vite dev (default) or the production build
  --from <run>       reuse the shots of an earlier run (a folder in tmp/qa, or "latest")
  --capture-only     never call the model, even with a key
  --name <label>     added to the run folder's name
  --notes <file>     merge findings written by hand (schema.ts Notes) into the report`;

export type Args = {
  only: string[];
  all: boolean;
  budget: number;
  browsers: Browser[];
  viewports: Viewport[];
  scans: string[];
  takes: string[];
  effort: Effort;
  concurrency: number;
  baseURL: string | null;
  web: "dev" | "build";
  from: string | null;
  captureOnly: boolean;
  reviewOnly: boolean;
  name: string | null;
  notes: string | null;
  help: boolean;
};

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    only: [],
    all: false,
    budget: 3,
    browsers: [...BROWSERS],
    viewports: ["phone", "desktop"],
    scans: ["sample"],
    takes: [],
    effort: "medium",
    concurrency: 4,
    baseURL: null,
    web: "dev",
    from: null,
    captureOnly: false,
    reviewOnly: false,
    name: null,
    notes: null,
    help: false,
  };
  const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case "--only":
        a.only.push(...list(value()));
        break;
      case "--all":
        a.all = true;
        break;
      case "--budget": {
        const n = Number(value());
        if (!Number.isFinite(n) || n < 0) throw new Error("--budget takes a number of dollars");
        a.budget = n;
        break;
      }
      case "--browsers":
        a.browsers = list(value()).map((b) => {
          if (b !== "chromium" && b !== "webkit") throw new Error(`unknown browser "${b}"`);
          return b;
        });
        break;
      case "--viewports":
        a.viewports = list(value()).map((v) => {
          if (v !== "phone" && v !== "desktop") throw new Error(`unknown viewport "${v}"`);
          return v;
        });
        break;
      case "--scan":
        a.scans = list(value());
        break;
      case "--take":
        a.takes.push(...list(value()));
        break;
      case "--effort": {
        const e = value() as Effort;
        if (!EFFORTS.includes(e)) throw new Error(`--effort is one of ${EFFORTS.join(", ")}`);
        a.effort = e;
        break;
      }
      case "--concurrency":
        a.concurrency = Math.max(1, Math.min(8, Number(value()) || 4));
        break;
      case "--base-url":
        a.baseURL = value().replace(/\/$/, "");
        break;
      case "--web": {
        const w = value();
        if (w !== "dev" && w !== "build") throw new Error("--web is dev or build");
        a.web = w;
        break;
      }
      case "--from":
        a.from = value();
        break;
      case "--capture-only":
        a.captureOnly = true;
        break;
      case "--review-only":
        a.reviewOnly = true;
        break;
      case "--name":
        a.name = value().replace(/[^a-z0-9-]+/gi, "-");
        break;
      case "--notes":
        a.notes = value();
        break;
      case "--help":
      case "-h":
        a.help = true;
        break;
      default:
        throw new Error(`unknown option ${flag}\n\n${USAGE}`);
    }
  }
  if (a.reviewOnly && !a.from) a.from = "latest";
  return a;
}
