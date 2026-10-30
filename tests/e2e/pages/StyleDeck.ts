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

  // The deck, or the plan check the wait screen moves on to when the scan beat the first card.
  async expectOpen() {
    await expect(this.deck.or(this.movedOn)).toBeVisible({ timeout: 60_000 });
  }

  // "3 of 16 · 1 loved": which card is on top, of how many.
  get counter() {
    return this.deck.locator(".deck-count");
  }
  // -1 when the deck isn't there (the wait screen moved on).
  async position() {
    const text = await this.counter.textContent({ timeout: 2_000 }).catch(() => null);
    return text == null ? -1 : Number(/^(\d+) of/.exec(text)?.[1] ?? 0);
  }

  get stepBar() {
    return this.page.getByRole("navigation", { name: "Steps" });
  }
  // Where the wait screen goes on its own when the scan is done and nothing's been swiped yet.
  get movedOn() {
    return this.page.getByRole("heading", { name: "Is this your basement?" });
  }
  private button(verdict: "love" | "pass") {
    return this.deck.locator(".deck-actions").getByRole("button", { name: verdict === "love" ? "Love it" : "Not for me", exact: true });
  }

  // Waits for a card to swipe. When the scan finished before the first card was restyled, the wait screen
  // has moved on to the plan check: the deck is then step 1 of the step bar, so it goes back there.
  private async ready() {
    for (let back = 0; ; back++) {
      let state: "ready" | "moved" | null = null;
      await expect
        .poll(
          async () => {
            if ((await this.button("love").isVisible()) && (await this.button("love").isEnabled())) return (state = "ready");
            if (await this.movedOn.isVisible()) return (state = "moved");
            return null;
          },
          { timeout: 120_000 },
        )
        .not.toBeNull();
      if (state === "ready") return back > 0;
      if (back > 0) throw new Error("The deck has no card to swipe on step 1 either");
      await this.stepBar.getByRole("link", { name: /^Step 1: Swipe your style/ }).click();
      await expect(this.deck).toBeVisible({ timeout: 30_000 });
    }
  }

  // Loves or passes the top card once it has landed (cards are restyled while the scan measures), then
  // waits for the next one to come up: a tap while a card is still leaving doesn't count. If the wait
  // screen moves on under the tap, it's done again on step 1. True when it went back to step 1.
  async swipe(verdict: "love" | "pass") {
    let wentBack = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      wentBack = (await this.ready()) || wentBack;
      const before = await this.position();
      await this.button(verdict).click({ timeout: 5_000 }).catch(() => {});
      const moved = await expect
        .poll(() => this.position(), { timeout: 15_000 })
        .toBeGreaterThan(before)
        .then(() => true, () => false);
      if (moved) return wentBack;
    }
    throw new Error(`Couldn't swipe ${verdict}: the deck didn't move on`);
  }

  // Swipes in order ("love", "pass", …), checks the loved ones are on the board, and says whether it went
  // back to step 1 to do it (the journey then goes on to step 2 itself). A tap the wait screen moved on
  // under may have counted too, so the board holds at least the loved ones.
  async swipeAll(verdicts: ("love" | "pass")[]) {
    let wentBack = false;
    for (const v of verdicts) wentBack = (await this.swipe(v)) || wentBack;
    const loved = verdicts.filter((v) => v === "love").length;
    await expect.poll(() => this.boardPictures.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(loved);
    return { loved, wentBack };
  }
}
