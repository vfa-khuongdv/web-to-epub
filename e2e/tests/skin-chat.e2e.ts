import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { blocksFor, fixtureChapterUrl, resetLibrary, seedStory } from "../helpers/seed";

// The team-chat skin, picked through Settings the way a reader does; the skin is kept in
// localStorage, which every test starts without.
async function chooseChat(page: Page, options: { neutral?: boolean } = {}) {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  if (options.neutral) await settings.getByRole("checkbox", { name: "Neutral names" }).check();
  await settings.getByRole("button", { name: "Team chat", exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toHaveCount(0);
}

// Titles carry "Chương N", which the chat never shows: a subtitle is kept, a bare label
// becomes a numbered thread.
function threeChapters(slug: string) {
  return [
    { title: "Chương 1: Mở đầu", url: fixtureChapterUrl(slug, 1), status: "done" as const, blocks: blocksFor(`${slug}-1`) },
    { title: "Chương 2", url: fixtureChapterUrl(slug, 2), status: "done" as const, blocks: blocksFor(`${slug}-2`) },
    { title: "Chương 3: Hẹn gặp", url: fixtureChapterUrl(slug, 3) },
  ];
}

const spaces = (page: Page) => page.getByRole("list", { name: "Spaces" });
const messages = (page: Page) => page.getByRole("region", { name: "Messages" });
const composer = (page: Page) => page.getByRole("combobox", { name: /^Message / });

test.describe("team chat skin", () => {
  test("lists stories as spaces and reads a chapter as a thread of messages", async ({ page }) => {
    await seedStory({ title: "Chat story", chapters: threeChapters("chat-story") });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
    await chooseChat(page);

    // The real app is gone, title and all; Home lists the space.
    await expect(page.getByRole("heading", { name: "My Stories" })).toHaveCount(0);
    await expect(page).toHaveTitle("Chat");
    await expect(page.getByRole("list", { name: "Home" }).getByRole("button", { name: /chat-story/ })).toBeVisible();

    // Never opened: both downloaded parts count as unread.
    await spaces(page).getByRole("button", { name: /^chat-story/ }).click();
    await expect(page).toHaveTitle("Chat – chat-story");
    const thread = messages(page);
    await expect(thread.getByText(/Đoạn 1 của chat-story-1/)).toBeVisible();
    // Pictures are a chip naming them, never loaded.
    await expect(thread.getByText("[image: minh họa]")).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(0);

    // No "Chương" anywhere — header, threads, the conversation's own title heading.
    await expect(page.getByText(/^\d+ members · Mở đầu$/)).toBeVisible();
    await expect(page.getByText(/Chương/)).toHaveCount(0);

    // ] moves to the next thread from the messages, which take the keys without a frame.
    await thread.focus();
    await page.keyboard.press("]");
    await expect(thread.getByText(/Đoạn 1 của chat-story-2/)).toBeVisible();
    await expect(thread).toBeFocused();
    await expect(thread).toHaveCSS("box-shadow", "none");

    // The visible control at the end of the thread goes back, and the last one says so.
    await thread.getByRole("button", { name: "Previous thread" }).click();
    await expect(thread.getByText(/Đoạn 1 của chat-story-1/)).toBeVisible();
    await thread.getByRole("button", { name: "Mark as read and go to next" }).click();
    await expect(thread.getByText(/Đoạn 1 của chat-story-2/)).toBeVisible();
    await expect(thread.getByText("You're all caught up")).toBeVisible();

    // The threads panel lists every part; the one not downloaded does not open.
    await page.getByRole("button", { name: "Threads" }).click();
    const panel = page.getByRole("complementary", { name: "Threads" });
    await expect(panel.getByRole("button", { name: "Hẹn gặp" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Thread 0002" })).toBeVisible();
    await expect(panel.getByText(/Chương/)).toHaveCount(0);
    await panel.getByRole("button", { name: "Mở đầu" }).click();
    await expect(thread.getByText(/Đoạn 1 của chat-story-1/)).toBeVisible();
  });

  test("the composer runs slash commands and keeps plain text on this screen", async ({ page }) => {
    await seedStory({ title: "Slash story", chapters: threeChapters("slash-story") });
    await page.goto("/");
    await chooseChat(page);
    await spaces(page).getByRole("button", { name: /^slash-story/ }).click();
    await expect(messages(page).getByText(/Đoạn 1 của slash-story-1/)).toBeVisible();

    await composer(page).click();
    await page.keyboard.type("/");
    await expect(page.getByRole("listbox", { name: "Commands" }).getByRole("option", { name: /\/next/ })).toBeVisible();
    await page.keyboard.type("next");
    await page.keyboard.press("Enter");
    await expect(messages(page).getByText(/Đoạn 1 của slash-story-2/)).toBeVisible();

    // Alt+↑ works from the composer too.
    await page.keyboard.press("Alt+ArrowUp");
    await expect(messages(page).getByText(/Đoạn 1 của slash-story-1/)).toBeVisible();

    await page.keyboard.type("ghi chú riêng");
    await page.keyboard.press("Enter");
    await expect(messages(page).getByText("ghi chú riêng")).toBeVisible();
    await expect(composer(page)).toHaveValue("");
  });

  test("neutral names hide every title", async ({ page }) => {
    await seedStory({ title: "Secret chat", chapters: threeChapters("secret-chat") });
    await page.goto("/");
    await chooseChat(page, { neutral: true });

    await expect(spaces(page).getByRole("button", { name: /^Team \d\d/ }).first()).toBeVisible();
    await expect(page.getByText("secret-chat", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Secret chat")).toHaveCount(0);

    await spaces(page).getByRole("button", { name: /^Team \d\d/ }).first().click();
    await expect(page).toHaveTitle(/^Chat – Team \d\d$/);
    // The chapter's own title heading is left out too; its text is not.
    await expect(messages(page).getByText(/Đoạn 1 của secret-chat-1/)).toBeVisible();
    await expect(page.getByText("Chương secret-chat-1")).toHaveCount(0);
    await page.getByRole("button", { name: "Threads" }).click();
    const panel = page.getByRole("complementary", { name: "Threads" });
    await expect(panel.getByRole("button", { name: /Thread 0001/ })).toBeVisible();
    await expect(panel.getByText(/Chương|Mở đầu|Hẹn gặp/)).toHaveCount(0);
  });

  test("the boss key shows the project space decoy, even from the composer", async ({ page }) => {
    await seedStory({ title: "Boss chat", chapters: threeChapters("boss-chat") });
    await page.goto("/");
    await chooseChat(page);
    await spaces(page).getByRole("button", { name: /^boss-chat/ }).click();
    await expect(page).toHaveTitle("Chat – boss-chat");

    // Nobody types a backquote in a chat line: the boss key works from the composer.
    await composer(page).click();
    await page.keyboard.press("Backquote");
    const decoy = page.locator("[data-stealth-decoy]");
    await expect(decoy).toBeVisible();
    await expect(page).toHaveTitle("Chat – Dự án Cổng thanh toán");
    await expect(decoy.getByText(/Đoạn/)).toHaveCount(0);
    await expect(decoy.getByText("Review tiến độ UAT – Cổng thanh toán")).toBeVisible();

    await page.keyboard.press("Backquote");
    await expect(decoy).toHaveCount(0);
    await expect(page).toHaveTitle("Chat – boss-chat");
  });

  test("the account menu and the search box reach the normal view and the other looks", async ({ page }) => {
    await seedStory({ title: "Menu chat", chapters: threeChapters("menu-chat") });
    await page.goto("/");
    await chooseChat(page);
    await spaces(page).getByRole("button", { name: /^menu-chat/ }).click();
    await expect(messages(page).getByText(/Đoạn 1 của menu-chat-1/)).toBeVisible();

    await page.getByRole("button", { name: "Account" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Team chat" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitem", { name: "Open in the normal view" }).click();
    await expect(page.getByRole("dialog", { name: "Reading Menu chat" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to Team chat" }).click();
    await expect(spaces(page)).toBeVisible();

    // The search box is the command list; it finds spaces by name, too. The other looks
    // are not listed until something is typed.
    await page.getByRole("button", { name: "Show and run commands" }).first().click();
    const palette = page.getByRole("dialog", { name: /command/i });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("option", { name: /^menu-chat/ })).toBeVisible();
    await expect(palette.getByRole("option", { name: /Switch look/ })).toHaveCount(0);
    await page.keyboard.type("look");
    await expect(palette.getByRole("option", { name: "Switch look: Terminal" })).toBeVisible();
    await palette.getByRole("textbox").fill("settings");
    await page.keyboard.press("Enter");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Normal", exact: true }).click();
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
    await expect(page).toHaveTitle("Web → EPUB cho Kindle");
  });

  test("an empty library says so in the chat's own way", async ({ page }) => {
    await resetLibrary();
    await page.goto("/");
    await chooseChat(page);
    await expect(page.getByText("No spaces yet. Add them in the normal view.")).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Open in the normal view" }).click();
    await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
  });
});
