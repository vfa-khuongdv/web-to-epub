import { expect, test } from "../helpers/fixtures";
import { blocksFor, fixtureChapterUrl, seedNarration, seedStory } from "../helpers/seed";

test("plays a chapter's narration, moves on to the next one, and keeps playing in the reader", async ({ page }) => {
  const story = await seedStory({
    title: "Nghe thử",
    language: "vi",
    chapters: [
      { title: "Chương một", url: fixtureChapterUrl("nghe-thu", 1), status: "done", blocks: blocksFor("một") },
      { title: "Chương hai", url: fixtureChapterUrl("nghe-thu", 2), status: "done", blocks: blocksFor("hai") },
    ],
  });
  await seedNarration(story.id, 1);
  await seedNarration(story.id, 2);

  await page.goto("/");
  await page.getByRole("button", { name: "Nghe thử", exact: true }).click();

  // Each narrated chapter has a play button; the player bar appears once one plays.
  await page.getByRole("button", { name: "Listen to chapter 1" }).click();
  const bar = page.getByRole("region", { name: "Narration player" });
  await expect(bar).toContainText("Chương một");
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause chapter 1" })).toBeVisible();
  // The file really loaded: the seek bar knows its length.
  await expect(bar.getByRole("slider", { name: "Position" })).toHaveAttribute("max", /^[1-9]/);

  // Faster, so the 2.5 s chapter ends quickly; at its end the next chapter starts.
  await bar.getByRole("combobox", { name: "Playback speed" }).selectOption("2");
  await expect(bar).toContainText("Chương hai", { timeout: 15_000 });
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();

  // The title opens the reader on the chapter being played, with the player still there.
  await bar.getByRole("button", { name: "Chương hai" }).click();
  const reader = page.getByRole("dialog", { name: /Reading/ });
  await expect(reader.locator(".reader-now")).toContainText("Chương hai");
  await expect(reader.getByRole("region", { name: "Narration player" })).toBeVisible();
  await expect(reader.getByRole("button", { name: "Pause" }).first()).toBeVisible();
});

test("offers no player for a story without narration", async ({ page }) => {
  await seedStory({
    title: "Chưa có audio",
    language: "vi",
    chapters: [{ title: "Chương một", url: fixtureChapterUrl("chua-co", 1), status: "done", blocks: blocksFor("x") }],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Chưa có audio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Listen to chapter 1" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Narration player" })).toHaveCount(0);
});

test("keeps playing while browsing to another story, and brings its reader back from the bar", async ({ page }) => {
  const playing = await seedStory({
    title: "Đang nghe",
    language: "vi",
    chapters: [
      { title: "Hồi một", url: fixtureChapterUrl("dang-nghe", 1), status: "done", blocks: blocksFor("hồi") },
    ],
  });
  await seedNarration(playing.id, 1);
  await seedStory({
    title: "Truyện khác",
    language: "vi",
    chapters: [{ title: "Chương khác", url: fixtureChapterUrl("truyen-khac", 1), status: "done", blocks: blocksFor("khác") }],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Đang nghe", exact: true }).click();
  await page.getByRole("button", { name: "Listen to chapter 1" }).click();
  const bar = page.getByRole("region", { name: "Narration player" });
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();

  // Another story's page: the bar stays, still on the first story, still playing.
  await page.getByRole("button", { name: "Truyện khác", exact: true }).click();
  await expect(page.locator(".story-title")).toHaveText("Truyện khác");
  await expect(bar).toContainText("Hồi một");
  await expect(bar).toContainText("Đang nghe");
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();

  // Its chapter title goes back to the playing story, straight into the reader.
  await bar.getByRole("button", { name: "Hồi một" }).click();
  const reader = page.getByRole("dialog", { name: /Reading Đang nghe/ });
  await expect(reader.locator(".reader-now")).toContainText("Hồi một");
  // The same player is inside the reader (the 2.5 s fixture may have ended by now).
  await expect(reader.getByRole("region", { name: "Narration player" })).toContainText("Hồi một");
});
