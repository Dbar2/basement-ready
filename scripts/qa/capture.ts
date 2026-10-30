// Walks the journey in each browser and size and saves what the plan asks for: full-page shots of every
// screen, the 3D views from fixed cameras, the plan drawn over the scan, and each PDF page. Every page
// shot also gets the free checks (lint.ts) and its numbers read off for the cross-screen check.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Download, Page } from "playwright";
import { launch } from "./browsers";
import { Images, imageSize, sha256, type Box } from "./images";
import { lint, lintText, numbersOf, type LintIssue } from "./lint";
import { renderPdf } from "./pdf";
import { SCREENS, STORY_STEPS, VIEWPORTS, type Browser, type Camera, type Shot, type Viewport } from "./plan";
import { cameraPose, eyeCandidates, grab, installThreeHook, mainCanvas, project, sceneBounds, setPose, type Bounds, type CanvasRef, type Pose } from "./three";

export type Captured = Omit<Shot, "id"> & {
  id: string;
  file: string; // relative to the run folder
  w: number;
  h: number;
  dpr: number;
  hash: string;
  url: string;
  page?: number; // PDF page number
  doc?: string; // which PDF: "review", "submit", "book"
  numbers?: string[];
  canvas?: Box; // where the 3D sits in the image, in image pixels
  notes: string[];
};

export type AutoFinding = {
  shot: string;
  screen: string;
  rule: string;
  severity: "P0" | "P1" | "P2";
  category: LintIssue["category"];
  title: string;
  what: string;
  fix: string;
  box?: Box; // image pixels
};

export type CaptureResult = { shots: Captured[]; auto: AutoFinding[]; log: string[] };

type Lane = { browser: Browser; viewport: Viewport };

// Test owner for the example's permit, money and build tabs (scripts/permit-render.ts uses the same).
const OWNER = { first: "Sam", last: "Rivera", phone: "519-555-0100", email: "sam@example.com", postal: "N2L 2C1" };

// Long pages are shot to this many screens tall; the rest is noted, not reviewed.
const MAX_SCREENS: Record<Viewport, number> = { phone: 7, desktop: 8 };

// The workspace's "Your basement, scanned" section (src/components/ScanViews.tsx) and its starting layout
// (src/components/StagedViews.tsx).
const SCAN_VIEW = "section.scan-views";
const STAGED_VIEW = "section.staged";

const LOADING = /(Opening|Loading|Getting|Making|Drawing|Preparing)[^\n]{0,48}…/;

export async function capture(opts: { baseURL: string; runDir: string; shots: Shot[]; claims?: unknown[]; log: (s: string) => void }): Promise<CaptureResult> {
  const result: CaptureResult = { shots: [], auto: [], log: [] };
  const say = (s: string) => {
    result.log.push(s);
    opts.log(s);
  };
  mkdirSync(join(opts.runDir, "shots"), { recursive: true });
  const images = await Images.open();
  try {
    const lanes: Lane[] = [];
    for (const s of opts.shots) if (!lanes.some((l) => l.browser === s.browser && l.viewport === s.viewport)) lanes.push({ browser: s.browser, viewport: s.viewport });
    for (const lane of lanes) {
      const shots = opts.shots.filter((s) => s.browser === lane.browser && s.viewport === lane.viewport);
      say(`— ${lane.browser} ${lane.viewport}: ${shots.length} shots`);
      await runLane(lane, shots, { ...opts, images, result, say });
    }
  } finally {
    await images.close();
  }
  return result;
}

type Ctx = { baseURL: string; runDir: string; claims?: unknown[]; images: Images; result: CaptureResult; say: (s: string) => void };

async function runLane(lane: Lane, shots: Shot[], ctx: Ctx) {
  const vp = VIEWPORTS[lane.viewport];
  const browser = await launch(lane.browser);
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    acceptDownloads: true,
    baseURL: ctx.baseURL,
    locale: "en-CA",
    timezoneId: "America/Toronto",
  });
  // tsx keeps function names with a __name() helper the page doesn't have.
  await context.addInitScript({ content: "window.__name = window.__name || ((f) => f);" });
  await context.addInitScript(installThreeHook);
  // A recorded take's workspace opens only on "the device that filmed it": its claim, as src/api.ts keeps it.
  if (ctx.claims?.length) {
    await context.addInitScript((claims) => {
      try {
        if (!localStorage.getItem("br-claims")) localStorage.setItem("br-claims", JSON.stringify(claims));
      } catch {
        // storage blocked: the workspace shows as a shared link
      }
    }, ctx.claims);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  const run = new LaneRun(lane, shots, page, context, ctx, errors);
  try {
    for (const scan of [...new Set(shots.map((s) => s.scan))]) await run.journey(scan);
    await run.marketing();
  } finally {
    await browser.close();
  }
}

class LaneRun {
  constructor(
    readonly lane: Lane,
    readonly shots: Shot[],
    readonly page: Page,
    readonly context: BrowserContext,
    readonly ctx: Ctx,
    readonly errors: string[],
  ) {}

  get dpr() {
    return VIEWPORTS[this.lane.viewport].deviceScaleFactor;
  }
  wants(screen: string, scan?: string) {
    return this.shots.filter((s) => s.screen === screen && (!scan || s.scan === scan));
  }
  one(screen: string, scan: string) {
    return this.wants(screen, scan)[0];
  }

  private auto(shot: { id: string; screen: string }, i: LintIssue | Omit<AutoFinding, "shot" | "screen">) {
    this.ctx.result.auto.push({ shot: shot.id, screen: shot.screen, rule: "rule" in i ? i.rule : "check", severity: i.severity, category: i.category, title: i.title, what: i.what, fix: i.fix, box: (i as AutoFinding).box });
  }

  // Errors since the last shot, attached to this one.
  private flushErrors(shot: { id: string; screen: string }) {
    const seen = new Set<string>();
    for (const e of this.errors.splice(0)) {
      const key = e.replace(/\d+/g, "#").slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      const pageError = e.startsWith("page error");
      this.auto(shot, { rule: pageError ? "page-error" : "console-error", severity: pageError ? "P1" : "P2", category: "correctness", title: pageError ? "The page threw an error" : "Console error", what: e, fix: "Find and fix the error; the homeowner may see a broken state." });
    }
  }

  private save(shot: Omit<Captured, "file" | "w" | "h" | "hash" | "dpr" | "notes"> & { notes?: string[]; dpr?: number }, png: Buffer) {
    const file = `shots/${shot.id}.png`;
    writeFileSync(join(this.ctx.runDir, file), png);
    const { w, h } = imageSize(png);
    const c: Captured = { ...shot, file, w, h, dpr: shot.dpr ?? this.dpr, hash: sha256(png), notes: shot.notes ?? [] };
    this.ctx.result.shots.push(c);
    return c;
  }

  private async settle(waitForLoading = true) {
    const p = this.page;
    await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await p.evaluate(() => document.fonts.ready.then(() => null)).catch(() => {});
    if (waitForLoading) await p.waitForFunction((re) => !new RegExp(re).test(document.body.innerText), LOADING.source, { timeout: 25_000 }).catch(() => {});
    await p.waitForTimeout(700);
  }

  // Scrolls to the bottom and back so lazy sections and reveal-on-scroll pieces are drawn.
  private async scrollThrough() {
    const p = this.page;
    const vh = VIEWPORTS[this.lane.viewport].height;
    const max = vh * MAX_SCREENS[this.lane.viewport];
    const total = Math.min(max, await p.evaluate(() => document.documentElement.scrollHeight));
    for (let y = 0; y < total; y += Math.round(vh * 0.7)) {
      await p.evaluate((y) => window.scrollTo(0, y), y);
      await p.waitForTimeout(220);
    }
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(500);
  }

  // A page shot: the whole page (to MAX_SCREENS tall), its free checks, its numbers.
  async pageShot(shot: Shot, opts: { full?: boolean; waitForLoading?: boolean; notes?: string[] } = {}) {
    const p = this.page;
    const full = opts.full ?? true;
    const notes = [...(opts.notes ?? [])];
    try {
      await this.settle(opts.waitForLoading ?? true);
      if (await p.evaluate((re) => new RegExp(re).test(document.body.innerText), LOADING.source)) notes.push("Still showing a loading line when shot.");
      if (full) await this.scrollThrough();
      const vp = VIEWPORTS[this.lane.viewport];
      const height = await p.evaluate(() => document.documentElement.scrollHeight);
      const cap = vp.height * MAX_SCREENS[this.lane.viewport];
      if (full && height > cap) notes.push(`Page is ${height}px tall; shot the top ${cap}px.`);
      const issues = await lint(p, this.lane.viewport === "phone");
      const numbers = await numbersOf(p);
      const png = full ? await p.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(height, cap) } }) : await p.screenshot();
      const c = this.save({ ...shot, url: p.url(), numbers, notes }, png);
      for (const i of issues) {
        const box = i.box ? { x: i.box.x * this.dpr, y: i.box.y * this.dpr, w: i.box.w * this.dpr, h: i.box.h * this.dpr } : undefined;
        if (box && box.y > c.h) continue; // below what was shot
        this.auto(shot, { ...i, box });
      }
      this.flushErrors(shot);
      if (shot.screen !== "home" && (await this.ctx.images.blankness(png)) > 0.97) this.auto(shot, { rule: "blank-page", severity: "P0", category: "correctness", title: "The page is blank", what: "Almost the whole shot is one colour.", fix: "Check for a crash or a stuck loading state." });
      this.ctx.say(`  ${shot.id}${notes.length ? `  (${notes.join(" ")})` : ""}`);
      return c;
    } catch (e) {
      return this.failed(shot, e);
    }
  }

  private async failed(shot: Shot, e: unknown) {
    const msg = (e as Error).message?.split("\n")[0] ?? String(e);
    this.ctx.say(`  ${shot.id}: FAILED ${msg}`);
    try {
      const png = await this.page.screenshot();
      this.save({ ...shot, url: this.page.url(), notes: [`Capture failed: ${msg}`] }, png);
    } catch {
      // the page itself is gone
    }
    this.auto(shot, { rule: "capture-failed", severity: "P0", category: "correctness", title: "This screen couldn't be reached", what: `The capture step failed: ${msg}`, fix: "Open the screen by hand and check it loads; the shot shows where it stopped." });
    this.flushErrors(shot);
    return null;
  }

  async goto(path: string) {
    await this.page.goto(path, { waitUntil: "load", timeout: 45_000 });
  }

  // ---- The journey for one scan ----
  async journey(scan: string) {
    const p = this.page;
    if (this.wants("home").length || this.wants("home-story").length) {
      await this.goto("/");
      const home = this.one("home", scan);
      if (home) await this.pageShot(home);
      if (this.wants("home-story").length) await this.story(scan);
    }

    const ws = ["wait", "workspace-plan", "workspace-ideas", "workspace-permit", "workspace-money", "workspace-build", "layout-3d", "scan-3d", "plan-overlay", "permit-pdf"];
    if (ws.some((s) => this.wants(s, scan).length)) await this.workspace(scan);

    // Every page with a route of its own under the scan, in plan order.
    for (const def of SCREENS.filter((d) => d.kind === "page" && d.route.startsWith("/scans/{scan}/"))) {
      const screen = def.id;
      const shot = this.one(screen, scan);
      const three = this.wants(`${screen}-3d`, scan);
      const pdf = screen === "book" ? this.one("book-pdf", scan) : undefined;
      if (!shot && !three.length && !pdf) continue;
      try {
        await this.goto(def.route.replace("{scan}", scan));
      } catch (e) {
        if (shot) await this.failed(shot, e);
        continue;
      }
      if (def.ifPresent && (await p.getByText("We couldn't find that page.").isVisible().catch(() => false))) {
        this.ctx.say(`  ${screen}: not on this build, skipped`);
        this.errors.splice(0);
        continue;
      }
      if (shot) await this.pageShot(shot);
      if (three.length) await this.cameras(three, scan);
      if (pdf) await this.download(pdf, "book", () => p.getByRole("button", { name: /Download the book/ }).click());
    }
  }

  // The example replays its wait screen first; a finished real scan opens straight on the workspace.
  async workspace(scan: string) {
    const p = this.page;
    const wait = this.one("wait", scan);
    try {
      await this.goto(`/scans/${scan}`);
      const tabs = p.getByRole("tablist", { name: "Workspace" });
      // The wait screen with its first question up, or after a few seconds of finding things.
      await p.locator(".live-ask, .live-ready, [role=tablist]").first().waitFor({ timeout: 20_000 }).catch(() => {});
      if (wait && !(await tabs.isVisible())) {
        await p.waitForTimeout(2500);
        await this.pageShot(wait, { full: false, waitForLoading: false });
      }
      const until = Date.now() + 150_000;
      while (!(await tabs.isVisible())) {
        if (Date.now() > until) throw new Error("the workspace didn't open within 150 s");
        // The one-flow build moves on from the wait screen to the plan step; ?tab= opens the workspace.
        if (!new URL(p.url()).pathname.endsWith(`/scans/${scan}`)) {
          await this.goto(`/scans/${scan}?tab=plan`);
          continue;
        }
        const go = p.getByRole("button", { name: /^(Skip and see my plan|See my plan)/ });
        if (await go.first().isVisible().catch(() => false)) await go.first().click().catch(() => {});
        await p.waitForTimeout(1000);
      }
    } catch (e) {
      const first = this.wants("workspace-plan", scan)[0] ?? wait;
      if (first) await this.failed(first, e);
      return;
    }

    const tab = async (name: string) => {
      await p.getByRole("tablist", { name: "Workspace" }).getByRole("tab", { name, exact: true }).click();
      await p.waitForTimeout(400);
      await this.fillProfile();
    };

    const plan = this.one("workspace-plan", scan);
    if (plan) await this.pageShot(plan);
    // Two 3D views on this tab: the starting layout in the room, and the scan as it really is.
    const layout3d = this.wants("layout-3d", scan);
    if (layout3d.length) {
      await this.show3d(STAGED_VIEW);
      await this.cameras(layout3d, scan, { within: STAGED_VIEW });
    }
    const scan3d = this.wants("scan-3d", scan);
    const overlay = this.one("plan-overlay", scan);
    if (scan3d.length || overlay) {
      await this.show3d(SCAN_VIEW);
      await p.waitForTimeout(3000); // the scan rises from the floor (src/three/RealScan.tsx REVEAL_S)
      if (scan3d.length) await this.cameras(scan3d, scan, { within: SCAN_VIEW });
      if (overlay) await this.overlay(overlay, scan);
    }
    for (const [screen, name] of [
      ["workspace-ideas", "Ideas"],
      ["workspace-permit", "Permit"],
      ["workspace-money", "Money"],
      ["workspace-build", "Build"],
    ] as const) {
      const shot = this.one(screen, scan);
      const pdf = screen === "workspace-permit" ? this.one("permit-pdf", scan) : undefined;
      if (!shot && !pdf) continue;
      try {
        await tab(name);
      } catch (e) {
        if (shot) await this.failed(shot, e);
        continue;
      }
      if (shot) await this.pageShot(shot);
      if (pdf) {
        await this.download(pdf, "review", () => p.getByRole("button", { name: /Download the review copy/ }).click());
        const submit = p.getByRole("button", { name: /Download the submit copy/ });
        if (await submit.isVisible().catch(() => false)) await this.download(pdf, "submit", () => submit.click());
      }
    }
  }

  // Permit, Money and Build ask who owns the house once.
  async fillProfile() {
    const form = this.page.locator("form.ws-profile");
    if (!(await form.isVisible().catch(() => false))) return;
    await form.getByLabel("First name").first().fill(OWNER.first);
    await form.getByLabel("Last name").first().fill(OWNER.last);
    await form.getByLabel("Phone").fill(OWNER.phone);
    await form.getByLabel("Email").fill(OWNER.email);
    await form.getByLabel("Postal code").fill(OWNER.postal);
    await form.getByRole("button", { name: "Save" }).click();
    await form.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  }

  // Picks the 3D side of a section's 3D / Plan switch.
  async show3d(section: string) {
    const p = this.page;
    const sec = p.locator(section).first();
    await sec.scrollIntoViewIfNeeded().catch(() => {});
    const tab = sec.getByRole("tablist", { name: "View" }).getByRole("tab", { name: /3D/ });
    if (await tab.first().isVisible().catch(() => false)) await tab.first().click().catch(() => {});
    await p.waitForTimeout(500);
  }

  // A PDF the page downloads, one shot per page.
  async download(shot: Shot, doc: string, click: () => Promise<unknown>) {
    const p = this.page;
    try {
      const got = p.waitForEvent("download", { timeout: 120_000 });
      await click();
      const d: Download = await got;
      const dir = join(this.ctx.runDir, "pdf");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${shot.screen}-${doc}.pdf`);
      await d.saveAs(file);
      const pages = await renderPdf(new Uint8Array(readFileSync(file)), join(dir, "pages"), `${shot.screen}-${doc}`);
      for (const pg of pages) {
        const png = readFileSync(pg.file);
        const id = `${shot.screen}${shot.scan === "sample" ? "" : `@${shot.scan}`}.${doc}.p${String(pg.page).padStart(2, "0")}`;
        const saved = this.save({ ...shot, id, url: d.suggestedFilename(), page: pg.page, doc, numbers: pg.text.split("\n").filter((l) => /\d/.test(l)).slice(0, 120), dpr: 1 }, png);
        for (const i of lintText(pg.text)) this.auto(saved, i);
      }
      this.ctx.say(`  ${shot.screen} ${doc}: ${pages.length} pages`);
    } catch (e) {
      await this.failed({ ...shot, id: `${shot.id}.${doc}` }, e);
    }
  }

  // ---- 3D ----

  // The confirmed plan's extent and ceiling, when the scan has one: cameras frame the basement with it.
  private async planOf(scan: string): Promise<{ existing: any } | null> {
    return this.page
      .evaluate(async (scan) => {
        const r = await fetch(`/api/scans/${scan}/model`);
        if (!r.ok) return null;
        const j = await r.json();
        return j?.model?.existing ? { existing: j.model.existing } : null;
      }, scan)
      .catch(() => null);
  }

  private planBox(existing: any): { minX: number; maxX: number; minZ: number; maxZ: number; ceiling: number } | null {
    const pts: number[][] = [...(existing.walls ?? []).flatMap((w: any) => [w.a, w.b]), ...(existing.rooms ?? []).flatMap((r: any) => r.polygon ?? [])].filter((p) => Array.isArray(p) && p.length >= 2);
    if (!pts.length) return null;
    return {
      minX: Math.min(...pts.map((p) => p[0])),
      maxX: Math.max(...pts.map((p) => p[0])),
      minZ: Math.min(...pts.map((p) => p[1])),
      maxZ: Math.max(...pts.map((p) => p[1])),
      ceiling: Number(existing.ceilingM) || 2.4,
    };
  }

  // Brings the 3D view (inside `within` when given) to the middle of the screen and hides sticky bars
  // that cover it (showBars() puts them back). Returns the visible part of it: the clip to shoot.
  private async focusCanvas(within?: string): Promise<CanvasRef | null> {
    const p = this.page;
    if (within) {
      await p.locator(within).first().scrollIntoViewIfNeeded().catch(() => {});
      await p.waitForFunction((w) => !!document.querySelector(w)?.querySelector("canvas"), within, { timeout: 20_000 }).catch(() => {});
      await p.waitForTimeout(800);
    }
    const c = await mainCanvas(p, within);
    if (!c) return null;
    if (c.hidden) return c;
    await p.evaluate((i) => {
      const el = (window as any).__qa3d.renderers[i].domElement as HTMLCanvasElement;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const holder = el.parentElement?.parentElement ?? el;
      for (const e of document.querySelectorAll<HTMLElement>("body *")) {
        const s = getComputedStyle(e);
        if (s.position !== "fixed" && s.position !== "sticky") continue;
        if (holder.contains(e) || e.contains(el)) continue;
        const b = e.getBoundingClientRect();
        if (b.bottom > r.top && b.top < r.bottom && b.right > r.left && b.left < r.right) {
          e.dataset.qaHidden = e.style.visibility || "-";
          e.style.visibility = "hidden";
        }
      }
    }, c.index);
    await p.waitForTimeout(600);
    const again = await mainCanvas(p, within);
    if (!again) return null;
    const vp = VIEWPORTS[this.lane.viewport];
    const x = Math.max(0, again.box.x);
    const y = Math.max(0, again.box.y);
    return { index: again.index, hidden: false, box: { x, y, width: Math.min(again.box.x + again.box.width, vp.width) - x, height: Math.max(1, Math.min(again.box.y + again.box.height, vp.height) - y) } };
  }

  private async showBars() {
    await this.page
      .evaluate(() => {
        for (const e of document.querySelectorAll<HTMLElement>("[data-qa-hidden]")) {
          e.style.visibility = e.dataset.qaHidden === "-" ? "" : e.dataset.qaHidden!;
          delete e.dataset.qaHidden;
        }
      })
      .catch(() => {});
  }

  private bounds(sb: Bounds | null, plan: ReturnType<LaneRun["planBox"]>): { min: number[]; max: number[] } | null {
    if (plan && sb) {
      const floor = sb.min[1];
      return { min: [plan.minX, floor, plan.minZ], max: [plan.maxX, Math.min(sb.max[1], floor + plan.ceiling + 0.2), plan.maxZ] };
    }
    if (plan) return { min: [plan.minX, 0, plan.minZ], max: [plan.maxX, plan.ceiling, plan.maxZ] };
    return sb;
  }

  async cameras(shots: Shot[], scan: string, opts: { usePlan?: boolean; within?: string } = {}) {
    const usePlan = opts.usePlan ?? true;
    const p = this.page;
    const camShots = shots.filter((s) => s.camera);
    if (!camShots.length) return;
    try {
      await this.settle();
      const c = await this.focusCanvas(opts.within);
      if (!c) throw new Error(`no 3D view on the page${opts.within ? ` inside ${opts.within}` : ""}`);
      const plan = usePlan ? await this.planOf(scan) : null;
      const sb = await sceneBounds(p, c.index);
      const b = this.bounds(sb, plan ? this.planBox(plan.existing) : null);
      if (!b) throw new Error("the 3D scene is empty");
      const frame = async (pose: Pose): Promise<Buffer> => {
        if (c.hidden) {
          // The page's own off-screen render canvas: draw the frame and read it back.
          const got = await grab(p, c.index, pose);
          if (!got) throw new Error("the off-screen 3D canvas has nothing to draw");
          return got;
        }
        await setPose(p, c.index, pose);
        await p.waitForTimeout(500);
        return p.screenshot({ clip: { x: c.box.x, y: c.box.y, width: c.box.width, height: c.box.height } });
      };
      for (const shot of camShots) {
        let png: Buffer;
        const extra: string[] = [];
        if (shot.camera === "eye") {
          // Several places to stand; keep the one that sees the most.
          let best: { png: Buffer; blank: number; i: number } | null = null;
          const tries = eyeCandidates(b);
          for (let i = 0; i < tries.length; i++) {
            const got = await frame(tries[i]);
            const blank = await this.ctx.images.blankness(got);
            if (!best || blank < best.blank) best = { png: got, blank, i };
          }
          png = best!.png;
          extra.push(`Eye level: the clearest of ${tries.length} places to stand (#${best!.i + 1}).`);
        } else {
          png = await frame(cameraPose(shot.camera as Camera, b, c.box.width / c.box.height));
        }
        const saved = this.save({ ...shot, url: p.url(), dpr: c.hidden ? 1 : undefined, notes: [...(c.hidden ? ["Drawn from the page's hidden render canvas (no HTML labels)."] : []), ...extra, `Scene bounds x ${b.min[0].toFixed(2)}…${b.max[0].toFixed(2)}, y ${b.min[1].toFixed(2)}…${b.max[1].toFixed(2)}, z ${b.min[2].toFixed(2)}…${b.max[2].toFixed(2)} m`] }, png);
        if ((await this.ctx.images.blankness(png)) > 0.985) this.auto(saved, { rule: "blank-3d", severity: "P0", category: "correctness", title: "The 3D view is blank", what: `From the ${shot.camera} camera the canvas is one flat colour.`, fix: "Check the scene loads in this browser and the model isn't hidden or off-camera." });
        this.flushErrors(saved);
        this.ctx.say(`  ${shot.id}`);
      }
      if (!c.hidden) await setPose(p, c.index, null);
      await this.showBars();
    } catch (e) {
      await this.showBars();
      for (const shot of camShots) await this.failed(shot, e);
    }
  }

  // The home page's scroll story, step by step (as scripts/landing-stills.ts), then its fixed cameras.
  async story(scan: string) {
    const p = this.page;
    const shots = this.wants("home-story", scan);
    const steps = shots.filter((s) => s.step);
    try {
      await this.goto("/");
      await p.waitForSelector(".lp-stage canvas", { timeout: 60_000 }).catch(() => {});
      await p.waitForSelector(".lp-poster[data-hidden]", { timeout: 60_000 }).catch(() => {});
      for (const shot of steps) {
        await p.evaluate(
          ({ t, n }) => {
            const s = document.querySelector<HTMLElement>(".lp-story");
            if (!s) return;
            const top = s.getBoundingClientRect().top + scrollY;
            scrollTo(0, top + ((s.offsetHeight - innerHeight) * t) / n);
          },
          { t: shot.step!, n: STORY_STEPS.length },
        );
        await p.waitForTimeout(shot.step === STORY_STEPS.length ? 8000 : 3500);
        const png = await p.screenshot();
        const saved = this.save({ ...shot, url: p.url(), notes: [`Scroll step ${shot.step} of ${STORY_STEPS.length}`] }, png);
        this.flushErrors(saved);
        this.ctx.say(`  ${shot.id}`);
      }
    } catch (e) {
      for (const shot of steps) await this.failed(shot, e);
    }
    await this.cameras(shots, scan, { usePlan: false, within: ".lp-stage" });
  }

  // The plan's walls, openings and fixtures drawn over the scan seen from straight above.
  async overlay(shot: Shot, scan: string) {
    const p = this.page;
    try {
      const plan = await this.planOf(scan);
      if (!plan) throw new Error("the scan has no plan model");
      const box = this.planBox(plan.existing);
      if (!box) throw new Error("the plan has no walls");
      const c = await this.focusCanvas(SCAN_VIEW);
      if (!c) throw new Error("no 3D view of the scan");
      const sb = await sceneBounds(p, c.index);
      const floor = sb ? sb.min[1] : 0;
      const cut = floor + Math.min(1.2, box.ceiling * 0.55);
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const fov = 10;
      const aspect = c.box.width / c.box.height;
      const span = Math.max(box.maxZ - box.minZ, (box.maxX - box.minX) / aspect) * 1.18;
      const dist = span / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
      await setPose(p, c.index, { position: [cx, floor + dist, cz + 0.0001], target: [cx, floor, cz], up: [0, 0, -1], fov, near: Math.max(0.1, dist - 20), far: dist + 20, cut });
      await p.waitForTimeout(600);

      const e = plan.existing;
      const walls: { a: number[]; b: number[]; t: number; id: string }[] = (e.walls ?? []).map((w: any) => ({ a: w.a, b: w.b, t: Number(w.thicknessM) || 0.15, id: w.id }));
      const at = (w: { a: number[]; b: number[] }, off: number) => {
        const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
        return [w.a[0] + ((w.b[0] - w.a[0]) * off) / len, w.a[1] + ((w.b[1] - w.a[1]) * off) / len];
      };
      const openings = (e.openings ?? []).flatMap((o: any) => {
        const w = walls.find((x) => x.id === o.wallId);
        if (!w) return [];
        const s = Number(o.offsetM) || 0;
        const ww = Number(o.widthM) || 0.8;
        return [{ kind: String(o.kind), a: at(w, s), b: at(w, s + ww) }];
      });
      const fixtures = (e.fixtures ?? []).map((f: any) => {
        const [x, z] = f.at;
        const [sx, sz] = f.sizeM ?? [0.5, 0.5];
        return { kind: String(f.kind), pts: [[x - sx / 2, z - sz / 2], [x + sx / 2, z - sz / 2], [x + sx / 2, z + sz / 2], [x - sx / 2, z + sz / 2]] };
      });
      const flat = [
        ...walls.flatMap((w) => [w.a, w.b]),
        ...openings.flatMap((o: any) => [o.a, o.b]),
        ...fixtures.flatMap((f: any) => f.pts),
        [cx, cz],
        [cx + 1, cz],
      ];
      const px = await project(p, c.index, flat.map(([x, z]) => [x, cut, z]));
      const metre = px[px.length - 1] && px[px.length - 2] ? Math.hypot(px[px.length - 1]![0] - px[px.length - 2]![0], px[px.length - 1]![1] - px[px.length - 2]![1]) : 40;
      let k = 0;
      const take = (n: number) => px.slice(k, (k += n));
      const svgWalls = walls.map((w) => ({ pts: take(2), t: w.t }));
      const svgOpen = openings.map((o: any) => ({ kind: o.kind, pts: take(2) }));
      const svgFix = fixtures.map((f: any) => ({ kind: f.kind, pts: take(4) }));
      await p.evaluate(
        ({ walls, open, fix, metre, box }) => {
          const ns = "http://www.w3.org/2000/svg";
          const svg = document.createElementNS(ns, "svg");
          svg.id = "qa-overlay";
          svg.setAttribute("style", "position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647");
          const line = (a: number[], b: number[], stroke: string, width: number, opacity = 1, dash = "") => {
            const l = document.createElementNS(ns, "line");
            l.setAttribute("x1", String(a[0]));
            l.setAttribute("y1", String(a[1]));
            l.setAttribute("x2", String(b[0]));
            l.setAttribute("y2", String(b[1]));
            l.setAttribute("stroke", stroke);
            l.setAttribute("stroke-width", String(width));
            l.setAttribute("stroke-opacity", String(opacity));
            l.setAttribute("stroke-linecap", "butt");
            if (dash) l.setAttribute("stroke-dasharray", dash);
            svg.appendChild(l);
          };
          for (const w of walls) if (w.pts[0] && w.pts[1]) {
            line(w.pts[0], w.pts[1], "#ff00d4", Math.max(3, w.t * metre), 0.35);
            line(w.pts[0], w.pts[1], "#ff00d4", 2);
          }
          for (const o of open) if (o.pts[0] && o.pts[1]) line(o.pts[0], o.pts[1], o.kind === "window" ? "#2F6FDB" : "#0F8B8D", 7);
          for (const f of fix) {
            const pts = f.pts.filter(Boolean);
            if (pts.length < 4) continue;
            for (let i = 0; i < 4; i++) line(pts[i], pts[(i + 1) % 4], "#ffd400", 2, 1, "6 4");
            const t = document.createElementNS(ns, "text");
            t.setAttribute("x", String(pts[0][0] + 4));
            t.setAttribute("y", String(pts[0][1] + 14));
            t.setAttribute("fill", "#ffd400");
            t.setAttribute("font", "600 12px sans-serif");
            t.setAttribute("paint-order", "stroke");
            t.setAttribute("stroke", "#000");
            t.setAttribute("stroke-width", "3");
            t.textContent = f.kind;
            svg.appendChild(t);
          }
          // Legend and a 1 m bar, inside the canvas's top-left corner.
          const g = document.createElementNS(ns, "g");
          g.setAttribute("transform", `translate(${box.x + 12},${box.y + 12})`);
          g.innerHTML = `<rect width="230" height="96" fill="#000" fill-opacity="0.65" rx="4"/>
            <line x1="10" y1="18" x2="40" y2="18" stroke="#ff00d4" stroke-width="3"/><text x="48" y="22" fill="#fff" font-size="12" font-family="sans-serif">plan walls (band = thickness)</text>
            <line x1="10" y1="38" x2="40" y2="38" stroke="#2F6FDB" stroke-width="7"/><text x="48" y="42" fill="#fff" font-size="12" font-family="sans-serif">window</text>
            <line x1="110" y1="38" x2="140" y2="38" stroke="#0F8B8D" stroke-width="7"/><text x="148" y="42" fill="#fff" font-size="12" font-family="sans-serif">door</text>
            <line x1="10" y1="58" x2="40" y2="58" stroke="#ffd400" stroke-width="2" stroke-dasharray="6 4"/><text x="48" y="62" fill="#fff" font-size="12" font-family="sans-serif">stairs, ducts (plan)</text>
            <line x1="10" y1="80" x2="${10 + metre}" y2="80" stroke="#fff" stroke-width="3"/><text x="${16 + metre}" y="84" fill="#fff" font-size="12" font-family="sans-serif">1 m</text>`;
          svg.appendChild(g);
          document.body.appendChild(svg);
        },
        { walls: svgWalls, open: svgOpen, fix: svgFix, metre, box: c.box },
      );
      await p.waitForTimeout(150);
      const png = await p.screenshot({ clip: { x: c.box.x, y: c.box.y, width: c.box.width, height: c.box.height } });
      await p.evaluate(() => document.getElementById("qa-overlay")?.remove());
      await setPose(p, c.index, null);
      await this.showBars();
      const saved = this.save({ ...shot, url: p.url(), notes: [`Cut at ${(cut - floor).toFixed(2)} m above the scan floor (y ${floor.toFixed(2)}). ${walls.length} walls, ${openings.length} openings, ${fixtures.length} fixtures.`] }, png);
      this.flushErrors(saved);
      this.ctx.say(`  ${shot.id}`);
    } catch (e) {
      await p.evaluate(() => document.getElementById("qa-overlay")?.remove()).catch(() => {});
      await this.showBars();
      await this.failed(shot, e);
    }
  }

  async marketing() {
    for (const shot of this.shots.filter((s) => s.group === "marketing")) {
      try {
        await this.goto(shot.route);
      } catch (e) {
        await this.failed(shot, e);
        continue;
      }
      await this.pageShot(shot);
    }
  }
}
