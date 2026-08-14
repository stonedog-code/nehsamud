import { expect, test, type Page } from "@playwright/test";
import { deriveCharacter } from "@nehsamud/engine/character";
import { CHARACTER_OPTION_GROUPS } from "@nehsamud/engine/catalog";

/** One option from one declared axis, by its keys. */
function packOption(groupKey: string, slug: string) {
  const group = CHARACTER_OPTION_GROUPS.find((g) => g.key === groupKey);
  const option = group?.options.find((o) => o.slug === slug);
  if (!option) throw new Error(`no ${groupKey} option "${slug}" in the pack`);
  return option;
}

/**
 * End-to-end coverage of the three modes and the creation flow.
 *
 * These run against the real Next.js app, so they answer the questions jsdom
 * structurally cannot: does the page actually route, does the transcript
 * actually update, can a person actually get from the front page into a world.
 */

/**
 * Character names are globally unique in the engine, so a name reused across
 * runs collides with the row the last run created — locally, where the
 * database persists. CI gets a fresh container each time and would never see
 * it, which is exactly the kind of failure that only ever appears on someone
 * else's machine.
 */
const RUN = Array.from({ length: 5 }, () =>
  // Letters only, and lower-case: `validateCharacterName` allows letters plus
  // single interior hyphens or apostrophes, so a base36 suffix with digits in
  // it is silently rejected by the form and the test never leaves /create.
  String.fromCharCode(97 + Math.floor(Math.random() * 26)),
).join("");
const uniqueName = (base: string): string => `${base}${RUN}`;

/**
 * Open a play URL and wait until the socket is actually connected.
 *
 * Typing before the connection opens sends the command into a closed socket
 * and the transcript answers "Not connected to the world." — a real failure
 * that looks exactly like a broken engine. `data-status` exists on the
 * transcript for this: it is the component telling the test what it could not
 * otherwise know.
 */
async function enterWorld(page: Page, url: string): Promise<void> {
  await page.goto(url);
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toHaveAttribute("data-status", "playing");
  // AND the character actually exists. `playing` is set when AUTH_OK lands,
  // which is BEFORE creation finishes — so a test that typed a command on
  // that signal alone could put it into the character-creation flow instead
  // of the game. Under a loaded machine that is exactly what happened: the
  // transcript showed the echoed command ahead of the greeting, and the
  // verb was simply never answered.
  //
  // The room description is the first thing only a created character sees.
  await expect(transcript).toContainText("Exits:");
}

test("the front page offers all three modes on the dev site", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "NehsaMUD" })).toBeVisible();

  for (const mode of ["Exploration", "Player vs Environment", "Player vs Player"]) {
    await expect(page.getByRole("heading", { name: mode })).toBeVisible();
  }
});

test("Exploration advertises no hostiles and no combat", async ({ page }) => {
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

  // Derived from the engine rather than hardcoded, so this asserts the
  // preview AGREES WITH THE SERVER rather than agreeing with a number
  // someone typed. The previous version asserted a literal 40 against the
  // app's own modifier table, which the engine never shared.
  const dwarfWarrior = deriveCharacter([
    packOption("race", "dwarf"),
    packOption("class", "warrior"),
  ]);
  await expect(
    page.getByText(String(dwarfWarrior.maxHp), { exact: true }),
  ).toBeVisible();

  const aria = uniqueName("Aria");
  await page.getByLabel("Character name").fill(aria);
  await page.getByRole("button", { name: "Enter the world" }).click();

  await expect(page).toHaveURL(/\/play\/pve\?/);

  // From here the assertions are against the REAL ENGINE: the app opens a
  // WebSocket, authenticates, and creates the character server-side. The race
  // and class chosen above must survive that whole trip — they used to be
  // packed into the query string and dropped by the play page, so nothing
  // downstream ever mentioned them again.
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toContainText(`Welcome, ${aria} the Dwarf Warrior!`);
  // The room, its prose and its occupant all come out of Postgres.
  await expect(transcript).toContainText("Town Square");
  await expect(transcript).toContainText("bronze fountain shaped like a dire wolf");
  await expect(transcript).toContainText("Captain Edred");
});

test("a tough build previews tougher than a frail one", async ({ page }) => {
  // Deliberately NOT derived from the engine. The assertion above proves the
  // preview AGREES with the engine, which is tautological about the values:
  // make every modifier inert and both sides still agree, on 30 HP for
  // everyone. This one compares two builds against each other, so it fails
  // if the modifiers stop being applied at all — which is the bug (NEH-621).
  await page.goto("/play/pve/create");

  await page.getByRole("radio", { name: /Dwarf/ }).check();
  await page.getByRole("radio", { name: /Warrior/ }).check();
  const tough = Number(
    await page.getByTestId("preview-hp").textContent(),
  );

  await page.getByRole("radio", { name: /Halfling/ }).check();
  await page.getByRole("radio", { name: /Mage/ }).check();
  const frail = Number(
    await page.getByTestId("preview-hp").textContent(),
  );

  expect(tough).toBeGreaterThan(frail);
});

test("the chosen options reach the character sheet", async ({ page }) => {
  // The tier that would have caught the original bug: every unit test in the
  // chain passed while the selection was discarded between two pages.
  await page.goto("/play/pve/create");
  await page.getByRole("radio", { name: /Halfling/ }).check();
  await page.getByRole("radio", { name: /Mage/ }).check();
  const bryn = uniqueName("Bryn");
  await page.getByLabel("Character name").fill(bryn);
  await page.getByRole("button", { name: "Enter the world" }).click();

  await expect(page.getByTestId("transcript")).toHaveAttribute(
    "data-status",
    "playing",
  );
  const input = page.getByTestId("command-input");
  await input.fill("statistics");
  await input.press("Enter");

  // `statistics` is the ENGINE's verb, answered from the persisted row —
  // so this proves the choice reached the database, not just the browser.
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toContainText(`${bryn} — level 1`);
  await expect(transcript).toContainText("Halfling Mage");
  // Not the alphabetically-first pairing the server used to substitute.
  await expect(transcript).not.toContainText("Dwarf Warrior");
});

test("a play URL with no options at all goes back to creation", async ({
  page,
}) => {
  // Substituting a default here is exactly what the bug was: a silent
  // fallback and a working selection look identical from the outside.
  await page.goto("/play/pve?name=Aria");
  await expect(page.getByRole("heading", { name: "No character yet" })).toBeVisible();
});

test("a play URL naming an option that does not exist goes back to creation", async ({
  page,
}) => {
  await page.goto("/play/pve?name=Aria&race=wombat&class=warrior");
  await expect(page.getByRole("heading", { name: "No character yet" })).toBeVisible();
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

test("walking the real world, including a diagonal", async ({ page }) => {
  // Movement against the engine's map, loaded from Postgres — not the
  // in-browser stand-in this suite used to walk.
  await enterWorld(
    page,
    `/play/pve?name=${uniqueName("Walker")}&race=dwarf&class=warrior`,
  );

  const transcript = page.getByTestId("transcript");
  const input = page.getByTestId("command-input");
  await expect(transcript).toContainText("Town Square");

  await input.fill("north");
  await input.press("Enter");
  await expect(transcript).toContainText("Sunroad");

  await input.fill("s");
  await input.press("Enter");
  await expect(transcript).toContainText("Town Square");

  // Out of the town and across the river, which is also the area boundary.
  for (const step of ["south", "south", "east", "east", "east"]) {
    await input.fill(step);
    await input.press("Enter");
  }
  await expect(transcript).toContainText("Mindroad Bridge");

  await input.fill("east");
  await input.press("Enter");
  // Crossing a boundary announces the region — the whole point of areas.
  await expect(transcript).toContainText("You have entered The Kingsreach Wilds.");

  // Into the heath, where the lattice actually has diagonals. East Bank does
  // not — an exit only exists where the map says so, which is the point of
  // walking a real world instead of a stand-in that answers every direction.
  await input.fill("east");
  await input.press("Enter");
  await expect(transcript).toContainText("Heath");

  // The diagonal itself, typeable only since the parser gained all ten
  // directions and useful only since the wilds were laid out as a lattice
  // rather than a corridor.
  await input.fill("ne");
  await input.press("Enter");
  await expect(transcript).toContainText("Wolf Cairn");
});

test("the engine answers a verb the preview never had", async ({ page }) => {
  // A verb that exists only in the engine. Against the in-browser stand-in
  // this returns "You don't know how to inventory" — so it fails outright if
  // the app is talking to the preview rather than the real thing, which is
  // the mistake this whole suite is now guarding against.
  await enterWorld(
    page,
    `/play/pve?name=${uniqueName("Carrier")}&race=human&class=rogue`,
  );

  const input = page.getByTestId("command-input");
  await input.fill("inventory");
  await input.press("Enter");

  await expect(page.getByTestId("transcript")).toContainText(
    "You aren't carrying anything.",
  );
});

test("reaching the play page with no character offers creation instead", async ({
  page,
}) => {
  await page.goto("/play/pve");
  await expect(page.getByRole("heading", { name: "No character yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a character" })).toBeVisible();
});
