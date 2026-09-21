import { test, expect } from "../helpers/fixtures";

// Runs after other specs alphabetically, so it must not assume an empty library.
test("app boots and lists the supported sites", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
  await expect(page.getByRole("button", { name: "6 sites supported" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Story details" })).toBeVisible();
});
