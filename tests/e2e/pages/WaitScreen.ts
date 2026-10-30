// The wait screen: stages, finds, the basement assembling in 3D, the photos and the questions.
import type { Page } from "@playwright/test";
import { expect } from "../support/fixtures";

// How a journey answers the wait screen's questions: by question id, the option label (or the words)
// to give; anything not listed gets its first option.
export type WaitAnswers = Record<string, string>;

export class WaitScreen {
  constructor(readonly page: Page) {}

  get stages() {
    return this.page.getByRole("list", { name: "Scan progress" });
  }
  get ready() {
    return this.page.getByRole("heading", { name: "Your answer is ready" });
  }

  async expectOpen() {
    await expect(this.stages).toBeVisible();
    await expect(this.stages.getByRole("listitem")).toHaveCount(4);
  }

  // Answers whatever it asks, one question at a time, until it stops asking. Returns what was asked.
  async answerAll(answers: WaitAnswers = {}, until = 120_000) {
    const asked: { question: string; answer: string }[] = [];
    const deadline = Date.now() + until;
    const card = this.page.locator(".live-ask");
    while (Date.now() < deadline) {
      // Either a question is up, or it's done asking (ready, or still checking with nothing to ask).
      await expect(card.or(this.ready).or(this.page.getByRole("heading", { name: /Thanks\. Almost there\./ }))).toBeVisible({ timeout: 60_000 });
      if (!(await card.isVisible())) break;
      const question = (await card.getByRole("heading").textContent())?.trim() ?? "";
      const wanted = Object.entries(answers).find(([q]) => question.toLowerCase().includes(q.toLowerCase()))?.[1];
      const option = wanted ? card.getByRole("button", { name: wanted, exact: true }) : card.locator(".live-ask-options button").first();
      let answer: string;
      if (wanted && !(await option.count())) {
        // Not an option: say it in their own words.
        answer = wanted;
        await card.getByRole("textbox").fill(wanted);
        await card.getByRole("button", { name: "Save" }).click();
      } else {
        answer = (await option.textContent())?.trim() ?? "";
        await option.click();
      }
      asked.push({ question, answer });
      await expect(card.getByRole("heading", { name: question, exact: true })).toBeHidden({ timeout: 15_000 });
    }
    return asked;
  }

  get workspace() {
    return this.page.getByRole("tablist", { name: "Workspace" });
  }

  // Ready, or already opened: with nothing left to ask it opens the answer on its own after 2.5 s.
  async waitForAnswer(timeout = 5 * 60_000) {
    await expect(this.ready.or(this.workspace)).toBeVisible({ timeout });
  }

  async seePlan() {
    const button = this.page.getByRole("button", { name: /See my plan/ });
    await expect(button.or(this.workspace)).toBeVisible({ timeout: 30_000 });
    if (await button.isVisible()) await button.click({ timeout: 5_000 }).catch(() => {});
    await expect(this.workspace).toBeVisible({ timeout: 30_000 });
  }

  // What the finds caption and the 3D caption say right now.
  async captions() {
    return (await this.page.locator(".live-caption").allTextContents()).map((t) => t.trim());
  }
}
