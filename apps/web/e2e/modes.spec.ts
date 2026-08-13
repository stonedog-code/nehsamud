import { expect, test } from "@playwright/test";

/**
 * End-to-end coverage of the three modes and the creation flow.
 *
 * These run against the real Next.js app, so they answer the questions jsdom
 * structurally cannot: does the page actually route, does the transcript
 * actually update, can a person actually get from the front page into a world.
 */

test("the front page offers all three modes on the dev site", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "NehsaMUD" })).toBeVisible();

  for (const mode of ["Exploration", "Player vs Environment", "Player vs Player"]) {
    await expect(page.getByRole("heading", { name: mode })).toBeVisible();
  }
});

test("Exploration advertises no monsters and no combat", async ({ page }) => {
  await page.goto("/");
  const card = page
    .locator(".mode-card")
    .filter({ has: page.getByRole("heading", { name: "Exploration" }) });

  // Stated in words, not only colour — the accessibility floor for this build.
  // Exact matching matters here: "Combat: no" is a substring of
  // "Player combat: no", and a loose match would pass on the wrong chip.
  await expect(card.getByText("Monsters: no", { exact: true })).toBeVisible();
  await expect(card.getByText("Combat: no", { exact: true })).toBeVisible();
  await expect(card.getByText("Looting: no", { exact: true })).toBeVisible();
});

test("PVP advertises looting", async ({ page }) => {
  await page.goto("/");
  const card = page
    .locator(".mode-card")
    .filter({ has: page.getByRole("heading", { name: "Player vs Player" }) });

  await expect(
    card.getByText("Player combat: yes", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Looting: yes", { exact: true })).toBeVisible();
});

test("an unknown mode is a 404, not a rendered page", async ({ page }) => {
  const response = await page.goto("/play/creative/create");
  expect(response?.status()).toBe(404);
});

test("creating a character and entering the world", async ({ page }) => {
  await page.goto("/play/pve/create");

  await page.getByRole("radio", { name: /Dwarf/ }).check();
  await page.getByRole("radio", { name: /Warrior/ }).check();

  // 30 base + 4 dwarf + 6 warrior.
  await expect(page.getByText("40", { exact: true })).toBeVisible();

  await page.getByLabel("Character name").fill("Aria");
  await page.getByRole("button", { name: "Enter the world" }).click();

  await expect(page).toHaveURL(/\/play\/pve\?/);
  await expect(page.getByTestId("transcript")).toContainText("Welcome, Aria.");
  await expect(page.getByTestId("transcript")).toContainText("Town Square");
});

test("an invalid name is rejected before entering the world", async ({
  page,
}) => {
  await page.goto("/play/pve/create");
  await page.getByLabel("Character name").fill("Al");
  await page.getByRole("button", { name: "Enter the world" }).click();

  // Target the element `aria-describedby` actually points at. A bare
  // getByRole("alert") also matches Next's route announcer, and asserting
  // against the id checks the accessibility wiring rather than just the text.
  const error = page.locator("#character-name-error");
  await expect(error).toContainText("at least 3 characters");
  await expect(page.getByLabel("Character name")).toHaveAttribute(
    "aria-describedby",
    "character-name-error",
  );
  await expect(page).toHaveURL(/\/create$/);
});

test("walking the world, including a diagonal", async ({ page }) => {
  await page.goto("/play/pve?name=Aria&race=dwarf&class=warrior");

  const transcript = page.getByTestId("transcript");
  const input = page.getByTestId("command-input");

  await input.fill("north");
  await input.press("Enter");
  await expect(transcript).toContainText("Sunroad");

  await input.fill("s");
  await input.press("Enter");
  await expect(transcript).toContainText("Town Square");

  // The diagonal the engine's parser cannot currently handle.
  await input.fill("se");
  await input.press("Enter");
  await expect(transcript).toContainText("Townsmee Market");
});

test("Exploration refuses combat in the running app", async ({ page }) => {
  // The senior-safe promise, asserted end to end rather than in a unit test.
  await page.goto("/play/exploration?name=Aria&race=human&class=bard");

  const input = page.getByTestId("command-input");
  await input.fill("attack rat");
  await input.press("Enter");

  await expect(page.getByTestId("transcript")).toContainText(
    "There is no fighting in this world.",
  );
});

test("reaching the play page with no character offers creation instead", async ({
  page,
}) => {
  await page.goto("/play/pve");
  await expect(page.getByRole("heading", { name: "No character yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a character" })).toBeVisible();
});
