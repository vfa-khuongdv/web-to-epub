import path from "path";
import { test, expect } from "../helpers/fixtures";
import { DATA_DIR, audioBlock, blocksFor, fixtureChapterUrl, seedStory, store, writeStoredCover } from "../helpers/seed";
import { readEpub } from "../helpers/epub";

test.describe.configure({ timeout: 120_000 });

test("exports a validated EPUB with edits, images and media", async ({ page }) => {
  const story = await seedStory({
    title: "Export Novel",
    author: "E2E Author",
    language: "vi",
    chapters: [
      {
        title: "Chương 1",
        url: fixtureChapterUrl("export", 1),
        status: "done",
        blocks: blocksFor("E2E-export-1"),
      },
      {
        title: "Chương 2",
        url: fixtureChapterUrl("export", 2),
        status: "done",
        blocks: [...blocksFor("E2E-export-2"), audioBlock()],
      },
      {
        title: "Chương lỗi",
        url: fixtureChapterUrl("export", 3),
        status: "error",
        error: "boom",
        blocks: blocksFor("E2E-export-error"),
      },
      { title: "Chương chờ", url: fixtureChapterUrl("export", 4), blocks: blocksFor("E2E-export-4") },
    ],
  });
  await store.updateMeta(story.id, {
    title: "Export Novel",
    author: "E2E Author",
    language: "vi",
    coverUrl: writeStoredCover(story.id),
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Export Novel", exact: true }).click();

  // Open chapter 1 and edit it without saving: the export must send the editor's HTML.
  await page.locator('button[aria-controls="chapter-panel-1"]').click();
  const editor = page.getByRole("textbox", { name: "Content for chapter 1" });
  await editor.waitFor();
  // The editor first mounts from the outline (no content), then loadBody remounts it
  // with the chapter's HTML. Wait for that remount, otherwise the edit below can land
  // on a detached div and the export payload falls back to stored blocks.
  await expect(page.getByText("Loading chapter content…")).toHaveCount(0);
  await editor.evaluate((el) => {
    el.innerHTML = "<p>Unsaved edit EDITED-MARKER</p>";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // The chip proves the edit reached the app's live body state before exporting.
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Export EPUB" }).click();
  const download = await downloadPromise;
  const epubPath = path.join(DATA_DIR, "export.epub");
  await download.saveAs(epubPath);

  const epub = readEpub(epubPath);
  expect(epub.text("mimetype")).toBe("application/epub+zip");
  expect(epub.opf).toMatch(/<dc:title[^>]*>Export Novel<\/dc:title>/);
  expect(epub.opf).toContain("E2E Author");
  expect(epub.opf).toContain("<dc:language>vi</dc:language>");
  // epub-gen 0.1.0 declares the cover as id="image_cover" href="cover.png" and never
  // emits the EPUB3 properties="cover-image" attribute, so assert the declaration
  // and the embedded file instead of the literal string.
  expect(epub.opf).toMatch(/<item[^>]+href="cover\.png"[^>]*media-type="image\/png"/);
  expect(epub.files["OEBPS/cover.png"]).toBeDefined();

  // Unsaved edit wins; the done-but-unopened chapter comes from stored blocks.
  expect(epub.allXhtml).toContain("EDITED-MARKER");
  expect(epub.allXhtml).toContain("E2E-export-2");
  // Error and pending chapters are not exported.
  expect(epub.allXhtml).not.toContain("E2E-export-error");
  expect(epub.allXhtml).not.toContain("E2E-export-4");

  // epubBuilder's own image download ran, so the inline image is embedded. The cover
  // is always present, so require a PNG that is not the cover (discriminating).
  expect(Object.keys(epub.files).some((key) => key.endsWith(".png") && !key.endsWith("cover.png"))).toBe(true);
  expect(epub.opf).toContain('media-type="image/png"');

  // packMedia patched the media file, manifest and the controls attribute back in.
  expect(Object.keys(epub.files).some((key) => key.endsWith(".mp3"))).toBe(true);
  expect(epub.opf).toContain("audio/mpeg");
  expect(epub.allXhtml).toMatch(/<audio controls/);
});

test("disables export when no chapter is done", async ({ page }) => {
  await seedStory({
    title: "Nothing to export",
    chapters: [{ title: "Chương 1", url: fixtureChapterUrl("nothing", 1) }],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Nothing to export", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export EPUB" })).toBeDisabled();
});
