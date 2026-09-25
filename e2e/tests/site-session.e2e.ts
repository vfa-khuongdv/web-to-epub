import fs from "fs";
import path from "path";
import type { Locator } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { DATA_DIR } from "../helpers/env";
import { fixtureChapterUrl, seedStory } from "../helpers/seed";

// The saved sessions are per-site files: each test starts from none and the import tests
// leave one behind only for themselves.
test.describe.configure({ mode: "serial" });

const SESSION_FILE = path.join(DATA_DIR, "sessions", "asianfanfics.com.json");
const TRUYENFULL_SESSION_FILE = path.join(DATA_DIR, "sessions", "truyenfull.live.json");
const STORY_URL = "https://www.asianfanfics.com/story/view/1143593";
// The shape a browser's "Copy as cURL" produces: cookies in a header, UA included.
const NAMED_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjQxMDI0NDQ4MDAsIm5hbWUiOiJraHVvbmdkdiJ9.sig";
const CURL =
  "curl 'https://www.asianfanfics.com/story/view/1143593' " +
  `-H 'cookie: atokun=${NAMED_TOKEN}; cf_clearance=clear-value' -H 'user-agent: UA-TEST'`;
// TruyenFull's session is only the Cloudflare pass — no account, no login token.
const TRUYENFULL_CURL =
  "curl 'https://truyenfull.live/huyet-mach-khong-the-danh-trao-free/' " +
  "-H 'cookie: cf_clearance=tf-clearance' -H 'user-agent: UA-MAC'";

// One site's row in Settings → Site sessions. Both rows carry the same button names, so
// tests scope to the row by its label (the hint and controls sit in the same wrapper).
function sessionRow(panel: Locator, label: string): Locator {
  return panel.getByText(label, { exact: true }).locator("..").locator("..");
}

test.beforeEach(async ({ request }) => {
  await request.delete("/api/site-sessions/asianfanfics");
  await request.delete("/api/site-sessions/truyenfull");
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

test("cookies a site refreshes during a crawl are written back to the session file", async ({
  page,
}) => {
  // The fixture page sets aff_token while it renders, the way asianfanfics.com refreshes
  // its short-lived access token. Without writing it back, every later render would start
  // from the stale snapshot the user pasted.
  const file = path.join(DATA_DIR, "sessions", "127.0.0.1.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      userAgent: "UA-FIXTURE",
      savedAt: "2026-01-01T00:00:00.000Z",
      origins: [],
      cookies: [{ name: "aff_token", value: "old", domain: "127.0.0.1", path: "/" }],
    })
  );

  try {
    await seedStory({
      title: "Cookie refresh",
      chapters: [
        { title: "Chương 1", url: fixtureChapterUrl("cookie-refresh", 1, { mode: "cookie" }) },
      ],
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Cookie refresh", exact: true }).click();
    await page.getByRole("button", { name: "Continue crawl (1 chapters)" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Downloaded 1 chapters" })).toBeVisible({
      timeout: 90_000,
    });

    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as {
      userAgent?: string;
      savedAt?: string;
      cookies: { name: string; value: string }[];
    };
    expect(saved.cookies.find((c) => c.name === "aff_token")?.value).toBe("refreshed");
    // The import details are not what changed — only the cookies are.
    expect(saved.userAgent).toBe("UA-FIXTURE");
    expect(saved.savedAt).toBe("2026-01-01T00:00:00.000Z");
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test("settings shows the saved session and removes it", async ({ page, request }) => {
  await request.post("/api/site-sessions/asianfanfics", { data: { curl: CURL } });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const panel = page.getByRole("dialog", { name: "Settings" });
  const row = sessionRow(panel, "Asianfanfics");
  await expect(row.getByText("A saved login is in use for rated-M and subscribers-only stories.")).toBeVisible();

  await expect(row.getByRole("link", { name: "khuongdv" })).toHaveAttribute(
    "href",
    "https://www.asianfanfics.com/profile/u/khuongdv"
  );

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(
    row.getByText("Rated-M and subscribers-only stories need a login saved from your own browser.")
  ).toBeVisible();
  expect(fs.existsSync(SESSION_FILE)).toBe(false);
});

test("settings imports and removes a TruyenFull Cloudflare session", async ({ page, request }) => {
  await request.post("/api/site-sessions/truyenfull", { data: { curl: TRUYENFULL_CURL } });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const panel = page.getByRole("dialog", { name: "Settings" });
  const row = sessionRow(panel, "TruyenFull");
  await expect(row.getByText("A saved browser session is in use to pass TruyenFull's Cloudflare check.")).toBeVisible();
  // cf_clearance carries no readable expiry, so the row shows when it was saved instead.
  await expect(row.getByText(/Saved /)).toBeVisible();
  expect(fs.existsSync(TRUYENFULL_SESSION_FILE)).toBe(true);

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row.getByText("TruyenFull needs a saved browser session to pass its Cloudflare check.")).toBeVisible();
  expect(fs.existsSync(TRUYENFULL_SESSION_FILE)).toBe(false);
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
  const row = sessionRow(panel, "Asianfanfics");
  await expect(row.getByText("Session has expired — import a fresh one.")).toBeVisible();
  await expect(row.getByRole("button", { name: "Import session" })).toBeVisible();
});
