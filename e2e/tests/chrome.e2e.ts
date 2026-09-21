import { test, expect } from "../helpers/fixtures";
import { fixtureChapterUrl, seedStory } from "../helpers/seed";

test.describe.configure({ timeout: 120_000 });

test("switches language and persists it", async ({ page }) => {
  await page.goto("/");
  // The accessible name is translated along with the UI, so identify the button by its
  // visible code span instead; EN/VI upper-casing is CSS, hence useInnerText.
  const langButton = page.locator("header button:has(span.uppercase)");
  await expect(page.getByRole("button", { name: /^Language:/ })).toBeVisible();
  await expect(langButton).toContainText("EN", { useInnerText: true });

  await langButton.click();
  await expect(page.getByRole("heading", { name: "Truyện của tôi" })).toBeVisible();
  await expect(langButton).toContainText("VI", { useInnerText: true });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Truyện của tôi" })).toBeVisible();
});

test("cycles and persists the theme", async ({ page }) => {
  await page.goto("/");
  const themeButton = page.getByRole("button", { name: /^Theme:/ });

  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("lists supported sites and closes the popover with Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "6 sites supported" }).click();
  const heading = page.getByRole("heading", { name: "Supported sites" });
  await expect(heading).toBeVisible();

  for (const domain of ["xtruyen.vn", "truyenfull.vn", "truyenhoan.com", "wattpad.com"]) {
    await expect(page.getByRole("link", { name: new RegExp(domain.replace(".", "\\.")) })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(heading).toHaveCount(0);
});

test("replaces the sites button with a crawl chip while crawling", async ({ page }) => {
  await seedStory({
    title: "Chrome crawl",
    chapters: [{ title: "Chương 1", url: fixtureChapterUrl("chrome-crawl", 1) }],
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Chrome crawl", exact: true }).click();
  await page.getByRole("button", { name: "Continue crawl (1 chapters)" }).click();
  await expect(page.locator("header").getByText(/^Crawling/)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Downloaded 1 chapters" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole("button", { name: "6 sites supported" })).toBeVisible();
});
