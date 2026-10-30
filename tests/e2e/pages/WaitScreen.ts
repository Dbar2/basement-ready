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
  // The person who filmed it is told it's measured (the plan check is next); anyone else, the answer.
  get ready() {
    return this.page.getByRole("heading", { name: /^(Your basement is measured|Your answer is ready)$/ });
  }
  get planCheck() {
    return this.page.getByRole("heading", { name: "Is this your basement?" });
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
    // The questions come from the server once the screen opens.
    await expect(this.page.getByRole("heading", { name: "Getting your questions…" })).toBeHidden({ timeout: 60_000 });
    while (Date.now() < deadline && (await card.isVisible())) {
      const question = (await card.getByRole("heading").textContent())?.trim() ?? "";
      const wanted = Object.entries(answers).find(([q]) => question.toLowerCase().includes(q.toLowerCase()))?.[1];
      const option = wanted ? card.getByRole("button", { name: wanted, exact: true }) : card.locator(".live-ask-options button").first();
      // The server answers with what's still worth asking (a real scan's /answers, the sample's /money).
      const next = this.page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/(scans\/[^/]+\/answers|money)$/.test(new URL(r.url()).pathname));
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
      await next;
      await expect(card.getByRole("heading", { name: question, exact: true })).toBeHidden({ timeout: 15_000 });
      await this.page.waitForTimeout(250); // the next question, if any, renders from that reply
    }
    return asked;
  }

  get workspace() {
    return this.page.getByRole("tablist", { name: "Workspace" });
  }

  // Ready, or already moved on: with nothing left to ask it opens the plan check (or, for someone only
  // watching, the answer) on its own after 2.5 s.
  async waitForAnswer(timeout = 5 * 60_000) {
    await expect(this.ready.or(this.planCheck).or(this.workspace)).toBeVisible({ timeout });
  }

  // On to step 2 of the flow, "Is this your basement?" (src/flow/flow.ts).
  async checkPlan() {
    const button = this.page.getByRole("button", { name: /Is this your basement\?|Skip, check my plan/ }).first();
    await expect(button.or(this.planCheck)).toBeVisible({ timeout: 30_000 });
    if (await button.isVisible()) await button.click({ timeout: 5_000 }).catch(() => {});
    await expect(this.planCheck).toBeVisible({ timeout: 30_000 });
  }

  // What the finds caption and the 3D caption say right now.
  async captions() {
    return (await this.page.locator(".live-caption").allTextContents()).map((t) => t.trim());
  }
}
