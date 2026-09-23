import { test, expect } from "../helpers/fixtures";
import { fixtureChapterUrl, resetLibrary, seedStory, store } from "../helpers/seed";

test("shows the empty-library guidance", async ({ page }) => {
  await resetLibrary();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Library is empty" })).toBeVisible();
  await expect(page.getByText("Paste a story URL above and click Load chapters.")).toBeVisible();
});

test("rejects a URL from an unsupported site", async ({ page }) => {
  await page.goto("/");
  // Wait for the allowlist to load: the client validates against it, and an empty list
  // rejects every URL for the wrong reason.
  await expect(page.getByRole("button", { name: /\d+ sites supported/ })).toBeVisible();
  const before = (await store.list()).length;
  await page.getByLabel("Story page URL").fill("https://example.com/story");
  await page.getByRole("button", { name: "Load chapters" }).click();
  await expect(page.getByText("URL is not from a supported site.")).toBeVisible();
  expect((await store.list()).length).toBe(before);
});

test("lists a seeded story with its pending count", async ({ page }) => {
  await seedStory({
    title: "Library listing",
    chapters: [
      { title: "1", url: fixtureChapterUrl("listing", 1), status: "done" },
      { title: "2", url: fixtureChapterUrl("listing", 2) },
      { title: "3", url: fixtureChapterUrl("listing", 3) },
    ],
  });
  await page.goto("/");
  const row = page.locator("tr", { hasText: "Library listing" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("2 chapters pending");
});

test("deletes a single story with inline confirmation", async ({ page }) => {
  const story = await seedStory({
    title: "Delete me",
    chapters: [{ title: "1", url: fixtureChapterUrl("delete-me", 1) }],
  });
  await page.goto("/");
  const row = page.locator("tr", { hasText: "Delete me" });
  await row.getByRole("button", { name: "Delete Delete me" }).click();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(await store.get(story.id)).toBeUndefined();
});

test("bulk deletes selected stories", async ({ page }) => {
  await seedStory({ title: "Bulk one", chapters: [] });
  await seedStory({ title: "Bulk two", chapters: [] });
  await page.goto("/");
  await page.getByRole("checkbox", { name: "Select Bulk one" }).check();
  await page.getByRole("checkbox", { name: "Select Bulk two" }).check();
  await page.getByRole("button", { name: "Delete selected" }).click();
  await page.getByRole("button", { name: "Delete 2 stories" }).click();
  await expect(page.getByText("Bulk one")).toHaveCount(0);
  await expect(page.getByText("Bulk two")).toHaveCount(0);
});

test("watch toggle persists across reloads", async ({ page }) => {
  await seedStory({ title: "Watch me", chapters: [] });
  await page.goto("/");
  const row = page.locator("tr", { hasText: "Watch me" });
  await row.getByRole("button", { name: "Watch Watch me" }).click();
  await expect(row.getByRole("button", { name: "Stop watching Watch me" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.reload();
  await expect(
    page.locator("tr", { hasText: "Watch me" }).getByRole("button", { name: "Stop watching Watch me" })
  ).toBeVisible();
});
