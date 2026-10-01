import type { Page } from "playwright";

// Asianfanfics gates every page behind an "Are you over 18?" click-through that is
// independent of login: it sets a cookie only when a real click happens (a plain
// request to the same href does not), so a session captured from a pasted cURL never
// carries it. Click it once per render so rendering behaves like an already-verified
// browser, same as the user's own.
export async function verifyAge(page: Page): Promise<void> {
  const ageGate = page.locator('a[href="/htmx/story/verify_age"]');
  if (await ageGate.count().catch(() => 0)) {
    await ageGate.first().click().catch(() => {});
    // The click reloads the page; without this the settle loop that follows starts
    // polling mid-navigation and reads a transient blank document as a real
    // BlankedPageError instead of waiting for the unlocked content.
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
}
