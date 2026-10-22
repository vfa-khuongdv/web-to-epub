import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { blocksFor, fixtureChapterUrl, seedNarration, seedStory } from "../helpers/seed";

const REAL_TITLE = "Web → EPUB cho Kindle";
const DECOY_TITLE = "Biên bản họp giao ban – Tuần 40";

async function appReady(page: Page) {
  // The key listeners are installed in mount effects; a key pressed before that is lost.
  await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
}

function decoy(page: Page) {
  return page.locator("[data-stealth-decoy]");
}

test("the boss key covers the app with fake work and brings it back", async ({ page }) => {
  await seedStory({ title: "Stealth story", chapters: [] });
  await page.goto("/");
  await appReady(page);
  await expect(page).toHaveTitle(REAL_TITLE);

  await page.keyboard.press("Backquote");
  await expect(decoy(page)).toBeVisible();
  await expect(decoy(page).getByRole("heading", { name: "BIÊN BẢN HỌP GIAO BAN" })).toBeVisible();
  await expect(page).toHaveTitle(DECOY_TITLE);
  // Nothing underneath can be reached or announced.
  await expect(page.locator("#root")).toHaveAttribute("inert", "");

  // The app's own shortcuts are swallowed while the decoy shows (private mode here).
  await page.keyboard.press("Control+Shift+K");
  await expect(page.getByRole("dialog", { name: "Private mode" })).toHaveCount(0);

  await page.keyboard.press("Backquote");
  await expect(decoy(page)).toHaveCount(0);
  await expect(page).toHaveTitle(REAL_TITLE);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");

  // A held key repeats: the screen must stay covered, not flicker back to the app.
  await page.keyboard.down("Backquote");
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++)
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", key: "`", repeat: true, bubbles: true }));
  });
  await page.keyboard.up("Backquote");
  await expect(decoy(page)).toBeVisible();
  await page.keyboard.press("Backquote");
  await expect(decoy(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stealth story", exact: true })).toBeVisible();
});

test("the key types inside a text field, and Alt+` hides from there", async ({ page }) => {
  await page.goto("/");
  await appReady(page);
  const input = page.getByPlaceholder("https://example.com/story-title/");
  await input.click();
  await page.keyboard.press("Backquote");
  await expect(input).toHaveValue("`");
  await expect(decoy(page)).toHaveCount(0);

  await page.keyboard.press("Alt+Backquote");
  await expect(decoy(page)).toBeVisible();
  await page.keyboard.press("Backquote");
  await expect(decoy(page)).toHaveCount(0);
  // Focus goes back where it was.
  await expect(input).toBeFocused();
});

test("works while focus is inside the reader's chapter frame, after it reloads", async ({ page }) => {
  await seedStory({
    title: "Frame story",
    chapters: [1, 2].map((n) => ({
      title: `Chương ${n}`,
      url: fixtureChapterUrl("frame-story", n),
      status: "done" as const,
      blocks: blocksFor(`frame-${n}`),
    })),
  });
  await page.goto("/");
  await appReady(page);
  await page.getByRole("button", { name: "Frame story", exact: true }).click();
  await page.getByRole("button", { name: "Read / preview" }).click();
  const reader = page.getByRole("dialog", { name: "Reading Frame story" });
  const frame = page.frameLocator("iframe.reader-page");
  await expect(frame.getByText("Chương frame-1")).toBeVisible();

  // Next chapter replaces the frame's document: the listener must follow it.
  await reader.getByRole("button", { name: "Next" }).click();
  await expect(frame.getByText("Chương frame-2")).toBeVisible();
  await frame.locator("body").click();
  await page.keyboard.press("Backquote");
  await expect(decoy(page)).toBeVisible();

  await page.keyboard.press("Backquote");
  await expect(decoy(page)).toHaveCount(0);
  // Esc in the frame still closes the reader once the decoy is gone: nothing was left swallowing keys.
  await frame.locator("body").click();
  await page.keyboard.press("Escape");
  await expect(reader).toHaveCount(0);
});

test("silences the narration and does not start it again", async ({ page }) => {
  const story = await seedStory({
    title: "Quiet story",
    language: "vi",
    chapters: [{ title: "Chương một", url: fixtureChapterUrl("quiet-story", 1), status: "done", blocks: blocksFor("q") }],
  });
  await seedNarration(story.id, 1);
  await page.goto("/");
  await appReady(page);
  await page.getByRole("button", { name: "Quiet story", exact: true }).click();
  await page.getByRole("button", { name: "Listen to chapter 1" }).click();
  const bar = page.getByRole("region", { name: "Narration player" });
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();

  await page.keyboard.press("Backquote");
  await expect(decoy(page)).toBeVisible();
  // Space is the player's play/pause key: under the decoy it must not reach the player.
  await page.keyboard.press("Space");
  await page.keyboard.press("Backquote");
  await expect(decoy(page)).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("Settings → Disguise → Try it shows the decoy", async ({ page }) => {
  await page.goto("/");
  await appReady(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Disguise" })).toBeVisible();
  await settings.getByRole("button", { name: "Try it" }).click();
  await expect(decoy(page)).toBeVisible();
  await page.keyboard.press("Backquote");
  await expect(decoy(page)).toHaveCount(0);
  // The settings page is still there, untouched.
  await expect(settings).toBeVisible();
});

test("the code repository's decoy is a working review: keys reach it, and only the boss key leaves", async ({ page }) => {
  await seedStory({ title: "Decoy story", chapters: [] });
  await page.goto("/");
  await appReady(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Code repository", exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("list", { name: "Repositories" })).toBeVisible();

  await page.keyboard.press("Backquote");
  const shown = decoy(page);
  await expect(shown).toBeVisible();
  await expect(page).toHaveTitle(/Pull Request #482 · team\/budget-service$/);
  await shown.getByRole("navigation", { name: "Pull request" }).getByRole("button", { name: /Files changed/ }).click();
  const file = shown.getByRole("region", { name: "src/common/money.ts" });
  await file.locator('tr[data-line="R5"]').hover();
  await file.getByRole("button", { name: "Add a comment on line R5" }).click();
  const field = file.getByRole("textbox", { name: "Comment on line R5" });
  await expect(field).toBeFocused();

  // Typing reaches the decoy — a backquote too, since it is typed into a field.
  await page.keyboard.type("Đổi `factor` thành hằng số nhé");
  await expect(field).toHaveValue("Đổi `factor` thành hằng số nhé");
  await expect(shown).toBeVisible();
  // The app's own shortcuts still never see a key (private mode here).
  await page.keyboard.press("Control+Shift+K");
  await expect(page.getByRole("dialog", { name: "Private mode" })).toHaveCount(0);
  // Tab moves through the decoy's own controls.
  await page.keyboard.press("Tab");
  await expect(shown.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Alt+Backquote");
  await expect(shown).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("list", { name: "Repositories" })).toBeVisible();
  await expect(page).toHaveTitle("Repositories");
});
