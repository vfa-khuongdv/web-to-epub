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

test("returns server errors in the selected language", async ({ page, request }) => {
  // The wrong-code message is phrased server-side (routes/vault.ts) with whichever
  // X-Lang the request carries, so it proves the header propagates. Configure the
  // vault through the API instead of the UI so no story setup is needed; a retry
  // finds lock.json already there and gets 409, which is just as good for this test.
  const setup = await request.post("/api/vault/setup", { data: { code: "135790" } });
  expect([200, 409]).toContain(setup.status());

  await page.goto("/");
  const langButton = page.locator("header button:has(span.uppercase)");
  await langButton.click();
  await expect(page.getByRole("heading", { name: "Truyện của tôi" })).toBeVisible();

  await page.keyboard.press("Control+Shift+K");
  const dialog = page.getByRole("dialog", { name: "Chế độ ẩn danh" });
  await expect(dialog).toBeVisible();
  for (let i = 1; i <= 6; i++) {
    await dialog.getByLabel(`Ô số ${i}`).fill("9");
  }

  const unlockResponse = page.waitForResponse(
    (res) => res.url().includes("/api/vault/unlock") && res.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "Mở" }).click();

  // The response body itself must be Vietnamese: the client fallback has the same
  // wording, so only the raw server message proves X-Lang did the work.
  const response = await unlockResponse;
  expect(response.status()).toBe(401);
  expect((await response.json()).message).toBe("Mã không đúng");
  await expect(dialog.getByRole("alert")).toHaveText("Mã không đúng");
});

test("cycles and persists the theme", async ({ page }) => {
  // Theme defaults to "system", so a fresh page must follow the emulated OS scheme.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const themeButton = page.getByRole("button", { name: /^Theme:/ });
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("lists supported sites and closes the popover with Escape", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "6 sites supported" }).click();
  const heading = page.getByRole("heading", { name: "Supported sites" });
  await expect(heading).toBeVisible();

  // Assert every domain the API returns, not a hard-coded subset.
  const { sites } = (await (await request.get("/api/supported-sites")).json()) as {
    sites: { domain: string }[];
  };
  for (const site of sites) {
    const domain = site.domain.replace(/\./g, "\\.");
    await expect(page.getByRole("link", { name: new RegExp(domain) })).toBeVisible();
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
