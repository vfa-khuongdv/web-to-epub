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
