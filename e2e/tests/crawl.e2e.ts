import { test, expect } from "../helpers/fixtures";
import { FIXTURE_URL, fixtureChapterUrl, seedStory, store } from "../helpers/seed";

test.describe.configure({ timeout: 120_000 });

test("crawls pending chapters with live progress and stores extracted content", async ({
  page,
  request,
}) => {
  const story = await seedStory({
    title: "Crawl happy path",
    coverUrl: `${FIXTURE_URL}/cover/crawl-happy.png`,
    chapters: [1, 2, 3].map((n) => ({
      title: `Mục ${n}`,
      url: fixtureChapterUrl("crawl-happy", n),
    })),
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Crawl happy path", exact: true }).click();
  await page.getByRole("button", { name: "Continue crawl (3 chapters)" }).click();

  await expect(page.locator("header").getByText(/^Crawling/)).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Crawl progress" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Downloaded 3 chapters" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("Done · Story: Crawl happy path")).toBeVisible();

  const stored = await store.get(story.id);
  expect(stored?.chapters.map((c) => c.status)).toEqual(["done", "done", "done"]);
  expect(stored?.chapters[0].blocks?.some((b) => b.text?.includes("E2E-crawl-happy-1-0"))).toBe(
    true
  );

  // The crawl downloads the cover itself (covers.save) before crawling chapters.
  expect((await request.get(`/api/stories/${story.id}/cover`)).status()).toBe(200);
});

test("recovers from a blanked page and fails fast on a locked chapter", async ({ page }) => {
  const story = await seedStory({
    title: "Crawl failures",
    chapters: [
      { title: "Chương chập chờn", url: fixtureChapterUrl("crawl-fail", 1, { mode: "flaky", fails: 1 }) },
      { title: "Chương khóa", url: fixtureChapterUrl("crawl-fail", 2, { mode: "locked" }) },
    ],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Crawl failures", exact: true }).click();
  await page.getByRole("button", { name: "Continue crawl (2 chapters)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Downloaded" })).toBeVisible({
    timeout: 90_000,
  });

  const stored = await store.get(story.id);
  expect(stored?.chapters[0].status).toBe("done");
  expect(stored?.chapters[1].status).toBe("error");
  expect(stored?.chapters[1].error).toContain("Chapter is locked behind an ad blocker notice");

  const row = page.locator("tr", { hasText: "Chương khóa" });
  await expect(row.getByText("Error", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator("tr", { hasText: "Crawl failures" })).toContainText("Done · 1 errors");
});

test("retrying a failed chapter from the UI marks it done", async ({ page }) => {
  const story = await seedStory({
    title: "Retry from UI",
    chapters: [
      { title: "Chương lỗi", url: fixtureChapterUrl("retry-ui", 1), status: "error", error: "boom" },
      { title: "Chương ok", url: fixtureChapterUrl("retry-ui", 2), status: "done" },
    ],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Retry from UI", exact: true }).click();
  const row = page.locator("tr", { hasText: "Chương lỗi" });
  await row.getByRole("button", { name: "Retry" }).click();

  await expect(row.getByText("Done", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await store.get(story.id))?.chapters[0].status, { timeout: 30_000 })
    .toBe("done");
});
