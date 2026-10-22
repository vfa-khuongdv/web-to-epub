import { test as base, expect } from "@playwright/test";

// The app defaults to Vietnamese; pin English so accessible names match the t() keys.
// Only set when unset, so a test may switch language and reload without being reset.
// The launch update check asks GitHub for the latest release: whenever one is newer than
// this checkout, its dialog covers the page and every click times out. Answer "none".
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**/api/app-update", (route) => route.fulfill({ json: { hasUpdate: false } }));
    await page.addInitScript(() => {
      if (!localStorage.getItem("lang")) localStorage.setItem("lang", "en");
    });
    await use(page);
  },
});

export { expect };
