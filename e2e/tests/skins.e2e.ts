import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { blocksFor, fixtureChapterUrl, seedStory } from "../helpers/seed";

// Each test picks its skin through Settings, the way a reader does; the skin is kept in
// localStorage, which every test starts without.
async function chooseSkin(page: Page, label: "Code editor" | "Spreadsheet" | "Normal") {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: label, exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toHaveCount(0);
}

function threeChapters(slug: string) {
  return [
    { title: "Chương 1", url: fixtureChapterUrl(slug, 1), status: "done" as const, blocks: blocksFor(`${slug}-1`) },
    { title: "Chương 2", url: fixtureChapterUrl(slug, 2), status: "done" as const, blocks: blocksFor(`${slug}-2`) },
    { title: "Chương 3", url: fixtureChapterUrl(slug, 3) },
  ];
}

test.describe("code editor skin", () => {
  test("shows stories as folders and a chapter as a file in the editor", async ({ page }) => {
    await seedStory({ title: "Code story", chapters: threeChapters("code-story") });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
    await chooseSkin(page, "Code editor");

    const explorer = page.getByRole("tree", { name: "Explorer" });
    await expect(explorer).toBeVisible();
    // The real app is gone, title and all.
    await expect(page.getByRole("heading", { name: "My Stories" })).toHaveCount(0);
    await expect(page).not.toHaveTitle(/EPUB/);

    await explorer.getByRole("treeitem", { name: "code-story", exact: true }).click();
    await explorer.getByRole("treeitem", { name: "ch-0001-chuong-1.md", exact: true }).click();

    const editor = page.getByRole("region", { name: "Editor" });
    await expect(editor.getByText(/Đoạn 1 của code-story-1/)).toBeVisible();
    // Pictures are a placeholder line, never loaded.
    await expect(editor.getByText("[image: minh họa]")).toBeVisible();
    await expect(editor.locator("img")).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Open editors" }).getByRole("tab", { name: "ch-0001-chuong-1.md" })).toBeVisible();
    await expect(page).toHaveTitle("ch-0001-chuong-1.md — workspace");
    await expect(page.getByRole("status", { name: "Status bar" })).toBeVisible();

    // ] opens the next file from inside the editor.
    await editor.getByText(/Đoạn 1 của code-story-1/).click();
    await page.keyboard.press("]");
    await expect(editor.getByText(/Đoạn 1 của code-story-2/)).toBeVisible();
    await expect(page).toHaveTitle("ch-0002-chuong-2.md — workspace");
  });

  test("the palette opens the normal view at the story, and comes back", async ({ page }) => {
    await seedStory({ title: "Palette story", chapters: threeChapters("palette-story") });
    await page.goto("/");
    await chooseSkin(page, "Code editor");
    const explorer = page.getByRole("tree", { name: "Explorer" });
    await explorer.getByRole("treeitem", { name: "palette-story", exact: true }).click();
    await explorer.getByRole("treeitem", { name: "ch-0001-chuong-1.md", exact: true }).click();
    await expect(page.getByRole("region", { name: "Editor" }).getByText(/Đoạn 1 của palette-story-1/)).toBeVisible();

    await page.keyboard.press("F1");
    const palette = page.getByRole("dialog", { name: /command/i });
    await expect(palette).toBeVisible();
    await page.keyboard.type("normal view");
    await page.keyboard.press("Enter");

    // The normal view opens that chapter in the reader.
    await expect(page.getByRole("dialog", { name: "Reading Palette story" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to Code editor" }).click();
    await expect(page.getByRole("tree", { name: "Explorer" })).toBeVisible();
  });

  test("neutral names hide every title", async ({ page }) => {
    await seedStory({ title: "Secret story", chapters: threeChapters("secret-story") });
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("checkbox", { name: "Neutral names" }).check();
    await settings.getByRole("button", { name: "Code editor", exact: true }).click();
    await settings.getByRole("button", { name: "Close" }).click();

    const explorer = page.getByRole("tree", { name: "Explorer" });
    await expect(explorer.getByRole("treeitem", { name: /^module-\d\d$/ }).first()).toBeVisible();
    await expect(page.getByText("secret-story")).toHaveCount(0);
    await expect(page.getByText("Secret story")).toHaveCount(0);

    // The chapter's own title heading is left out too; its text is not.
    await explorer.getByRole("treeitem", { name: /^module-\d\d$/ }).first().click();
    await explorer.getByRole("treeitem", { name: "part-0001.md", exact: true }).click();
    const editor = page.getByRole("region", { name: "Editor" });
    await expect(editor.getByText(/Đoạn 1 của secret-story-1/)).toBeVisible();
    await expect(editor.getByText("Chương secret-story-1")).toHaveCount(0);
  });

  test("the boss key shows the code decoy and restores the file's title", async ({ page }) => {
    await seedStory({ title: "Boss story", chapters: threeChapters("boss-story") });
    await page.goto("/");
    await chooseSkin(page, "Code editor");
    const explorer = page.getByRole("tree", { name: "Explorer" });
    await explorer.getByRole("treeitem", { name: "boss-story", exact: true }).click();
    await explorer.getByRole("treeitem", { name: "ch-0001-chuong-1.md", exact: true }).click();
    await expect(page).toHaveTitle("ch-0001-chuong-1.md — workspace");

    // From the command palette's search box too: nobody types a backquote there.
    await page.keyboard.press("F1");
    await expect(page.getByRole("dialog", { name: /command/i })).toBeVisible();
    await page.keyboard.press("Backquote");
    const decoy = page.locator("[data-stealth-decoy]");
    await expect(decoy).toBeVisible();
    await expect(page).toHaveTitle("budget.service.ts — workspace");
    await expect(decoy.getByText(/Đoạn/)).toHaveCount(0);

    await page.keyboard.press("Backquote");
    await expect(decoy).toHaveCount(0);
    await expect(page).toHaveTitle("ch-0001-chuong-1.md — workspace");
  });

  test("the skin and its tab title are back before the app has loaded", async ({ page }) => {
    await seedStory({ title: "Reload story", chapters: threeChapters("reload-story") });
    await page.goto("/");
    await chooseSkin(page, "Code editor");
    await expect(page).toHaveTitle("Welcome — workspace");

    // With the app's script blocked, only index.html's pre-paint script can set the title.
    await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
    await page.reload();
    await expect(page).toHaveTitle("Welcome — workspace");
    await expect(page.locator("html")).toHaveAttribute("data-skin", "code");
  });
});

test.describe("spreadsheet skin", () => {
  test("lists stories, opens a story sheet, then a chapter one paragraph per row", async ({ page }) => {
    await seedStory({ title: "Sheet story", chapters: threeChapters("sheet-story") });
    await page.goto("/");
    await chooseSkin(page, "Spreadsheet");

    const sheet = page.getByRole("table", { name: "Sheet" });
    const tabs = page.getByRole("tablist", { name: "Sheets" });
    await expect(tabs.getByRole("tab", { name: "Danh_muc" })).toBeVisible();
    await expect(page).toHaveTitle(/\.xlsx/);

    await sheet.getByRole("cell", { name: "Sheet story", exact: true }).dblclick();
    await expect(tabs.getByRole("tab", { name: "sheet_story" })).toBeVisible();

    await sheet.getByRole("cell", { name: "Chương 1", exact: true }).dblclick();
    await expect(tabs.getByRole("tab", { name: "Ch_0001" })).toBeVisible();
    const paragraph = sheet.getByRole("cell", { name: /Đoạn 1 của sheet-story-1/ });
    await expect(paragraph).toBeVisible();
    await expect(sheet.locator("img")).toHaveCount(0);

    await paragraph.click();
    await expect(page.getByRole("textbox", { name: "Formula bar" })).toHaveValue(/Đoạn 1 của sheet-story-1/);
    await expect(page.getByLabel("Name Box")).toContainText(/^B\d+$/);
    await expect(page.getByRole("status", { name: "Status bar" })).toBeVisible();

    // The read-only formula bar is not a text field: the boss key works from it.
    await page.getByRole("textbox", { name: "Formula bar" }).focus();
    await page.keyboard.press("Backquote");
    await expect(page.locator("[data-stealth-decoy]")).toBeVisible();
    await page.keyboard.press("Backquote");
    await expect(page.locator("[data-stealth-decoy]")).toHaveCount(0);

    // ] moves to the next chapter's sheet.
    await paragraph.click();
    await page.keyboard.press("]");
    await expect(sheet.getByRole("cell", { name: /Đoạn 1 của sheet-story-2/ })).toBeVisible();
  });

  test("the boss key shows the budget decoy", async ({ page }) => {
    await seedStory({ title: "Budget story", chapters: threeChapters("budget-story") });
    await page.goto("/");
    await chooseSkin(page, "Spreadsheet");
    await expect(page.getByRole("table", { name: "Sheet" })).toBeVisible();

    await page.keyboard.press("Backquote");
    const decoy = page.locator("[data-stealth-decoy]");
    await expect(decoy).toBeVisible();
    await expect(page).toHaveTitle("Ngan_sach_Q4.xlsx");
    await expect(decoy.getByText("=SUM(F2:F16)").or(decoy.locator('input[value="=SUM(F2:F16)"]'))).toHaveCount(1);
    await page.keyboard.press("Backquote");
    await expect(decoy).toHaveCount(0);
  });

  test("switching back to the normal look restores the app and its title", async ({ page }) => {
    await page.goto("/");
    await chooseSkin(page, "Spreadsheet");
    await expect(page.getByRole("table", { name: "Sheet" })).toBeVisible();
    await chooseSkinFromSkin(page);
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
    await expect(page).toHaveTitle("Web → EPUB cho Kindle");
  });
});

// Inside a skin the settings page is reached through the palette.
async function chooseSkinFromSkin(page: Page) {
  await page.keyboard.press("F1");
  await page.keyboard.type("settings");
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Normal", exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
}

test.describe("switching look without shortcuts", () => {
  test("header button, the editor's menus and the spreadsheet's tabs and view buttons", async ({ page }) => {
    await seedStory({ title: "Menu story", chapters: threeChapters("menu-story") });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();

    // Normal view → code editor, from the header.
    await page.getByRole("button", { name: "Change look" }).click();
    await page.getByRole("menuitemradio", { name: "Code editor" }).click();
    const explorer = page.getByRole("tree", { name: "Explorer" });
    await expect(explorer).toBeVisible();

    // The editor's File menu: open the normal view at the open file, then come back.
    await explorer.getByRole("treeitem", { name: "menu-story", exact: true }).click();
    await explorer.getByRole("treeitem", { name: "ch-0001-chuong-1.md", exact: true }).click();
    await page.getByRole("button", { name: "File", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: "Code editor" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitem", { name: "Open in the normal view" }).click();
    await expect(page.getByRole("dialog", { name: "Reading Menu story" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to Code editor" }).click();

    // The editor's layout button → spreadsheet.
    await page.getByRole("button", { name: "Change look" }).click();
    await page.getByRole("menuitemradio", { name: "Spreadsheet" }).click();
    await expect(page.getByRole("table", { name: "Sheet" })).toBeVisible();

    // The spreadsheet's view buttons → code editor, and its File tab → normal.
    await page.getByRole("button", { name: "Switch look: Code editor" }).click();
    await expect(page.getByRole("tree", { name: "Explorer" })).toBeVisible();
    await page.getByRole("button", { name: "Change look" }).click();
    await page.getByRole("menuitemradio", { name: "Spreadsheet" }).click();
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Normal" }).click();
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
    await expect(page).toHaveTitle("Web → EPUB cho Kindle");
  });
});
