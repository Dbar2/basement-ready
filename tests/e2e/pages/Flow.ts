// The flow after the upload (src/flow/flow.ts): the steps across the top, one way on and a way back at
// the bottom, and a page object for each step between the wait screen and the workspace.
import type { Page } from "@playwright/test";
import { expect } from "../support/fixtures";

export class Flow {
  constructor(readonly page: Page) {}

  get steps() {
    return this.page.getByRole("navigation", { name: "Steps" });
  }
  get forward() {
    return this.page.locator(".flow-foot .btn-primary");
  }
  get back() {
    return this.page.locator(".flow-foot .flow-back");
  }

  // The step it's on, by its number and name ("Step 3: Pick a layout").
  async expectStep(n: number, name: string | RegExp) {
    await expect(this.steps.locator("[aria-current=step]")).toHaveAttribute("aria-label", typeof name === "string" ? `Step ${n}: ${name}` : new RegExp(`^Step ${n}: ${name.source}`));
  }

  plan() {
    return new PlanStep(this.page);
  }
  layouts() {
    return new LayoutsStep(this.page);
  }
  studio() {
    return new StudioStep(this.page);
  }
  pictures() {
    return new PicturesStep(this.page);
  }
}

// 2. "Is this your basement?": the measured plan, to fix and confirm.
export class PlanStep {
  constructor(readonly page: Page) {}

  get drawingSvg() {
    return this.page.locator(".plan-stage svg").first();
  }

  async expectOpen() {
    await expect(this.page).toHaveURL(/\/plan$/, { timeout: 30_000 });
    await expect(this.page.getByRole("heading", { name: "Is this your basement?" })).toBeVisible({ timeout: 30_000 });
    await expect(this.drawingSvg).toBeVisible({ timeout: 30_000 });
  }

  // Its label ("Your basement's plan, 41.7 m²…") and every word and size drawn on it.
  async drawing() {
    return { label: (await this.drawingSvg.getAttribute("aria-label")) ?? "", texts: (await this.drawingSvg.locator("text").allTextContents()).map((t) => t.trim()).filter(Boolean) };
  }

  // A photo take asks for one tape number on its longest wall.
  async tapeIfAsked(metres: string) {
    const card = this.page.locator(".tape-ask");
    if (!(await card.isVisible().catch(() => false))) return false;
    await card.getByRole("textbox").fill(metres);
    await card.getByRole("button", { name: "Scale everything to it" }).click();
    await expect(card).toBeHidden();
    return true;
  }

  async confirm() {
    await this.page.locator(".flow-foot").getByRole("button", { name: "Yes, this is my basement" }).click();
    await expect(this.page).toHaveURL(/\/layouts$/, { timeout: 60_000 });
  }
}

// 3. "Pick a layout": the designs on their plan, each with a picture, its checks and its price; the
// decision beside them.
export class LayoutsStep {
  constructor(readonly page: Page) {}

  get cards() {
    return this.page.locator(".layout-card");
  }
  get decision() {
    return this.page.getByRole("complementary", { name: "Your answer" });
  }

  async expectOpen() {
    await expect(this.page.getByRole("heading", { name: "Pick a layout" })).toBeVisible({ timeout: 30_000 });
    await expect(this.cards.first()).toBeVisible({ timeout: 30_000 });
  }

  // Every card's picture once it's drawn: the layout in 3D in the basement as built.
  async pictures(timeout = 120_000) {
    await expect.poll(async () => (await this.cards.count()) > 0 && (await this.cards.locator(".layout-pic[data-ready]").count()) === (await this.cards.count()), { timeout }).toBe(true);
    return (await this.cards.locator(".layout-corner figcaption").allTextContents()).map((t) => t.trim());
  }

  async names() {
    return (await this.cards.locator("h3").allTextContents()).map((t) => t.trim());
  }

  async pick(name: string) {
    await this.cards.filter({ has: this.page.getByRole("heading", { name, exact: true }) }).locator(".layout-hit").click();
    await expect(this.page.locator(".layout-card[data-chosen] h3")).toHaveText(name);
  }

  async designIt() {
    await this.page.locator(".flow-foot .btn-primary").click();
    await expect(this.page).toHaveURL(/\/studio$/, { timeout: 30_000 });
  }
}

// 4. The studio: the chosen design in 3D, its checks and its quote.
export class StudioStep {
  constructor(readonly page: Page) {}

  get cost() {
    return this.page.locator(".status-chip", { hasText: "hired out" });
  }
  get checks() {
    return this.page.locator(".status-chip", { hasText: "checks" });
  }

  async expectOpen() {
    await expect(this.page.getByRole("heading", { name: "Your basement, designed" })).toBeVisible({ timeout: 30_000 });
    await expect(this.page.locator(".studio-3d canvas").first()).toBeVisible({ timeout: 60_000 });
    await expect(this.cost).toBeVisible({ timeout: 30_000 });
  }

  async chosen() {
    return ((await this.page.getByRole("radiogroup", { name: "Design" }).getByRole("radio", { checked: true }).textContent()) ?? "").trim();
  }

  async toPictures() {
    await this.page.locator(".flow-foot").getByRole("link", { name: /See it in pictures/ }).click();
    await expect(this.page).toHaveURL(/\/pictures$/, { timeout: 30_000 });
  }
}

// 5. Pictures of the design from the best real angles, every one labelled virtually staged.
export class PicturesStep {
  constructor(readonly page: Page) {}

  get cards() {
    return this.page.locator(".views-card");
  }

  async expectOpen(timeout = 120_000) {
    await expect(this.cards.first()).toBeVisible({ timeout: 60_000 });
    await expect(this.page.locator(".views")).not.toContainText(/Drawing the design|Updating every angle/, { timeout });
  }

  async labels() {
    return (await this.cards.locator(".views-label").allTextContents()).map((t) => t.trim());
  }

  async toBook() {
    await this.page.locator(".flow-foot").getByRole("link", { name: /Your book/ }).click();
    await expect(this.page).toHaveURL(/\?tab=book$/, { timeout: 30_000 });
  }
}
