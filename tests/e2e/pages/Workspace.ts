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
    await this.page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: "Plan" }).click();
    const svg = this.page.locator("svg.plan").first();
    await expect(svg).toBeVisible();
    return { label: (await svg.getAttribute("aria-label")) ?? "", texts: (await svg.locator("text").allTextContents()).map((t) => t.trim()).filter(Boolean) };
  }

  get scanned() {
    return this.page.getByRole("heading", { name: "Your basement, scanned" });
  }
}

export class PermitTab {
  constructor(readonly page: Page) {}

  // Its readiness count: "14 things left before you can submit", or "Ready to submit".
  get count() {
    return this.page.getByRole("heading", { name: /things? left before you can submit|Ready to submit/ });
  }

  async expectOpen() {
    await expect(this.count).toBeVisible({ timeout: 30_000 });
  }

  async left() {
    const text = (await this.count.textContent()) ?? "";
    return /Ready to submit/.test(text) ? 0 : Number(/(\d+)/.exec(text)?.[1] ?? NaN);
  }

  // Downloads the review copy and opens it: page count, sheet numbers and the sheet list.
  async downloadPackage(saveAs: string) {
    const download = this.page.waitForEvent("download", { timeout: 120_000 });
    await this.page.getByRole("button", { name: "Download the review copy" }).click();
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

export class MoneyTab {
  constructor(readonly page: Page) {}

  async expectOpen() {
    await expect(this.page.getByRole("heading", { name: "Money you can get" })).toBeVisible({ timeout: 30_000 });
  }
}

export class BuildTab {
  constructor(readonly page: Page) {}

  async expectOpen() {
    await expect(this.page.getByRole("heading", { name: "Who builds it?" })).toBeVisible({ timeout: 30_000 });
  }
}
