// The home page and its start sheet: where the house is, who it's for, then the video.
import type { Page } from "@playwright/test";
import { expect } from "../support/fixtures";

export class Home {
  constructor(readonly page: Page) {}

  async open() {
    await this.page.goto("/");
    await expect(this.page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  // The hero and the closing call to action both offer these: the first is the hero's.
  async trySample() {
    await this.page.getByRole("button", { name: /^Try (the example|a sample basement)$/ }).first().click();
    await this.page.waitForURL("**/scans/sample");
  }

  async startSheet() {
    await this.page.getByRole("button", { name: /Check my basement/ }).first().click();
    const sheet = new StartSheet(this.page);
    await expect(sheet.dialog).toBeVisible();
    return sheet;
  }
}

export class StartSheet {
  readonly dialog;
  constructor(readonly page: Page) {
    this.dialog = page.getByRole("dialog");
  }

  // Types part of an address and picks the first match from the list.
  async address(typed: string, pick: RegExp | string = typed) {
    await this.dialog.getByRole("combobox", { name: "Your address" }).fill(typed);
    await this.dialog.getByRole("option", { name: pick }).first().click();
  }

  async who(label: string | RegExp) {
    await this.dialog.getByRole("button", { name: label }).click();
    await expect(this.dialog.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
  }

  // Uploads a video file and waits for the wait screen's URL. Returns the new scan's id.
  async upload(videoPath: string): Promise<string> {
    const chooser = this.page.waitForEvent("filechooser");
    await this.dialog.getByRole("button", { name: "Upload a video" }).click();
    await (await chooser).setFiles(videoPath);
    await this.page.waitForURL(/\/scans\/[0-9a-f-]{36}$/, { timeout: 120_000 });
    return this.page.url().split("/").pop()!;
  }
}
