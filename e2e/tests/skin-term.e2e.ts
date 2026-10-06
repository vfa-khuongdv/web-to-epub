import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { blocksFor, fixtureChapterUrl, resetLibrary, seedStory } from "../helpers/seed";

// The terminal skin, driven the way a reader drives it: commands typed at the prompt, the
// pager's keys, and the title bar's buttons for everything else.

async function chooseTerminal(page: Page, options: { neutral?: boolean } = {}) {
  await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  if (options.neutral) await settings.getByRole("checkbox", { name: "Neutral names" }).check();
  await settings.getByRole("button", { name: "Terminal", exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toHaveCount(0);
  // The prompt is drawn once the library is in (an invisible field over the prompt line).
  await expect(prompt(page)).toBeAttached();
  await expect(terminal(page).getByText('Type "help" to see the commands.')).toBeVisible();
}

function prompt(page: Page) {
  return page.getByRole("textbox", { name: "Terminal input" });
}

function terminal(page: Page) {
  return page.getByRole("region", { name: "Terminal" });
}

// Types a command and runs it. The prompt ignores Enter while a command is still running,
// so each caller waits for the output it expects before typing the next one.
async function run(page: Page, command: string) {
  await prompt(page).fill(command);
  await prompt(page).press("Enter");
}

function threeChapters(slug: string, paragraphs = 3) {
  return [
    { title: "Chương 1", url: fixtureChapterUrl(slug, 1), status: "done" as const, blocks: blocksFor(`${slug}-1`, paragraphs) },
    { title: "Chương 2", url: fixtureChapterUrl(slug, 2), status: "done" as const, blocks: blocksFor(`${slug}-2`, paragraphs) },
    { title: "Chương 3", url: fixtureChapterUrl(slug, 3) },
  ];
}

test.describe("terminal skin", () => {
  test("lists stories as folders and reads a chapter in the pager", async ({ page }) => {
    await seedStory({ title: "Term story", chapters: threeChapters("term-story") });
    await page.goto("/");
    await chooseTerminal(page);

    // The real app is gone, title and all.
    await expect(page.getByRole("heading", { name: "My Stories" })).toHaveCount(0);
    await expect(page).toHaveTitle("dev@workstation: ~/projects");

    await run(page, "ls");
    await expect(terminal(page).getByText("term-story", { exact: true })).toBeVisible();
    await run(page, "cd term-story");
    await expect(page).toHaveTitle("dev@workstation: ~/projects/term-story");
    await run(page, "ls -l");
    await expect(terminal(page).getByText("ch-0001-chuong-1.md")).toBeVisible();
    await expect(terminal(page).getByText("ch-0003-chuong-3.md")).toBeVisible();

    await run(page, "less ch-0001-chuong-1.md");
    const pager = page.getByRole("document", { name: "ch-0001-chuong-1.md" });
    await expect(pager).toBeFocused();
    await expect(pager.getByText(/Đoạn 1 của term-story-1/)).toBeVisible();
    // Pictures are a placeholder line, never loaded.
    await expect(pager.getByText("[image: minh họa]")).toBeVisible();
    await expect(page.locator("img")).toHaveCount(0);
    await expect(pager.getByRole("status")).toContainText("ch-0001-chuong-1.md lines 1-");
    await expect(page).toHaveTitle("less ch-0001-chuong-1.md");

    // ] (or :n) is the next file; the pager's own prompt has a button for it too.
    await page.keyboard.press("]");
    const second = page.getByRole("document", { name: "ch-0002-chuong-2.md" });
    await expect(second.getByText(/Đoạn 1 của term-story-2/)).toBeVisible();
    await expect(second.getByRole("status")).toContainText("(file 2 of 3)");
    await second.getByRole("button", { name: "Previous file" }).click();
    await expect(page.getByRole("document", { name: "ch-0001-chuong-1.md" })).toBeVisible();

    // Search: the match is marked, and q goes back to the prompt.
    await page.keyboard.type("/term-story-1");
    await page.keyboard.press("Enter");
    await expect(page.locator("mark").first()).toHaveText("term-story-1");
    await page.keyboard.press("q");
    await expect(prompt(page)).toBeFocused();
    await expect(page).toHaveTitle("dev@workstation: ~/projects/term-story");

    // The third file is not downloaded: less says so instead of opening it.
    await run(page, "less ch-0003-chuong-3.md");
    await expect(terminal(page).getByText("ch-0003-chuong-3.md: Not downloaded yet.")).toBeVisible();
    await run(page, "frobnicate");
    await expect(terminal(page).getByText("zsh: command not found: frobnicate")).toBeVisible();
  });

  test("tab completes names and less picks up where the reader left off", async ({ page }) => {
    await seedStory({ title: "Resume story", chapters: threeChapters("resume-story", 40) });
    await page.goto("/");
    await chooseTerminal(page);

    await prompt(page).fill("cd resume-st");
    await prompt(page).press("Tab");
    await expect(prompt(page)).toHaveValue("cd resume-story/");
    await prompt(page).press("Enter");
    await expect(page).toHaveTitle("dev@workstation: ~/projects/resume-story");
    // Completion needs the folder's file list, which the first ls loads.
    await run(page, "ls");
    await expect(terminal(page).getByText("ch-0002-chuong-2.md")).toBeVisible();

    await prompt(page).fill("less ch-0002");
    await prompt(page).press("Tab");
    await expect(prompt(page)).toHaveValue("less ch-0002-chuong-2.md ");
    await prompt(page).press("Enter");
    const pager = page.getByRole("document", { name: "ch-0002-chuong-2.md" });
    await expect(pager.getByRole("status")).toContainText("lines 1-");
    await page.keyboard.press("G");
    await expect(pager.getByRole("status")).toContainText("(END)");
    await page.keyboard.press("q");

    // No file named: the one read last, at the line that was on top.
    await run(page, "less");
    const again = page.getByRole("document", { name: "ch-0002-chuong-2.md" });
    await expect(again).toBeVisible();
    await expect(again.getByRole("status")).not.toContainText("lines 1-");
  });

  test("neutral names hide every title", async ({ page }) => {
    await resetLibrary();
    await seedStory({ title: "Secret term story", chapters: threeChapters("secret-term") });
    await page.goto("/");
    await chooseTerminal(page, { neutral: true });

    await run(page, "ls");
    await expect(terminal(page).getByText("module-01", { exact: true })).toBeVisible();
    await run(page, "cd module-01");
    await expect(page).toHaveTitle("dev@workstation: ~/projects/module-01");
    await run(page, "ls");
    await expect(terminal(page).getByText(/part-0001\.md/)).toBeVisible();
    await run(page, "less part-0001.md");
    const pager = page.getByRole("document", { name: "part-0001.md" });
    await expect(pager.getByText(/Đoạn 1 của secret-term-1/)).toBeVisible();
    // The chapter's own title heading is left out too; its text is not.
    await expect(pager.getByText("Chương secret-term-1")).toHaveCount(0);
    await expect(page.getByText(/secret-term-story|Secret term story/i)).toHaveCount(0);
    await expect(page).toHaveTitle("less part-0001.md");
  });

  test("the boss key works from the prompt and the pager", async ({ page }) => {
    await seedStory({ title: "Boss term", chapters: threeChapters("boss-term") });
    await page.goto("/");
    await chooseTerminal(page);
    await run(page, "cd boss-term");
    await expect(page).toHaveTitle("dev@workstation: ~/projects/boss-term");

    // The window's size in the title bar, which the decoy must not change.
    const size = (await page.getByText(/^\d+×\d+$/).first().textContent()) ?? "";
    expect(size).toMatch(/^\d+×\d+$/);

    // From the prompt: nobody types a backquote at a shell prompt here.
    await page.keyboard.press("Backquote");
    const decoy = page.locator("[data-stealth-decoy]");
    await expect(decoy).toBeVisible();
    await expect(page).toHaveTitle("dev@workstation: ~/projects/budget-service");
    await expect(decoy.getByText(size, { exact: true })).toBeVisible();
    await expect(decoy.getByText(/^Last login: /)).toBeVisible();
    await expect(decoy.getByText(/Test Suites:/).first()).toBeVisible();
    await expect(decoy.getByText(/Đoạn/)).toHaveCount(0);
    await page.keyboard.press("Backquote");
    await expect(decoy).toHaveCount(0);
    await expect(page).toHaveTitle("dev@workstation: ~/projects/boss-term");
    await expect(prompt(page)).toHaveValue("");

    await run(page, "less ch-0001-chuong-1.md");
    await expect(page.getByRole("document", { name: "ch-0001-chuong-1.md" })).toBeFocused();
    await page.keyboard.press("Backquote");
    await expect(decoy).toBeVisible();
    await page.keyboard.press("Backquote");
    await expect(decoy).toHaveCount(0);
    await expect(page).toHaveTitle("less ch-0001-chuong-1.md");
  });

  test("the palette and the menu reach the normal view and the looks", async ({ page }) => {
    await seedStory({ title: "Menu term", chapters: threeChapters("menu-term") });
    await page.goto("/");
    await chooseTerminal(page);
    await run(page, "less menu-term/ch-0001-chuong-1.md");
    await expect(page.getByRole("document", { name: "ch-0001-chuong-1.md" })).toBeVisible();

    // The title bar's menu: the normal view at the file being read, then back.
    await page.getByRole("button", { name: "Terminal menu" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Terminal" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitem", { name: "Open in the normal view" }).click();
    await expect(page.getByRole("dialog", { name: "Reading Menu term" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to Terminal" }).click();
    await expect(terminal(page)).toBeVisible();

    // The palette, from its button and from F1.
    await page.getByRole("button", { name: "Show and run commands" }).click();
    const palette = page.getByRole("dialog", { name: /command/i });
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await page.keyboard.press("F1");
    await expect(palette).toBeVisible();
    // The other looks are found by typing, never listed on the open palette.
    await expect(palette.getByRole("option", { name: "Settings", exact: true })).toBeVisible();
    await expect(palette.getByRole("option", { name: /Switch look/ })).toHaveCount(0);
    await page.keyboard.type("look");
    await expect(palette.getByRole("option", { name: "Switch look: Team chat" })).toBeVisible();
    await palette.getByRole("textbox").fill("settings");
    await page.keyboard.press("Enter");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Normal", exact: true }).click();
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
    await expect(page).toHaveTitle("Web → EPUB cho Kindle");
  });

  test("sync downloads the rest with progress and never prints an address", async ({ page }) => {
    test.setTimeout(120_000);
    await seedStory({ title: "Term sync", chapters: threeChapters("term-sync") });
    await page.goto("/");
    await chooseTerminal(page);
    await run(page, "cd term-sync");
    await expect(page).toHaveTitle("dev@workstation: ~/projects/term-sync");

    await run(page, "sync");
    // The prompt comes back once the download has finished, with a full bar above it.
    await expect(terminal(page).getByText(/\[#+\] 1\/1 100%/).first()).toBeVisible({ timeout: 90_000 });
    // While it runs the tab is titled by the command; the shell's own title is back after.
    await expect(page).toHaveTitle("dev@workstation: ~/projects/term-sync", { timeout: 30_000 });
    await expect(terminal(page)).not.toContainText("http");

    // The download renamed the file after the page's own title ("Chương 3: Kiểm thử …"), so
    // complete the name the way a reader would, with Tab.
    await prompt(page).fill("head -n 40 ch-0003");
    await prompt(page).press("Tab");
    await expect(prompt(page)).toHaveValue(/^head -n 40 ch-0003-chuong-3-[\w-]+\.md\s?$/);
    await prompt(page).press("Enter");
    await expect(terminal(page).getByText(/E2E-term-sync-3-0/)).toBeVisible();
    await expect(terminal(page)).not.toContainText("127.0.0.1");
  });

  test("the skin and its tab title are back before the app has loaded", async ({ page }) => {
    await page.goto("/");
    await chooseTerminal(page);
    await expect(page).toHaveTitle("dev@workstation: ~/projects");

    // With the app's script blocked, only index.html's pre-paint script can set the title.
    await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
    await page.reload();
    await expect(page).toHaveTitle("dev@workstation: ~/projects");
    await expect(page.locator("html")).toHaveAttribute("data-skin", "term");
  });
});
