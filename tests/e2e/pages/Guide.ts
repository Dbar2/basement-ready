// The guide (src/guide/GuideScreen.tsx): after the upload, one screen with the three milestones on top,
// the basement in the visual pane, and the guide's thread above the ask bar. A journey walks it as a
// homeowner would: it answers each question, takes the guide's way on, and fills in each Build card.
// Everything is read from the screen: the guide's own GET saves the thread, so polling it beside the
// page could race the page's own taps.
import { expect, type Locator, type Page } from "@playwright/test";
import { readPdf } from "../support/pdf";

// A wait question's start (as the guide asks it) → the label of the option to tap.
export type WaitAnswers = Record<string, string>;

// What a walk saw and did, for the take's recorded outcome.
export type Walked = {
  asked: { question: string; answer: string }[];
  answer: { headline: string; said: string } | null;
  design: { recommended: string | null; look: string | null };
  // Each Build message in order, by its card ("tape", "window W1", "owner", "water", …) or what it asked.
  build: string[];
  // A message the walk can't take further on its own (a change the design needs, say): where it stopped.
  stopped: string | null;
  pdfs: { review?: Pdf; submit?: Pdf; book?: Pdf };
  // Kitchener's water meter, as saved in its card.
  water: string | null;
};
export type Pdf = Awaited<ReturnType<typeof readPdf>> & { path: string };

export type WalkOptions = {
  answers: WaitAnswers;
  // Where each downloaded PDF goes: (which) → a path.
  saveAs: (which: "review" | "submit" | "book") => string;
  // A named step with a screenshot (support/fixtures.ts journey.step).
  step: <T>(name: string, fn?: () => Promise<T>) => Promise<T | undefined>;
  // How long the guide may say it's still measuring.
  measuringMs: number;
  look?: string;
  waterMeter?: { option: string; where: string };
};

// An element's text, or "" at once when it isn't there (textContent would wait out the action timeout).
const text = async (l: Locator) => ((await l.allTextContents())[0] ?? "").replace(/\s+/g, " ").trim();
// A message's own answers: never "Later" (back to the home base) or a "What's …?" or "Why …?" aside.
const answersOf = (choices: string[]) => choices.filter((c) => !/^Later$|^What's |^Why /.test(c));

export class Guide {
  constructor(readonly page: Page) {}

  get milestones() {
    return this.page.getByRole("navigation", { name: "Milestones" });
  }
  get thread() {
    return this.page.getByRole("log", { name: "Your guide" });
  }
  get visual() {
    return this.page.locator("section.gs-visual");
  }
  // The guide's newest message: the one asking (only its choices are live).
  get live() {
    return this.thread.locator(".gs-msg").last();
  }

  async open(scanId: string) {
    const at = new RegExp(`/scans/${scanId}/guide(\\?.*)?$`);
    // The basement's home base may forward to the guide by itself (after an upload, or the example): a
    // second navigation to the same address then interrupts it in WebKit, so it's waited for, not raced.
    // Going there over it cancels the page's own requests (WebKit then reports them as page errors).
    const onScan = new RegExp(`/scans/${scanId}(\\?.*)?$`).test(this.page.url());
    if (onScan) await this.page.waitForURL(at, { timeout: 10_000 }).catch(() => {});
    if (!at.test(this.page.url())) {
      await this.page.goto(`/scans/${scanId}/guide`).catch((err: unknown) => {
        if (!/interrupted by another navigation/.test(String(err))) throw err;
      });
      await this.page.waitForURL(at);
    }
    await this.expectOpen();
  }

  async expectOpen() {
    await expect(this.milestones).toBeVisible({ timeout: 60_000 });
    await expect(this.milestones.getByRole("listitem")).toHaveText(["Answer", "Design", "Build"]);
    await expect(this.thread.locator(".gs-msg").first()).toBeVisible({ timeout: 60_000 });
  }

  // The milestone the guide is on ("Answer", "Design" or "Build").
  async milestone() {
    return text(this.milestones.locator('[aria-current="step"]'));
  }

  // The guide's newest message once it's done thinking: what it says, its card and its choices.
  async asking() {
    await expect(this.thread).not.toHaveAttribute("aria-busy", "true", { timeout: 120_000 });
    const live = this.live;
    const card = live.locator("[data-card]");
    const hasCard = (await card.count()) > 0;
    return {
      count: await this.thread.locator(".gs-msg").count(),
      said: await text(live.locator(".gs-msg-body > p").first()),
      bold: await text(live.locator(".gs-msg-body > p").first().locator("strong").first()),
      card: hasCard ? { kind: (await card.getAttribute("data-card")) ?? "", label: (await card.getAttribute("aria-label")) ?? "", el: card } : null,
      choices: await live.locator(".gs-choices button").allTextContents().then((all) => all.map((c) => c.replace(/\s*→\s*$/, "").trim())),
    };
  }

  async tap(label: string | RegExp) {
    await this.live.locator(".gs-choices").getByRole("button", { name: label }).click();
  }

  // Waits for the guide's next message (or a new word in the one asking, while it measures).
  async moved(before: { count: number; said: string }, timeout = 120_000) {
    await expect
      .poll(async () => (await this.thread.locator(".gs-msg").count()) > before.count || (await text(this.live.locator(".gs-msg-body > p").first())) !== before.said, { timeout, intervals: [500, 1_000, 2_000] })
      .toBe(true);
  }

  // A download from a card's button, read back. A refusal shows as an alert; fail on it rather than
  // wait out the download.
  async download(button: Locator, saveAs: string): Promise<Pdf> {
    const download = this.page.waitForEvent("download", { timeout: 180_000 });
    await button.click();
    const file = await download;
    await file.saveAs(saveAs);
    expect(file.suggestedFilename()).toMatch(/\.pdf$/);
    const { readFileSync } = await import("node:fs");
    return { ...(await readPdf(new Uint8Array(readFileSync(saveAs)))), path: saveAs };
  }

  // The whole walk: the answer, the design, then every Build card, to the book.
  async walk(o: WalkOptions): Promise<Walked> {
    const out: Walked = { asked: [], answer: null, design: { recommended: null, look: null }, build: [], stopped: null, pdfs: {}, water: null };
    for (let i = 0; i < 120; i++) {
      const now = await this.asking();
      const { card, choices, said } = now;

      // ---- Build cards: each fills in, saves, and the guide moves on ----
      if (card) {
        const done = await this.card(card, o, out);
        if (done === "end") return out;
        await this.moved(now);
        continue;
      }

      // ---- Still measuring: the guide speaks again when there's something to say ----
      if (!choices.length) {
        await this.moved(now, o.measuringMs);
        continue;
      }

      // ---- What it says, and the way on ----
      if (choices.includes("Try again")) {
        out.stopped = said;
        return out;
      }
      if (choices.includes("Fix it in the design")) {
        // A change the design needs before the permit set (server/guide/build.ts): not a walk's to make.
        out.build.push(`design change: ${said}`);
        out.stopped = said;
        return out;
      }
      const primary = (re: RegExp) => choices.find((c) => re.test(c));
      if (primary(/^Show me (what it could be|the plan anyway)$/)) {
        out.answer = { headline: now.bold, said };
        await o.step("the answer", () => this.tap(primary(/^Show me/)!));
      } else if (choices.includes("Looks right")) {
        await o.step("is this your basement? looks right", () => this.tap("Looks right"));
      } else if (primary(/^Use /)) {
        out.design.recommended = primary(/^Use /)!.replace(/^Use /, "");
        await o.step(`a layout: ${out.design.recommended}`, () => this.tap(primary(/^Use /)!));
      } else if (choices.includes("Looks good")) {
        await o.step("before and after: looks good", () => this.tap("Looks good"));
      } else if (choices.includes("None of these") && choices.includes(o.look ?? "Light oak")) {
        out.design.look = o.look ?? "Light oak";
        await o.step(`the look: ${out.design.look}`, () => this.tap(out.design.look!));
      } else if (choices.includes("Start")) {
        out.build.push("permit set");
        await o.step("build: the permit set", () => this.tap("Start"));
      } else if (choices.some((c) => /^Back to (your|my) basement$/.test(c))) {
        return out;
      } else {
        // A question: the take's answer where one fits, else its first option.
        const question = now.bold || said;
        const key = Object.keys(o.answers).find((q) => question.includes(q));
        const pick = (key && choices.find((c) => c === o.answers[key])) || answersOf(choices)[0];
        out.asked.push({ question, answer: pick });
        await o.step(`asked: ${question.slice(0, 50)}`, () => this.tap(pick));
      }
      await this.moved(now);
    }
    throw new Error("The guide didn't finish in 120 messages");
  }

  // One Build card: fill it in and save it (or download what it offers). "end" once the book is in hand.
  private async card(card: { kind: string; label: string; el: Locator }, o: WalkOptions, out: Walked): Promise<"next" | "end"> {
    const el = card.el;
    // A card loads its permit set first ("Opening your permit set…"): nothing to tap until it has.
    await expect(el.locator(".gc-loading")).toHaveCount(0, { timeout: 60_000 });
    const save = el.getByRole("button", { name: /^Save$/ });
    const fill = async (values: (label: string, placeholder: string | null, i: number) => string) => {
      const inputs = el.locator("input");
      for (let i = 0; i < (await inputs.count()); i++) {
        const input = inputs.nth(i);
        const label = await text(input.locator("xpath=preceding-sibling::*[1]"));
        await input.fill(values(label, await input.getAttribute("placeholder"), i));
      }
    };
    const about = (placeholder: string | null) => /about (\d+)/.exec(placeholder ?? "")?.[1] ?? null;

    if (card.kind === "tape" && card.label === "Tape numbers") {
      out.build.push("tape");
      await o.step("build: tape numbers", async () => {
        // Save waits for every number.
        await expect(save).toBeDisabled();
        await fill((label, ph) => about(ph) ?? (/ceiling/i.test(label) ? "2085" : /beam|duct/i.test(label) ? "1960" : "3000"));
        await expect(save).toBeEnabled();
        await save.click();
      });
    } else if (card.kind === "tape") {
      out.build.push("lot line");
      await o.step("build: distance to the lot line", async () => {
        await fill(() => "1800");
        await save.click();
      });
    } else if (card.kind === "window") {
      out.build.push(card.label.toLowerCase());
      await o.step(`build: ${card.label.toLowerCase()}`, async () => {
        await fill((_l, _p, i) => ["610", "762", "1120"][i] ?? "610");
        await save.click();
      });
    } else if (card.kind === "owner") {
      out.build.push("owner");
      await o.step("build: the owners", async () => {
        const inputs = el.locator("input");
        // First and last name, phone, email and postal code; the rest is optional.
        const by = { "given-name": "Test", "family-name": "Owner", tel: "519-555-0100", email: "owner@example.com", "postal-code": "N2L 3G1" } as Record<string, string>;
        for (let i = 0; i < (await inputs.count()); i++) {
          const v = by[(await inputs.nth(i).getAttribute("autocomplete")) ?? ""];
          if (v && !(await inputs.nth(i).inputValue())) await inputs.nth(i).fill(v);
        }
        await save.click();
      });
    } else if (card.kind === "upstairs") {
      out.build.push("upstairs");
      await o.step("build: bedrooms upstairs", () => el.getByRole("button", { name: "There are no bedrooms upstairs" }).click());
    } else if (card.kind === "waterMeter") {
      out.build.push("water");
      const w = o.waterMeter ?? { option: "One meter for both", where: "unit 1's furnace room" };
      await o.step("build: the water meter", async () => {
        await el.getByRole("group", { name: "How the water is metered" }).getByRole("button", { name: w.option }).click();
        await el.locator("input").fill(w.where);
        await save.click();
      });
      out.water = `${w.option}: ${w.where}`;
    } else if (card.kind === "designer") {
      out.build.push("designer");
      await o.step("build: the designer", async () => {
        // The owner signs where the City and the work allow it; otherwise a BCIN designer's details.
        const myself = el.getByRole("button", { name: "I'll sign them myself instead" });
        if (await myself.count()) await myself.click();
        else {
          await fill((label) => (/bcin/i.test(label) ? "123456" : /email/i.test(label) ? "designer@example.com" : /name/i.test(label) ? "Pat Designer" : "Designer Ltd"));
          await el.getByRole("button", { name: "Put them on the drawings" }).click();
        }
      });
    } else if (card.kind === "download" && card.label === "Look over the drawings") {
      out.build.push("review");
      await o.step("build: the review copy, every sheet looked over", async () => {
        out.pdfs.review = await this.download(el.getByRole("button", { name: "Download the review copy" }), o.saveAs("review"));
        await el.getByRole("button", { name: "Every sheet matches my basement" }).click();
      });
    } else if (card.kind === "download" && card.label === "Hand it in") {
      out.build.push("submit");
      const button = el.getByRole("button", { name: /Download the submit copy/ });
      if (!(await button.count())) {
        out.stopped = await text(el);
        return "end";
      }
      await o.step("build: the submit copy, handed in", async () => {
        out.pdfs.submit = await this.download(button, o.saveAs("submit"));
        await el.getByRole("button", { name: /^(I've handed it in|Done with the permit set)$/ }).click();
      });
    } else if (card.kind === "download") {
      out.build.push("book");
      await o.step("done: the book", async () => {
        out.pdfs.book = await this.download(el.getByRole("button", { name: "Download your book (PDF)" }), o.saveAs("book"));
      });
      return "end";
    } else if (card.kind === "moneyQuestion") {
      // A money question has its answers as the message's choices; "apply" marks each program.
      const choices = answersOf((await this.live.locator(".gs-choices button").allTextContents()).map((c) => c.replace(/\s*→\s*$/, "").trim()));
      if (choices.length) {
        out.build.push("money question");
        await o.step("build: a money question", () => this.tap(choices[0]));
      } else {
        out.build.push("apply");
        await o.step("build: apply before work starts", async () => {
          // Each program marked in turn: its buttons are disabled while the last mark saves, then it drops off.
          const marks = el.getByRole("button", { name: /^(Not for me|Got it)$/ });
          for (let i = 0; i < 12; i++) {
            const n = await marks.count();
            if (!n) break;
            await expect(marks.first()).toBeEnabled({ timeout: 30_000 });
            await marks.first().click();
            await expect.poll(() => marks.count(), { timeout: 30_000 }).toBeLessThan(n);
          }
        });
      }
    } else if (card.kind === "buildPath") {
      out.build.push("who builds it");
      await o.step("build: who builds it", () => el.getByRole("group", { name: "Who builds it" }).getByRole("button").first().click());
    } else throw new Error(`A card the walk doesn't know: ${card.kind} (${card.label})`);
    return "next";
  }
}

// The permit set's structure: a cover first, a page for every sheet it lists ("A2.1" and "A2.2" count as
// A2 when a plan takes two sheets).
export function expectSheets(pdf: Pdf) {
  const numbers = Object.keys(pdf.index);
  expect(numbers.length, "sheets listed on the cover").toBeGreaterThan(4);
  expect(pdf.index.A0).toMatch(/^Cover/);
  expect([...new Set(pdf.sheets.map((x) => x.number.split(".")[0]))]).toEqual(numbers);
  expect(pdf.pageCount).toBeGreaterThanOrEqual(numbers.length);
}

// A sheet's text, all its pages (A2.1 and A2.2 for A2), on one line.
export const sheetText = (pdf: Pdf, n: string) =>
  pdf.sheets
    .filter((x) => x.number === n || x.number.startsWith(`${n}.`))
    .map((x) => pdf.pages[x.page - 1].text.replace(/\s+/g, " "))
    .join(" ");
