import fs from "fs";
import path from "path";
import { test, expect } from "../helpers/fixtures";
import { DATA_DIR } from "../helpers/env";

// The saved session is one file, shared by both tests here: each starts from no session
// and the import test leaves one behind only for itself.
test.describe.configure({ mode: "serial" });

const SESSION_FILE = path.join(DATA_DIR, "sessions", "asianfanfics.com.json");
const STORY_URL = "https://www.asianfanfics.com/story/view/1143593";
// The shape a browser's "Copy as cURL" produces: cookies in a header, UA included.
const NAMED_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjQxMDI0NDQ4MDAsIm5hbWUiOiJraHVvbmdkdiJ9.sig";
const CURL =
  "curl 'https://www.asianfanfics.com/story/view/1143593' " +
  `-H 'cookie: atokun=${NAMED_TOKEN}; cf_clearance=clear-value' -H 'user-agent: UA-TEST'`;

test.beforeEach(async ({ request }) => {
  await request.delete("/api/site-sessions/asianfanfics");
});

test("asks for a session before loading an Asianfanfics URL, then continues with it", async ({ page, request }) => {
  let created = 0;
  // The add continues once the session is saved. Answer it here so the test needs no
  // real network — only the dialog and the wiring are under test.
  await page.route("**/api/stories", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    created += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        story: {
          id: "canned",
          storyUrl: STORY_URL,
          site: "asianfanfics.com",
          title: "Canned story",
          watching: false,
          newChapterCount: 0,
          chapters: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("Story page URL").fill(STORY_URL);
  await page.getByRole("button", { name: "Load chapters" }).click();

  const dialog = page.getByRole("dialog", { name: "Asianfanfics session" });
  await expect(dialog).toBeVisible();

  // A cURL from another site is refused, and nothing is loaded.
  await dialog.getByLabel("cURL from your browser").fill("curl 'https://example.com/' -H 'cookie: a=1'");
  await dialog.getByRole("button", { name: "Save session" }).click();
  await expect(dialog.getByRole("alert")).toContainText("not for asianfanfics.com");
  expect(created).toBe(0);

  // A real one is saved, and the pending add continues by itself.
  await dialog.getByLabel("cURL from your browser").fill(CURL);
  await dialog.getByRole("button", { name: "Save session" }).click();
  await expect(dialog).toHaveCount(0);
  // The toast names the account that was imported.
  await expect(page.getByRole("status").filter({ hasText: "Saved login for khuongdv" })).toBeVisible();
  await expect.poll(() => created).toBe(1);
  expect(fs.existsSync(SESSION_FILE)).toBe(true);

  const status = await (await request.get("/api/site-sessions/asianfanfics")).json();
  expect(status).toMatchObject({ configured: true });
});

test("settings shows the saved session and removes it", async ({ page, request }) => {
  await request.post("/api/site-sessions/asianfanfics", { data: { curl: CURL } });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const panel = page.getByRole("dialog", { name: "Settings" });
  await expect(panel.getByText("A saved login is in use for rated-M and subscribers-only stories.")).toBeVisible();

  await expect(panel.getByRole("link", { name: "khuongdv" })).toHaveAttribute(
    "href",
    "https://www.asianfanfics.com/profile/u/khuongdv"
  );

  await panel.getByRole("button", { name: "Remove" }).click();
  await expect(
    panel.getByText("Rated-M and subscribers-only stories need a login saved from your own browser.")
  ).toBeVisible();
  expect(fs.existsSync(SESSION_FILE)).toBe(false);
});

// A token whose `exp` is long past: the app must treat it as needing a fresh import.
const EXPIRED_CURL =
  "curl 'https://www.asianfanfics.com/story/view/1426810' " +
  "-H 'cookie: atokun=eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjEwMDAwMDAwMDB9.sig' -H 'user-agent: UA-TEST'";

test("asks to import again when the saved login has expired", async ({ page, request }) => {
  await request.post("/api/site-sessions/asianfanfics", { data: { curl: EXPIRED_CURL } });

  await page.goto("/");
  await page.getByLabel("Story page URL").fill(STORY_URL);
  await page.getByRole("button", { name: "Load chapters" }).click();
  await expect(page.getByRole("dialog", { name: "Asianfanfics session" })).toBeVisible();
});

test("settings shows the saved login as expired", async ({ page, request }) => {
  await request.post("/api/site-sessions/asianfanfics", { data: { curl: EXPIRED_CURL } });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const panel = page.getByRole("dialog", { name: "Settings" });
  await expect(panel.getByText("Session has expired — import a fresh one.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Import session" })).toBeVisible();
});
