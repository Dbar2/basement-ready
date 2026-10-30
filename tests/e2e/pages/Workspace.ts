// The workspace once the answer is in: five tabs, one page object each. A new journey piece (the swipe
// deck, the plan confirm, the layout picker, the studio, the pictures, the quote, permit readiness,
// booking) gets its own class here or in its own file, and a step in the journeys (see README.md).
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expect } from "../support/fixtures";
import { readPdf } from "../support/pdf";

export type TabName = "Your plan" | "Ideas" | "Permit" | "Money" | "Build";

export class Workspace {
  constructor(readonly page: Page) {}

  get tabs() {
    return this.page.getByRole("tablist", { name: "Workspace" });
  }

  async expectOpen() {
    await expect(this.tabs).toBeVisible({ timeout: 30_000 });
    await expect(this.tabs.getByRole("tab")).toHaveText(["Your plan", "Ideas", "Permit", "Money", "Build"]);
  }

  async open(tab: TabName) {
    await this.tabs.getByRole("tab", { name: tab, exact: true }).click();
    await expect(this.tabs.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
  }

  plan() {
    return new PlanTab(this.page);
  }
  ideas() {
    return new IdeasTab(this.page);
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

export class PlanTab {
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

export class IdeasTab {
  constructor(readonly page: Page) {}

  async expectOpen() {
    await expect(this.page.getByRole("heading", { name: "Make it yours" })).toBeVisible();
  }

  // The finished-basement photos (virtually staged).
  photos() {
    return this.page.locator("main img[alt*='staged' i], main img[alt*='virtually' i]");
  }
}

export class PermitTab {
  constructor(readonly page: Page) {}

  async expectOpen() {
    await expect(this.page.getByRole("heading", { name: "Your permit package" })).toBeVisible({ timeout: 30_000 });
  }

  // Downloads the package and opens it: page count, sheet numbers and the sheet list.
  async downloadPackage(saveAs: string) {
    const download = this.page.waitForEvent("download", { timeout: 120_000 });
    await this.page.getByRole("button", { name: "Download permit package" }).click();
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
