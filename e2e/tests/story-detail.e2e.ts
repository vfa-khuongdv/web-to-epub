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
  // openStory fetches the full story before StoryDetail remounts (key={selected.id}).
  // exact: true is required: without it "Cover story" also matches the "No cover story"
  // heading (substring, case-insensitive) and setInputFiles races the pane swap.
  await expect(page.getByRole("heading", { name: "Cover story", exact: true, level: 3 })).toBeVisible();
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
  // The editor first mounts from the outline (no content), then loadBody remounts it
  // with the chapter's HTML: wait for that remount so evaluate() can't run on the
  // detached div (its input event would never reach React and Save stays disabled).
  await expect(page.getByText("Loading chapter content…")).toHaveCount(0);
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

test("shows a locked chapter as Locked, with how to unlock it", async ({ page }) => {
  await seedStory({
    title: "Locked story",
    chapters: [
      {
        title: "Chương 1",
        url: fixtureChapterUrl("locked", 1),
        status: "error",
        error: "This Asianfanfics content is for subscribers only — it needs an account subscribed to the author",
        errorKind: "locked",
      },
    ],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Locked story", exact: true }).click();
  await expect(page.getByText("Locked", { exact: true })).toBeVisible();

  await page.locator('button[aria-controls="chapter-panel-1"]').click();
  await expect(page.getByText("This chapter is locked")).toBeVisible();
  await expect(page.getByText(/Unlock it on the site first/)).toBeVisible();
});

test("shows a subscribers-only chapter with the fix, not a plain lock", async ({ page }) => {
  await seedStory({
    title: "Subscribers story",
    chapters: [
      {
        title: "Chương 1",
        url: fixtureChapterUrl("subs", 1),
        status: "error",
        error: "This Asianfanfics content is for subscribers only — it needs an account subscribed to the author",
        errorKind: "subscribers",
      },
    ],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Subscribers story", exact: true }).click();
  await expect(page.getByText("Subscribers only", { exact: true })).toBeVisible();

  await page.locator('button[aria-controls="chapter-panel-1"]').click();
  await expect(page.getByText("This chapter is for subscribers only")).toBeVisible();
  await expect(page.getByText(/Subscribe to the author on asianfanfics.com/)).toBeVisible();
  await expect(page.getByText(/Unlock it on the site first/)).toHaveCount(0);
});

test("shows a rated-M chapter with the mature opt-in fix", async ({ page }) => {
  await seedStory({
    title: "Mature story",
    chapters: [
      {
        title: "Chương 1",
        url: fixtureChapterUrl("mature", 1),
        status: "error",
        error: "This Asianfanfics content is rated M (mature) — it needs a logged-in account with mature content enabled",
        errorKind: "mature",
      },
    ],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Mature story", exact: true }).click();
  await expect(page.getByText("Rated M (18+)", { exact: true })).toBeVisible();

  await page.locator('button[aria-controls="chapter-panel-1"]').click();
  await expect(page.getByText("This chapter is rated M (18+)", { exact: true })).toBeVisible();
  await expect(page.getByText(/Enable mature content on your asianfanfics.com account/)).toBeVisible();
  await expect(page.getByText(/Unlock it on the site first/)).toHaveCount(0);
});
