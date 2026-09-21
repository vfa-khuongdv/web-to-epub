import fs from "fs";
import path from "path";
import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { APP_URL, DATA_DIR, REPO_ROOT } from "../helpers/env";
import { seedStory } from "../helpers/seed";

// The settings are one row in the library's database, so these tests share state with
// each other and with every later file: each one puts back what it changed.
test.describe.configure({ mode: "serial" });

// A retry must not inherit the settings a failed attempt left behind.
test.beforeAll(async () => {
  const res = await fetch(`${APP_URL}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoScanOnOpen: true, defaultBookLanguage: "vi", defaultAuthor: "" }),
  });
  if (!res.ok) throw new Error(`Could not reset settings: ${res.status}`);
});

const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { version: string }
).version;

async function openSettings(page: Page) {
  await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const panel = page.getByRole("dialog", { name: "Settings" });
  await expect(panel).toBeVisible();
  return panel;
}

// Every control saves on change, so a test that reloads has to know the write landed.
function settingsSaved(page: Page) {
  return page.waitForResponse(
    (response) => response.url().includes("/api/settings") && response.request().method() === "PATCH"
  );
}

test("reports the real version and library folder", async ({ page }) => {
  await page.goto("/");
  const panel = await openSettings(page);
  await expect(panel.getByText(PACKAGE_VERSION, { exact: true })).toBeVisible();
  await expect(panel.getByText(DATA_DIR, { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
});

test("turns the launch check off, and the library stops checking", async ({ page }) => {
  await seedStory({ title: "Autoscan story", chapters: [], watching: true });

  // The check fails on a fixture story (no TOC adapter) — that a request is sent at all
  // is the point, not its answer.
  let checks = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/check")) checks++;
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
  await expect.poll(() => checks).toBeGreaterThan(0);

  const panel = await openSettings(page);
  const toggle = panel.getByRole("checkbox", { name: "Check for new chapters when the app opens" });
  await expect(toggle).toBeChecked();
  // click(), not uncheck(): the box is controlled by the saved value, so it only shows
  // the new state once the server has taken it.
  await Promise.all([settingsSaved(page), toggle.click()]);
  await expect(toggle).not.toBeChecked();
  await panel.getByRole("button", { name: "Close" }).click();

  checks = 0;
  await page.reload();
  await expect(page.getByRole("heading", { name: "My Stories" })).toBeVisible();
  // There is nothing to wait for when the setting works, so the check gets a window to
  // happen in and has to stay away for all of it.
  await page.waitForTimeout(700);
  expect(checks).toBe(0);

  // Back on: the setting survives a reload in both directions, and the library resumes.
  const reopened = await openSettings(page);
  const restored = reopened.getByRole("checkbox", { name: "Check for new chapters when the app opens" });
  await expect(restored).not.toBeChecked();
  await Promise.all([settingsSaved(page), restored.click()]);
  await expect(restored).toBeChecked();
  await reopened.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect.poll(() => checks).toBeGreaterThan(0);
});

test("remembers the default author for new books", async ({ page }) => {
  await page.goto("/");
  const panel = await openSettings(page);
  const author = panel.getByLabel("Author", { exact: true });
  await author.fill("Người dịch");
  await Promise.all([settingsSaved(page), author.blur()]);

  await page.reload();
  const reopened = await openSettings(page);
  const saved = reopened.getByLabel("Author", { exact: true });
  await expect(saved).toHaveValue("Người dịch");

  await saved.fill("");
  await Promise.all([settingsSaved(page), saved.blur()]);
});
