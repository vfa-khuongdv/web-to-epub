# Quản lý truyện đã crawl + tự động load danh sách chương — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lưu tiến độ crawl theo từng truyện vào file JSON để xem lại/crawl tiếp, và tự động lấy toàn bộ danh sách chương khi người dùng dán URL truyện.

**Architecture:** Backend thêm `storyStore` (file JSON atomic trong `data/stories/`), `toc` adapters (fetch + parse HTML/JSON thuần, không cần Playwright) cho truyenfull/.vn/truyencom/xtruyen, `crawl` service dùng chung với flow cũ, và 5 endpoint `/api/stories*`. Frontend tách 2 tab: "Crawl thủ công" (nguyên trạng) và "Truyện của tôi" (danh sách + chi tiết + crawl tiếp + export).

**Tech Stack:** Node 22 + Express + TypeScript (CommonJS, `tsc` → `dist/`), JSDOM (đã có), Vitest (thêm mới), React + Vite (frontend).

**Spec:** `docs/superpowers/specs/2026-09-17-crawl-story-management-design.md`

## Global Constraints

- Không đổi hành vi tab "Crawl thủ công" hiện tại.
- Không persist chỉnh sửa thủ công của người dùng (chỉ lưu kết quả crawl thô).
- Adapter TOC chỉ cho: `truyenfull.live`, `truyenfull.vn`, `truyencom.com`, `xtruyen.vn`; `metruyenchu.com` báo lỗi rõ ràng.
- Backend build bằng `npm run build:backend` (`tsc`, `rootDir: src`, output `dist/`); test bằng `npx vitest run`.
- Frontend build bằng `npm run build -w frontend`.
- Fixtures test commit vào repo, test không gọi mạng.
- Văn bản UI/log bằng tiếng Việt, code/comment bằng tiếng Anh (theo style hiện có).
- Commit sau mỗi task, message theo style repo (`feat:`, `test:`, `refactor:`, `docs:`).

---

### Task 1: Story store + Vitest setup

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.gitignore`, `src/types.ts`
- Create: `src/services/storyStore.ts`, `src/services/storyStore.test.ts`

**Interfaces:**
- Consumes: không.
- Produces: `storyId(storyUrl: string): string`, `summarize(story: StoredStory): StorySummary`, `createStoryStore(baseDir: string): StoryStore`, `storyStore` (instance mặc định, trỏ `data/stories`); types `ChapterStatus`, `StoredChapter`, `StoredStory`, `StorySummary` trong `src/types.ts`.

- [ ] **Step 1: Cài vitest + script test + exclude test khỏi build**

```bash
npm i -D vitest
```

Sửa `package.json` scripts thành:

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

Thêm vào `tsconfig.json`:

```json
  "exclude": ["src/**/*.test.ts", "src/**/__fixtures__/**"]
```

Thêm dòng `data/` vào `.gitignore`.

- [ ] **Step 2: Viết test thất bại**

Tạo `src/services/storyStore.test.ts`:

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
        error: "Trang bị xoá trắng",
      },
    ],
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("storyId", () => {
  it("stable và khác nhau giữa các URL", () => {
    expect(storyId("https://a.com/x/")).toBe(storyId("https://a.com/x/"));
    expect(storyId("https://a.com/x/")).not.toBe(storyId("https://a.com/y/"));
  });
});

describe("summarize", () => {
  it("đếm đúng done/error/total", () => {
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

  it("save rồi get trả về đúng dữ liệu (round-trip)", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.get(story.id)).toEqual(story);
  });

  it("save lần sau ghi đè bản cũ", async () => {
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

  it("list sắp xếp theo updatedAt giảm dần, bỏ qua file hỏng", async () => {
    await store.save(makeStory({ updatedAt: "2026-09-17T00:00:00.000Z" }));
    await store.save(
      makeStory({ id: storyId("https://example.com/truyen-b/"), storyUrl: "https://example.com/truyen-b/", updatedAt: "2026-09-18T00:00:00.000Z" })
    );
    await writeFile(path.join(dir, "broken.json"), "{ khong phai json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const stories = await store.list();
    expect(stories.map((s) => s.id)).toHaveLength(2);
    expect(stories[0].updatedAt).toBe("2026-09-18T00:00:00.000Z");
    warn.mockRestore();
  });

  it("get/remove trả undefined/false khi không tồn tại", async () => {
    expect(await store.get(storyId("https://example.com/khong-co/"))).toBeUndefined();
    expect(await store.remove(storyId("https://example.com/khong-co/"))).toBe(false);
  });

  it("remove xoá file", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.remove(story.id)).toBe(true);
    expect(await store.get(story.id)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Chạy test để chắc chắn fail**

Run: `npx vitest run src/services/storyStore.test.ts`
Expected: FAIL — `Cannot find module './storyStore'`.

- [ ] **Step 4: Thêm types vào `src/types.ts`**

Thêm cuối file:

```ts
export type ChapterStatus = "pending" | "done" | "error";

export interface StoredChapter {
  order: number; // vị trí trong TOC, bắt đầu từ 1
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

- [ ] **Step 5: Viết `src/services/storyStore.ts`**

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
          console.warn(`Bỏ qua file truyện hỏng: ${name}`, err);
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

- [ ] **Step 6: Chạy test để chắc chắn pass**

Run: `npx vitest run src/services/storyStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src/types.ts src/services/storyStore.ts src/services/storyStore.test.ts
git commit -m "feat: story store (file JSON) cho quản lý tiến độ crawl + setup vitest"
```

---

### Task 2: TOC adapter template truyenfull (truyenfull.live/.vn + truyencom.com)

**Files:**
- Create: `src/services/toc/types.ts`, `src/services/toc/normalizeUrl.ts`, `src/services/toc/truyenfullTemplate.ts`, `src/services/toc/truyenfullTemplate.test.ts`
- Create (fixtures, commit): `src/services/toc/__fixtures__/truyenfull-story.html`, `src/services/toc/__fixtures__/truyencom-story.html`

**Interfaces:**
- Consumes: không.
- Produces: `TocChapter`, `TocResult`, `TocAdapter` (types.ts); `normalizeStoryUrl(url: string): string` (normalizeUrl.ts); `parseStoryMeta(html: string, pageUrl: string): { title, author?, coverUrl? }`, `parseChapterLinks(html: string, pageUrl: string): TocChapter[]`, `parseTotalPages(html: string): number | undefined`, `truyenfullTemplateAdapter: TocAdapter` (truyenfullTemplate.ts).

- [ ] **Step 1: Tải fixtures**

```bash
mkdir -p src/services/toc/__fixtures__
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
curl -sS -A "$UA" "https://truyenfull.live/dau-xuan-tuoi-sang/" -o src/services/toc/__fixtures__/truyenfull-story.html
curl -sS -A "$UA" "https://truyencom.com/de-ba.27/" -o src/services/toc/__fixtures__/truyencom-story.html
ls -la src/services/toc/__fixtures__/
```

Expected: 2 file, mỗi file > 60KB.

- [ ] **Step 2: Viết test thất bại**

Tạo `src/services/toc/truyenfullTemplate.test.ts`:

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

  it("truyencom.com: title lấy từ h1", () => {
    const meta = parseStoryMeta(readFixture("truyencom-story.html"), "https://truyencom.com/de-ba.27/");
    expect(nfc(meta.title)).toBe(nfc("Đế Bá"));
    expect(meta.author).toBeTruthy();
  });
});

describe("parseChapterLinks", () => {
  it("truyenfull.live: 50 chương trang 1, giữ đúng thứ tự", () => {
    const chapters = parseChapterLinks(readFixture("truyenfull-story.html"), "https://truyenfull.live/dau-xuan-tuoi-sang/");
    expect(chapters).toHaveLength(50);
    expect(chapters[0].url).toBe("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-1/");
    expect(chapters[49].url).toBe("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-50/");
    expect(nfc(chapters[0].title)).toContain(nfc("Chương 1"));
  });

  it("truyencom.com: 50 chương, href .html", () => {
    const chapters = parseChapterLinks(readFixture("truyencom-story.html"), "https://truyencom.com/de-ba.27/");
    expect(chapters).toHaveLength(50);
    expect(chapters[0].url).toBe("https://truyencom.com/de-ba/chuong-1.html");
  });
});

describe("parseTotalPages", () => {
  it("truyenfull.live: đọc từ #total-page", () => {
    expect(parseTotalPages(readFixture("truyenfull-story.html"))).toBe(3);
  });

  it("truyencom.com: suy ra từ pagination links", () => {
    expect(parseTotalPages(readFixture("truyencom-story.html"))).toBe(140);
  });
});

describe("normalizeStoryUrl", () => {
  it("cắt URL chương truyenfull về URL truyện", () => {
    expect(normalizeStoryUrl("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-12/")).toBe(
      "https://truyenfull.live/dau-xuan-tuoi-sang/"
    );
  });

  it("cắt URL chương .html của truyencom về URL truyện", () => {
    expect(normalizeStoryUrl("https://truyencom.com/de-ba/chuong-118.html")).toBe("https://truyencom.com/de-ba/");
  });

  it("giữ nguyên URL truyện, bỏ query/hash", () => {
    expect(normalizeStoryUrl("https://truyenfull.live/dau-xuan-tuoi-sang/?abc=1#x")).toBe(
      "https://truyenfull.live/dau-xuan-tuoi-sang/"
    );
  });
});
```

- [ ] **Step 3: Chạy test để chắc chắn fail**

Run: `npx vitest run src/services/toc/truyenfullTemplate.test.ts`
Expected: FAIL — không tìm thấy module `./truyenfullTemplate`.

- [ ] **Step 4: Viết `src/services/toc/types.ts`**

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

- [ ] **Step 5: Viết `src/services/toc/normalizeUrl.ts`**

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

- [ ] **Step 6: Viết `src/services/toc/truyenfullTemplate.ts`**

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
    throw new Error(`Không tìm thấy danh sách chương tại ${storyUrl} — kiểm tra lại URL truyện`);
  }
  return { ...meta, chapters };
}

export const truyenfullTemplateAdapter: TocAdapter = {
  domains: TRUYENFULL_TEMPLATE_DOMAINS,
  fetchToc,
  normalizeStoryUrl,
};
```

- [ ] **Step 7: Chạy test để chắc chắn pass**

Run: `npx vitest run src/services/toc/truyenfullTemplate.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 8: Commit**

```bash
git add src/services/toc/
git commit -m "feat: TOC adapter cho truyenfull/.vn + truyencom (parse HTML, có fixture test)"
```

---

### Task 3: TOC adapter xtruyen

**Files:**
- Create: `src/services/toc/xtruyen.ts`, `src/services/toc/xtruyen.test.ts`
- Create (fixtures, commit): `src/services/toc/__fixtures__/xtruyen-story.html`, `src/services/toc/__fixtures__/xtruyen-chapters.json`

**Interfaces:**
- Consumes: `TocAdapter`, `TocResult` từ `./types`; `normalizeStoryUrl` từ `./normalizeUrl`.
- Produces: `parseMangaId(html: string): string | undefined`, `parseStoryMeta(html: string, pageUrl: string)`, `parseChaptersResponse(text: string): { slug: string; title: string }[]`, `buildChapterUrl(storyUrl: string, slug: string): string`, `xtruyenAdapter: TocAdapter`.

- [ ] **Step 1: Tải fixtures**

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
curl -sS -A "$UA" "https://xtruyen.vn/truyen/han-phu/" -o src/services/toc/__fixtures__/xtruyen-story.html
curl -sS -A "$UA" -H "x-custom-auth: abC0000011111" -H "X-Requested-With: XMLHttpRequest" \
  -e "https://xtruyen.vn/truyen/han-phu/" -X POST "https://xtruyen.vn/api/api-chapters.php" \
  --data "manga_id=2892796&from=1&to=100&vol=" -o src/services/toc/__fixtures__/xtruyen-chapters.json
head -c 200 src/services/toc/__fixtures__/xtruyen-chapters.json; echo
```

Expected: JSON bắt đầu bằng `[{"s":"chuong-1","n":"Chương 1","e":""},...`.

- [ ] **Step 2: Viết test thất bại**

Tạo `src/services/toc/xtruyen.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildChapterUrl, parseChaptersResponse, parseMangaId, parseStoryMeta } from "./xtruyen";
import { normalizeStoryUrl } from "./normalizeUrl";

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

describe("parseMangaId", () => {
  it("đọc data-id từ #manga-chapters-holder", () => {
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
  it("parse 100 item từ JSON API", () => {
    const items = parseChaptersResponse(readFixture("xtruyen-chapters.json"));
    expect(items).toHaveLength(100);
    expect(items[0]).toEqual({ slug: "chuong-1", title: "Chương 1" });
    expect(items[99].slug).toBe("chuong-100");
  });

  it("ném lỗi khi JSON sai định dạng", () => {
    expect(() => parseChaptersResponse("<html>khong phai json</html>")).toThrow();
  });
});

describe("buildChapterUrl", () => {
  it("ghép URL chương từ slug", () => {
    expect(buildChapterUrl("https://xtruyen.vn/truyen/han-phu/", "chuong-12")).toBe(
      "https://xtruyen.vn/truyen/han-phu/chuong-12/"
    );
  });
});

describe("normalizeStoryUrl (xtruyen)", () => {
  it("cắt URL chương về URL truyện", () => {
    expect(normalizeStoryUrl("https://xtruyen.vn/truyen/han-phu/chuong-233/")).toBe("https://xtruyen.vn/truyen/han-phu/");
  });
});
```

- [ ] **Step 3: Chạy test để chắc chắn fail**

Run: `npx vitest run src/services/toc/xtruyen.test.ts`
Expected: FAIL — không tìm thấy module `./xtruyen`.

- [ ] **Step 4: Viết `src/services/toc/xtruyen.ts`**

```ts
import { JSDOM } from "jsdom";
import { normalizeStoryUrl } from "./normalizeUrl";
import { TocAdapter, TocChapter, TocResult } from "./types";

export const XTRUYEN_DOMAINS = ["xtruyen.vn"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
// Endpoint AJAX nội bộ của xtruyen.vn yêu cầu header tĩnh này (xem manga-single.js
// + request thật của trang); không phải thông tin đăng nhập của người dùng.
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
    throw new Error("API danh sách chương của xtruyen trả về không phải JSON");
  }
  if (!Array.isArray(data)) {
    throw new Error("API danh sách chương của xtruyen trả về sai định dạng");
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
  if (!res.ok) throw new Error(`Không tải được ${url} (HTTP ${res.status})`);
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
  if (!res.ok) throw new Error(`Không tải được ${url} (HTTP ${res.status})`);
  return res.text();
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const pageHtml = await fetchHtml(storyUrl);
  const meta = parseStoryMeta(pageHtml, storyUrl);
  const mangaId = parseMangaId(pageHtml);
  if (!mangaId) {
    throw new Error(`Không tìm thấy mã truyện trên trang ${storyUrl} — kiểm tra lại URL truyện`);
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
    throw new Error(`Không tìm thấy danh sách chương tại ${storyUrl} — kiểm tra lại URL truyện`);
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

- [ ] **Step 5: Chạy test để chắc chắn pass**

Run: `npx vitest run src/services/toc/xtruyen.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/toc/
git commit -m "feat: TOC adapter cho xtruyen.vn (API chapters + fixture test)"
```

---

### Task 4: TOC registry theo hostname

**Files:**
- Create: `src/services/toc/index.ts`, `src/services/toc/index.test.ts`

**Interfaces:**
- Consumes: `truyenfullTemplateAdapter`, `xtruyenAdapter`, `TocAdapter`.
- Produces: `getTocAdapter(url: string): TocAdapter | undefined` (Task 7 dùng).

- [ ] **Step 1: Viết test thất bại**

Tạo `src/services/toc/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getTocAdapter } from "./index";

describe("getTocAdapter", () => {
  it("chọn adapter theo hostname, bỏ tiền tố www", () => {
    expect(getTocAdapter("https://truyenfull.live/a/")?.domains).toContain("truyenfull.live");
    expect(getTocAdapter("https://truyenfull.vn/a/")?.domains).toContain("truyenfull.vn");
    expect(getTocAdapter("https://www.truyencom.com/de-ba.27/")?.domains).toContain("truyencom.com");
    expect(getTocAdapter("https://xtruyen.vn/truyen/han-phu/")?.domains).toContain("xtruyen.vn");
  });

  it("trả undefined cho site không có adapter (metruyenchu, site lạ)", () => {
    expect(getTocAdapter("https://metruyenchu.com/truyen/a/")).toBeUndefined();
    expect(getTocAdapter("https://example.com/a/")).toBeUndefined();
  });

  it("trả undefined cho URL không hợp lệ", () => {
    expect(getTocAdapter("khong-phai-url")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn fail**

Run: `npx vitest run src/services/toc/index.test.ts`
Expected: FAIL — không tìm thấy module `./index`.

- [ ] **Step 3: Viết `src/services/toc/index.ts`**

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

- [ ] **Step 4: Chạy test để chắc chắn pass**

Run: `npx vitest run src/services/toc/index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/toc/index.ts src/services/toc/index.test.ts
git commit -m "feat: registry chọn TOC adapter theo hostname"
```

---

### Task 5: storyService — merge TOC + chọn chương cần crawl

**Files:**
- Create: `src/services/storyService.ts`, `src/services/storyService.test.ts`

**Interfaces:**
- Consumes: `storyId` từ `./storyStore`; types `StoredChapter`, `StoredStory`, `ExtractedChapter` từ `../types`; `TocResult` từ `./toc/types`.
- Produces: `mergeStory(params: { existing?: StoredStory; site: string; storyUrl: string; toc: TocResult; now?: string }): StoredStory`, `chaptersToCrawl(story: StoredStory, orders?: number[]): StoredChapter[]`, `toExtractedChapter(chapter: StoredChapter): ExtractedChapter` (Task 7 dùng).

- [ ] **Step 1: Viết test thất bại**

Tạo `src/services/storyService.test.ts`:

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
      { order: 1, url: "https://example.com/a/chuong-1/", title: "Chương 1 (sửa)", status: "done", blocks: [{ type: "paragraph", text: "x" }] },
      { order: 2, url: "https://example.com/a/chuong-2/", title: "Chương 2", status: "error", error: "timeout" },
    ],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("mergeStory", () => {
  it("tạo mới khi chưa có: mọi chương pending, giữ createdAt mới", () => {
    const merged = mergeStory({ site: "example.com", storyUrl: "https://example.com/a/", toc, now: "2026-09-17T00:00:00.000Z" });
    expect(merged.chapters.map((c) => c.status)).toEqual(["pending", "pending", "pending"]);
    expect(merged.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
    expect(merged.createdAt).toBe("2026-09-17T00:00:00.000Z");
    expect(merged.author).toBe("Tác giả");
  });

  it("giữ status/blocks/error/title của chương cũ theo URL, thêm chương mới là pending", () => {
    const merged = mergeStory({ existing: existingStory(), site: "example.com", storyUrl: "https://example.com/a/", toc });
    expect(merged.chapters[0]).toMatchObject({ status: "done", title: "Chương 1 (sửa)" });
    expect(merged.chapters[1]).toMatchObject({ status: "error", error: "timeout" });
    expect(merged.chapters[2]).toMatchObject({ status: "pending" });
    expect(merged.createdAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("chaptersToCrawl", () => {
  it("mặc định chỉ chương chưa done (pending + error), giữ thứ tự", () => {
    const story = existingStory();
    story.chapters.push({ order: 3, url: "https://example.com/a/chuong-3/", title: "Chương 3", status: "pending" });
    expect(chaptersToCrawl(story).map((c) => c.order)).toEqual([2, 3]);
  });

  it("có orders thì trả đúng các order đó, kể cả chương done", () => {
    const story = existingStory();
    expect(chaptersToCrawl(story, [1]).map((c) => c.order)).toEqual([1]);
  });

  it("bỏ qua order không tồn tại", () => {
    expect(chaptersToCrawl(existingStory(), [99])).toEqual([]);
  });
});

describe("toExtractedChapter", () => {
  it("chương done: trả blocks; chương error: trả error", () => {
    expect(toExtractedChapter({ order: 1, url: "u", title: "t", status: "done", blocks: [] })).toEqual({
      sourceUrl: "u",
      title: "t",
      blocks: [],
    });
    const failed = toExtractedChapter({ order: 2, url: "u2", title: "t2", status: "error", error: "lỗi" });
    expect(failed.error).toBe("lỗi");
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn fail**

Run: `npx vitest run src/services/storyService.test.ts`
Expected: FAIL — không tìm thấy module `./storyService`.

- [ ] **Step 3: Viết `src/services/storyService.ts`**

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
    return { sourceUrl: chapter.url, title: chapter.title, blocks: [], error: chapter.error || "Lỗi không xác định" };
  }
  return { sourceUrl: chapter.url, title: chapter.title, blocks: chapter.blocks ?? [] };
}
```

- [ ] **Step 4: Chạy test để chắc chắn pass**

Run: `npx vitest run src/services/storyService.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/storyService.ts src/services/storyService.test.ts
git commit -m "feat: storyService merge TOC luôn giữ tiến độ cũ + chọn chương cần crawl"
```

---

### Task 6: Tách crawl service dùng chung

**Files:**
- Create: `src/services/crawl.ts`
- Modify: `src/routes/api.ts`

**Interfaces:**
- Consumes: `renderPageHtml` từ `./renderer`, `extractChapter`/`LockedContentError` từ `./extractor`, `ExtractedChapter` từ `../types`.
- Produces: `MAX_ATTEMPTS: number`, `extractWithRetry(url: string, onAttempt?: (attempt: number) => void): Promise<ExtractedChapter>` (Task 7 dùng).

- [ ] **Step 1: Tạo `src/services/crawl.ts` — chuyển nguyên code từ `src/routes/api.ts`**

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
  let lastError = "Lỗi không xác định";
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

- [ ] **Step 2: Sửa `src/routes/api.ts` dùng service mới**

Xoá khối `MAX_ATTEMPTS`, `sleep`, `extractWithRetry` khỏi `api.ts` (giữ comment liên quan nếu còn dùng). Thêm import:

```ts
import { MAX_ATTEMPTS, extractWithRetry } from "../services/crawl";
```

Trong `/extract`, thay `const attemptSuffix = ...` — không đổi code khác; `MAX_ATTEMPTS` vẫn được tham chiếu qua import.

- [ ] **Step 3: Verify build + test**

Run: `npm run build:backend && npx vitest run`
Expected: `tsc` không lỗi; tất cả test PASS.

- [ ] **Step 4: Verify tab thủ công không hồi quy (chạy tay)**

Run: `npm run build:backend && node dist/server.js` (terminal 1), mở `http://localhost:3100` (terminal 2 dùng `npm run dev:frontend` nếu cần), nhập 1 URL chương xtruyen bất kỳ → crawl thành công như trước.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api.ts src/services/crawl.ts
git commit -m "refactor: tách extractWithRetry thành crawl service dùng chung"
```

---

### Task 7: API endpoints `/api/stories*`

**Files:**
- Modify: `src/routes/api.ts`, `src/server.ts`

**Interfaces:**
- Consumes: `storyStore`, `storyId` (Task 1); `getTocAdapter` (Task 4); `mergeStory`, `chaptersToCrawl`, `toExtractedChapter` (Task 5); `extractWithRetry`, `MAX_ATTEMPTS` (Task 6).
- Produces (REST, Task 8-10 dùng): `POST /api/stories {url} → {story}`, `GET /api/stories → {stories}`, `GET /api/stories/:id → {story}`, `POST /api/stories/:id/crawl {orders?} → NDJSON`, `DELETE /api/stories/:id → {ok}`, lỗi 400/404/409/502 với `{message}`.

- [ ] **Step 1: Sửa `src/server.ts` — nâng giới hạn JSON body**

Đổi `express.json({ limit: "5mb" })` thành:

```ts
app.use(express.json({ limit: "50mb" }));
```

(Lý do: payload export EPUB của truyện nhiều chương lớn hơn 5MB.)

- [ ] **Step 2: Thêm endpoints vào `src/routes/api.ts`**

Thêm import:

```ts
import { MAX_ATTEMPTS, extractWithRetry } from "../services/crawl";
import { storyId, storyStore } from "../services/storyStore";
import { chaptersToCrawl, mergeStory, toExtractedChapter } from "../services/storyService";
import { getTocAdapter } from "../services/toc";
import { StoredStory } from "../types";
```

Thêm trước `export default router;`:

```ts
const crawlingStoryIds = new Set<string>();

router.post("/stories", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ message: "url là bắt buộc" });
    return;
  }
  const site = findSupportedSite(url);
  if (!site) {
    res.status(400).json({ message: `Trang này chưa được hỗ trợ: ${url}` });
    return;
  }
  const adapter = getTocAdapter(url);
  if (!adapter) {
    res.status(400).json({
      message: `${site.name} chưa hỗ trợ tự động load danh sách chương — hãy nhập URL từng chương ở tab "Crawl thủ công"`,
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
    res.status(502).json({ message: err instanceof Error ? err.message : "Không tải được danh sách chương" });
  }
});

router.get("/stories", async (_req, res) => {
  res.json({ stories: await storyStore.list() });
});

router.get("/stories/:id", async (req, res) => {
  const story = await storyStore.get(req.params.id);
  if (!story) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  res.json({ story });
});

router.delete("/stories/:id", async (req, res) => {
  if (crawlingStoryIds.has(req.params.id)) {
    res.status(409).json({ message: "Truyện đang được crawl, không thể xoá" });
    return;
  }
  const removed = await storyStore.remove(req.params.id);
  if (!removed) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  res.json({ ok: true });
});

router.post("/stories/:id/crawl", async (req, res) => {
  const { id } = req.params;
  const story: StoredStory | undefined = await storyStore.get(id);
  if (!story) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  if (crawlingStoryIds.has(id)) {
    res.status(409).json({ message: "Truyện đang được crawl" });
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
  // Nếu client ngắt kết nối giữa chừng, res.write sẽ ném lỗi — bỏ qua và
  // tiếp tục crawl, vì mỗi chương vẫn được lưu vào store ngay khi xong.
  const send = (event: ProgressEvent) => {
    try {
      res.write(JSON.stringify(event) + "\n");
    } catch {
      /* client đã ngắt kết nối */
    }
  };

  crawlingStoryIds.add(id);
  try {
    for (let i = 0; i < plan.length; i++) {
      const chapter = plan[i];
      const extracted = await extractWithRetry(chapter.url, (attempt) => {
        const attemptSuffix = attempt > 1 ? ` (lần thử ${attempt}/${MAX_ATTEMPTS})` : "";
        send({ type: "progress", index: i, total: plan.length, url: chapter.url, message: `Đang tải & trích xuất...${attemptSuffix}` });
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
Expected: build OK, test PASS.

- [ ] **Step 4: Verify API bằng curl (server chạy ở terminal riêng)**

Run (terminal 1): `npm run build:backend && node dist/server.js`

Run (terminal 2):

```bash
# 1) Tạo truyện từ URL truyenfull -> kỳ vọng 150 chương, tất cả pending
curl -sS -X POST localhost:3100/api/stories -H "Content-Type: application/json" \
  -d '{"url":"https://truyenfull.live/dau-xuan-tuoi-sang/"}' | python3 -c "
import json,sys
s=json.load(sys.stdin)['story']
print('title:', s['title'], '| chapters:', len(s['chapters']), '| statuses:', {c['status'] for c in s['chapters']})
print('id:', s['id'])
"
# Expected: chapters: 150 | statuses: {'pending'}

# 2) Danh sách + chi tiết
curl -sS localhost:3100/api/stories | python3 -c "import json,sys; print([ (s['title'], s['chapterCount']) for s in json.load(sys.stdin)['stories'] ])"
# Expected: [('Đầu Xuân Tươi Sáng', 150)]

# 3) metruyenchu -> 400 với message riêng
curl -sS -o /dev/null -w "%{http_code}\n" -X POST localhost:3100/api/stories -H "Content-Type: application/json" \
  -d '{"url":"https://metruyenchu.com/truyen/a/"}'
# Expected: 400

# 4) xtruyen -> 233 chương (truyện Hãn Phu)
curl -sS -X POST localhost:3100/api/stories -H "Content-Type: application/json" \
  -d '{"url":"https://xtruyen.vn/truyen/han-phu/"}' | python3 -c "
import json,sys
s=json.load(sys.stdin)['story']
print('title:', s['title'], '| chapters:', len(s['chapters']))
"
# Expected: chapters: 233

# 5) Crawl 1 chương rồi kiểm tra store (Playwright cần vài giây)
ID=$(curl -sS localhost:3100/api/stories | python3 -c "import json,sys; print([s['id'] for s in json.load(sys.stdin)['stories'] if 'Đầu Xuân' in s['title']][0])")
curl -sS -N -X POST "localhost:3100/api/stories/$ID/crawl" -H "Content-Type: application/json" -d '{"orders":[1]}'
# Expected: dòng progress... rồi dòng {"type":"done",...}; không có lỗi JSON
curl -sS "localhost:3100/api/stories/$ID" | python3 -c "
import json,sys
s=json.load(sys.stdin)['story']
c=s['chapters'][0]
print('status:', c['status'], '| blocks:', len(c.get('blocks') or []), '| title:', c['title'])
"
# Expected: status: done | blocks > 0

# 6) Xoá truyện vừa tạo
curl -sS -X DELETE "localhost:3100/api/stories/$ID"
# Expected: {"ok":true}
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/api.ts src/server.ts
git commit -m "feat: API /api/stories (tạo/list/chi tiết/xoá/crawl tiếp), lưu tiến độ từng chương"
```

---

### Task 8: Frontend — types + API client + export hook dùng chung

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`
- Create: `frontend/src/useEpubExport.ts`

**Interfaces:**
- Consumes: types backend ở Task 1/5 (mirror thủ công), `exportEpub`, `uploadCover` hiện có.
- Produces: types `ChapterStatus`, `StoredChapter`, `StoredStory`, `StorySummary`; `createStory(url: string): Promise<StoredStory>`, `fetchStories(): Promise<StorySummary[]>`, `fetchStory(id: string): Promise<StoredStory>`, `deleteStory(id: string): Promise<void>`, `crawlStory(id: string, orders: number[] | undefined, onEvent): Promise<void>`; hook `useEpubExport(): { isExporting, exportBook }` (Task 9/10 dùng).

- [ ] **Step 1: Thêm types vào `frontend/src/types.ts`**

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

- [ ] **Step 2: Refactor `frontend/src/api.ts` + thêm hàm mới**

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

Cập nhật import đầu file:

```ts
import { BookMetadata, ExtractedChapter, ProgressEvent, StoredStory, StorySummary, SupportedSite } from "./types";
```

- [ ] **Step 3: Tạo `frontend/src/useEpubExport.ts`**

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

- [ ] **Step 4: Build verify**

Run: `npm run build -w frontend`
Expected: Vite build OK (TS types của các hàm mới chưa được dùng cũng không sao).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/useEpubExport.ts
git commit -m "feat(frontend): API client cho stories + hook export EPUB dùng chung"
```

---

### Task 9: Tách `ManualCrawlView` khỏi App (không đổi hành vi)

**Files:**
- Create: `frontend/src/components/ManualCrawlView.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: mọi thứ App.tsx đang dùng + `useEpubExport` (Task 8).
- Produces: `ManualCrawlView({ supportedSites }: { supportedSites: SupportedSite[] })`; App.tsx còn header + render view này.

- [ ] **Step 1: Tạo `frontend/src/components/ManualCrawlView.tsx`**

Chuyển **nguyên** toàn bộ state + `handleExtract`, `retrySingle`, `handleRetryAll`, `handleExport` và JSX 2 section từ `App.tsx` sang component này, với các điểm sửa:

- Props: `{ supportedSites }: { supportedSites: SupportedSite[] }` (bỏ `useEffect` fetch sites khỏi view — App giữ).
- `handleExport` dùng hook:

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

- Import: `import { exportEpub, extractChapters, extractOne, uploadCover } from "../api";` → đổi thành `import { extractChapters, extractOne } from "../api";` và `import { useEpubExport } from "../useEpubExport";`.

- [ ] **Step 2: Rút gọn `frontend/src/App.tsx`**

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

- [ ] **Step 3: Build + verify tay không hồi quy**

Run: `npm run build -w frontend && npm run build:backend && node dist/server.js`
Mở `http://localhost:3100`, crawl thử 1-2 URL chương, kiểm tra preview/sửa/export EPUB vẫn chạy y như trước.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/ManualCrawlView.tsx
git commit -m "refactor(frontend): tách tab crawl thủ công thành ManualCrawlView, không đổi hành vi"
```

---

### Task 10: Tab "Truyện của tôi" — LibraryView + StoryDetail

**Files:**
- Create: `frontend/src/components/LibraryView.tsx`, `frontend/src/components/StoryDetail.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/styles.css`

**Interfaces:**
- Consumes: API client + hook (Task 8): `createStory`, `fetchStories`, `fetchStory`, `deleteStory`, `crawlStory`; types `StoredStory`, `StorySummary`, `StoredChapter`, `ExtractedChapter`; `ChapterCard`, `useEpubExport`.
- Produces: `LibraryView({ supportedSites })` và `StoryDetail({ story, onBack, onStoryChanged })`; App có 2 tab.

- [ ] **Step 1: Tạo `frontend/src/components/StoryDetail.tsx`**

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
          ← Danh sách truyện
        </button>
        <h2>{story.title}</h2>
      </div>
      <p className="hint">
        {story.storyUrl} — {story.site}
      </p>
      <div className="result-summary">
        {doneCount}/{story.chapters.length} chương đã crawl
        {pendingCount > 0 && `, ${pendingCount} chờ`}
        {errorCount > 0 && `, ${errorCount} lỗi`}
      </div>

      <button disabled={isCrawling || remaining === 0} onClick={() => runCrawl(undefined, true)}>
        {isCrawling ? "Đang crawl..." : `Crawl tiếp (${remaining} chương)`}
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

- [ ] **Step 2: Tạo `frontend/src/components/LibraryView.tsx`**

```tsx
import { useEffect, useState } from "react";
import { createStory, deleteStory, fetchStories } from "../api";
import { StoredStory, StorySummary, SupportedSite } from "../types";
import { isSupportedUrl } from "../isSupportedUrl";
import StoryDetail from "./StoryDetail";

export default function LibraryView({ supportedSites }: { supportedSites: SupportedSite[] }) {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [storyUrl, setStoryUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<StoredStory | null>(null);

  async function loadStories() {
    try {
      setStories(await fetchStories());
    } catch (err) {
      alert((err as Error).message);
    }
  }

  useEffect(() => {
    loadStories();
  }, []);

  async function handleCreate() {
    const url = storyUrl.trim();
    if (!url) {
      alert("Vui lòng nhập URL truyện.");
      return;
    }
    if (!isSupportedUrl(url, supportedSites)) {
      alert("URL không thuộc trang được hỗ trợ.");
      return;
    }
    setBusy(true);
    try {
      setSelected(await createStory(url));
      setStoryUrl("");
      await loadStories();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Xoá truyện này khỏi danh sách? Toàn bộ nội dung đã crawl của truyện sẽ bị xoá.")) return;
    try {
      await deleteStory(id);
      await loadStories();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleStoryChanged() {
    await loadStories();
    if (selected) {
      try {
        setSelected(await fetchStory(selected.id));
      } catch {
        /* danh sách đã báo lỗi nếu có */
      }
    }
  }

  if (selected) {
    return (
      <StoryDetail
        story={selected}
        onBack={() => setSelected(null)}
        onStoryChanged={handleStoryChanged}
      />
    );
  }

  return (
    <section className="card">
      <h2>Truyện của tôi</h2>
      <p className="hint">Dán URL trang truyện (ví dụ https://truyenfull.live/dau-xuan-tuoi-sang/) để load toàn bộ danh sách chương.</p>
      <div className="story-add">
        <input
          type="text"
          placeholder="https://truyenfull.live/ten-truyen/"
          value={storyUrl}
          onChange={(e) => setStoryUrl(e.target.value)}
        />
        <button disabled={busy} onClick={handleCreate}>
          {busy ? "Đang tải danh sách chương..." : "Tải danh sách chương"}
        </button>
      </div>

      {stories.length === 0 ? (
        <p className="hint">Chưa có truyện nào.</p>
      ) : (
        <ul className="story-list">
          {stories.map((s) => {
            const pct = s.chapterCount > 0 ? (s.doneCount / s.chapterCount) * 100 : 0;
            return (
              <li key={s.id} className="story-item">
                <div className="story-item-main" onClick={() => fetchDetail(s.id)}>
                  <strong>{s.title}</strong>
                  <span className="story-site">{s.site}</span>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="story-progress">
                    {s.doneCount}/{s.chapterCount} chương{s.errorCount > 0 ? `, ${s.errorCount} lỗi` : ""}
                  </span>
                </div>
                <button type="button" className="btn-delete" onClick={() => handleDelete(s.id)}>
                  Xoá
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  async function fetchDetail(id: string) {
    try {
      setSelected(await fetchStory(id));
    } catch (err) {
      alert((err as Error).message);
    }
  }
}
```

(Lưu ý: `fetchDetail` khai báo sau `return` là function declaration nên vẫn hoist được — giữ nguyên như trên.)

- [ ] **Step 3: Sửa `frontend/src/App.tsx` thêm tab**

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
            Crawl thủ công
          </button>
          <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>
            Truyện của tôi
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
Expected: cả 2 pass.

- [ ] **Step 6: Verify E2E bằng tay**

Run (terminal 1): `node dist/server.js` — terminal 2: `npm run dev:frontend` (hoặc dùng bản build ở `localhost:3100`).

1. Tab "Truyện của tôi" → dán `https://truyenfull.live/dau-xuan-tuoi-sang/` → "Tải danh sách chương" → thấy 150 chương, `0/150`.
2. Bấm "Crawl tiếp (150 chương)" → chờ 2-3 chương rồi **đóng tab trình duyệt**.
3. Mở lại `localhost:3100` → tab "Truyện của tôi" → truyện hiện `n/150` với n = số chương đã xong; mở chi tiết → đúng n chương, chương còn lại "Chờ crawl".
4. Bấm "Crawl tiếp" → chỉ chạy các chương còn lại (log bắt đầu từ chương chưa xong).
5. Với một chương lỗi (nếu có): bấm "Thử lại" trên ChapterCard → trạng thái cập nhật khi xong.
6. Xuất EPUB từ truyện đã crawl vài chương → file tải về, mở đọc được.
7. Kiểm tra `data/stories/*.json` có đúng trạng thái.
8. Tab "Crawl thủ công" vẫn chạy bình thường.
9. Thử thêm truyện xtruyen.vn → 233 chương.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/LibraryView.tsx frontend/src/components/StoryDetail.tsx frontend/src/styles.css
git commit -m "feat(frontend): tab Truyện của tôi - danh sách, tiến độ, crawl tiếp, export EPUB"
```

---

### Task 11: README + verify tổng thể

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tất cả tasks trước.
- Produces: tài liệu tính năng + giới hạn; xác nhận cuối cùng.

- [ ] **Step 1: Cập nhật README — mục tính năng**

Thêm mục mô tả 2 tính năng mới (quản lý truyện trong `data/stories/`, tự động load TOC cho truyenfull/.vn, truyencom, xtruyen; crawl tiếp/đóng tab không mất tiến độ).

- [ ] **Step 2: Cập nhật README — mục "7. Giới hạn hiện tại (MVP)"**

Bổ sung các giới hạn (copy nguyên văn từ spec mục 7):

```markdown
- Tab "Truyện của tôi" tự động load danh sách chương cho truyenfull.live,
  truyenfull.vn, truyencom.com và xtruyen.vn. metruyenchu.com phải nhập URL
  chương thủ công ở tab "Crawl thủ công".
- Tiến độ crawl lưu ở `data/stories/*.json` (không commit). Chỉnh sửa chương
  và thông tin sách trên UI **không** được lưu — chỉ dùng cho lần export hiện
  tại. Kết quả crawl thô thì được lưu và dùng lại khi crawl tiếp.
- Truyện rất dài (hàng nghìn chương) có thể làm UI nặng khi mở chi tiết vì
  tải toàn bộ nội dung đã crawl.
- Site đổi cấu trúc HTML/API có thể làm hỏng TOC adapter (báo lỗi rõ ràng,
  không tạo record rác).
```

- [ ] **Step 3: Verify toàn bộ**

Run: `npx vitest run && npm run build`
Expected: tất cả test PASS; build backend + frontend OK.

Chạy lại checklist E2E ở Task 10 Step 6 (mục 1-9).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: tính năng quản lý truyện + giới hạn của tab Truyện của tôi"
```

---

## Self-review (đã chạy khi viết plan)

- **Spec coverage:** story store (T1), TOC adapters truyenfull/truyencom (T2) + xtruyen (T3) + registry (T4), merge/plan (T5), crawl service dùng chung (T6), API 5 endpoint + lưu từng chương + lock + giới hạn body (T7), frontend API/hook (T8), tách tab thủ công (T9), Library + StoryDetail + tab + CSS (T10), README/limits + verify (T11). Không thiếu mục nào của spec.
- **Placeholder scan:** không có TBD/TODO; mọi step có code/command cụ thể.
- **Type consistency:** `TocResult`/`TocAdapter` (T2) dùng thống nhất ở T3/T4/T5; `storyId`/`summarize`/`createStoryStore`/`storyStore` (T1) dùng ở T5/T7; `MAX_ATTEMPTS`/`extractWithRetry` (T6) dùng ở T7; `useEpubExport` (T8) dùng ở T9/T10; `crawlStory(id, orders, onEvent)` (T8) gọi ở T10.
- **Lưu ý khi thực thi:** `Item 1` của Task 7 Step 4 kỳ vọng 150 chương nhưng con số thực tế phụ thuộc site (nếu site thêm chương mới, chỉnh kỳ vọng theo kết quả TOC thực tế, miễn là toàn bộ TOC được tải).
