import fs from "fs";
import path from "path";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { DATA_DIR, fixtureChapterUrl, privateStore, seedPrivateStory, seedStory } from "../helpers/seed";

const CODE = "135790";

test.describe.configure({ mode: "serial", timeout: 120_000 });

// setup() is file-based (services/vault.ts re-reads lock.json), so clearing the lock
// here makes the setup test idempotent when Playwright retries the serial group.
test.beforeAll(() => {
  fs.rmSync(path.join(DATA_DIR, "private", "lock.json"), { force: true });
});

async function pressVaultShortcut(page: Page) {
  // The keydown listener is installed in a mount effect, and the keypress is a one-shot
  // event: without waiting for the app, the page silently swallows it.
  await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
  await page.keyboard.press("Control+Shift+K");
  const dialog = page.getByRole("dialog", { name: "Private mode" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillPin(scope: Locator, code: string) {
  for (let i = 1; i <= 6; i++) {
    await scope.getByLabel(`Digit ${i}`).fill(code[i - 1]);
  }
}

test("creates a code and keeps the private library isolated", async ({ page }) => {
  await seedStory({ title: "Public story", chapters: [] });
  await seedPrivateStory({ title: "Private story", chapters: [] });

  await page.goto("/");
  const dialog = await pressVaultShortcut(page);
  await expect(dialog.getByText("Set a code for private mode")).toBeVisible();
  await fillPin(dialog.getByRole("group", { name: "New code" }), CODE);
  await fillPin(dialog.getByRole("group", { name: "Repeat the code" }), CODE);
  await dialog.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("button", { name: "Private", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Private story", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Public story", exact: true })).toHaveCount(0);
});

test("crawls a private story with live progress", async ({ page }) => {
  const privateStory = await seedPrivateStory({
    title: "Private crawl",
    chapters: [{ title: "Chương 1", url: fixtureChapterUrl("private-crawl", 1) }],
  });

  await page.goto("/");
  const dialog = await pressVaultShortcut(page);
  await fillPin(dialog.getByRole("group", { name: "Code" }), CODE);
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("button", { name: "Private", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Private crawl", exact: true }).click();
  await page.getByRole("button", { name: "Continue crawl (1 chapters)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Downloaded 1 chapters" })).toBeVisible({
    timeout: 90_000,
  });

  const stored = await privateStore().get(privateStory.id);
  expect(stored?.chapters[0].status).toBe("done");
});

test("locking returns to the public library", async ({ page }) => {
  await page.goto("/");
  const dialog = await pressVaultShortcut(page);
  await fillPin(dialog.getByRole("group", { name: "Code" }), CODE);
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("button", { name: "Private", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Private", exact: true }).click();
  await expect(page.getByRole("button", { name: "Public story", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Private crawl", exact: true })).toHaveCount(0);
});

test("rejects a wrong code", async ({ page }) => {
  await page.goto("/");
  const dialog = await pressVaultShortcut(page);
  await fillPin(dialog.getByRole("group", { name: "Code" }), "999999");
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Wrong code");
});

test("drops to the public library when the session token goes stale", async ({ page, request }) => {
  await page.goto("/");
  const tokenRequest = page.waitForRequest(
    (req) => req.url().includes("/api/stories") && !!req.headers()["x-vault-token"]
  );
  const dialog = await pressVaultShortcut(page);
  await fillPin(dialog.getByRole("group", { name: "Code" }), CODE);
  await dialog.getByRole("button", { name: "Open" }).click();
  const token = (await tokenRequest).headers()["x-vault-token"]!;
  await expect(page.getByRole("button", { name: "Private", exact: true })).toBeVisible();

  // Invalidate the session server-side, leaving the frontend holding a stale token.
  await request.post("/api/vault/lock", { headers: { "X-Vault-Token": token } });
  await page.getByRole("button", { name: "Private crawl", exact: true }).click();

  await expect(page.getByRole("button", { name: "Private" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Public story", exact: true })).toBeVisible();
});
