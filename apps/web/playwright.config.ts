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
  /**
   * Two servers, because the suite plays the real game.
   *
   * The engine only starts when `MUD_DATABASE_URL` is set — locally that
   * means `npm run test:e2e` still works against the in-browser preview with
   * no database, and in CI the database is there so the engine comes up and
   * the app talks to it. The alternative, silently skipping the engine when
   * it fails to boot, would turn a broken engine into a green suite.
   */
  webServer: [
    ...(process.env.MUD_DATABASE_URL
      ? [
          {
            command: "npm run start --workspace @nehsamud/engine",
            url: `http://127.0.0.1:${process.env.MUD_HTTP_PORT ?? 22010}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ]
      : []),
    {
      command: `npx next dev --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
