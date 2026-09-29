# Archive.org Session + Borrow-Page Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reader save an archive.org login (cURL session) and import borrow-only books as page-image chapters by riding a browse/borrow session — the book from `https://archive.org/details/namiyazakkatenno0000higa/page/n161/mode/2up` imports instead of being refused.

**Architecture:** A new service `src/services/archiveBorrow.ts` talks to the BookReader's own endpoints (details page → `BookReaderJSIA.php` → `/services/loans/loan` → `/services/bookreader/request_page` → `BookReaderPreview.php`) with the saved session's cookies, and builds an `ImportedBook` of image blocks (20 leaves per chapter). The existing `importArchiveItem` gains a `session` option and branches on `access-restricted-item`; a site-session slug makes archive.org a first-class session site in Settings and the add flow.

**Tech Stack:** Node 22 + TypeScript (backend), React 18 + Vite (frontend), vitest with mocked `fetch` (hermetic — tests never hit archive.org), JSDOM (already a dependency) for the details-page HTML, Playwright's `Cookie`/`StorageState` types already used by `siteSession.ts`.

**Spec:** `docs/superpowers/specs/2026-09-29-archive-borrow-import-design.md` (read it first; this plan argues from it)

## Global Constraints

- Node ≥ 22.5 (`node:sqlite`). No new runtime dependencies (jsdom, sharp, playwright types already present).
- Tests are hermetic: no live archive.org calls ever; inject `fetch` / stub `globalThis.fetch`.
- Server user-facing messages: English key in `t()`, Vietnamese entry added to `src/services/lang.ts` (module state `vi` map near line 220 where the other archive errors live).
- Frontend user-facing strings: the key IS the English source text; every new key must be added to BOTH `frontend/src/i18n/locales/en.ts` and `vi.ts` with identical `{placeholder}` sets (`frontend/src/i18n/locales.test.ts` fails otherwise). Keys already present (shared with Asianfanfics/TruyenFull dialog steps) must NOT be duplicated.
- Caps reused from existing code: `MAX_PAGES = 5000`, `PAGES_PER_CHUNK = 20` (`src/services/pdfImport.ts:8,13`), `MAX_ARCHIVE_FILE_BYTES = 100 MB`, cover cap `MAX_COVER_BYTES` (archiveImport), image cap `MAX_IMAGE_BYTES = 8 MB` (`src/services/epubImport.ts:14`, must be exported by Task 3).
- Product rules (spec): never decrypt LCP/ACSM, never fetch `private: true` files, no OCR, archive.org stays OUT of `SUPPORTED_SITES` (import-only), chapters are images so Narration reads nothing (accepted trait).
- UI: Tailwind utilities at the call site only; no new component classes in `styles.css`.
- Commit style: conventional prefixes, Vietnamese or English messages. Never stage unrelated dirty files (there are pre-existing `vietmessenger` edits — leave them alone).
- Verification commands: `npm test`, `npm run build` (tsc + vite), `npx tsc -p frontend --noEmit`, targeted runs via `npx vitest run <path>`.

---

### Task 1: Backend site-session plumbing for archive.org

**Files:**
- Modify: `src/services/siteSession.ts` (extract `siteSessionHeaders`, account-name fallback)
- Modify: `src/routes/siteSessions.ts:17-20` (slug allowlist)
- Test: `src/services/siteSession.test.ts`, `src/routes/siteSessions.test.ts`

**Interfaces:**
- Produces: `siteSessionHeaders(session: SiteSession, url: string): Record<string, string>` (used by Task 3–5), `sessionAccountName(session)` now also reads archive.org's `logged-in-user` cookie, route accepts `POST/GET/DELETE /api/site-sessions/archive`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/siteSession.test.ts` inside the top-level `describe("siteSession")` (the file already imports the module dynamically; add `import type { SiteSession } from "./siteSession";` at the top — a type-only import is erased, so it does not disturb the DATA_DIR-before-import rule):

```ts
it("gây header từ phiên đã lưu cho cả host kho của archive.org", () => {
  const session: SiteSession = {
    userAgent: "UA-ARCHIVE",
    cookies: [
      { name: "loan-x", value: "1-abc", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
      { name: "other", value: "z", domain: ".example.com", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
    ],
    origins: [],
  };
  const headers = siteSession.siteSessionHeaders(
    session,
    "https://ia601804.us.archive.org/BookReader/BookReaderPreview.php?page=leaf1"
  );
  expect(headers["User-Agent"]).toBe("UA-ARCHIVE");
  expect(headers.Cookie).toBe("loan-x=1-abc");
});

it("lấy tên tài khoản từ cookie logged-in-user của archive.org", () => {
  const session: SiteSession = {
    cookies: [
      { name: "logged-in-user", value: "tester%40example.com", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
    ],
    origins: [],
  };
  expect(siteSession.sessionAccountName(session)).toBe("tester@example.com");
});
```

Append to `src/routes/siteSessions.test.ts` inside its top-level describe (note: `existsSync` and `path` are already imported):

```ts
const ARCHIVE_CURL =
  `curl 'https://archive.org/details/namiyazakkatenno0000higa/page/n161/mode/2up' ` +
  `-H 'cookie: logged-in-user=tester%40example.com; logged-in-sig=sigvalue; loan-namiyazakkatenno0000higa=1790656967-abc' ` +
  `-H 'user-agent: UA-ARCHIVE'`;

it("nhập và đọc phiên archive.org, không lộ cookie", async () => {
  const post = await fetch(`${base}/api/site-sessions/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ curl: ARCHIVE_CURL }),
  });
  expect(post.status).toBe(200);
  const body = await post.json();
  expect(body.username).toBe("tester@example.com");
  expect(body.cookieCount).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toContain("sigvalue");

  const get = await fetch(`${base}/api/site-sessions/archive`);
  const status = await get.json();
  expect(status.configured).toBe(true);
  expect(status.username).toBe("tester@example.com");
  expect(existsSync(path.join(DATA_DIR, "sessions", "archive.org.json"))).toBe(true);

  const del = await fetch(`${base}/api/site-sessions/archive`, { method: "DELETE" });
  expect((await del.json()).removed).toBe(true);
  expect((await (await fetch(`${base}/api/site-sessions/archive`)).json()).configured).toBe(false);
});

it("chưa nhập phiên archive.org → configured false", async () => {
  const res = await fetch(`${base}/api/site-sessions/archive`);
  expect((await res.json()).configured).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/siteSession.test.ts src/routes/siteSessions.test.ts`
Expected: FAIL — `siteSessionHeaders is not a function`; route test fails with 404 `Unknown site session`.

- [ ] **Step 3: Implement**

In `src/services/siteSession.ts`, replace the body of `sessionRequestHeaders` (line ~78) with an exported session-based helper plus a thin wrapper (keeps truyenfull's callers unchanged):

```ts
/**
 * Headers that make a plain HTTP request to `url` look like the session's own browser:
 * the saved user agent plus the cookies that apply to the URL's host (a storage host
 * under .archive.org counts). Used by the sites whose pages are served in the raw HTML
 * (truyenfull.live), so they can skip the browser when the saved session is enough, and
 * by the archive.org borrow capture.
 */
export function siteSessionHeaders(session: SiteSession, url: string): Record<string, string> {
  const hostname = sessionHostname(url);
  if (!hostname) return {};
  const headers: Record<string, string> = {};
  if (session.userAgent) headers["User-Agent"] = session.userAgent;
  const cookies = (session.cookies ?? []).filter((cookie) => cookieAppliesToHost(cookie.domain, hostname));
  if (cookies.length > 0) headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  return headers;
}

export function sessionRequestHeaders(url: string): Record<string, string> {
  const session = loadSiteSession(url);
  return session ? siteSessionHeaders(session, url) : {};
}
```

Delete the old `sessionRequestHeaders` implementation (its `cookieAppliesToHost` calls move into `siteSessionHeaders`; `cookieAppliesToHost` stays where it is).

In `sessionAccountName` (line ~124), run the JWT loop first, then fall back to archive.org's plain cookie:

```ts
export function sessionAccountName(session: SiteSession): string | undefined {
  for (const cookie of session.cookies ?? []) {
    const payload = jwtPayload(cookie.value);
    if (!payload) continue;
    for (const claim of ["name", "preferred_username", "username", "nickname"]) {
      const value = payload[claim];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  // archive.org carries no JWT: its logged-in cookie is the plain (URL-encoded) email.
  for (const cookie of session.cookies ?? []) {
    if (cookie.name !== "logged-in-user" || !cookie.value.trim()) continue;
    try {
      return decodeURIComponent(cookie.value).trim();
    } catch {
      return cookie.value.trim();
    }
  }
  return undefined;
}
```

In `src/routes/siteSessions.ts`, extend the allowlist (keep the comment, append the line):

```ts
const SESSION_SITES: Record<string, string> = {
  asianfanfics: "asianfanfics.com",
  truyenfull: "truyenfull.live",
  archive: "archive.org",
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/siteSession.test.ts src/routes/siteSessions.test.ts src/services/toc/truyenfullTemplate.test.ts src/services/chapters/truyenfull.test.ts`
Expected: PASS (the last two files guard the `sessionRequestHeaders` refactor).

- [ ] **Step 5: Commit**

```bash
git add src/services/siteSession.ts src/routes/siteSessions.ts src/services/siteSession.test.ts src/routes/siteSessions.test.ts
git commit -m "feat(session): archive.org slug, shared session headers, logged-in-user account name"
```

---

### Task 2: Frontend session site entry + locales

**Files:**
- Modify: `frontend/src/lib/siteSessions.ts` (append to `SESSION_SITES`, line ~81)
- Modify: `frontend/src/i18n/locales/en.ts` (after line ~412, the TruyenFull skip note, before `// Narration (Settings)`)
- Modify: `frontend/src/i18n/locales/vi.ts` (same position)
- Test: `frontend/src/lib/siteSessions.test.ts` (new)

**Interfaces:**
- Produces: `SESSION_SITES` entry with `slug: "archive"`, `domain: "archive.org"` — consumed by `LibraryView` (Task 8) via `sessionSiteForUrl` and by Settings' `SiteSessionRow` automatically.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/siteSessions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SESSION_SITES, sessionSiteForUrl } from "./siteSessions";

describe("sessionSiteForUrl", () => {
  it("matches archive.org item URLs, deep links included", () => {
    expect(sessionSiteForUrl("https://archive.org/details/namiyazakkatenno0000higa/page/n161/mode/2up")?.slug).toBe(
      "archive"
    );
    expect(sessionSiteForUrl("https://www.archive.org/metadata/x")?.slug).toBe("archive");
    expect(sessionSiteForUrl("https://ia601804.us.archive.org/BookReader/x")?.slug).toBe("archive");
  });

  it("keeps the existing session sites", () => {
    expect(sessionSiteForUrl("https://www.asianfanfics.com/story/view/1")?.slug).toBe("asianfanfics");
    expect(sessionSiteForUrl("https://truyenfull.live/truyen/x/")?.slug).toBe("truyenfull");
    expect(sessionSiteForUrl("https://example.com/x")).toBeUndefined();
  });

  it("archive shows no expiry and skips cleanly", () => {
    const archive = SESSION_SITES.find((site) => site.slug === "archive");
    expect(archive?.domain).toBe("archive.org");
    expect(archive?.showsExpiry).toBe(false);
    expect(archive?.accountUrl).toBeUndefined();
    expect(archive?.skipNote).toContain("public items");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/lib/siteSessions.test.ts`
Expected: FAIL — `archive` entry undefined / slug mismatch.

- [ ] **Step 3: Implement the SESSION_SITES entry**

Append this object after the TruyenFull entry in `frontend/src/lib/siteSessions.ts` (before the closing `]` of `SESSION_SITES`). Steps 2, 3, 5 and note 1 deliberately reuse strings already in the locale files — do not reword them:

```ts
{
  slug: "archive",
  domain: "archive.org",
  label: "Internet Archive",
  dialogTitle: "Internet Archive session",
  dialogIntro:
    "Borrow-only books need a login saved from your own browser. The tool never sees your password — you log in there and paste a copy of the request.",
  dialogSteps: [
    "Log in to archive.org in your browser — the copy has to come from a page where you are already logged in.",
    "Open DevTools: press F12, or ⌥⌘I on a Mac (Safari: turn the Develop menu on first).",
    "Switch to the Network tab and reload the page (⌘R / Ctrl+R) so the request list fills up.",
    'Right-click the first archive.org request (the details page) → Copy → Copy as cURL. "Copy as cURL (bash)" works too.',
    "Paste it into the box below and save.",
  ],
  dialogNotes: [
    "A wrong request (an image, an ad) carries no login cookies — the app says so instead of saving it.",
    "The session lasts as long as archive.org keeps you signed in; import a fresh one when imports start failing.",
  ],
  placeholder: "curl 'https://archive.org/details/<id>' -H 'cookie: logged-in-user=…'",
  settingsConfiguredHint: "A saved login is in use for borrow-only Internet Archive books.",
  settingsEmptyHint: "Borrow-only Internet Archive books need a login saved from your own browser.",
  skipNote: "You can skip this — public items still import.",
  showsExpiry: false,
},
```

Also update the file's header comment (line 1–6) to mention archive.org: change "(see src/services/siteSession.ts). Asianfanfics needs a login for rated-M and subscribers-only stories; truyenfull.live pages sit behind a Cloudflare check the app cannot pass by itself, so it reuses the pass the reader's browser already has." to append: "archive.org needs a login so borrow-only books can be imported through the reader's own session (see src/services/archiveBorrow.ts)."

- [ ] **Step 4: Add the 8 new locale keys**

Add exactly these entries to the site-sessions block of `frontend/src/i18n/locales/en.ts` (identity values; the shared DevTools/Network/paste steps and the wrong-request note already exist — do not duplicate them). **Every key must be byte-identical to the string in `siteSessions.ts`** — `t()` is an exact-match lookup:

```ts
"Internet Archive session": "Internet Archive session",
"Borrow-only books need a login saved from your own browser. The tool never sees your password — you log in there and paste a copy of the request.":
  "Borrow-only books need a login saved from your own browser. The tool never sees your password — you log in there and paste a copy of the request.",
"Log in to archive.org in your browser — the copy has to come from a page where you are already logged in.":
  "Log in to archive.org in your browser — the copy has to come from a page where you are already logged in.",
'Right-click the first archive.org request (the details page) → Copy → Copy as cURL. "Copy as cURL (bash)" works too.':
  'Right-click the first archive.org request (the details page) → Copy → Copy as cURL. "Copy as cURL (bash)" works too.',
"The session lasts as long as archive.org keeps you signed in; import a fresh one when imports start failing.":
  "The session lasts as long as archive.org keeps you signed in; import a fresh one when imports start failing.",
"A saved login is in use for borrow-only Internet Archive books.":
  "A saved login is in use for borrow-only Internet Archive books.",
"Borrow-only Internet Archive books need a login saved from your own browser.":
  "Borrow-only Internet Archive books need a login saved from your own browser.",
"You can skip this — public items still import.": "You can skip this — public items still import.",
```

> Every key above is byte-identical to the string in `siteSessions.ts` (`t()` is an exact-match lookup). Verify with `grep -F "Right-click the first archive.org request" frontend/src/lib/siteSessions.ts frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/vi.ts` — three hits.

Add the same 8 keys to `frontend/src/i18n/locales/vi.ts` with these translations:

```ts
"Internet Archive session": "Phiên Internet Archive",
"Borrow-only books need a login saved from your own browser. The tool never sees your password — you log in there and paste a copy of the request.":
  "Sách cho mượn cần một đăng nhập lưu từ chính trình duyệt của bạn. Công cụ không bao giờ thấy mật khẩu — bạn đăng nhập ở đó rồi dán bản sao yêu cầu.",
"Log in to archive.org in your browser — the copy has to come from a page where you are already logged in.":
  "Đăng nhập archive.org trong trình duyệt — bản sao phải lấy từ trang khi bạn đã đăng nhập.",
'Right-click the first archive.org request (the details page) → Copy → Copy as cURL. "Copy as cURL (bash)" works too.':
  'Nhấp chuột phải vào yêu cầu archive.org đầu tiên (trang chi tiết) → Copy → Copy as cURL. "Copy as cURL (bash)" cũng được.',
"The session lasts as long as archive.org keeps you signed in; import a fresh one when imports start failing.":
  "Phiên theo thời gian archive.org giữ bạn đăng nhập; hãy nhập bản mới khi việc import bắt đầu thất bại.",
"A saved login is in use for borrow-only Internet Archive books.":
  "Đăng nhập đã lưu đang dùng cho sách cho mượn trên Internet Archive.",
"Borrow-only Internet Archive books need a login saved from your own browser.":
  "Sách cho mượn trên Internet Archive cần đăng nhập lưu từ chính trình duyệt của bạn.",
"You can skip this — public items still import.": "Có thể bỏ qua — mục công khai vẫn import được.",
```

> Same rule here: the key must match `siteSessions.ts` byte for byte (the `grep -F` check above covers `vi.ts` too).

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run frontend/src/lib/siteSessions.test.ts frontend/src/i18n/locales.test.ts && npx tsc -p frontend --noEmit`
Expected: PASS + clean typecheck (locales parity test enforces the key sets match).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/siteSessions.ts frontend/src/lib/siteSessions.test.ts frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/vi.ts
git commit -m "feat(session): Internet Archive entry in the site-session dialog and settings"
```

---

### Task 3: `archiveBorrow` — reader config + shared fixtures

**Files:**
- Create: `src/services/archiveBorrow.ts`
- Create: `src/services/__fixtures__/archiveBorrowFixtures.ts`
- Modify: `src/services/epubImport.ts:14` (export `MAX_IMAGE_BYTES`)
- Test: `src/services/archiveBorrow.test.ts` (new)

**Interfaces:**
- Consumes: `siteSessionHeaders(session, url)` from Task 1, `SiteSession` from `siteSession.ts`.
- Produces (relied on by Tasks 4–7):

```ts
export interface ReaderLeaf { leafNum: number; uri: string }
export interface ReaderConfig {
  bookId: string;
  subPrefix: string;
  bookTitle: string;
  leaves: ReaderLeaf[];          // sorted later by capture; here in API order
  lendingStatus: Record<string, unknown>;
  metadata: Record<string, unknown>;
}
export async function readerConfig(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<ReaderConfig>;
```

- Produces fixtures used by Tasks 4–6 tests: `JPEG`, `detailsHtml(configUrl)`, `jsiaBody(overrides)`, `ARCHIVE_BORROW_URLS` helper `borrowMock(...)`.

- [ ] **Step 1: Export the image cap**

In `src/services/epubImport.ts:14` change `const MAX_IMAGE_BYTES = 8 * 1024 * 1024;` to `export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;`.

- [ ] **Step 2: Write the failing tests**

Create `src/services/archiveBorrow.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SiteSession } from "./siteSession";
import { detailsHtml, jsiaBody, JPEG } from "./__fixtures__/archiveBorrowFixtures";
import { readerConfig } from "./archiveBorrow";

const SESSION: SiteSession = {
  cookies: [
    { name: "logged-in-user", value: "me%40x.com", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
  ],
  origins: [],
};

function baseMock(options: { html?: string; jsia?: unknown } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://archive.org/details/testitem")) {
      return new Response(options.html ?? detailsHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.includes("BookReaderJSIA.php")) {
      const body = options.jsia ?? jsiaBody({});
      if (body === null) return new Response("not found", { status: 404 });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 404 });
  });
}

describe("readerConfig", () => {
  it("reads the config url off the details page and fetches it as json on the storage host", async () => {
    const fetchImpl = baseMock();
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");

    expect(config.bookId).toBe("testitem");
    expect(config.subPrefix).toBe("testitem");
    expect(config.bookTitle).toBe("Namiya zakkaten no kiseki");
    expect(config.leaves.map((leaf) => leaf.leafNum)).toEqual([1, 2, 3]);
    expect(config.leaves[0].uri).toContain("BookReaderPreview.php");
    expect(config.lendingStatus.is_lendable).toBe(true);
    expect(config.metadata.creator).toBe("Keigo Higashino");

    const called = fetchImpl.mock.calls.map(([input]) => String(input));
    // format=jsonp must be rewritten to format=json, on the storage host — archive.org 404s it.
    const configCall = called.find((url) => url.includes("BookReaderJSIA.php"));
    expect(configCall).toContain("format=json");
    expect(configCall).not.toContain("format=jsonp");
    expect(configCall).toContain("ia601804.us.archive.org");
    expect(configCall).toContain("https://");
    // session headers ride both requests
    const headers = (fetchImpl.mock.calls[1]?.[1] as RequestInit)?.headers as Record<string, string>;
    expect(headers.Cookie).toContain("logged-in-user=me%40x.com");
  });

  it("fails clearly when the details page has no reader config", async () => {
    const fetchImpl = baseMock({ html: "<html><body>nothing here</body></html>" });
    await expect(readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem")).rejects.toThrow(
      /reader config/
    );
  });

  it("fails clearly when the config response has an unexpected shape", async () => {
    const fetchImpl = baseMock({ jsia: JSON.stringify({ data: { brOptions: { data: "no" } } }) });
    await expect(readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem")).rejects.toThrow(
      /unexpected shape/
    );
    const notJson = baseMock({ jsia: "<html>login</html>" });
    await expect(readerConfig(notJson as unknown as typeof fetch, SESSION, "testitem")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/services/archiveBorrow.test.ts`
Expected: FAIL — `Cannot find module './archiveBorrow'` (fixtures module also missing).

- [ ] **Step 4: Write the fixtures module**

Create `src/services/__fixtures__/archiveBorrowFixtures.ts`:

```ts
/**
 * Fixtures shaped like the live archive.org responses probed during design
 * (see docs/superpowers/specs/2026-09-29-archive-borrow-import-design.md §2).
 * Shared by archiveBorrow.test.ts, archiveImport.test.ts and the import route test.
 */

// Minimal JPEG magic bytes — the capture only checks the header before storing.
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]);

// The details page carries the reader config url in a hidden input; & must be
// escaped as in real HTML so JSDOM decodes it back on .value.
export function detailsHtml(configUrl = defaultConfigUrl()): string {
  return `<html><head><title>x</title></head><body><input class="js-bookreader" type="hidden" value='${configUrl.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'></body></html>`;
}

export function defaultConfigUrl(): string {
  return (
    "//ia601804.us.archive.org/BookReader/BookReaderJSIA.php?id=testitem" +
    "&itemPath=/24/items/testitem&server=ia601804.us.archive.org" +
    "&format=jsonp&subPrefix=testitem&requestUri=/details/testitem/mode/2up"
  );
}

export interface JsiaOverrides {
  leafCount?: number;
  bookTitle?: string;
  lendingStatus?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// BookReaderJSIA.php?format=json → { data: { brOptions, lendingInfo, metadata } }.
export function jsiaBody(overrides: JsiaOverrides = {}) {
  const leafCount = overrides.leafCount ?? 3;
  const leaves = Array.from({ length: leafCount }, (_, index) => ({
    leafNum: index + 1,
    uri:
      "https://ia601804.us.archive.org/BookReader/BookReaderPreview.php" +
      `?id=testitem&subPrefix=testitem&itemPath=/24/items/testitem` +
      `&server=ia601804.us.archive.org&page=leaf${index + 1}&fail=preview&`,
    width: 1414,
    height: 2048,
    pageType: index < 2 ? "Cover" : "Normal",
    viewable: true,
  }));
  return {
    data: {
      brOptions: {
        bookId: "testitem",
        subPrefix: "testitem",
        bookPath: "/24/items/testitem/testitem",
        server: "ia601804.us.archive.org",
        imageFormat: "jp2",
        bookTitle: overrides.bookTitle ?? "Namiya zakkaten no kiseki",
        data: [leaves],
      },
      lendingInfo: {
        lendingStatus: {
          is_lendable: true,
          active_borrows: 0,
          active_browses: 1,
          available_to_borrow: false,
          available_to_browse: false,
          ...overrides.lendingStatus,
        },
      },
      metadata: { identifier: "testitem", title: "Namiya zakkaten no kiseki", creator: "Keigo Higashino", language: "jpn", ...overrides.metadata },
    },
  };
}
```

- [ ] **Step 5: Write minimal implementation**

Create `src/services/archiveBorrow.ts`:

```ts
import { JSDOM } from "jsdom";
import { SiteSession, siteSessionHeaders } from "./siteSession";

/**
 * The reader's own endpoints for a borrow-only item, driven with the session the
 * reader saved from their browser. Files stay private and LCP stays encrypted —
 * only what the BookReader itself displays (page images) is captured, so the book
 * lands as image blocks, like a scanned PDF. Endpoints are pinned by
 * docs/superpowers/specs/2026-09-29-archive-borrow-import-design.md §2.
 */

export interface ReaderLeaf {
  leafNum: number;
  uri: string;
}

export interface ReaderConfig {
  bookId: string;
  subPrefix: string;
  bookTitle: string;
  leaves: ReaderLeaf[];
  lendingStatus: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export async function readerConfig(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<ReaderConfig> {
  const detailsUrl = `https://archive.org/details/${encodeURIComponent(id)}`;
  const details = await fetchImpl(detailsUrl, { headers: siteSessionHeaders(session, detailsUrl) });
  if (!details.ok) throw new Error(`archive details request failed (${details.status})`);
  const html = await details.text();
  const input = new JSDOM(html).window.document.querySelector("input.js-bookreader") as
    | (Element & { value?: string })
    | null;
  let configUrl: string | undefined;
  if (input?.value) {
    try {
      const parsed = JSON.parse(input.value) as { url?: unknown };
      if (typeof parsed.url === "string" && parsed.url) {
        configUrl = parsed.url.startsWith("//") ? `https:${parsed.url}` : parsed.url;
      }
    } catch {
      configUrl = undefined;
    }
  }
  if (!configUrl) throw new Error("archive reader config not found on the details page");

  // The endpoint lives on the storage host and only answers format=json there.
  const jsonUrl = configUrl.replace("format=jsonp", "format=json");
  const response = await fetchImpl(jsonUrl, { headers: siteSessionHeaders(session, jsonUrl) });
  if (!response.ok) throw new Error(`archive reader config request failed (${response.status})`);
  const body = (await response.json().catch(() => null)) as {
    data?: {
      brOptions?: { bookId?: unknown; subPrefix?: unknown; bookTitle?: unknown; data?: unknown };
      lendingInfo?: { lendingStatus?: unknown };
      metadata?: unknown;
    };
  } | null;
  const brOptions = body?.data?.brOptions;
  if (!brOptions || !Array.isArray(brOptions.data)) throw new Error("archive reader config has an unexpected shape");

  const leaves: ReaderLeaf[] = [];
  for (const group of brOptions.data) {
    if (!Array.isArray(group)) continue;
    for (const leaf of group) {
      if (leaf && typeof leaf.leafNum === "number" && typeof leaf.uri === "string") {
        leaves.push({ leafNum: leaf.leafNum, uri: leaf.uri });
      }
    }
  }
  const lendingStatus = (body?.data?.lendingInfo?.lendingStatus ?? {}) as Record<string, unknown>;
  return {
    bookId: typeof brOptions.bookId === "string" ? brOptions.bookId : id,
    subPrefix: typeof brOptions.subPrefix === "string" ? brOptions.subPrefix : id,
    bookTitle: typeof brOptions.bookTitle === "string" ? brOptions.bookTitle : "",
    leaves,
    lendingStatus,
    metadata: (body?.data?.metadata ?? {}) as Record<string, unknown>,
  };
}
```

(Task 5 adds the capture code below it and its `ContentBlock`/`epubImport`/`pdfImport` imports.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/services/archiveBorrow.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/archiveBorrow.ts src/services/archiveBorrow.test.ts src/services/__fixtures__/archiveBorrowFixtures.ts src/services/epubImport.ts
git commit -m "feat(archive): read the borrow reader config (details page + BookReaderJSIA)"
```

---

### Task 4: `archiveBorrow` — loan ensure/renew with cookie merge

**Files:**
- Create (extend): `src/services/archiveBorrow.ts`
- Test: `src/services/archiveBorrow.test.ts`

**Interfaces:**
- Consumes: `mergeSessionCookies` from `siteSession.ts` (already exported), `siteSessionHeaders`.
- Produces:

```ts
export async function ensureLoan(
  fetchImpl: typeof fetch, session: SiteSession, id: string, lendingStatus: Record<string, unknown>
): Promise<{ session: SiteSession; startedBorrow: boolean }>;
export async function renewLoan(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<SiteSession>;
export async function returnLoan(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<void>;
export function loanExpiryEpoch(session: SiteSession, id: string): number | undefined;
```

- This task also relocates ALL seven `Archive*` error classes into `src/services/archiveErrors.ts` (five moved from `archiveImport.ts`, two new) and turns `archiveImport.ts` into an importer + re-exporter. Doing it HERE keeps `archiveBorrow.ts` free of any import of `archiveImport.ts` — Task 6 makes `archiveImport` depend on `archiveBorrow`, and a cycle between the two would be fragile.
- `ensureLoan` throws `ArchiveLoanError`; `startedBorrow` is `true` only when THIS call posted `borrow_book`, so Task 5 can return the loan in a `finally`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/archiveBorrow.test.ts`:

```ts
import { ArchiveLoanError } from "./archiveErrors";
import { ensureLoan, loanExpiryEpoch, renewLoan } from "./archiveBorrow";

describe("ensureLoan", () => {
  function loanMock(loanResponse?: () => Response) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://archive.org/services/loans/loan")) {
        return loanResponse ? loanResponse() : new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
  }

  it("reuses an active session without calling the loans API", async () => {
    const fetchImpl = loanMock();
    const result = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      active_browses: 1,
      active_borrows: 0,
      is_lendable: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.session).toBe(SESSION);
    expect(result.startedBorrow).toBe(false);
  });

  it("starts a browse when no loan is active and a browse copy exists", async () => {
    const fetchImpl = loanMock(() =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "set-cookie": "loan-testitem=1790656967-abc; Path=/" },
      })
    );
    const { session, startedBorrow } = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      is_lendable: true,
      active_borrows: 0,
      active_browses: 0,
      available_to_borrow: false,
      available_to_browse: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://archive.org/services/loans/loan");
    const form = init?.body as FormData;
    expect(form.get("action")).toBe("browse_book");
    expect(form.get("identifier")).toBe("testitem");
    // the Set-Cookie of the loan is merged in, so the capture rides the new loan
    expect(session.cookies?.some((cookie) => cookie.name === "loan-testitem")).toBe(true);
    expect(session.cookies?.some((cookie) => cookie.name === "logged-in-user")).toBe(true);
    // a browse is handed back by IA in an hour anyway — only borrows must be returned
    expect(startedBorrow).toBe(false);
  });

  it("prefers borrowing when a copy is borrowable and reports it started one", async () => {
    const fetchImpl = loanMock();
    const { startedBorrow } = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      is_lendable: true,
      available_to_borrow: true,
      available_to_browse: true,
    });
    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("action")).toBe("borrow_book");
    expect(startedBorrow).toBe(true);
  });

  it("refuses when no copy is free and explains it", async () => {
    const fetchImpl = loanMock();
    const error = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      is_lendable: true,
      available_to_borrow: false,
      available_to_browse: false,
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ArchiveLoanError);
    expect((error as Error).message).toMatch(/No copy/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a rejected loan as a dead session", async () => {
    const fetchImpl = loanMock(() => new Response(JSON.stringify({ error: "login required" }), { status: 200 }));
    const error = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      is_lendable: true,
      available_to_browse: true,
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ArchiveLoanError);
    expect((error as Error).message).toMatch(/not logged in/);
  });
});

describe("loanExpiryEpoch", () => {
  it("reads the epoch out of the loan cookie", () => {
    const session: SiteSession = {
      cookies: [
        { name: "loan-testitem", value: "1790656967-abc", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
      ],
      origins: [],
    };
    expect(loanExpiryEpoch(session, "testitem")).toBe(1790656967);
    expect(loanExpiryEpoch(SESSION, "testitem")).toBeUndefined();
  });

  it("renewLoan posts renew_loan and returns merged cookies", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "set-cookie": "loan-testitem=1790999999-xyz; Path=/" },
        })
    );
    const session = await renewLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("action")).toBe("renew_loan");
    expect(loanExpiryEpoch(session, "testitem")).toBe(1790999999);
  });
});
```

Append this to `src/services/archiveBorrow.test.ts` (the `renewLoan` case), after the `loanExpiryEpoch` describe:

```ts
it("returnLoan posts return_loan and ignores failures", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
  await expect(returnLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem")).resolves.toBeUndefined();
  const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
  expect(form.get("action")).toBe("return_loan");
  const failing = vi.fn(async () => new Response("", { status: 500 }));
  await expect(returnLoan(failing as unknown as typeof fetch, SESSION, "testitem")).resolves.toBeUndefined();
});
```

(import `returnLoan` in the same statement as `ensureLoan`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/archiveBorrow.test.ts`
Expected: FAIL — `ensureLoan` not exported, `./archiveErrors` missing.

- [ ] **Step 3: Move every Archive error into `archiveErrors.ts`**

Create `src/services/archiveErrors.ts` containing ALL seven classes — the five currently defined at the top of `src/services/archiveImport.ts` (lines 7–37, comments included, wording byte-identical) plus these two new ones. The module's only import is `t`:

```ts
import { t } from "./lang";

// ... the five existing classes cut from archiveImport.ts, unchanged, then:

/** Restricted item, no saved session: the fix is a login import, not a retry. */
export class ArchiveLoginRequiredError extends Error {
  constructor(url: string) {
    super(
      t(
        "This Internet Archive item is borrow-only. Sign in to archive.org (Settings → Site sessions) and import again: {url}",
        { url }
      )
    );
  }
}

/** A loan-level failure whose wording was already chosen at the throw site. */
export class ArchiveLoanError extends Error {}
```

(`ArchiveTooManyPagesError` takes `count` as a constructor argument, so nothing else is needed.)

In `src/services/archiveImport.ts`, replace the five class definitions with an import and a re-export so every existing import site (`routes/stories.ts`, both test files) keeps working unchanged:

```ts
import {
  ArchiveLoginRequiredError,
  ArchiveNotFoundError,
  ArchiveNotBookError,
  ArchiveRestrictedError,
  ArchiveTooManyPagesError,
  ArchiveUnavailableError,
} from "./archiveErrors";
export {
  ArchiveLoginRequiredError,
  ArchiveLoanError,
  ArchiveNotFoundError,
  ArchiveNotBookError,
  ArchiveRestrictedError,
  ArchiveTooManyPagesError,
  ArchiveUnavailableError,
} from "./archiveErrors";
```

(`ArchiveLoanError` is re-exported only for the route; `archiveBorrow.ts` imports it from `./archiveErrors` directly.)

Run the untouched suites to prove the move is behaviour-neutral:

Run: `npx vitest run src/services/archiveImport.test.ts src/routes/importArchive.test.ts`
Expected: PASS (no behaviour changed yet).

- [ ] **Step 4: Implement ensureLoan / renewLoan / returnLoan / loanExpiryEpoch**

Append to `src/services/archiveBorrow.ts` (add `mergeSessionCookies` to the existing `./siteSession` import, and `ArchiveLoanError` from `./archiveErrors`, `t` from `./lang`):

```ts
const truthy = (value: unknown): boolean => value === true || value === "true";

// The loan cookie carries its own expiry: loan-<id> = <epoch>-<signature>.
export function loanExpiryEpoch(session: SiteSession, id: string): number | undefined {
  const cookie = (session.cookies ?? []).find((candidate) => candidate.name === `loan-${id}`);
  const epoch = Number(cookie?.value.split("-")[0]);
  return Number.isFinite(epoch) && epoch > 0 ? epoch : undefined;
}

// Cookies the loans API sets, as storage-state cookies. Attributes are best effort:
// only name/value/domain/path reach the request headers.
function setCookieCookies(response: Response, fallbackDomain: string): NonNullable<SiteSession["cookies"]> {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies: NonNullable<SiteSession["cookies"]> = [];
  for (const raw of headers.getSetCookie?.() ?? []) {
    const [pair = ""] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name) continue;
    const domain = (/domain=([^;]+)/i.exec(raw)?.[1] ?? fallbackDomain).trim().replace(/^\./, "");
    const cookiePath = /path=([^;]+)/i.exec(raw)?.[1]?.trim() ?? "/";
    cookies.push({
      name,
      value: pair.slice(eq + 1).trim(),
      domain,
      path: cookiePath,
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    });
  }
  return cookies;
}

async function postLoan(
  fetchImpl: typeof fetch,
  session: SiteSession,
  id: string,
  action: "browse_book" | "borrow_book" | "renew_loan" | "return_loan"
): Promise<SiteSession> {
  const url = "https://archive.org/services/loans/loan";
  const form = new FormData();
  form.append("action", action);
  form.append("identifier", id);
  const response = await fetchImpl(url, { method: "POST", body: form, headers: siteSessionHeaders(session, url) });
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  // The API answers { error } on failure; anything unreadable (a login page, a 5xx)
  // means this session cannot act on the loan.
  if (!response.ok || !body || body.error) {
    throw new ArchiveLoanError(
      t("The saved archive.org session is not logged in — import a fresh one (Settings → Site sessions).")
    );
  }
  const fresh = setCookieCookies(response, "archive.org");
  return fresh.length ? { ...session, cookies: mergeSessionCookies(session.cookies ?? [], fresh) } : session;
}

/**
 * Make sure a loan is active for the capture: reuse the reader's own session when
 * one is running, otherwise start one (a borrow when a copy allows it, else the
 * one-hour browse). `session` is the one to capture with — the loan's own cookies
 * are merged in, because this POST's Set-Cookie is what grants access.
 * `startedBorrow` is true only when this call posted `borrow_book`, so the caller
 * can return it when it is done (spec §3.3).
 */
export async function ensureLoan(
  fetchImpl: typeof fetch,
  session: SiteSession,
  id: string,
  lendingStatus: Record<string, unknown>
): Promise<{ session: SiteSession; startedBorrow: boolean }> {
  const active = Number(lendingStatus.active_borrows ?? 0) > 0 || Number(lendingStatus.active_browses ?? 0) > 0;
  if (active) return { session, startedBorrow: false };
  const canBorrow = truthy(lendingStatus.available_to_borrow);
  const canBrowse = truthy(lendingStatus.available_to_browse);
  if (!canBorrow && !canBrowse) {
    throw new ArchiveLoanError(
      t("No copy of this Internet Archive book is available to borrow right now — try again later: {url}", {
        url: `https://archive.org/details/${id}`,
      })
    );
  }
  const next = await postLoan(fetchImpl, session, id, canBorrow ? "borrow_book" : "browse_book");
  return { session: next, startedBorrow: canBorrow };
}

export async function renewLoan(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<SiteSession> {
  return postLoan(fetchImpl, session, id, "renew_loan");
}

// Best effort: a loan that cannot be returned still expires on IA's own clock.
export async function returnLoan(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<void> {
  await postLoan(fetchImpl, session, id, "return_loan").catch(() => undefined);
}
```

Add `t` to the imports (`import { t } from "./lang";`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services/archiveBorrow.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/archiveBorrow.ts src/services/archiveBorrow.test.ts src/services/archiveErrors.ts src/services/archiveImport.ts
git commit -m "feat(archive): start or reuse a browse/borrow loan for the capture"
```

---

### Task 5: `archiveBorrow` — page capture + book assembly

**Files:**
- Modify: `src/services/archiveBorrow.ts`
- Test: `src/services/archiveBorrow.test.ts`

**Interfaces:**
- Consumes: `readerConfig` (Task 3), `ensureLoan`/`renewLoan`/`loanExpiryEpoch` (Task 4), `MAX_PAGES`/`PAGES_PER_CHUNK` from `pdfImport`, `MAX_IMAGE_BYTES` from `epubImport`, `t` from `lang`.
- Produces (consumed by Task 6):

```ts
export async function captureChapters(
  fetchImpl: typeof fetch,
  session: SiteSession,
  config: ReaderConfig,
  storeImage: StoreImage,
  fallbackTitle: string
): Promise<ImportedChapter[]>;

export async function importBorrowedBook(
  fetchImpl: typeof fetch,
  session: SiteSession,
  id: string,
  item: { title: string },
  storeImage: StoreImage
): Promise<ImportedBook>;
```

- Throwing contract: `ArchiveTooManyPagesError` when `leaves > MAX_PAGES`; `ArchiveLoanError` with "The archive.org loan ended…" when grant/image access stays refused after one renew retry; `ArchiveLoanError` with "Could not read page {page}…" when a granted page still fails (bad status / not a JPEG) after one retry; `ArchiveRestrictedError` when `lendingStatus.is_lendable` is false.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/archiveBorrow.test.ts` (these imports join the ones from Task 4's Step 1; `ArchiveLoanError` and `./archiveErrors` are already imported there):

```ts
import { captureChapters, importBorrowedBook } from "./archiveBorrow";
import { ArchiveRestrictedError, ArchiveTooManyPagesError } from "./archiveErrors";
```

```ts
const STORED: string[] = [];
const storeImage = (bytes: Buffer, extension: string) => {
  STORED.push(`${bytes.length}:${extension}`);
  return `epub-media/test/${STORED.length}.jpg`;
};

// One mock for the whole capture: JSIA (config) + grant + page image.
function captureMock(options: {
  leafCount?: number;
  lendingStatus?: Record<string, unknown>;
  grant?: (leafNum: number) => Response;
  preview?: (leafNum: number) => Response;
  loan?: () => Response;
} = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://archive.org/details/testitem")) {
      return new Response(detailsHtml(), { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.includes("BookReaderJSIA.php")) {
      return new Response(
        JSON.stringify(jsiaBody({ leafCount: options.leafCount, lendingStatus: options.lendingStatus })),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.startsWith("https://archive.org/services/loans/loan")) {
      return options.loan
        ? options.loan()
        : new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes("/services/bookreader/request_page")) {
      const leafNum = Number(new URL(url).searchParams.get("leafNum"));
      return options.grant
        ? options.grant(leafNum)
        : new Response(JSON.stringify({ success: true, value: [leafNum, leafNum + 1] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    }
    if (url.includes("BookReaderPreview.php")) {
      const leafNum = Number(/page=leaf(\d+)/.exec(url)?.[1] ?? 0);
      return options.preview
        ? options.preview(leafNum)
        : new Response(new Uint8Array(JPEG), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return new Response("", { status: 404 });
  });
}

describe("captureChapters", () => {
  it("grants each spread once, stores every page and chunks 45 leaves into 3 chapters", async () => {
    STORED.length = 0;
    const fetchImpl = captureMock({ leafCount: 45 });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const chapters = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "Fallback");

    expect(chapters.map((chapter) => chapter.title)).toEqual(["Pages 1–20", "Pages 21–40", "Pages 41–45"]);
    expect(chapters.flatMap((chapter) => chapter.blocks)).toHaveLength(45);
    expect(chapters[0].blocks[0]).toEqual({ type: "image", src: "epub-media/test/1.jpg", alt: "" });
    expect(STORED).toHaveLength(45);

    // one grant covers the pair: 45 leaves → ceil(45/2) request_page calls
    const grants = fetchImpl.mock.calls.filter(([input]) => String(input).includes("request_page"));
    expect(grants).toHaveLength(23);
  });

  it("keeps a book that fits one chunk under the book's title", async () => {
    const fetchImpl = captureMock({ leafCount: 3 });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const chapters = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "Fallback");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("Namiya zakkaten no kiseki");
  });

  it("retries a refused page once after renewing, then reports the loan as ended", async () => {
    const unavailable = () =>
      new Response("", { status: 302, headers: { location: "https://archive.org/bookreader/static/preview-unavailable.png" } });
    const fetchImpl = captureMock({
      leafCount: 3,
      lendingStatus: { active_browses: 0, available_to_browse: true },
      preview: unavailable,
    });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const error = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F").catch(
      (err: unknown) => err
    );
    expect(error).toBeInstanceOf(ArchiveLoanError);
    expect((error as Error).message).toMatch(/loan ended/);
    // the reactive renewal was attempted before giving up
    const loans = fetchImpl.mock.calls.filter(([input]) => String(input).includes("/services/loans/loan"));
    expect(loans.length).toBeGreaterThanOrEqual(1);
  });

  it("names the page when a granted page still cannot be read", async () => {
    const fetchImpl = captureMock({
      leafCount: 2,
      preview: () => new Response("", { status: 500 }),
    });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const error = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F").catch(
      (err: unknown) => err
    );
    expect(error).toBeInstanceOf(ArchiveLoanError);
    expect((error as Error).message).toMatch(/page 1/);
  });

  it("skips an oversized page image but keeps the chapter structure", async () => {
    const fetchImpl = captureMock({
      leafCount: 3,
      preview: () => {
        const big = Buffer.alloc(8 * 1024 * 1024 + 1, 0x41);
        big[0] = 0xff;
        big[1] = 0xd8;
        big[2] = 0xff;
        return new Response(new Uint8Array(big));
      },
    });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const chapters = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].blocks).toHaveLength(2);
  });

  it("refuses a book with more than MAX_PAGES leaves", async () => {
    const fetchImpl = captureMock({ leafCount: 5001 });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    await expect(
      captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F")
    ).rejects.toBeInstanceOf(ArchiveTooManyPagesError);
  });
});

describe("importBorrowedBook", () => {
  it("refuses an item the catalog marks not lendable", async () => {
    const fetchImpl = captureMock({ lendingStatus: { is_lendable: false } });
    await expect(
      importBorrowedBook(fetchImpl as unknown as typeof fetch, SESSION, "testitem", { title: "Fallback" }, storeImage)
    ).rejects.toBeInstanceOf(ArchiveRestrictedError);
  });

  it("returns a book whose chapters are image blocks", async () => {
    const fetchImpl = captureMock({ leafCount: 2 });
    const book = await importBorrowedBook(fetchImpl as unknown as typeof fetch, SESSION, "testitem", { title: "Fallback" }, storeImage);
    expect(book.title).toBe("Namiya zakkaten no kiseki");
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].blocks.every((block) => block.type === "image")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/archiveBorrow.test.ts`
Expected: FAIL — `captureChapters`/`importBorrowedBook` not exported.

- [ ] **Step 3: Implement capture + assembly**

Append to `src/services/archiveBorrow.ts`. Imports to add at the top (alongside Task 4's — `ArchiveLoanError`, `siteSessionHeaders`, `t` are already imported there):

```ts
import { ContentBlock } from "../types";
import { ArchiveRestrictedError, ArchiveTooManyPagesError } from "./archiveErrors";
import { ImportedBook, ImportedChapter, MAX_IMAGE_BYTES, StoreImage } from "./epubImport";
import { MAX_PAGES, PAGES_PER_CHUNK } from "./pdfImport";
```

Body:

```ts
const GRANT_RENEW_WINDOW_MS = 10 * 60_000;
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

const loanEndedError = (id: string) =>
  new ArchiveLoanError(
    t("The archive.org loan ended while importing — run the import again: {url}", {
      url: `https://archive.org/details/${id}`,
    })
  );

const pageReadError = (page: number, id: string) =>
  new ArchiveLoanError(
    t("Could not read page {page} of this Internet Archive book: {url}", {
      page,
      url: `https://archive.org/details/${id}`,
    })
  );

function chapterTitle(from: number, to: number, total: number, fallback: string): string {
  return total <= PAGES_PER_CHUNK ? fallback : t("Pages {from}–{to}", { from, to });
}

async function grantLeaf(
  fetchImpl: typeof fetch,
  session: SiteSession,
  config: ReaderConfig,
  leafNum: number
): Promise<boolean> {
  const query = new URLSearchParams({
    id: config.bookId,
    subprefix: config.subPrefix,
    leafNum: String(leafNum),
  });
  const url = `https://archive.org/services/bookreader/request_page?${query}`;
  const response = await fetchImpl(url, { headers: siteSessionHeaders(session, url) });
  const body = (await response.json().catch(() => null)) as { success?: boolean; value?: number[] } | null;
  return !!response.ok && body?.success === true;
}

// One leaf's JPEG: grant the spread if needed, then read the page. Access that went
// away (expired loan) is renewed once and retried; a refusal that survives the retry
// means the loan is over, while a granted page that still will not read is a broken
// page — the two failures say different things to the reader (spec §3.4).
async function fetchLeaf(
  fetchImpl: typeof fetch,
  holder: { current: SiteSession },
  config: ReaderConfig,
  leaf: ReaderLeaf,
  granted: Set<number>
): Promise<Buffer> {
  let refused = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      holder.current = await renewLoan(fetchImpl, holder.current, config.bookId).catch(() => holder.current);
      granted.clear();
    }
    let grantedNow = granted.has(leaf.leafNum);
    if (!grantedNow) {
      grantedNow = await grantLeaf(fetchImpl, holder.current, config, leaf.leafNum);
      if (grantedNow) {
        // the grant covers this leaf and its spread partner (the API answers [n, n+1])
        granted.add(leaf.leafNum);
        granted.add(leaf.leafNum + 1);
      }
    }
    if (!grantedNow) {
      refused = true;
      continue;
    }
    refused = false;
    const response = await fetchImpl(leaf.uri, { headers: siteSessionHeaders(holder.current, leaf.uri) });
    // A real fetch follows the redirect to preview-unavailable (visible in response.url);
    // an unfollowed 302 (as in the test mocks) still carries it in Location.
    const location = response.headers.get("location") ?? "";
    const unavailable = response.url.includes("preview-unavailable") || location.includes("preview-unavailable");
    if (!response.ok || unavailable) {
      refused = unavailable || response.status === 401 || response.status === 403;
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length >= 3 && JPEG_MAGIC.every((byte, index) => bytes[index] === byte)) return bytes;
    refused = false;
  }
  if (refused) throw loanEndedError(config.bookId);
  throw pageReadError(leaf.leafNum, config.bookId);
}
```

Then the assembly:

```ts
export async function captureChapters(
  fetchImpl: typeof fetch,
  initialSession: SiteSession,
  config: ReaderConfig,
  storeImage: StoreImage,
  fallbackTitle: string
): Promise<ImportedChapter[]> {
  const leaves = [...config.leaves].sort((a, b) => a.leafNum - b.leafNum);
  if (leaves.length > MAX_PAGES) throw new ArchiveTooManyPagesError(MAX_PAGES);

  const holder = { current: initialSession };
  const granted = new Set<number>();
  const chapters: ImportedChapter[] = [];
  let current: ContentBlock[] | undefined;

  for (let index = 0; index < leaves.length; index++) {
    // Renew before the loan window runs out; the capture of a long book outlives it.
    const expiry = loanExpiryEpoch(holder.current, config.bookId);
    if (expiry && expiry * 1000 - Date.now() < GRANT_RENEW_WINDOW_MS) {
      holder.current = await renewLoan(fetchImpl, holder.current, config.bookId).catch(() => holder.current);
    }

    const leaf = leaves[index];
    if (index % PAGES_PER_CHUNK === 0) {
      current = [];
      chapters.push({
        title: chapterTitle(index + 1, Math.min(index + PAGES_PER_CHUNK, leaves.length), leaves.length, config.bookTitle || fallbackTitle),
        blocks: current,
      });
    }
    const bytes = await fetchLeaf(fetchImpl, holder, config, leaf, granted);
    if (bytes.length > MAX_IMAGE_BYTES) continue;
    current!.push({ type: "image", src: storeImage(bytes, "jpg"), alt: "" });
  }
  return chapters;
}

export async function importBorrowedBook(
  fetchImpl: typeof fetch,
  session: SiteSession,
  id: string,
  item: { title: string },
  storeImage: StoreImage
): Promise<ImportedBook> {
  const config = await readerConfig(fetchImpl, session, id);
  const lendable = config.lendingStatus.is_lendable;
  if (lendable === false || lendable === "false") {
    throw new ArchiveRestrictedError(`https://archive.org/details/${id}`);
  }
  const loan = await ensureLoan(fetchImpl, session, id, config.lendingStatus);
  try {
    const chapters = await captureChapters(fetchImpl, loan.session, config, storeImage, item.title);
    return { title: config.bookTitle || item.title, chapters };
  } finally {
    // Only a borrow this import started is handed back (spec §3.3); a browse expires
    // on its own and the reader's own loan is theirs to keep.
    if (loan.startedBorrow) await returnLoan(fetchImpl, loan.session, id);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/archiveBorrow.test.ts`
Expected: PASS. If the grant-count assertion (23 for 45 leaves) disagrees with your `granted.add` logic, fix the logic — one grant must cover `[n, n+1]`.

- [ ] **Step 5: Commit**

```bash
git add src/services/archiveBorrow.ts src/services/archiveBorrow.test.ts
git commit -m "feat(archive): capture borrow pages into 20-leaf image chapters"
```

---

### Task 6: `archiveImport` restricted branch + error wording

**Files:**
- Modify: `src/services/archiveImport.ts` (`fetchItem` option, `ArchiveItem.restricted`, session branch; the class move already happened in Task 4)
- Modify: `src/services/lang.ts` (5 Vietnamese messages)
- Test: `src/services/archiveImport.test.ts`

**Interfaces:**
- Consumes: `importBorrowedBook(fetchImpl, session, id, item, storeImage)` (Task 5), `ArchiveLoginRequiredError`/`ArchiveLoanError` (Task 4).
- Produces: `ImportArchiveOptions.session?: SiteSession`; `fetchItem(fetchImpl, id, options?: { allowRestricted?: boolean })`; `ArchiveItem.restricted: boolean`; all `Archive*` error classes re-exported from `archiveImport` (route and tests keep their imports).

- [ ] **Step 1: Write the failing tests**

Append to `src/services/archiveImport.test.ts`:

```ts
import type { SiteSession } from "./siteSession";
import { ArchiveLoginRequiredError } from "./archiveErrors";
import { detailsHtml, jsiaBody, JPEG } from "./__fixtures__/archiveBorrowFixtures";

const SESSION: SiteSession = {
  cookies: [
    { name: "logged-in-user", value: "me%40x.com", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
  ],
  origins: [],
};

// The same endpoints the borrow path hits, on top of the catalog stub.
function withBorrow(fetchImpl: ReturnType<typeof archiveFetch>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init; // the catalog stub ignores init; the borrow branches build their own Responses
    const url = String(input);
    if (url.startsWith("https://archive.org/details/")) {
      return new Response(detailsHtml(), { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.includes("BookReaderJSIA.php")) {
      return new Response(JSON.stringify(jsiaBody({ leafCount: 2 })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/services/bookreader/request_page")) {
      const leafNum = Number(new URL(url).searchParams.get("leafNum"));
      return new Response(JSON.stringify({ success: true, value: [leafNum, leafNum + 1] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("BookReaderPreview.php")) {
      return new Response(new Uint8Array(JPEG), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return fetchImpl(input);
  });
}

```ts
describe("importArchiveItem with a session", () => {
  it("refuses a restricted item without a session with the login message", async () => {
    const fetchImpl = archiveFetch({ metadata: { "access-restricted-item": "true" } });
    const error = await importArchiveItem("x", { fetchImpl: fetchImpl as unknown as typeof fetch }).catch(
      (err: unknown) => err
    );
    expect(error).toBeInstanceOf(ArchiveLoginRequiredError);
    expect((error as Error).message).toMatch(/Sign in to archive\.org/);
  });

  it("captures the borrow pages when a session is saved", async () => {
    const catalog = archiveFetch({
      metadata: { title: "Namiya", creator: "Keigo", "access-restricted-item": "true" },
      cover: undefined,
    });
    const fetchImpl = withBorrow(catalog);
    const stored: string[] = [];
    const book = await importArchiveItem("testitem", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: SESSION,
      storeImage: (_bytes, extension) => `media/${stored.push(extension)}.jpg`,
    });
    expect(book.title).toBe("Namiya");
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].blocks).toHaveLength(2);
    expect(book.chapters[0].blocks[0].type).toBe("image");
    // the public candidates are never fetched for a restricted item
    const downloads = fetchImpl.mock.calls.map(([input]) => String(input)).filter((url) => url.includes("/download/"));
    expect(downloads).toEqual([]);
  });

  it("still refuses an item that is not lendable at all", async () => {
    const catalog = archiveFetch({ metadata: { "access-restricted-item": "true" } });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://archive.org/details/")) {
        return new Response(detailsHtml(), { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.includes("BookReaderJSIA.php")) {
        return new Response(JSON.stringify(jsiaBody({ lendingStatus: { is_lendable: false } })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return catalog(input);
    });
    const error = await importArchiveItem("x", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      session: SESSION,
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ArchiveRestrictedError);
  });

  it("ignores the session for an open item", async () => {
    const fetchImpl = archiveFetch({ metadata: { title: "Open" }, files: [{ name: "book_djvu.txt", format: "DjVuTXT" }], bodies: { "book_djvu.txt": "x".repeat(300) } });
    const book = await importArchiveItem("open", { fetchImpl: fetchImpl as unknown as typeof fetch, session: SESSION });
    const urls = fetchImpl.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes("BookReaderJSIA"))).toBe(false);
    expect(book.chapters.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/archiveImport.test.ts`
Expected: FAIL — `session` not in options / restricted still throwing the old error.

- [ ] **Step 3: `fetchItem` gains `allowRestricted` and the item gains `restricted`**

In `archiveImport.ts`:

```ts
export interface ArchiveItem {
  id: string;
  title: string;
  titleFromCatalog: boolean;
  author?: string;
  language?: string;
  pdfDegraded: boolean;
  restricted: boolean;
  files: ArchiveFile[];
}
```

Change the signature and the check:

```ts
export async function fetchItem(
  fetchImpl: typeof fetch,
  id: string,
  options: { allowRestricted?: boolean } = {}
): Promise<ArchiveItem> {
  // ... unchanged until the restriction check ...
  const restricted = metadata["access-restricted-item"] === "true" || metadata["access-restricted-item"] === true;
  if (restricted && !options.allowRestricted) throw new ArchiveRestrictedError(url);
  // ...
  return {
    id,
    title: catalogTitle ?? id,
    titleFromCatalog: catalogTitle !== undefined,
    author: metaString(metadata.creator),
    language: metaString(metadata.language),
    pdfDegraded: metadata.pdf_degraded === true || !!metaString(metadata.pdf_degraded),
    restricted,
    files: Array.isArray(data.files) ? (data.files as ArchiveFile[]) : [],
  };
}
```

- [ ] **Step 4: The session branch in `importArchiveItem`**

Extend the options and the flow:

```ts
export interface ImportArchiveOptions {
  fetchImpl?: typeof fetch;
  storeImage?: StoreImage;
  maxFileBytes?: number;
  session?: SiteSession;
}
```

(add `import { SiteSession } from "./siteSession";` and `import { importBorrowedBook } from "./archiveBorrow";`).

```ts
export async function importArchiveItem(id: string, options: ImportArchiveOptions = {}): Promise<ImportedBook> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxFileBytes ?? MAX_ARCHIVE_FILE_BYTES;
  const item = await fetchItem(fetchImpl, id, { allowRestricted: true });
  const parseOptions = { fallbackTitle: item.title, storeImage: options.storeImage ?? (() => "") };

  if (item.restricted) {
    if (!options.session) throw new ArchiveLoginRequiredError(`https://archive.org/details/${id}`);
    const book = await importBorrowedBook(fetchImpl, options.session, id, item, options.storeImage ?? (() => ""));
    return withItemMeta(book, item, fetchImpl, maxBytes);
  }

  // ... the existing EPUB → text → PDF candidates, unchanged ...
}
```

- [ ] **Step 5: Add the five Vietnamese messages to `src/services/lang.ts`**

Insert next to the existing archive entries (~line 220):

```ts
"This Internet Archive item is borrow-only. Sign in to archive.org (Settings → Site sessions) and import again: {url}":
  "Sách này trên Internet Archive chỉ cho mượn. Hãy đăng nhập archive.org (Cài đặt → Phiên trang web) rồi import lại: {url}",
"No copy of this Internet Archive book is available to borrow right now — try again later: {url}":
  "Hiện không còn bản nào của sách này để mượn trên Internet Archive — thử lại sau: {url}",
"The saved archive.org session is not logged in — import a fresh one (Settings → Site sessions).":
  "Phiên archive.org đã lưu chưa đăng nhập — hãy nhập phiên mới (Cài đặt → Phiên trang web).",
"The archive.org loan ended while importing — run the import again: {url}":
  "Phiên mượn trên archive.org hết hạn giữa chừng — hãy chạy import lại: {url}",
"Could not read page {page} of this Internet Archive book: {url}":
  "Không đọc được trang {page} của sách Internet Archive này: {url}",
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/services/archiveImport.test.ts src/services/archiveBorrow.test.ts src/services/siteSession.test.ts`
Expected: PASS — including the pre-existing "refuses a lending item before looking at files" test (fetchItem's default still throws).

- [ ] **Step 7: Commit**

```bash
git add src/services/archiveImport.ts src/services/lang.ts src/services/archiveImport.test.ts
git commit -m "feat(archive): restricted items import through a saved session"
```

---

### Task 7: Route wiring + route tests

**Files:**
- Modify: `src/routes/stories.ts:203-278` (pass the session, widen the error allowlist)
- Test: `src/routes/importArchive.test.ts`

**Interfaces:**
- Consumes: `loadSiteSession("https://archive.org/details/<id>")` (existing), `importArchiveItem({ session })` (Task 6).
- Produces: the HTTP contract the frontend relies on (400 + Vietnamese message per error class).

- [ ] **Step 1: Write the failing tests**

In `src/routes/importArchive.test.ts`, add `mkdirSync, writeFileSync` to the `node:fs` import and import the fixtures:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { detailsHtml, jsiaBody, JPEG } from "../services/__fixtures__/archiveBorrowFixtures";
```

In `beforeEach`, alongside the existing cleanup, remove any session file left by a previous test:

```ts
await rm(path.join(DATA_DIR, "sessions"), { recursive: true, force: true });
```

Extend `StubOptions` with `borrow?: boolean` and, inside `stubArchive`'s URL dispatch, before the `return realFetch(input, init)` fallback, add:

```ts
if (options.borrow) {
  if (url.startsWith("https://archive.org/details/")) {
    return new Response(detailsHtml(), { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url.includes("BookReaderJSIA.php")) {
    return new Response(JSON.stringify(jsiaBody({ leafCount: 2, bookTitle: "Sách Archive" })), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("/services/bookreader/request_page")) {
    const leafNum = Number(new URL(url).searchParams.get("leafNum"));
    return new Response(JSON.stringify({ success: true, value: [leafNum, leafNum + 1] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("BookReaderPreview.php")) {
    return new Response(new Uint8Array(JPEG), { status: 200, headers: { "content-type": "image/jpeg" } });
  }
  if (url.startsWith("https://archive.org/services/loans/loan")) {
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
}
```

Add a helper for the session file and two tests:

```ts
function saveArchiveSession() {
  const dir = path.join(DATA_DIR, "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "archive.org.json"),
    JSON.stringify({
      cookies: [{ name: "logged-in-user", value: "me%40example.com", domain: ".archive.org", path: "/" }],
      origins: [],
    })
  );
}

it("imports a borrow-only item as image chapters when a session is saved", async () => {
  stubArchive({ restricted: true, borrow: true });
  saveArchiveSession();
  const res = await importArchive();
  expect(res.status).toBe(201);

  const { story } = await res.json();
  expect(story).toMatchObject({ id, site: "epub", storyUrl: "archive:testitem", title: "Sách Archive" });
  expect(story.chapters).toHaveLength(1);
  expect(story.chapters[0].blocks).toHaveLength(2);
  expect(story.chapters[0].blocks[0].type).toBe("image");
});

it("asks for a login when a borrow-only item has no saved session", async () => {
  stubArchive({ restricted: true, borrow: true });
  const res = await importArchive("", { url: "https://archive.org/details/testitem" }, { "X-Lang": "vi" });
  expect(res.status).toBe(400);
  expect((await res.json()).message).toContain("Đăng nhập archive.org");
});
```

Update the existing test `refuses a lending item with the translated message`: keep its stub, delete the `X-Lang`/`giới hạn truy cập` assertion or — better — rename it to `refuses a lending item without a session and says how to sign in` and assert the message contains `"Đăng nhập archive.org"` (it now covers the same case as the new test above; if you keep both, make this one run without `borrow: true` so the stub stays minimal).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/routes/importArchive.test.ts`
Expected: FAIL — the borrow test 400s (route does not pass a session) or 500s (error class not in the allowlist).

- [ ] **Step 3: Implement the route changes**

In `src/routes/stories.ts`, add to the import block:

```ts
import { ArchiveLoginRequiredError, ArchiveLoanError } from "../services/archiveImport";
import { loadSiteSession } from "../services/siteSession";
```

(merge the error names into the existing `from "../services/archiveImport"` import instead of a second statement if it already lists errors — the file already imports `ArchiveNotFoundError` etc. from there).

Pass the session:

```ts
const book = await importArchiveItem(itemId, {
  storeImage: (imageBytes, extension) => library.epubMedia.save(id, imageBytes, extension),
  session: loadSiteSession(`https://archive.org/details/${itemId}`),
});
```

Widen the catch allowlist (the comment above it stays true — these are the service's own translated errors):

```ts
err instanceof ArchiveNotFoundError ||
err instanceof ArchiveNotBookError ||
err instanceof ArchiveRestrictedError ||
err instanceof ArchiveTooManyPagesError ||
err instanceof ArchiveUnavailableError ||
err instanceof ArchiveLoginRequiredError ||
err instanceof ArchiveLoanError
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/routes/importArchive.test.ts src/routes/siteSessions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/stories.ts src/routes/importArchive.test.ts
git commit -m "feat(archive): import-archive passes the saved session and maps the new errors"
```

---

### Task 8: Add-flow session prompt dispatches the archive import

**Files:**
- Modify: `frontend/src/components/LibraryView.tsx:190` (state type), `:286-323` (handleCreate), `:917-932` (dialog callbacks)

**Interfaces:**
- Consumes: `sessionSiteForUrl` → `archive` slug (Task 2), `fetchSiteSession` (existing), `importArchiveFrom` (existing, line ~362).

- [ ] **Step 1: State + helper**

Change the state type (line 190):

```ts
const [sessionPrompt, setSessionPrompt] = useState<{ url: string; site: SessionSite; action: "story" | "archive" } | null>(
  null
);
```

Replace `handleCreate` (lines 286–323) with:

```ts
async function handleCreate() {
  if (busy || importBusy) return;
  const url = storyUrl.trim();
  if (!url) {
    setError(t("Paste a story URL first."));
    return;
  }
  const archive = isArchiveItemUrl(url);
  if (!archive && !isSupportedUrl(url, supportedSites)) {
    setError(
      t("URL is not from a supported site. Supported: {sites}.", {
        sites: supportedSites.map((s) => s.domain).join(", "),
      })
    );
    return;
  }
  // Sites whose crawls need a session saved from the reader's browser ask for one first
  // (skippable — the import then reports what the site refused). Checked per add, so a
  // session imported here is picked up by the next one; a failed check never blocks.
  const sessionSite = sessionSiteForUrl(url);
  if (sessionSite && (await needsSessionPrompt(sessionSite))) {
    setSessionPrompt({ url, site: sessionSite, action: archive ? "archive" : "story" });
    return;
  }
  if (archive) await importArchiveFrom(url);
  else await createStoryFrom(url);
}

async function needsSessionPrompt(site: SessionSite): Promise<boolean> {
  return fetchSiteSession(site.slug)
    .then(
      (status) =>
        !status.configured ||
        (site.showsExpiry && !!status.expiresAt && Date.parse(status.expiresAt) <= Date.now())
    )
    .catch(() => false);
}
```

- [ ] **Step 2: Dialog callbacks dispatch by action**

Replace the `{sessionPrompt && (...)}` block (lines 917–932) with:

```tsx
{sessionPrompt && (
  <SiteSessionDialog
    site={sessionPrompt.site}
    onSaved={(result) => {
      const { url, action } = sessionPrompt;
      setSessionPrompt(null);
      pushNotice({ kind: "session-saved", username: result.username });
      if (action === "archive") void importArchiveFrom(url);
      else void createStoryFrom(url);
    }}
    onSkip={() => {
      const { url, action } = sessionPrompt;
      setSessionPrompt(null);
      if (action === "archive") void importArchiveFrom(url);
      else void createStoryFrom(url);
    }}
  />
)}
```

- [ ] **Step 3: Verify**

Run: `npx tsc -p frontend --noEmit && npm run build`
Expected: clean typecheck; vite build succeeds. (No component test exists for LibraryView — the prompt logic is covered by manual verification in Task 9.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/LibraryView.tsx
git commit -m "feat(archive): prompt for the archive.org session when adding an item"
```

---

### Task 9: Docs + full verification + manual import

**Files:**
- Modify: `AGENTS.md` (two paragraphs)

- [ ] **Step 1: Update AGENTS.md**

In the site-sessions paragraph, change the allowlist parenthetical:

> `(a slug allowlist: \`asianfanfics\` → asianfanfics.com, \`truyenfull\` → truyenfull.live)`

to:

> `(a slug allowlist: \`asianfanfics\` → asianfanfics.com, \`truyenfull\` → truyenfull.live, \`archive\` → archive.org)`

In the Internet Archive import paragraph, change:

> `refuses \`access-restricted-item\` items (lending/LCP — never borrowed, never decrypted)`

to:

> `refuses \`access-restricted-item\` items unless a saved archive.org session exists (Settings → Site sessions): with one, \`services/archiveBorrow.ts\` starts or reuses a browse/borrow through \`/services/loans/loan\` and captures the page images the BookReader itself shows (\`request_page\` grant + \`BookReaderPreview.php\`) — still never decrypted, never a private file, no OCR, so the book lands as image chapters (Narration reads nothing). Without a session the import fails with the "sign in" message`

- [ ] **Step 2: Full verification**

Run: `npm test`
Expected: all suites pass (including `frontend/src/i18n/locales.test.ts`).

Run: `npm run build`
Expected: `tsc` then `vite build` succeed.

Run: `npx tsc -p frontend --noEmit && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual import with the owner's session**

The probe session from design time expires about an hour after it was pasted. Ask the owner for a fresh cURL (same steps as the dialog), save it via `POST /api/site-sessions/archive` (or Settings → Site sessions → Import), then import:

```
https://archive.org/details/namiyazakkatenno0000higa/page/n161/mode/2up
```

Verify in the UI: story appears with `archive:` URL prefix, ~21 chapters of `Pages …`, chapter view renders the page images, `Export to EPUB` embeds them, and Settings shows "A saved login is in use for borrow-only Internet Archive books."

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(archive): session allowlist and the borrow-page import path"
```

---

## Self-Review notes (already applied)

- **Spec coverage:** §3.1 session → Tasks 1–2 + 8; §3.2 readerConfig → 3, loans → 4 (incl. `returnLoan` for §3.3's finally-return of a started borrow, driven by `startedBorrow`), capture/assembly → 5; §3.3 integration/route → 6–7; §3.4 errors → 4/6 (classes in `archiveErrors.ts` + lang.ts); §5 tests → per task + 9; §6 build order → task order. Frontend settings row needs no task: `SettingsOverlay` renders every `SESSION_SITES` entry automatically.
- **Type consistency:** `readerConfig`/`ensureLoan`/`renewLoan`/`captureChapters`/`importBorrowedBook` signatures are identical in Tasks 3–7; `Archive*` classes live in `archiveErrors.ts` and are re-exported from `archiveImport` so existing imports keep working.
- **Known wording hazard:** the right-click locale key must be byte-identical across `siteSessions.ts`, `en.ts`, `vi.ts` (flagged inline in Task 2).
