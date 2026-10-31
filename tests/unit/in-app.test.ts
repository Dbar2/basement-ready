// Inside the iPhone app (src/inApp.tsx): its web view's user agent says so, "New scan" goes to the app's own
// start screen, and nothing links to the website. In a browser, the website's links stay.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Logo } from "../../src/components/Logo";
import { APP_NEW_SCAN, AppNewScan, inApp, newScanHref } from "../../src/inApp";

// What WKWebView sends with applicationNameForUserAgent = "BasementReadyApp/1" (ios/BasementReady/Result/ResultView.swift).
const APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) BasementReadyApp/1";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const as = (userAgent: string) => vi.stubGlobal("navigator", { userAgent });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inside the iPhone app", () => {
  it("knows the app's web view by its user agent", () => {
    expect(inApp(APP)).toBe(true);
    expect(inApp(SAFARI)).toBe(false);
    expect(inApp("")).toBe(false);
  });

  it("reads the page's own user agent", () => {
    as(APP);
    expect(inApp()).toBe(true);
    as(SAFARI);
    expect(inApp()).toBe(false);
  });

  it("sends New scan to the app's start screen, and never links the website", () => {
    as(APP);
    expect(newScanHref()).toBe(APP_NEW_SCAN);
    expect(renderToStaticMarkup(createElement(AppNewScan))).toContain(`href="${APP_NEW_SCAN}"`);
    // A logo that would go to the website is just the logo; one that goes to the home base stays a link.
    expect(renderToStaticMarkup(createElement(Logo))).not.toContain("<a");
    expect(renderToStaticMarkup(createElement(Logo, { href: "/scans/abc" }))).toContain('href="/scans/abc"');
  });

  it("in a browser, keeps the website's links and puts no New scan in the bar", () => {
    as(SAFARI);
    expect(newScanHref()).toBe("/");
    expect(renderToStaticMarkup(createElement(AppNewScan))).toBe("");
    expect(renderToStaticMarkup(createElement(Logo))).toContain('href="/"');
  });
});
