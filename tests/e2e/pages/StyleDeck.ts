// "Swipe your style" on the wait screen: their own basement restyled card by card, and the board the
// loved ones build (src/ideas/StyleDeck.tsx).
import type { Page } from "@playwright/test";
import { expect } from "../support/fixtures";

export class StyleDeck {
  constructor(readonly page: Page) {}

  // The wait screen's section and the deck inside it share the name; this is the deck.
  get deck() {
    return this.page.getByRole("region", { name: "Swipe your style" }).last();
  }
  get board() {
    return this.page.getByRole("region", { name: "Your board" });
  }
  // The pictures on the board, one button each ("See … bigger").
  get boardPictures() {
    return this.board.getByRole("button", { name: /^See .+ bigger$/ });
  }

  async expectOpen() {
    await expect(this.deck).toBeVisible({ timeout: 60_000 });
  }

  // "3 of 16 · 1 loved": which card is on top, of how many.
  get counter() {
    return this.deck.locator(".deck-count");
  }
  async position() {
    return Number(/^(\d+) of/.exec((await this.counter.textContent()) ?? "")?.[1] ?? 0);
  }

  // Loves or passes the top card once it has landed (cards are restyled while the scan measures), then
  // waits for the next one to come up: a tap while a card is still leaving doesn't count.
  async swipe(verdict: "love" | "pass") {
    const button = this.deck.locator(".deck-actions").getByRole("button", { name: verdict === "love" ? "Love it" : "Not for me", exact: true });
    await expect(button).toBeEnabled({ timeout: 120_000 });
    const before = await this.position();
    await button.click();
    await expect.poll(() => this.position(), { timeout: 15_000 }).toBeGreaterThan(before);
  }

  // Swipes in order ("love", "pass", …) and returns how many ended up on the board.
  async swipeAll(verdicts: ("love" | "pass")[]) {
    for (const v of verdicts) await this.swipe(v);
    const loved = verdicts.filter((v) => v === "love").length;
    await expect(this.boardPictures).toHaveCount(loved);
    return loved;
  }
}
