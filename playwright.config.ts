import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * E2E against a real build.
 *
 * `NEHSAMUD_MODES` is left unset so the dev server offers all three modes —
 * the suite needs to drive each one. A per-mode deployment narrows it, and the
 * "mode not served" case is covered by unit tests rather than by booting three
 * servers here.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
