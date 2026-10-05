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
