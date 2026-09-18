# Story management + automatic chapter list loading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save crawl progress per story to JSON file for review/resume, and automatically fetch all chapters when user pastes story URL.

**Architecture:** Backend adds `storyStore` (atomic JSON files in `data/stories/`), `toc` adapters (fetch + parse plain HTML/JSON, no Playwright needed) for truyenfull/.vn/truyencom/xtruyen, shared `crawl` service with existing flow, and 5 `/api/stories*` endpoints. Frontend separates 2 tabs: "Manual crawl" (unchanged) and "My Stories" (list + details + resume crawl + export).

**Tech Stack:** Node 22 + Express + TypeScript (CommonJS, `tsc` → `dist/`), JSDOM (existing), Vitest (new), React + Vite (frontend).

**Spec:** `docs/superpowers/specs/2026-09-17-crawl-story-management-design.md`

## Global Constraints

- Do not change current "Manual crawl" tab behavior.
- Do not persist manual user edits (only save raw crawl results).
- TOC adapters only for: `truyenfull.live`, `truyenfull.vn`, `truyencom.com`, `xtruyen.vn`; `metruyenchu.com` returns clear error.
- Backend built via `npm run build:backend` (`tsc`, `rootDir: src`, output `dist/`); tested via `npx vitest run`.
- Frontend built via `npm run build -w frontend`.
- Test fixtures committed to repo, tests don't make network calls.
- UI/log text in Vietnamese, code/comments in English (per existing style).
- Commit after each task, message follows repo style (`feat:`, `test:`, `refactor:`, `docs:`).

---

### Task 1: Story store + Vitest setup

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.gitignore`, `src/types.ts`
- Create: `src/services/storyStore.ts`, `src/services/storyStore.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `storyId(storyUrl: string): string`, `summarize(story: StoredStory): StorySummary`, `createStoryStore(baseDir: string): StoryStore`, `storyStore` (default instance pointing to `data/stories`); types `ChapterStatus`, `StoredChapter`, `StoredStory`, `StorySummary` in `src/types.ts`.

- [ ] **Step 1: Install vitest + test script + exclude tests from build**

```bash
npm i -D vitest
```

Edit `package.json` scripts to:

```json
  "scripts": {
    "build": "tsc && npm run build -w frontend",
    "build:backend": "tsc",
    "start": "node dist/server.js",
    "dev": "tsc --watch & nodemon dist/server.js",
    "dev:frontend": "npm run dev -w frontend",
    "test": "vitest run"
  },
```

Add to `tsconfig.json`:

```json
  "exclude": ["src/**/*.test.ts", "src/**/__fixtures__/**"]
```

Add `data/` line to `.gitignore`.

- [ ] **Step 2: Write failing test**

Create `src/services/storyStore.test.ts`:

```ts
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoredStory } from "../types";
import { createStoryStore, storyId, summarize, type StoryStore } from "./storyStore";

function makeStory(overrides: Partial<StoredStory> = {}): StoredStory {
  return {
    id: storyId("https://example.com/truyen-a/"),
    storyUrl: "https://example.com/truyen-a/",
    site: "example.com",
    title: "Truyện A",
    chapters: [
      {
        order: 1,
        url: "https://example.com/truyen-a/chuong-1/",
        title: "Chương 1",
        status: "done",
        blocks: [{ type: "paragraph", text: "Nội dung chương 1" }],
      },
      { order: 2, url: "https://example.com/truyen-a/chuong-2/", title: "Chương 2", status: "pending" },
      {
        order: 3,
        url: "https://example.com/truyen-a/chuong-3/",
        title: "Chương 3",
        status: "error",
        error: "Page cleared",
      },
    ],
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("storyId", () => {
  it("stable and different between URLs", () => {
    expect(storyId("https://a.com/x/")).toBe(storyId("https://a.com/x/"));
    expect(storyId("https://a.com/x/")).not.toBe(storyId("https://a.com/y/"));
  });
});

describe("summarize", () => {
  it("counts done/error/total correctly", () => {
    const summary = summarize(makeStory());
    expect(summary).toEqual({
      id: storyId("https://example.com/truyen-a/"),
      storyUrl: "https://example.com/truyen-a/",
      site: "example.com",
      title: "Truyện A",
      chapterCount: 3,
      doneCount: 1,
      errorCount: 1,
      updatedAt: "2026-09-17T00:00:00.000Z",
    });
  });
});

describe("createStoryStore", () => {
  let dir: string;
  let store: StoryStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "story-store-"));
    store = createStoryStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("save then get returns correct data (round-trip)", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.get(story.id)).toEqual(story);
  });

  it("second save overwrites old version", async () => {
    const story = makeStory();
    await store.save(story);
    story.chapters[1].status = "done";
    story.updatedAt = "2026-09-18T00:00:00.000Z";
    await store.save(story);

    const loaded = await store.get(story.id);
    expect(loaded?.chapters[1].status).toBe("done");
    expect(loaded?.updatedAt).toBe("2026-09-18T00:00:00.000Z");
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });

  it("list sorts by updatedAt descending, skips corrupted files", async () => {
    await store.save(makeStory({ updatedAt: "2026-09-17T00:00:00.000Z" }));
    await store.save(
      makeStory({ id: storyId("https://example.com/truyen-b/"), storyUrl: "https://example.com/truyen-b/", updatedAt: "2026-09-18T00:00:00.000Z" })
    );
    await writeFile(path.join(dir, "broken.json"), "{ not json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const stories = await store.list();
    expect(stories.map((s) => s.id)).toHaveLength(2);
    expect(stories[0].updatedAt).toBe("2026-09-18T00:00:00.000Z");
    warn.mockRestore();
  });

  it("get/remove return undefined/false when not found", async () => {
    expect(await store.get(storyId("https://example.com/khong-co/"))).toBeUndefined();
    expect(await store.remove(storyId("https://example.com/khong-co/"))).toBe(false);
  });

  it("remove deletes file", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.remove(story.id)).toBe(true);
    expect(await store.get(story.id)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to ensure it fails**

Run: `npx vitest run src/services/storyStore.test.ts`
Expected: FAIL — `Cannot find module './storyStore'`.

- [ ] **Step 4: Add types to `src/types.ts`**

Add to end of file:

```ts
export type ChapterStatus = "pending" | "done" | "error";

export interface StoredChapter {
  order: number; // position in TOC, starts from 1
  url: string;
  title: string;
  status: ChapterStatus;
  error?: string;
  blocks?: ContentBlock[];
}

export interface StoredStory {
  id: string;
  storyUrl: string;
  site: string;
  title: string;
  author?: string;
  coverUrl?: string;
  chapters: StoredChapter[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface StorySummary {
  id: string;
  storyUrl: string;
  site: string;
  title: string;
  chapterCount: number;
  doneCount: number;
  errorCount: number;
  updatedAt: string;
}
```

- [ ] **Step 5: Write `src/services/storyStore.ts`**

```ts
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { StoredStory, StorySummary } from "../types";

export function storyId(storyUrl: string): string {
  return crypto.createHash("sha1").update(storyUrl).digest("hex").slice(0, 16);
}

export function summarize(story: StoredStory): StorySummary {
  return {
    id: story.id,
    storyUrl: story.storyUrl,
    site: story.site,
    title: story.title,
    chapterCount: story.chapters.length,
    doneCount: story.chapters.filter((c) => c.status === "done").length,
    errorCount: story.chapters.filter((c) => c.status === "error").length,
    updatedAt: story.updatedAt,
  };
}

export interface StoryStore {
  list(): Promise<StorySummary[]>;
  get(id: string): Promise<StoredStory | undefined>;
  save(story: StoredStory): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export function createStoryStore(baseDir: string): StoryStore {
  const filePath = (id: string) => path.join(baseDir, `${id}.json`);

  return {
    async list(): Promise<StorySummary[]> {
      let names: string[];
      try {
        names = await fs.readdir(baseDir);
      } catch {
        return [];
      }
      const out: StorySummary[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(baseDir, name), "utf8");
          out.push(summarize(JSON.parse(raw) as StoredStory));
        } catch (err) {
          console.warn(`Skipping corrupted story file: ${name}`, err);
        }
      }
      return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async get(id: string): Promise<StoredStory | undefined> {
      try {
        return JSON.parse(await fs.readFile(filePath(id), "utf8")) as StoredStory;
      } catch {
        return undefined;
      }
    },

    async save(story: StoredStory): Promise<void> {
      await fs.mkdir(baseDir, { recursive: true });
      const tmp = `${filePath(story.id)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(story, null, 2), "utf8");
      await fs.rename(tmp, filePath(story.id));
    },

    async remove(id: string): Promise<boolean> {
      try {
        await fs.unlink(filePath(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export const storyStore = createStoryStore(path.resolve("data", "stories"));
```

- [ ] **Step 6: Run test to ensure it passes**

Run: `npx vitest run src/services/storyStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src/types.ts src/services/storyStore.ts src/services/storyStore.test.ts
git commit -m "feat: story store (JSON file) for crawl progress management + setup vitest"
```

---

### Task 2: TOC adapter template truyenfull (truyenfull.live/.vn + truyencom.com)

**Files:**
- Create: `src/services/toc/types.ts`, `src/services/toc/normalizeUrl.ts`, `src/services/toc/truyenfullTemplate.ts`, `src/services/toc/truyenfullTemplate.test.ts`
- Create (fixtures, commit): `src/services/toc/__fixtures__/truyenfull-story.html`, `src/services/toc/__fixtures__/truyencom-story.html`

**Interfaces:**
- Consumes: none.
- Produces: `TocChapter`, `TocResult`, `TocAdapter` (types.ts); `normalizeStoryUrl(url: string): string` (normalizeUrl.ts); `parseStoryMeta(html: string, pageUrl: string): { title, author?, coverUrl? }`, `parseChapterLinks(html: string, pageUrl: string): TocChapter[]`, `parseTotalPages(html: string): number | undefined`, `truyenfullTemplateAdapter: TocAdapter` (truyenfullTemplate.ts).

- [ ] **Step 1: Download fixtures**

```bash
mkdir -p src/services/toc/__fixtures__
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
curl -sS -A "$UA" "https://truyenfull.live/dau-xuan-tuoi-sang/" -o src/services/toc/__fixtures__/truyenfull-story.html
curl -sS -A "$UA" "https://truyencom.com/de-ba.27/" -o src/services/toc/__fixtures__/truyencom-story.html
ls -la src/services/toc/__fixtures__/
```

Expected: 2 files, each > 60KB.

- [ ] **Step 2: Write failing test**

Create `src/services/toc/truyenfullTemplate.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeStoryUrl } from "./normalizeUrl";
import { parseChapterLinks, parseStoryMeta, parseTotalPages } from "./truyenfullTemplate";

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
const nfc = (s: string) => s.normalize("NFC");

describe("parseStoryMeta (template truyenfull)", () => {
  it("truyenfull.live: title/author/cover", () => {
    const meta = parseStoryMeta(readFixture("truyenfull-story.html"), "https://truyenfull.live/dau-xuan-tuoi-sang/");
    expect(nfc(meta.title)).toBe(nfc("Đầu Xuân Tươi Sáng"));
    expect(meta.author).toBeTruthy();
    expect(meta.coverUrl?.startsWith("https://lh3.googleusercontent.com")).toBe(true);
  });

  it("truyencom.com: title from h1", () => {
    const meta = parseStoryMeta(readFixture("truyencom-story.html"), "https://truyencom.com/de-ba.27/");
    expect(nfc(meta.title)).toBe(nfc("Đế Bá"));
    expect(meta.author).toBeTruthy();
  });
});

describe("parseChapterLinks", () => {
  it("truyenfull.live: 50 chapters page 1, correct order", () => {
    const chapters = parseChapterLinks(readFixture("truyenfull-story.html"), "https://truyenfull.live/dau-xuan-tuoi-sang/");
    expect(chapters).toHaveLength(50);
    expect(chapters[0].url).toBe("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-1/");
    expect(chapters[49].url).toBe("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-50/");
    expect(nfc(chapters[0].title)).toContain(nfc("Chương 1"));
  });

  it("truyencom.com: 50 chapters, href .html", () => {
    const chapters = parseChapterLinks(readFixture("truyencom-story.html"), "https://truyencom.com/de-ba.27/");
    expect(chapters).toHaveLength(50);
    expect(chapters[0].url).toBe("https://truyencom.com/de-ba/chuong-1.html");
  });
});

describe("parseTotalPages", () => {
  it("truyenfull.live: read from #total-page", () => {
    expect(parseTotalPages(readFixture("truyenfull-story.html"))).toBe(3);
  });

  it("truyencom.com: infer from pagination links", () => {
    expect(parseTotalPages(readFixture("truyencom-story.html"))).toBe(140);
  });
});

describe("normalizeStoryUrl", () => {
  it("strip chapter URL back to story URL", () => {
    expect(normalizeStoryUrl("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-12/")).toBe(
      "https://truyenfull.live/dau-xuan-tuoi-sang/"
    );
  });

  it("strip .html chapter URL of truyencom back to story URL", () => {
    expect(normalizeStoryUrl("https://truyencom.com/de-ba/chuong-118.html")).toBe("https://truyencom.com/de-ba/");
  });

  it("preserve story URL, remove query/hash", () => {
    expect(normalizeStoryUrl("https://truyenfull.live/dau-xuan-tuoi-sang/?abc=1#x")).toBe(
      "https://truyenfull.live/dau-xuan-tuoi-sang/"
    );
  });
});
```

- [ ] **Step 3: Run test to ensure it fails**

Run: `npx vitest run src/services/toc/truyenfullTemplate.test.ts`
Expected: FAIL — module `./truyenfullTemplate` not found.

- [ ] **Step 4: Write `src/services/toc/types.ts`**

```ts
export interface TocChapter {
  url: string;
  title: string;
}

export interface TocResult {
  title: string;
  author?: string;
  coverUrl?: string;
  chapters: TocChapter[];
}

export interface TocAdapter {
  domains: string[];
  fetchToc(storyUrl: string): Promise<TocResult>;
  normalizeStoryUrl(url: string): string;
}
```

- [ ] **Step 5: Write `src/services/toc/normalizeUrl.ts`**

```ts
// "https://site.com/truyen/abc/chuong-12/" -> "https://site.com/truyen/abc/"
// "https://site.com/de-ba/chuong-118.html" -> "https://site.com/de-ba/"
export function normalizeStoryUrl(url: string): string {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && last && /^chuong-/i.test(last.replace(/\.html$/i, ""))) {
    parts.pop();
  }
  u.pathname = `/${parts.join("/")}${parts.length > 0 ? "/" : ""}`;
  u.search = "";
  u.hash = "";
  return u.toString();
}
```

- [ ] **Step 6: Write `src/services/toc/truyenfullTemplate.ts`**

```ts
import { JSDOM } from "jsdom";
import { normalizeStoryUrl } from "./normalizeUrl";
import { TocAdapter, TocChapter, TocResult } from "./types";

export const TRUYENFULL_TEMPLATE_DOMAINS = ["truyenfull.live", "truyenfull.vn", "truyencom.com"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MAX_TOC_PAGES = 1000;

export function parseStoryMeta(html: string, pageUrl: string): { title: string; author?: string; coverUrl?: string } {
  const doc = new JSDOM(html).window.document;
  const title =
    doc.querySelector("h3.title")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title.split(" - ")[0]?.trim() ||
    "Untitled";
  const author = doc.querySelector('a[itemprop="author"]')?.textContent?.trim() || undefined;
  const coverRaw = doc.querySelector<HTMLImageElement>('img[itemprop="image"]')?.getAttribute("src");
  let coverUrl: string | undefined;
  if (coverRaw) {
    try {
      coverUrl = new URL(coverRaw, pageUrl).toString();
    } catch {
      coverUrl = undefined;
    }
  }
  return { title, author, coverUrl };
}

export function parseChapterLinks(html: string, pageUrl: string): TocChapter[] {
  const doc = new JSDOM(html).window.document;
  const seen = new Set<string>();
  const out: TocChapter[] = [];
  doc.querySelectorAll("#list-chapter ul.list-chapter a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, title: a.textContent?.replace(/\s+/g, " ").trim() || url });
  });
  return out;
}

export function parseTotalPages(html: string): number | undefined {
  const doc = new JSDOM(html).window.document;
  const hidden = doc.querySelector<HTMLInputElement>("#total-page")?.value;
  const hiddenNum = hidden ? Number(hidden) : NaN;
  if (Number.isFinite(hiddenNum) && hiddenNum > 0) return hiddenNum;

  let max = 0;
  doc.querySelectorAll('a[href*="trang-"]').forEach((a) => {
    const m = (a.getAttribute("href") || "").match(/trang-(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max > 0 ? max : undefined;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Không tải được ${url} (HTTP ${res.status})`);
  return res.text();
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const firstHtml = await fetchHtml(storyUrl);
  const meta = parseStoryMeta(firstHtml, storyUrl);
  const chapters = parseChapterLinks(firstHtml, storyUrl);
  const seen = new Set(chapters.map((c) => c.url));

  const totalPages = Math.min(parseTotalPages(firstHtml) ?? MAX_TOC_PAGES, MAX_TOC_PAGES);
  for (let page = 2; page <= totalPages; page++) {
    const pageUrl = new URL(`trang-${page}/`, storyUrl).toString();
    const newOnes = parseChapterLinks(await fetchHtml(pageUrl), pageUrl).filter((c) => !seen.has(c.url));
    newOnes.forEach((c) => seen.add(c.url));
    if (newOnes.length === 0) break;
    chapters.push(...newOnes);
  }

  if (chapters.length === 0) {
    throw new Error(`No chapter list found at ${storyUrl} — check the story URL`);
  }
  return { ...meta, chapters };
}

export const truyenfullTemplateAdapter: TocAdapter = {
  domains: TRUYENFULL_TEMPLATE_DOMAINS,
  fetchToc,
  normalizeStoryUrl,
};
```

- [ ] **Step 7: Run test to ensure it passes**

Run: `npx vitest run src/services/toc/truyenfullTemplate.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 8: Commit**

```bash
git add src/services/toc/
git commit -m "feat: TOC adapter for truyenfull/.vn + truyencom (parse HTML, fixture test included)"
```

---

### Task 3: TOC adapter xtruyen

**Files:**
- Create: `src/services/toc/xtruyen.ts`, `src/services/toc/xtruyen.test.ts`
- Create (fixtures, commit): `src/services/toc/__fixtures__/xtruyen-story.html`, `src/services/toc/__fixtures__/xtruyen-chapters.json`

**Interfaces:**
- Consumes: `TocAdapter`, `TocResult` from `./types`; `normalizeStoryUrl` from `./normalizeUrl`.
- Produces: `parseMangaId(html: string): string | undefined`, `parseStoryMeta(html: string, pageUrl: string)`, `parseChaptersResponse(text: string): { slug: string; title: string }[]`, `buildChapterUrl(storyUrl: string, slug: string): string`, `xtruyenAdapter: TocAdapter`.

- [ ] **Step 1: Download fixtures**

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
curl -sS -A "$UA" "https://xtruyen.vn/truyen/han-phu/" -o src/services/toc/__fixtures__/xtruyen-story.html
curl -sS -A "$UA" -H "x-custom-auth: abC0000011111" -H "X-Requested-With: XMLHttpRequest" \
  -e "https://xtruyen.vn/truyen/han-phu/" -X POST "https://xtruyen.vn/api/api-chapters.php" \
  --data "manga_id=2892796&from=1&to=100&vol=" -o src/services/toc/__fixtures__/xtruyen-chapters.json
head -c 200 src/services/toc/__fixtures__/xtruyen-chapters.json; echo
```

Expected: JSON starts with `[{"s":"chuong-1","n":"Chương 1","e":""},...`.

- [ ] **Step 2: Write failing test**

Create `src/services/toc/xtruyen.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildChapterUrl, parseChaptersResponse, parseMangaId, parseStoryMeta } from "./xtruyen";
import { normalizeStoryUrl } from "./normalizeUrl";

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

describe("parseMangaId", () => {
  it("read data-id from #manga-chapters-holder", () => {
    expect(parseMangaId(readFixture("xtruyen-story.html"))).toBe("2892796");
  });
});

describe("parseStoryMeta", () => {
  it("title/author/cover best-effort", () => {
    const meta = parseStoryMeta(readFixture("xtruyen-story.html"), "https://xtruyen.vn/truyen/han-phu/");
    expect(meta.title.normalize("NFC")).toBe("HÃN PHU".normalize("NFC"));
    expect(meta.author).toBe("Neleta");
    expect(meta.coverUrl?.startsWith("https://img.xtruyen.vn")).toBe(true);
  });
});

describe("parseChaptersResponse", () => {
  it("parse 100 items from JSON API", () => {
    const items = parseChaptersResponse(readFixture("xtruyen-chapters.json"));
    expect(items).toHaveLength(100);
    expect(items[0]).toEqual({ slug: "chuong-1", title: "Chương 1" });
    expect(items[99].slug).toBe("chuong-100");
  });

  it("throw error on invalid JSON", () => {
    expect(() => parseChaptersResponse("<html>not json</html>")).toThrow();
  });
});

describe("buildChapterUrl", () => {
  it("assemble chapter URL from slug", () => {
    expect(buildChapterUrl("https://xtruyen.vn/truyen/han-phu/", "chuong-12")).toBe(
      "https://xtruyen.vn/truyen/han-phu/chuong-12/"
    );
  });
});

describe("normalizeStoryUrl (xtruyen)", () => {
  it("strip chapter URL back to story URL", () => {
    expect(normalizeStoryUrl("https://xtruyen.vn/truyen/han-phu/chuong-233/")).toBe("https://xtruyen.vn/truyen/han-phu/");
  });
});
```

- [ ] **Step 3: Run test to ensure it fails**

Run: `npx vitest run src/services/toc/xtruyen.test.ts`
Expected: FAIL — module `./xtruyen` not found.

- [ ] **Step 4: Write `src/services/toc/xtruyen.ts`**

```ts
import { JSDOM } from "jsdom";
import { normalizeStoryUrl } from "./normalizeUrl";
import { TocAdapter, TocChapter, TocResult } from "./types";

export const XTRUYEN_DOMAINS = ["xtruyen.vn"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
// Xtruyen.vn's internal AJAX endpoint requires this static header (see manga-single.js
// + actual page request); not user login credentials.
const CUSTOM_AUTH = "abC0000011111";
const CHAPTER_WINDOW = 100;

export function parseMangaId(html: string): string | undefined {
  const doc = new JSDOM(html).window.document;
  return doc.querySelector<HTMLElement>("#manga-chapters-holder")?.dataset.id || undefined;
}

export function parseStoryMeta(html: string, pageUrl: string): { title: string; author?: string; coverUrl?: string } {
  const doc = new JSDOM(html).window.document;
  const title =
    doc.querySelector("h1")?.textContent?.trim() || doc.title.split(" - ")[0]?.trim() || "Untitled";
  const author = doc.querySelector(".author-content a")?.textContent?.trim() || undefined;
  const coverRaw = doc.querySelector<HTMLImageElement>(".summary_image img")?.getAttribute("src");
  let coverUrl: string | undefined;
  if (coverRaw) {
    try {
      coverUrl = new URL(coverRaw, pageUrl).toString();
    } catch {
      coverUrl = undefined;
    }
  }
  return { title, author, coverUrl };
}

export function parseChaptersResponse(text: string): { slug: string; title: string }[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Xtruyen chapter list API returned invalid JSON");
  }
  if (!Array.isArray(data)) {
    throw new Error("Xtruyen chapter list API returned incorrect format");
  }
  return data
    .filter((x): x is { s: string; n: string } => {
      const item = x as { s?: unknown; n?: unknown };
      return !!x && typeof item.s === "string" && typeof item.n === "string";
    })
    .map((x) => ({ slug: x.s, title: x.n }));
}

export function buildChapterUrl(storyUrl: string, slug: string): string {
  return new URL(`${slug.replace(/^\/+/, "")}/`, storyUrl).toString();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  return res.text();
}

async function postForm(url: string, body: string, referer: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      "x-custom-auth": CUSTOM_AUTH,
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
    },
    body,
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  return res.text();
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const pageHtml = await fetchHtml(storyUrl);
  const meta = parseStoryMeta(pageHtml, storyUrl);
  const mangaId = parseMangaId(pageHtml);
  if (!mangaId) {
    throw new Error(`Story ID not found on page ${storyUrl} — check the story URL`);
  }

  const apiUrl = new URL("/api/api-chapters.php", storyUrl).toString();
  const chapters: TocChapter[] = [];
  const seen = new Set<string>();

  for (let from = 1; ; from += CHAPTER_WINDOW) {
    const items = parseChaptersResponse(
      await postForm(
        apiUrl,
        new URLSearchParams({
          manga_id: mangaId,
          from: String(from),
          to: String(from + CHAPTER_WINDOW - 1),
          vol: "",
        }).toString(),
        storyUrl
      )
    );
    for (const { slug, title } of items) {
      const url = buildChapterUrl(storyUrl, slug);
      if (seen.has(url)) continue;
      seen.add(url);
      chapters.push({ url, title });
    }
    if (items.length < CHAPTER_WINDOW) break;
  }

  if (chapters.length === 0) {
    throw new Error(`No chapter list found at ${storyUrl} — check the story URL`);
  }

  const chapterNumber = (url: string) => {
    const m = url.match(/chuong-(\d+)/i);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  chapters.sort((a, b) => chapterNumber(a.url) - chapterNumber(b.url));
  return { ...meta, chapters };
}

export const xtruyenAdapter: TocAdapter = {
  domains: XTRUYEN_DOMAINS,
  fetchToc,
  normalizeStoryUrl,
};
```

- [ ] **Step 5: Run test to ensure it passes**

Run: `npx vitest run src/services/toc/xtruyen.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/toc/
git commit -m "feat: TOC adapter for xtruyen.vn (API chapters + fixture test)"
```

---

### Task 4: TOC registry by hostname

**Files:**
- Create: `src/services/toc/index.ts`, `src/services/toc/index.test.ts`

**Interfaces:**
- Consumes: `truyenfullTemplateAdapter`, `xtruyenAdapter`, `TocAdapter`.
- Produces: `getTocAdapter(url: string): TocAdapter | undefined` (used in Task 7).

- [ ] **Step 1: Write failing test**

Create `src/services/toc/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getTocAdapter } from "./index";

describe("getTocAdapter", () => {
  it("select adapter by hostname, strip www prefix", () => {
    expect(getTocAdapter("https://truyenfull.live/a/")?.domains).toContain("truyenfull.live");
    expect(getTocAdapter("https://truyenfull.vn/a/")?.domains).toContain("truyenfull.vn");
    expect(getTocAdapter("https://www.truyencom.com/de-ba.27/")?.domains).toContain("truyencom.com");
    expect(getTocAdapter("https://xtruyen.vn/truyen/han-phu/")?.domains).toContain("xtruyen.vn");
  });

  it("return undefined for unsupported sites (metruyenchu, unknown)", () => {
    expect(getTocAdapter("https://metruyenchu.com/truyen/a/")).toBeUndefined();
    expect(getTocAdapter("https://example.com/a/")).toBeUndefined();
  });

  it("return undefined for invalid URL", () => {
    expect(getTocAdapter("not-a-url")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to ensure it fails**

Run: `npx vitest run src/services/toc/index.test.ts`
Expected: FAIL — module `./index` not found.

- [ ] **Step 3: Write `src/services/toc/index.ts`**

```ts
import { truyenfullTemplateAdapter } from "./truyenfullTemplate";
import { TocAdapter } from "./types";
import { xtruyenAdapter } from "./xtruyen";

export type { TocAdapter, TocChapter, TocResult } from "./types";

const ADAPTERS: TocAdapter[] = [truyenfullTemplateAdapter, xtruyenAdapter];

export function getTocAdapter(url: string): TocAdapter | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return ADAPTERS.find((adapter) => adapter.domains.includes(hostname));
}
```

- [ ] **Step 4: Run test to ensure it passes**

Run: `npx vitest run src/services/toc/index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/toc/index.ts src/services/toc/index.test.ts
git commit -m "feat: registry to select TOC adapter by hostname"
```

---

### Task 5: storyService — merge TOC + select chapters to crawl

**Files:**
- Create: `src/services/storyService.ts`, `src/services/storyService.test.ts`

**Interfaces:**
- Consumes: `storyId` from `./storyStore`; types `StoredChapter`, `StoredStory`, `ExtractedChapter` from `../types`; `TocResult` from `./toc/types`.
- Produces: `mergeStory(params: { existing?: StoredStory; site: string; storyUrl: string; toc: TocResult; now?: string }): StoredStory`, `chaptersToCrawl(story: StoredStory, orders?: number[]): StoredChapter[]`, `toExtractedChapter(chapter: StoredChapter): ExtractedChapter` (used in Task 7).

- [ ] **Step 1: Write failing test**

Create `src/services/storyService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { StoredStory } from "../types";
import { TocResult } from "./toc/types";
import { chaptersToCrawl, mergeStory, toExtractedChapter } from "./storyService";

const toc: TocResult = {
  title: "Truyện A",
  author: "Tác giả",
  coverUrl: "https://example.com/cover.jpg",
  chapters: [
    { url: "https://example.com/a/chuong-1/", title: "Chương 1" },
    { url: "https://example.com/a/chuong-2/", title: "Chương 2" },
    { url: "https://example.com/a/chuong-3/", title: "Chương 3" },
  ],
};

function existingStory(): StoredStory {
  return {
    id: "abc",
    storyUrl: "https://example.com/a/",
    site: "example.com",
    title: "Truyện A",
    chapters: [
      { order: 1, url: "https://example.com/a/chuong-1/", title: "Chương 1 (edited)", status: "done", blocks: [{ type: "paragraph", text: "x" }] },
      { order: 2, url: "https://example.com/a/chuong-2/", title: "Chương 2", status: "error", error: "timeout" },
    ],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("mergeStory", () => {
  it("create new when none exists: all chapters pending, keep createdAt", () => {
    const merged = mergeStory({ site: "example.com", storyUrl: "https://example.com/a/", toc, now: "2026-09-17T00:00:00.000Z" });
    expect(merged.chapters.map((c) => c.status)).toEqual(["pending", "pending", "pending"]);
    expect(merged.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
    expect(merged.createdAt).toBe("2026-09-17T00:00:00.000Z");
    expect(merged.author).toBe("Tác giả");
  });

  it("preserve status/blocks/error/title of old chapters by URL, add new chapters as pending", () => {
    const merged = mergeStory({ existing: existingStory(), site: "example.com", storyUrl: "https://example.com/a/", toc });
    expect(merged.chapters[0]).toMatchObject({ status: "done", title: "Chương 1 (edited)" });
    expect(merged.chapters[1]).toMatchObject({ status: "error", error: "timeout" });
    expect(merged.chapters[2]).toMatchObject({ status: "pending" });
    expect(merged.createdAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("chaptersToCrawl", () => {
  it("by default only non-done chapters (pending + error), maintain order", () => {
    const story = existingStory();
    story.chapters.push({ order: 3, url: "https://example.com/a/chuong-3/", title: "Chương 3", status: "pending" });
    expect(chaptersToCrawl(story).map((c) => c.order)).toEqual([2, 3]);
  });

  it("if orders provided, return exactly those, including done chapters", () => {
    const story = existingStory();
    expect(chaptersToCrawl(story, [1]).map((c) => c.order)).toEqual([1]);
  });

  it("skip orders that don't exist", () => {
    expect(chaptersToCrawl(existingStory(), [99])).toEqual([]);
  });
});

describe("toExtractedChapter", () => {
  it("done chapter: return blocks; error chapter: return error", () => {
    expect(toExtractedChapter({ order: 1, url: "u", title: "t", status: "done", blocks: [] })).toEqual({
      sourceUrl: "u",
      title: "t",
      blocks: [],
    });
    const failed = toExtractedChapter({ order: 2, url: "u2", title: "t2", status: "error", error: "error" });
    expect(failed.error).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to ensure it fails**

Run: `npx vitest run src/services/storyService.test.ts`
Expected: FAIL — module `./storyService` not found.

- [ ] **Step 3: Write `src/services/storyService.ts`**

```ts
import { ExtractedChapter, StoredChapter, StoredStory } from "../types";
import { storyId } from "./storyStore";
import { TocResult } from "./toc/types";

export function mergeStory(params: {
  existing?: StoredStory;
  site: string;
  storyUrl: string;
  toc: TocResult;
  now?: string;
}): StoredStory {
  const now = params.now || new Date().toISOString();
  const existingByUrl = new Map((params.existing?.chapters ?? []).map((c) => [c.url, c]));

  const chapters: StoredChapter[] = params.toc.chapters.map((c, i) => {
    const old = existingByUrl.get(c.url);
    if (old && old.status !== "pending") {
      return { ...old, order: i + 1, title: old.title || c.title };
    }
    return { order: i + 1, url: c.url, title: c.title, status: "pending" };
  });

  return {
    id: storyId(params.storyUrl),
    storyUrl: params.storyUrl,
    site: params.site,
    title: params.toc.title || params.existing?.title || "Untitled",
    author: params.toc.author ?? params.existing?.author,
    coverUrl: params.toc.coverUrl ?? params.existing?.coverUrl,
    chapters,
    createdAt: params.existing?.createdAt || now,
    updatedAt: now,
  };
}

export function chaptersToCrawl(story: StoredStory, orders?: number[]): StoredChapter[] {
  if (orders && orders.length > 0) {
    const wanted = new Set(orders);
    return story.chapters.filter((c) => wanted.has(c.order)).sort((a, b) => a.order - b.order);
  }
  return story.chapters.filter((c) => c.status !== "done").sort((a, b) => a.order - b.order);
}

export function toExtractedChapter(chapter: StoredChapter): ExtractedChapter {
  if (chapter.status === "error") {
    return { sourceUrl: chapter.url, title: chapter.title, blocks: [], error: chapter.error || "Unknown error" };
  }
  return { sourceUrl: chapter.url, title: chapter.title, blocks: chapter.blocks ?? [] };
}
```

- [ ] **Step 4: Run test to ensure it passes**

Run: `npx vitest run src/services/storyService.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/storyService.ts src/services/storyService.test.ts
git commit -m "feat: storyService merge TOC always preserves old progress + select chapters to crawl"
```

---

### Task 6: Extract shared crawl service

**Files:**
- Create: `src/services/crawl.ts`
- Modify: `src/routes/api.ts`

**Interfaces:**
- Consumes: `renderPageHtml` from `./renderer`, `extractChapter`/`LockedContentError` from `./extractor`, `ExtractedChapter` from `../types`.
- Produces: `MAX_ATTEMPTS: number`, `extractWithRetry(url: string, onAttempt?: (attempt: number) => void): Promise<ExtractedChapter>` (used in Task 7).

- [ ] **Step 1: Create `src/services/crawl.ts` — move code from `src/routes/api.ts`**

```ts
import { ExtractedChapter } from "../types";
import { extractChapter, LockedContentError } from "./extractor";
import { renderPageHtml } from "./renderer";

// Some sites' anti-tool scripts blank the page at random (see renderer.ts),
// and a cold browser session can take ~10 loads before it settles down, so
// the budget is generous — each attempt is a fresh page load, and a warm
// session succeeds on the first or second try.
export const MAX_ATTEMPTS = 12;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries render+extract a few times before giving up — some sites finish
// loading their chapter body slightly after network-idle, which makes
// extraction fail intermittently rather than consistently. On final failure
// this returns a chapter with `error` set instead of throwing, so the
// caller can still show/keep a slot for it (and offer a manual retry) rather
// than silently dropping it from the result set.
export async function extractWithRetry(
  url: string,
  onAttempt?: (attempt: number) => void
): Promise<ExtractedChapter> {
  let lastError = "Unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt);
    try {
      const html = await renderPageHtml(url);
      return extractChapter(url, html);
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
      // A locked chapter can't be unlocked by rendering again — fail fast
      // instead of burning the whole retry budget on it. (The preview UI
      // still offers a manual retry per chapter.)
      if (err instanceof LockedContentError) break;
      if (attempt < MAX_ATTEMPTS) await sleep(Math.min(1000 * attempt, 3000));
    }
  }
  return { sourceUrl: url, title: url, blocks: [], error: lastError };
}
```

- [ ] **Step 2: Update `src/routes/api.ts` to use new service**

Remove `MAX_ATTEMPTS`, `sleep`, `extractWithRetry` blocks from `api.ts` (keep related comments if used). Add import:

```ts
import { MAX_ATTEMPTS, extractWithRetry } from "../services/crawl";
```

In `/extract`, keep `const attemptSuffix = ...` — no other changes; `MAX_ATTEMPTS` still referenced via import.

- [ ] **Step 3: Verify build + tests**

Run: `npm run build:backend && npx vitest run`
Expected: `tsc` no errors; all tests PASS.

- [ ] **Step 4: Verify manual tab not broken (run manually)**

Run: `npm run build:backend && node dist/server.js` (terminal 1), open `http://localhost:3100` (terminal 2 use `npm run dev:frontend` if needed), enter any xtruyen chapter URL → crawl succeeds as before.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api.ts src/services/crawl.ts
git commit -m "refactor: extract extractWithRetry into shared crawl service"
```

---

### Task 7: API endpoints `/api/stories*`

**Files:**
- Modify: `src/routes/api.ts`, `src/server.ts`

**Interfaces:**
- Consumes: `storyStore`, `storyId` (Task 1); `getTocAdapter` (Task 4); `mergeStory`, `chaptersToCrawl`, `toExtractedChapter` (Task 5); `extractWithRetry`, `MAX_ATTEMPTS` (Task 6).
- Produces (REST, used in Task 8-10): `POST /api/stories {url} → {story}`, `GET /api/stories → {stories}`, `GET /api/stories/:id → {story}`, `POST /api/stories/:id/crawl {orders?} → NDJSON`, `DELETE /api/stories/:id → {ok}`, errors 400/404/409/502 with `{message}`.

- [ ] **Step 1: Update `src/server.ts` — increase JSON body limit**

Change `express.json({ limit: "5mb" })` to:

```ts
app.use(express.json({ limit: "50mb" }));
```

(Reason: EPUB export payload for multi-chapter stories exceeds 5MB.)

- [ ] **Step 2: Add endpoints to `src/routes/api.ts`**

Add imports:

```ts
import { MAX_ATTEMPTS, extractWithRetry } from "../services/crawl";
import { storyId, storyStore } from "../services/storyStore";
import { chaptersToCrawl, mergeStory, toExtractedChapter } from "../services/storyService";
import { getTocAdapter } from "../services/toc";
import { StoredStory } from "../types";
```

Add before `export default router;`:

```ts
const crawlingStoryIds = new Set<string>();

router.post("/stories", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ message: "url is required" });
    return;
  }
  const site = findSupportedSite(url);
  if (!site) {
    res.status(400).json({ message: `This page is not yet supported: ${url}` });
    return;
  }
  const adapter = getTocAdapter(url);
  if (!adapter) {
    res.status(400).json({
      message: `${site.name} does not yet support automatic chapter list loading — please enter individual chapter URLs in the "Manual crawl" tab`,
    });
    return;
  }

  const storyUrl = adapter.normalizeStoryUrl(url);
  const id = storyId(storyUrl);
  const existing = await storyStore.get(id);
  try {
    const toc = await adapter.fetchToc(storyUrl);
    const story = mergeStory({ existing, site: site.domain, storyUrl, toc });
    await storyStore.save(story);
    res.json({ story });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : "Failed to load chapter list" });
  }
});

router.get("/stories", async (_req, res) => {
  res.json({ stories: await storyStore.list() });
});

router.get("/stories/:id", async (req, res) => {
  const story = await storyStore.get(req.params.id);
  if (!story) {
    res.status(404).json({ message: "Story not found" });
    return;
  }
  res.json({ story });
});

router.delete("/stories/:id", async (req, res) => {
  if (crawlingStoryIds.has(req.params.id)) {
    res.status(409).json({ message: "Story is being crawled, cannot delete" });
    return;
  }
  const removed = await storyStore.remove(req.params.id);
  if (!removed) {
    res.status(404).json({ message: "Story not found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/stories/:id/crawl", async (req, res) => {
  const { id } = req.params;
  const story: StoredStory | undefined = await storyStore.get(id);
  if (!story) {
    res.status(404).json({ message: "Story not found" });
    return;
  }
  if (crawlingStoryIds.has(id)) {
    res.status(409).json({ message: "Story is being crawled" });
    return;
  }

  const orders = Array.isArray((req.body as { orders?: number[] })?.orders)
    ? (req.body as { orders: number[] }).orders
    : undefined;
  const plan = chaptersToCrawl(story, orders);

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    "Transfer-Encoding": "chunked",
  });
  // If client disconnects mid-crawl, res.write will throw — ignore and
  // continue crawling, because each chapter is still saved to store when done.
  const send = (event: ProgressEvent) => {
    try {
      res.write(JSON.stringify(event) + "\n");
    } catch {
      /* client disconnected */
    }
  };

  crawlingStoryIds.add(id);
  try {
    for (let i = 0; i < plan.length; i++) {
      const chapter = plan[i];
      const extracted = await extractWithRetry(chapter.url, (attempt) => {
        const attemptSuffix = attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : "";
        send({ type: "progress", index: i, total: plan.length, url: chapter.url, message: `Loading & extracting...${attemptSuffix}` });
      });

      const stored = story.chapters.find((c) => c.order === chapter.order);
      if (stored) {
        stored.status = extracted.error ? "error" : "done";
        stored.error = extracted.error;
        stored.blocks = extracted.error ? undefined : extracted.blocks;
        if (!extracted.error) stored.title = extracted.title;
      }
      story.updatedAt = new Date().toISOString();
      await storyStore.save(story);

      if (extracted.error) {
        send({ type: "error", index: i, total: plan.length, url: chapter.url, message: extracted.error });
      }
    }
    send({ type: "done", chapters: story.chapters.map(toExtractedChapter) });
  } finally {
    crawlingStoryIds.delete(id);
    res.end();
  }
});
```

- [ ] **Step 3: Build + test**

Run: `npm run build:backend && npx vitest run`
Expected: build OK, tests PASS.

- [ ] **Step 4: Verify API with curl (server in separate terminal)**

Run (terminal 1): `npm run build:backend && node dist/server.js`

Run (terminal 2):

```bash
# 1) Create story from truyenfull URL -> expect 150 chapters, all pending
curl -sS -X POST localhost:3100/api/stories -H "Content-Type: application/json" \
  -d '{"url":"https://truyenfull.live/dau-xuan-tuoi-sang/"}' | python3 -c "
import json,sys
s=json.load(sys.stdin)['story']
print('title:', s['title'], '| chapters:', len(s['chapters']), '| statuses:', {c['status'] for c in s['chapters']})
print('id:', s['id'])
"
# Expected: chapters: 150 | statuses: {'pending'}

# 2) List + details
curl -sS localhost:3100/api/stories | python3 -c "import json,sys; print([ (s['title'], s['chapterCount']) for s in json.load(sys.stdin)['stories'] ])"
# Expected: [('Đầu Xuân Tươi Sáng', 150)]

# 3) metruyenchu -> 400 with specific message
curl -sS -o /dev/null -w "%{http_code}\n" -X POST localhost:3100/api/stories -H "Content-Type: application/json" \
  -d '{"url":"https://metruyenchu.com/truyen/a/"}'
# Expected: 400

# 4) xtruyen -> 233 chapters (Hãn Phu story)
curl -sS -X POST localhost:3100/api/stories -H "Content-Type: application/json" \
  -d '{"url":"https://xtruyen.vn/truyen/han-phu/"}' | python3 -c "
import json,sys
s=json.load(sys.stdin)['story']
print('title:', s['title'], '| chapters:', len(s['chapters']))
"
# Expected: chapters: 233

# 5) Crawl 1 chapter then check store (Playwright takes a few seconds)
ID=$(curl -sS localhost:3100/api/stories | python3 -c "import json,sys; print([s['id'] for s in json.load(sys.stdin)['stories'] if 'Đầu Xuân' in s['title']][0])")
curl -sS -N -X POST "localhost:3100/api/stories/$ID/crawl" -H "Content-Type: application/json" -d '{"orders":[1]}'
# Expected: progress lines... then {"type":"done",...}; no JSON errors
curl -sS "localhost:3100/api/stories/$ID" | python3 -c "
import json,sys
s=json.load(sys.stdin)['story']
c=s['chapters'][0]
print('status:', c['status'], '| blocks:', len(c.get('blocks') or []), '| title:', c['title'])
"
# Expected: status: done | blocks > 0

# 6) Delete the created story
curl -sS -X DELETE "localhost:3100/api/stories/$ID"
# Expected: {"ok":true}
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/api.ts src/server.ts
git commit -m "feat: API /api/stories (create/list/details/delete/resume crawl), save progress per chapter"
```

---

### Task 8: Frontend — types + API client + shared export hook

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`
- Create: `frontend/src/useEpubExport.ts`

**Interfaces:**
- Consumes: backend types from Task 1/5 (manual mirror), existing `exportEpub`, `uploadCover`.
- Produces: types `ChapterStatus`, `StoredChapter`, `StoredStory`, `StorySummary`; `createStory(url: string): Promise<StoredStory>`, `fetchStories(): Promise<StorySummary[]>`, `fetchStory(id: string): Promise<StoredStory>`, `deleteStory(id: string): Promise<void>`, `crawlStory(id: string, orders: number[] | undefined, onEvent): Promise<void>`; hook `useEpubExport(): { isExporting, exportBook }` (used in Task 9/10).

- [ ] **Step 1: Add types to `frontend/src/types.ts`**

```ts
export type ChapterStatus = "pending" | "done" | "error";

export interface StoredChapter {
  order: number;
  url: string;
  title: string;
  status: ChapterStatus;
  error?: string;
  blocks?: ContentBlock[];
}

export interface StoredStory {
  id: string;
  storyUrl: string;
  site: string;
  title: string;
  author?: string;
  coverUrl?: string;
  chapters: StoredChapter[];
  createdAt: string;
  updatedAt: string;
}

export interface StorySummary {
  id: string;
  storyUrl: string;
  site: string;
  title: string;
  chapterCount: number;
  doneCount: number;
  errorCount: number;
  updatedAt: string;
}
```

- [ ] **Step 2: Refactor `frontend/src/api.ts` + add new functions**

Thay hàm `extractChapters` hiện tại bằng helper chung và thêm các hàm stories (giữ nguyên các hàm khác):

```ts
async function streamNdjson(path: string, body: unknown, onEvent: (event: ProgressEvent) => void): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error(await readJsonError(res, "Crawl thất bại"));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line));
    }
  }
}

// Streams NDJSON progress events from POST /api/extract, invoking onEvent
// for each line as it arrives.
export async function extractChapters(urls: string[], onEvent: (event: ProgressEvent) => void): Promise<void> {
  await streamNdjson("/api/extract", { urls }, onEvent);
}

export async function crawlStory(
  id: string,
  orders: number[] | undefined,
  onEvent: (event: ProgressEvent) => void
): Promise<void> {
  await streamNdjson(`/api/stories/${encodeURIComponent(id)}/crawl`, { orders }, onEvent);
}

export async function fetchStories(): Promise<StorySummary[]> {
  const res = await fetch("/api/stories");
  if (!res.ok) throw new Error(await readJsonError(res, "Không tải được danh sách truyện"));
  const data = await res.json();
  return data.stories || [];
}

export async function createStory(url: string): Promise<StoredStory> {
  const res = await fetch("/api/stories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, "Không tải được danh sách chương"));
  const data = await res.json();
  return data.story as StoredStory;
}

export async function fetchStory(id: string): Promise<StoredStory> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await readJsonError(res, "Không tải được truyện"));
  const data = await res.json();
  return data.story as StoredStory;
}

export async function deleteStory(id: string): Promise<void> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readJsonError(res, "Không xoá được truyện"));
}
```

Update import at beginning of file:

```ts
import { BookMetadata, ExtractedChapter, ProgressEvent, StoredStory, StorySummary, SupportedSite } from "./types";
```

- [ ] **Step 3: Create `frontend/src/useEpubExport.ts`**

```ts
import { useState } from "react";
import { exportEpub, ExportChapterPayload, uploadCover } from "./api";
import { BookMetadata } from "./types";

export function useEpubExport() {
  const [isExporting, setIsExporting] = useState(false);

  async function exportBook(
    metadata: Omit<BookMetadata, "coverUrl">,
    chapters: ExportChapterPayload[],
    coverFile: File | null
  ): Promise<void> {
    setIsExporting(true);
    try {
      const coverUrl = coverFile ? await uploadCover(coverFile) : undefined;
      const blob = await exportEpub({ ...metadata, coverUrl }, chapters);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(metadata.title || "book").replace(/[^a-z0-9]+/gi, "_")}.epub`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  return { isExporting, exportBook };
}
```

- [ ] **Step 4: Build verification**

Run: `npm run build -w frontend`
Expected: Vite build OK (TS types of unused functions are fine).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/useEpubExport.ts
git commit -m "feat(frontend): API client for stories + shared EPUB export hook"
```

---

### Task 9: Extract `ManualCrawlView` from App (no behavior change)

**Files:**
- Create: `frontend/src/components/ManualCrawlView.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: everything App.tsx uses + `useEpubExport` (Task 8).
- Produces: `ManualCrawlView({ supportedSites }: { supportedSites: SupportedSite[] })`; App.tsx retains header + renders this view.

- [ ] **Step 1: Create `frontend/src/components/ManualCrawlView.tsx`**

Move **entire** state + `handleExtract`, `retrySingle`, `handleRetryAll`, `handleExport` and JSX of 2 sections from `App.tsx` to this component, with changes:

- Props: `{ supportedSites }: { supportedSites: SupportedSite[] }` (remove sites `useEffect` fetch from view — App keeps it).
- `handleExport` use hook:

```tsx
const { isExporting, exportBook } = useEpubExport();

async function handleExport() {
  try {
    const payload = chapters.map((c) => ({
      title: c.title,
      includeInBook: c.included,
      contentHtml: bodyRefs.current.get(c.id)?.innerHTML || "",
    }));
    await exportBook({ title: bookTitle || "Untitled Book", author: author || "Unknown", language }, payload, coverFile);
  } catch (err) {
    alert((err as Error).message);
  }
}
```

- Import: `import { exportEpub, extractChapters, extractOne, uploadCover } from "../api";` → change to `import { extractChapters, extractOne } from "../api";` and `import { useEpubExport } from "../useEpubExport";`.

- [ ] **Step 2: Simplify `frontend/src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import ManualCrawlView from "./components/ManualCrawlView";
import { fetchSupportedSites } from "./api";
import { SupportedSite } from "./types";

export default function App() {
  const [supportedSites, setSupportedSites] = useState<SupportedSite[]>([]);

  useEffect(() => {
    fetchSupportedSites().then(setSupportedSites).catch(() => setSupportedSites([]));
  }, []);

  return (
    <>
      <header>
        <h1>Web → EPUB cho Kindle</h1>
        <p className="subtitle">
          Trích xuất nội dung đang hiển thị trên trang web (kể cả trang chặn copy) và xuất thành EPUB.
        </p>
      </header>
      <main>
        <ManualCrawlView supportedSites={supportedSites} />
      </main>
    </>
  );
}
```

- [ ] **Step 3: Build + manual verification no regression**

Run: `npm run build -w frontend && npm run build:backend && node dist/server.js`
Open `http://localhost:3100`, crawl a few chapter URLs, verify preview/edit/export EPUB still work.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/ManualCrawlView.tsx
git commit -m "refactor(frontend): extract manual crawl tab to ManualCrawlView, no behavior change"
```

---

### Task 10: "My Stories" tab — LibraryView + StoryDetail

**Files:**
- Create: `frontend/src/components/LibraryView.tsx`, `frontend/src/components/StoryDetail.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/styles.css`

**Interfaces:**
- Consumes: API client + hook (Task 8): `createStory`, `fetchStories`, `fetchStory`, `deleteStory`, `crawlStory`; types `StoredStory`, `StorySummary`, `StoredChapter`, `ExtractedChapter`; `ChapterCard`, `useEpubExport`.
- Produces: `LibraryView({ supportedSites })` and `StoryDetail({ story, onBack, onStoryChanged })`; App has 2 tabs.

- [ ] **Step 1: Create `frontend/src/components/StoryDetail.tsx`**

```tsx
import { useRef, useState } from "react";
import { crawlStory, fetchStory } from "../api";
import { ExtractedChapter, StoredChapter, StoredStory } from "../types";
import { useEpubExport } from "../useEpubExport";
import ChapterCard from "./ChapterCard";

interface ChapterState {
  id: string;
  order: number;
  data: ExtractedChapter;
  title: string;
  included: boolean;
  retrying: boolean;
  version: number;
  retriedOnce: boolean;
}

interface LogLine {
  text: string;
  isError: boolean;
}

function toChapterState(chapter: StoredChapter, version: number): ChapterState {
  const data: ExtractedChapter =
    chapter.status === "error"
      ? { sourceUrl: chapter.url, title: chapter.title, blocks: [], error: chapter.error || "Lỗi không xác định" }
      : { sourceUrl: chapter.url, title: chapter.title, blocks: chapter.blocks ?? [] };
  return {
    id: `stored-${chapter.order}`,
    order: chapter.order,
    data,
    title: chapter.title,
    included: chapter.status === "done",
    retrying: false,
    version,
    retriedOnce: chapter.status === "error",
  };
}

export default function StoryDetail({
  story,
  onBack,
  onStoryChanged,
}: {
  story: StoredStory;
  onBack: () => void;
  onStoryChanged: () => void;
}) {
  const [chapters, setChapters] = useState<ChapterState[]>(() =>
    story.chapters.filter((c) => c.status !== "pending").map((c) => toChapterState(c, 0))
  );
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [isCrawling, setIsCrawling] = useState(false);
  const [progressPct, setProgressPct] = useState(0);

  const [bookTitle, setBookTitle] = useState(story.title);
  const [author, setAuthor] = useState(story.author || "");
  const [language, setLanguage] = useState("vi");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const { isExporting, exportBook } = useEpubExport();

  const bodyRefs = useRef(new Map<string, HTMLDivElement | null>());
  const pendingCount = story.chapters.filter((c) => c.status === "pending").length;
  const errorCount = story.chapters.filter((c) => c.status === "error").length;
  const doneCount = story.chapters.length - pendingCount - errorCount;

  async function runCrawl(orders: number[] | undefined, replaceAllOnDone: boolean) {
    setIsCrawling(true);
    setProgressPct(0);
    if (orders === undefined) setLogLines([]);
    if (orders?.length === 1) {
      const order = orders[0];
      setChapters((cs) => cs.map((c) => (c.order === order ? { ...c, retrying: true, retriedOnce: true } : c)));
    }
    try {
      await crawlStory(story.id, orders, (event) => {
        if (event.type === "progress" && event.index !== undefined && event.total) {
          setProgressPct(((event.index + 1) / event.total) * 100);
          setLogLines((lines) => [
            ...lines,
            { text: `[${event.index! + 1}/${event.total}] ${event.url} — ${event.message}`, isError: false },
          ]);
        } else if (event.type === "error" && event.index !== undefined && event.total) {
          setLogLines((lines) => [
            ...lines,
            { text: `[${event.index! + 1}/${event.total}] ${event.url} — ${event.message}`, isError: true },
          ]);
        } else if (event.type === "done") {
          setProgressPct(100);
        }
      });

      const fresh = await fetchStory(story.id);
      if (replaceAllOnDone) {
        setChapters(fresh.chapters.filter((c) => c.status !== "pending").map((c) => toChapterState(c, 0)));
      } else {
        const order = orders?.[0];
        const updated = fresh.chapters.find((c) => c.order === order);
        if (updated) {
          setChapters((cs) => cs.map((c) => (c.order === order ? toChapterState(updated, c.version + 1) : c)));
        }
      }
      onStoryChanged();
    } catch (err) {
      setLogLines((lines) => [...lines, { text: `Lỗi kết nối: ${(err as Error).message}`, isError: true }]);
    } finally {
      setIsCrawling(false);
    }
  }

  async function handleExport() {
    try {
      const payload = chapters
        .filter((c) => c.included)
        .map((c) => ({
          title: c.title,
          includeInBook: true,
          contentHtml: bodyRefs.current.get(c.id)?.innerHTML || "",
        }));
      await exportBook({ title: bookTitle || story.title, author: author || "Unknown", language }, payload, coverFile);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const remaining = pendingCount + errorCount;

  return (
    <section className="card">
      <div className="story-head">
        <button type="button" onClick={onBack}>
          ← Story list
        </button>
        <h2>{story.title}</h2>
      </div>
      <p className="hint">
        {story.storyUrl} — {story.site}
      </p>
      <div className="result-summary">
        {doneCount}/{story.chapters.length} chapters crawled
        {pendingCount > 0 && `, ${pendingCount} pending`}
        {errorCount > 0 && `, ${errorCount} errors`}
      </div>

      <button disabled={isCrawling || remaining === 0} onClick={() => runCrawl(undefined, true)}>
        {isCrawling ? "Crawling..." : `Resume crawling (${remaining} chapters)`}
      </button>

      {logLines.length > 0 && (
        <div className="progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <ul id="progress-log">
            {logLines.map((line, i) => (
              <li key={i} className={line.isError ? "error" : undefined}>
                {line.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid">
        <div>
          <label htmlFor="story-title">Tên sách</label>
          <input id="story-title" type="text" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="story-author">Tác giả</label>
          <input id="story-author" type="text" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div>
          <label htmlFor="story-language">Ngôn ngữ</label>
          <select id="story-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </div>
        <div>
          <label htmlFor="story-cover">Ảnh bìa (tùy chọn)</label>
          <input id="story-cover" type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
        </div>
      </div>

      <div id="chapters">
        {story.chapters.map((sc) => {
          if (sc.status === "pending") {
            return (
              <div key={`pending-${sc.order}`} className="chapter chapter-pending">
                <div className="chapter-head">
                  <span className="chapter-order">#{sc.order}</span>
                  <span className="chapter-title">{sc.title}</span>
                  <span className="badge badge-pending">Chờ crawl</span>
                </div>
                <p className="chapter-source">
                  Nguồn: <a href={sc.url} target="_blank" rel="noreferrer">{sc.url}</a>
                </p>
              </div>
            );
          }
          const c = chapters.find((x) => x.order === sc.order);
          if (!c) return null;
          return (
            <ChapterCard
              key={`${c.id}-${c.version}`}
              chapter={c.data}
              order={c.order}
              title={c.title}
              included={c.included}
              retrying={c.retrying}
              retriedOnce={c.retriedOnce}
              onTitleChange={(title) => setChapters((cs) => cs.map((x) => (x.id === c.id ? { ...x, title } : x)))}
              onIncludedChange={(included) => setChapters((cs) => cs.map((x) => (x.id === c.id ? { ...x, included } : x)))}
              onRetry={() => runCrawl([c.order], false)}
              bodyRef={(el) => bodyRefs.current.set(c.id, el)}
            />
          );
        })}
      </div>

      <button disabled={isExporting} onClick={handleExport}>
        {isExporting ? "Đang xuất..." : "Xuất EPUB"}
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/LibraryView.tsx`**

(Code block trimmed for brevity — translate key labels in UI):
- "My Stories" (Truyện của tôi)
- "Paste story page URL (e.g. https://truyenfull.live/dau-xuan-tuoi-sang/) to load full chapter list." (Dán URL trang truyện...)
- "Load chapter list" (Tải danh sách chương)
- "No stories yet." (Chưa có truyện nào)
- "chapters", "error", "Delete" (chương, lỗi, Xoá)

- [ ] **Step 3: Update `frontend/src/App.tsx` add tabs**

```tsx
import { useEffect, useState } from "react";
import LibraryView from "./components/LibraryView";
import ManualCrawlView from "./components/ManualCrawlView";
import { fetchSupportedSites } from "./api";
import { SupportedSite } from "./types";

export default function App() {
  const [supportedSites, setSupportedSites] = useState<SupportedSite[]>([]);
  const [tab, setTab] = useState<"manual" | "library">("manual");

  useEffect(() => {
    fetchSupportedSites().then(setSupportedSites).catch(() => setSupportedSites([]));
  }, []);

  return (
    <>
      <header>
        <h1>Web → EPUB cho Kindle</h1>
        <p className="subtitle">
          Trích xuất nội dung đang hiển thị trên trang web (kể cả trang chặn copy) và xuất thành EPUB.
        </p>
      </header>
      <main>
        <nav className="tabs">
          <button className={tab === "manual" ? "active" : ""} onClick={() => setTab("manual")}>
            Manual crawl
          </button>
          <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>
            My Stories
          </button>
        </nav>
        {tab === "manual" ? (
          <ManualCrawlView supportedSites={supportedSites} />
        ) : (
          <LibraryView supportedSites={supportedSites} />
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Thêm CSS vào cuối `frontend/src/styles.css`**

```css
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.tabs button {
  background: transparent;
  border: 1px solid #444;
  color: inherit;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.tabs button.active {
  background: #2f6fed;
  border-color: #2f6fed;
  color: #fff;
}

.story-add {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}

.story-add input {
  flex: 1;
}

.story-list {
  list-style: none;
  padding: 0;
  margin: 16px 0 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.story-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 10px 12px;
}

.story-item-main {
  flex: 1;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.story-site,
.story-progress {
  font-size: 12px;
  opacity: 0.75;
}

.story-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  margin-bottom: 6px;
}

.badge-pending {
  background: #444;
  color: #ddd;
}

.chapter-pending {
  opacity: 0.7;
}
```

- [ ] **Step 5: Build**

Run: `npm run build` (build backend + frontend)
Expected: both pass.

- [ ] **Step 6: Verify E2E manually**

Run (terminal 1): `node dist/server.js` — terminal 2: `npm run dev:frontend` (or use build at `localhost:3100`).

1. "My Stories" tab → paste `https://truyenfull.live/dau-xuan-tuoi-sang/` → "Load chapter list" → see 150 chapters, `0/150`.
2. Click "Resume crawling (150 chapters)" → wait 2-3 chapters then **close browser tab**.
3. Reopen `localhost:3100` → "My Stories" tab → story shows `n/150` where n = chapters done; open details → exactly n chapters, rest "Pending".
4. Click "Resume crawling" → only runs remaining chapters (log starts from unfinished).
5. For an error chapter (if any): click "Retry" on ChapterCard → status updates when done.
6. Export EPUB from story with several chapters → file downloads, opens readable.
7. Check `data/stories/*.json` has correct status.
8. "Manual crawl" tab still works normally.
9. Try adding story from xtruyen.vn → 233 chapters.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/LibraryView.tsx frontend/src/components/StoryDetail.tsx frontend/src/styles.css
git commit -m "feat(frontend): My Stories tab - list, progress, resume crawl, export EPUB"
```

---

### Task 11: README + overall verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: feature documentation + limitations; final verification.

- [ ] **Step 1: Update README — Features section**

Add section describing 2 new features (story management in `data/stories/`, auto-load TOC for truyenfull/.vn/truyencom/xtruyen; resume crawl after closing tab without losing progress).

- [ ] **Step 2: Update README — "7. Current Limitations (MVP)" section**

Add limitations (copy verbatim from spec section 7):

```markdown
- "My Stories" tab automatically loads chapter list for truyenfull.live,
  truyenfull.vn, truyencom.com, and xtruyen.vn. metruyenchu.com requires manual
  chapter URL entry in "Manual crawl" tab.
- Crawl progress saved in `data/stories/*.json` (not committed). Chapter and
  book edits in UI are **not** saved — only used for current export. Raw crawl
  results are saved and reused when resuming crawl.
- Very long stories (thousands of chapters) may cause heavy UI when opening
  details due to loading all crawled content.
- Site HTML/API structure changes may break TOC adapter (clear error, no orphaned
  records).
```

- [ ] **Step 3: Verify all**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; backend + frontend build OK.

Re-run E2E checklist from Task 10 Step 6 (items 1-9).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: story management feature + My Stories tab limitations"
```

---

## Self-review (validated during plan writing)

- **Spec coverage:** story store (T1), TOC adapters truyenfull/truyencom (T2) + xtruyen (T3) + registry (T4), merge/plan (T5), shared crawl service (T6), 5 API endpoints + per-chapter save + locking + body limit (T7), frontend API/hook (T8), extract manual tab (T9), Library + StoryDetail + tabs + CSS (T10), README/limits + verify (T11). No spec sections missing.
- **Placeholder scan:** no TBD/TODO; all steps have concrete code/commands.
- **Type consistency:** `TocResult`/`TocAdapter` (T2) used consistently in T3/T4/T5; `storyId`/`summarize`/`createStoryStore`/`storyStore` (T1) used in T5/T7; `MAX_ATTEMPTS`/`extractWithRetry` (T6) used in T7; `useEpubExport` (T8) used in T9/T10; `crawlStory(id, orders, onEvent)` (T8) called in T10.
- **Implementation note:** `Item 1` of Task 7 Step 4 expects 150 chapters but actual count depends on site (if site adds chapters, adjust expected count per actual TOC result, as long as full TOC is loaded).
