import { test, expect } from "../helpers/fixtures";
import { blocksFor, fixtureChapterUrl, seedStory, store, writeCoverFixture } from "../helpers/seed";

test("saves edited metadata and clears the author", async ({ page }) => {
  const story = await seedStory({
    title: "Meta story",
    author: "Old Author",
    chapters: [{ title: "Chương 1", url: fixtureChapterUrl("meta", 1), status: "done" }],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Meta story", exact: true }).click();
  await page.getByLabel("Book title").fill("Meta story renamed");
  await page.getByLabel("Author").fill("");
  await page.getByLabel("Book language").selectOption("en");
  await page.getByRole("button", { name: "Save metadata" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  const stored = await store.get(story.id);
  expect(stored?.title).toBe("Meta story renamed");
  expect(stored?.author).toBeUndefined();
  expect(stored?.language).toBe("en");

  await page.reload();
  await page.getByRole("button", { name: "Meta story renamed", exact: true }).click();
  await expect(page.getByLabel("Book title")).toHaveValue("Meta story renamed");
});

test("uploads a cover image and shows a placeholder without one", async ({ page, request }) => {
  const story = await seedStory({ title: "Cover story", chapters: [] });
  await seedStory({ title: "No cover story", chapters: [] });
  const file = writeCoverFixture();

  await page.goto("/");
  await page.getByRole("button", { name: "No cover story", exact: true }).click();
  await expect(page.getByRole("img", { name: "Cover image for No cover story" })).toHaveCount(0);

  await page.getByRole("button", { name: "Cover story", exact: true }).click();
  await page.getByLabel("Cover image").setInputFiles(file);
  await page.getByRole("button", { name: "Save metadata" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Cover image for Cover story" })).toBeVisible();
  expect((await request.get(`/api/stories/${story.id}/cover`)).status()).toBe(200);
});

test("edits and saves chapter content through the PATCH route", async ({ page, request }) => {
  const story = await seedStory({
    title: "Edit story",
    chapters: [
      {
        title: "Chương 1",
        url: fixtureChapterUrl("edit", 1),
        status: "done",
        blocks: blocksFor("edit", 3),
      },
    ],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Edit story", exact: true }).click();
  await page.locator('button[aria-controls="chapter-panel-1"]').click();
  const editor = page.getByRole("textbox", { name: "Content for chapter 1" });
  await editor.waitFor();
  await editor.evaluate((el) => {
    el.innerHTML = "<p>Nội dung đã sửa EDITED-MARKER</p>";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Save chapter" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  const res = await request.get(`/api/stories/${story.id}/chapters/1`);
  const chapter = (await res.json()).chapter as { blocks: { text?: string }[] };
  expect(chapter.blocks.some((block) => block.text?.includes("EDITED-MARKER"))).toBe(true);

  await page.reload();
  await page.getByRole("button", { name: "Edit story", exact: true }).click();
  await page.locator('button[aria-controls="chapter-panel-1"]').click();
  await expect(page.getByRole("textbox", { name: "Content for chapter 1" })).toContainText(
    "EDITED-MARKER"
  );
});

test("shows watch state and reports the missing TOC adapter", async ({ page }) => {
  await seedStory({
    title: "Watched story",
    watching: true,
    newChapterCount: 2,
    chapters: [{ title: "Chương 1", url: fixtureChapterUrl("watched", 1), status: "done" }],
  });

  await page.goto("/");
  const row = page.locator("tr", { hasText: "Watched story" });
  await expect(row).toContainText("2 new chapters");
  await row.getByRole("button", { name: "Watched story", exact: true }).click();

  await expect(page.getByText("2 new chapters since the last crawl.")).toBeVisible();
  await page.getByRole("button", { name: "Load 2 new chapters" }).click();
  await expect(page.getByText("This story has no TOC adapter")).toBeVisible();
});
