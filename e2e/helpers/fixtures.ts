import { test as base, expect } from "@playwright/test";

// The app defaults to Vietnamese; pin English so accessible names match the t() keys.
// Only set when unset, so a test may switch language and reload without being reset.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("lang")) localStorage.setItem("lang", "en");
    });
    await use(page);
  },
});

export { expect };
