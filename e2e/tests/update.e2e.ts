import { test, expect } from "../helpers/fixtures";

const notes = [
  "Adds an AI crawler and two book sources.",
  "",
  "## AI crawler",
  "",
  "- **Read any site** with AI.",
  "- A <script>window.__pwned = true</script> in the notes stays plain text.",
  "- [Docs](https://example.test/docs) open in a new tab.",
].join("\n");

test("the update dialog shows what the release itself says is new", async ({ page }) => {
  await page.route("**/api/app-update", (route) =>
    route.fulfill({
      json: {
        current: "1.6.1",
        latest: "1.7.0",
        hasUpdate: true,
        releaseUrl: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.7.0",
        zipUrl: null,
        notes,
      },
    })
  );
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: "Update available" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Adds an AI crawler and two book sources.")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "AI crawler" })).toBeVisible();
  await expect(dialog.getByText("Read any site", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "https://example.test/docs");

  // Text from the network is never markup: the <script> is shown, not run, and no element was made.
  await expect(dialog.getByText("<script>window.__pwned = true</script>", { exact: false })).toBeVisible();
  await expect(dialog.locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
});

test("without notes the update dialog is as short as before", async ({ page }) => {
  await page.route("**/api/app-update", (route) =>
    route.fulfill({
      json: {
        current: "1.6.1",
        latest: "1.7.0",
        hasUpdate: true,
        releaseUrl: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.7.0",
        zipUrl: null,
        notes: null,
      },
    })
  );
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Update available" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("A new version v1.7.0 is available (you have v1.6.1).")).toBeVisible();
  await expect(dialog.getByText("What's new")).toHaveCount(0);
});
