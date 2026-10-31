// The workspace, the flow's last step (src/screens/Workspace.tsx): five tabs, one page object each. The
// steps before it (the plan check, the layouts, the studio, the pictures) are in Flow.ts.
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expect } from "../support/fixtures";
import { readPdf } from "../support/pdf";

export type TabName = "Your book" | "The answer" | "Permit" | "Money" | "Build";

export class Workspace {
  constructor(readonly page: Page) {}

  get tabs() {
    return this.page.getByRole("tablist", { name: "Workspace" });
  }

  async expectOpen() {
    await expect(this.tabs).toBeVisible({ timeout: 30_000 });
    await expect(this.tabs.getByRole("tab")).toHaveText(["Your book", "The answer", "Permit", "Money", "Build"]);
  }

  async open(tab: TabName) {
    await this.tabs.getByRole("tab", { name: tab, exact: true }).click();
    await expect(this.tabs.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
  }

  book() {
    return new BookTab(this.page);
  }
  answer() {
    return new AnswerTab(this.page);
  }
  permit() {
    return new PermitTab(this.page);
  }
  money() {
    return new MoneyTab(this.page);
  }
  build() {
    return new BuildTab(this.page);
  }

  // Permit, Money and Build ask who owns the house once; it's saved for every tab after.
  async fillProfileIfAsked(owner = { first: "Test", last: "Owner", phone: "519-555-0100", email: "owner@example.com", postal: "N2L 3G1" }) {
    const form = this.page.locator("form.ws-profile");
    if (!(await form.isVisible().catch(() => false))) return false;
    await form.getByLabel("First name").first().fill(owner.first);
    await form.getByLabel("Last name").first().fill(owner.last);
    await form.getByLabel("Phone").fill(owner.phone);
    await form.getByLabel("Email").fill(owner.email);
    await form.getByLabel("Postal code").fill(owner.postal);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    return true;
  }
}

// The book: the design they made, its pictures, the quote, the timeline.
export class BookTab {
  constructor(readonly page: Page) {}

  get cover() {
    return this.page.locator(".book-cover");
  }

  async expectOpen() {
    await expect(this.cover).toBeVisible({ timeout: 60_000 });
  }

  // "The design", "Hired out", "Built yourself", "Permit": what the cover says.
  async facts() {
    const rows = this.cover.locator(".book-facts > div");
    const out: Record<string, string> = {};
    for (const row of await rows.all()) out[((await row.locator("dt").textContent()) ?? "").trim()] = ((await row.locator("dd").textContent()) ?? "").trim();
    return out;
  }

  // The quote's building-permit line: its amount and how it's counted ("342 sq ft. $392 for the new
  // unit plus $0.62 per sq ft of the suite (31.8 m² (342 sq ft)).").
  async permitLine() {
    const line = this.page.locator(".book-quote li").filter({ has: this.page.locator("strong", { hasText: /^Building permit$/ }) });
    return { amount: ((await line.locator(".mono").first().textContent()) ?? "").trim(), basis: ((await line.locator("p").first().textContent()) ?? "").trim() };
  }
}

// The answer: the decision, what has to change, the scan in 3D and its floor plan.
export class AnswerTab {
  constructor(readonly page: Page) {}

  get verdict() {
    return this.page.locator("h1.verdict-line");
  }

  async expectVerdict(headline: string | RegExp) {
    await expect(this.verdict).toHaveText(headline);
  }

  // The whole-basement floor plan: its label ("Floor plan of the basement, 2 rooms, 41.7 m²") and every
  // word and size drawn on it (room names, overall dimensions).
  async floorPlan() {
    // The plan tab has more than one View switch; this one is the scan's.
    const scanned = this.page.locator("section").filter({ has: this.scanned });
    await scanned.getByRole("tablist", { name: "View" }).getByRole("tab", { name: "Plan" }).click();
    const svg = scanned.locator("svg.plan").first();
    await expect(svg).toBeVisible();
    return { label: (await svg.getAttribute("aria-label")) ?? "", texts: (await svg.locator("text").allTextContents()).map((t) => t.trim()).filter(Boolean) };
  }

  get scanned() {
    return this.page.getByRole("heading", { name: "Your basement, scanned" });
  }
}

export class PermitTab {
  constructor(readonly page: Page) {}

  // "Your permit set" until its readiness loads, then "3 things left before you can submit" or "Ready to submit".
  get heading() {
    return this.page.getByRole("heading", { level: 2, name: /^(Your permit set|\d+ things? left before you can submit|Ready to submit)$/ });
  }

  // The same heading, by the name the flow's journeys use.
  get count() {
    return this.heading;
  }

  async expectOpen() {
    await expect(this.heading).toBeVisible({ timeout: 30_000 });
  }

  // How many things are left before the clean submit copy: 0 when it's ready.
  async left(): Promise<number> {
    await expect(this.heading).not.toHaveText("Your permit set", { timeout: 30_000 });
    const text = (await this.heading.textContent()) ?? "";
    return /^Ready/.test(text) ? 0 : Number(/^(\d+)/.exec(text)?.[1]);
  }

  // Downloads the review copy (always offered; the submit copy comes when nothing is left) and opens it:
  // page count, each sheet's number and the sheet list from the title blocks.
  async downloadPackage(saveAs: string, copy: "review" | "submit" = "review") {
    const download = this.page.waitForEvent("download", { timeout: 120_000 });
    await this.page.getByRole("button", { name: copy === "submit" ? "Download the submit copy" : "Download the review copy" }).click();
    // A refusal shows as an alert; fail on it rather than wait out the download.
    let downloaded = false;
    void download.then(() => (downloaded = true), () => {});
    const refused = this.page.getByRole("alert").filter({ hasText: /./ }).first();
    const refusal = refused.waitFor({ timeout: 120_000 }).then(
      async (): Promise<never> => {
        if (downloaded) return new Promise<never>(() => {});
        throw new Error(`The package didn't download: ${await refused.textContent()}`);
      },
      () => new Promise<never>(() => {}),
    );
    const file = await Promise.race([download, refusal]);
    await file.saveAs(saveAs);
    expect(file.suggestedFilename()).toMatch(/\.pdf$/);
    return { file: saveAs, name: file.suggestedFilename(), ...(await readPdf(new Uint8Array(readFileSync(saveAs)))) };
  }
}

// What every permit set must hold, whatever its sheets are called: at least eight drawings, a cover
// first, and a page for every sheet the title blocks list (and nothing unlisted). A plan too big for
// one sheet runs over "A2.1", "A2.2": both count as A2.
export function expectSheets(pdf: Awaited<ReturnType<PermitTab["downloadPackage"]>>) {
  const numbers = Object.keys(pdf.index);
  expect(numbers.length, `sheets listed: ${JSON.stringify(pdf.index)}`).toBeGreaterThanOrEqual(8);
  expect(pdf.index.A0).toMatch(/^Cover/);
  expect([...new Set(pdf.sheets.map((x) => x.number.split(".")[0]))]).toEqual(numbers);
  expect(pdf.pageCount).toBeGreaterThanOrEqual(numbers.length);
}

export class MoneyTab {
  constructor(readonly page: Page) {}

  async expectOpen() {
    await expect(this.page.getByRole("heading", { name: "Money you can get" })).toBeVisible({ timeout: 30_000 });
  }

  // How to apply's permit step: "You or your designer · about 15 business days · $604" and its note
  // ("$392 per new home + $0.62 per sq ft, for about 342 sq ft").
  async permitStep() {
    const step = this.page.locator('.plan-steps li[data-step="permit"]');
    await expect(step).toBeVisible();
    return { meta: ((await step.locator(".timeline-meta").textContent()) ?? "").trim(), note: ((await step.locator(".timeline-cost").textContent()) ?? "").trim() };
  }
}

export class BuildTab {
  constructor(readonly page: Page) {}

  async expectOpen() {
    await expect(this.page.getByRole("heading", { name: "Who builds it?" })).toBeVisible({ timeout: 30_000 });
  }
}
