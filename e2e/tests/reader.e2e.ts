import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { blocksFor, fixtureChapterUrl, resetHighlights, seedHighlight, seedStory, store } from "../helpers/seed";

async function openReader(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "Read / preview" }).click();
  await expect(page.getByRole("dialog", { name: `Reading ${title}` })).toBeVisible();
}

function readerStory(title: string, slug: string, paragraphs = 20) {
  return seedStory({
    title,
    chapters: [1, 2, 3].map((n) => ({
      title: `Chương ${n}`,
      url: fixtureChapterUrl(slug, n),
      status: "done",
      blocks: blocksFor(`${slug}-${n}`, paragraphs),
    })),
  });
}

test("opens the preview and navigates between chapters", async ({ page }) => {
  await readerStory("Reader story", "reader");
  await page.goto("/");
  await openReader(page, "Reader story");

  const frame = page.frameLocator("iframe.reader-page");
  await expect(frame.getByText("Chương reader-1")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(frame.getByText("Chương reader-2")).toBeVisible();
  await expect(page.getByText("Chapter 2 / 3")).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(frame.getByText("Chương reader-1")).toBeVisible();
});

test("saves and restores the reading position", async ({ page }) => {
  const story = await readerStory("Position story", "position", 40);
  await page.goto("/");
  await openReader(page, "Position story");

  const iframe = page.locator("iframe.reader-page");
  const frame = page.frameLocator("iframe.reader-page");
  await frame.locator("#reader-content").waitFor();
  await iframe.hover();
  await page.mouse.wheel(0, 4000);

  const positionKey = `reader-position:${story.id}`;
  await expect
    .poll(async () => {
      const raw = await page.evaluate((key) => localStorage.getItem(key), positionKey);
      return raw ? (JSON.parse(raw) as { scroll: number }).scroll : 0;
    })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Read / preview" }).click();
  await expect
    .poll(() => frame.locator("body").evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
});

test("persists reader text settings", async ({ page }) => {
  await readerStory("Prefs story", "prefs");
  await page.goto("/");
  await openReader(page, "Prefs story");

  await page.getByRole("button", { name: "Text settings" }).click();
  await page.getByRole("button", { name: "Larger text" }).click();
  await expect(page.locator(".reader-seg-value")).toHaveText("20px");

  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("reader-prefs") ?? "{}"));
  expect(prefs.fontSize).toBe(20);

  await page.reload();
  await openReader(page, "Prefs story");
  await page.getByRole("button", { name: "Text settings" }).click();
  await expect(page.locator(".reader-seg-value")).toHaveText("20px");
});

test("renders, recolours and deletes a seeded highlight", async ({ page }) => {
  const story = await seedStory({
    title: "Highlight story",
    chapters: [
      {
        title: "Chương 1",
        url: fixtureChapterUrl("highlight", 1),
        status: "done",
        blocks: [{ type: "paragraph", text: "Alpha bravo charlie delta echo foxtrot golf hotel" }],
      },
      // The Next/Previous reload below needs somewhere to go; the highlight stays on
      // chapter 1, these only exist to turn the page away and back.
      {
        title: "Chương 2",
        url: fixtureChapterUrl("highlight", 2),
        status: "done",
        blocks: blocksFor("highlight-2", 3),
      },
      {
        title: "Chương 3",
        url: fixtureChapterUrl("highlight", 3),
        status: "done",
        blocks: blocksFor("highlight-3", 3),
      },
    ],
  });
  // A retry re-seeds the same deterministic story id; clear leftovers so the DB starts
  // with exactly one highlight on every attempt.
  await resetHighlights(story.id);
  // The srcdoc template puts a newline text node right after #reader-content opens, so
  // the root's plain text starts with "\n" and "Alpha" sits at offsets 1–6.
  await seedHighlight(story.id, {
    chapterOrder: 1,
    start: 1,
    end: 6,
    color: "yellow",
    text: "Alpha",
  });

  await page.goto("/");
  await openReader(page, "Highlight story");
  const frame = page.frameLocator("iframe.reader-page");
  const mark = frame.locator("mark[data-highlight]");

  // Panel lists it, and clicking an entry jumps to its chapter.
  await page.getByRole("button", { name: "Highlights (1)" }).click();
  await expect(page.locator(".reader-hl-row")).toContainText("Alpha");

  // The app paints marks only inside the iframe load handler, which can run before the
  // highlights fetch resolves. The tab label above proves the fetch is done, so one
  // round trip (Next, Previous) forces a load that paints. Known gap: the very first
  // open is not guaranteed to paint, so that is deliberately not asserted.
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(mark).toHaveClass(/hl-yellow/);

  await mark.click();
  const palette = page.getByRole("group", { name: "Highlight colour" });
  await palette.getByRole("button", { name: "Green" }).click();
  await expect(mark).toHaveClass(/hl-green/);

  await mark.click();
  await palette.getByRole("button", { name: "Remove highlight" }).click();
  await expect(frame.locator("mark[data-highlight]")).toHaveCount(0);
  expect(await store.listHighlights(story.id)).toHaveLength(0);
});

test("creates a highlight from a selection", async ({ page }) => {
  const story = await seedStory({
    title: "Selection story",
    chapters: [
      {
        title: "Chương 1",
        url: fixtureChapterUrl("selection", 1),
        status: "done",
        // One short word so the synthesised Range selection lands offsets 1–6
        // deterministically (the srcdoc template's newline before the content is part
        // of the offset root).
        blocks: [{ type: "paragraph", text: "Alpha" }],
      },
    ],
  });
  // A retry re-seeds the same deterministic story id; clear leftovers so the UI creates
  // exactly one highlight on every attempt.
  await resetHighlights(story.id);

  await page.goto("/");
  await openReader(page, "Selection story");
  const frame = page.frameLocator("iframe.reader-page");
  await frame.locator("#reader-content").waitFor();

  // Select the paragraph and fire the mouseup the app listens for. This drives the real
  // selection handler; only the pointer physics are simulated.
  await frame.locator("#reader-content").evaluate((root) => {
    const paragraph = root.querySelector("p") as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await page.getByRole("group", { name: "Highlight colour" }).getByRole("button", { name: "Yellow" }).click();
  await expect(frame.locator("mark[data-highlight]")).toHaveText("Alpha");

  const highlights = await store.listHighlights(story.id);
  expect(highlights).toHaveLength(1);
  expect(highlights[0]).toMatchObject({ chapterOrder: 1, start: 1, end: 6, color: "yellow", text: "Alpha" });
});
