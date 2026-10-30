// End-to-end journeys (tests/e2e). `pnpm test:e2e` replays saved model and 3D answers: free, no network,
// the same every run. `pnpm test:e2e:record` runs the same journeys against the real services once and
// saves their answers. See tests/e2e/README.md.
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";
import { API_PORT, apiCommand, apiEnv, baseURL, mode, runDir, WEB_PORT } from "./tests/e2e/support/run";

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };

// The full Chromium build with the Mac's GPU: the headless shell draws WebGL in software, and the 3D
// views then block clicks for seconds at a time.
const chromium = { browserName: "chromium" as const, channel: "chromium", launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } };

const projects: PlaywrightTestConfig["projects"] = [
  { name: "chromium-phone", use: { ...chromium, ...phone } },
  { name: "chromium-desktop", use: { ...chromium, ...desktop } },
  { name: "webkit-phone", use: { browserName: "webkit", ...phone } },
  { name: "webkit-desktop", use: { browserName: "webkit", ...desktop } },
];

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  outputDir: `${runDir}/playwright`,
  // A recorded take runs a whole scan: minutes on the real services, well under one replayed.
  timeout: mode === "record" ? 20 * 60_000 : 6 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // One scan job runs at a time on the test server, so more workers only queue.
  workers: mode === "record" ? 1 : 2,
  retries: 0,
  reporter: [["list"], ["./tests/e2e/support/reporter.ts"]],
  globalSetup: "./tests/e2e/support/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    acceptDownloads: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects,
  webServer: [
    {
      name: "api",
      command: apiCommand(),
      url: `http://localhost:${API_PORT}/api/health`,
      env: apiEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "web",
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: baseURL,
      env: { API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
