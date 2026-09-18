import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { ContentBlock, StoredChapter, StoredStory, StorySummary } from "../types";
import { DATA_DIR } from "../config/paths";

export function storyId(storyUrl: string): string {
  return crypto.createHash("sha1").update(storyUrl).digest("hex").slice(0, 16);
}

export interface StoryMeta {
  title: string;
  author?: string;
  language?: string;
  coverUrl?: string;
}

export interface StoryStore {
  list(): Promise<StorySummary[]>;
  get(id: string): Promise<StoredStory | undefined>;
  // Như get() nhưng bỏ nội dung chương: truyện vài nghìn chương đã crawl nặng
  // hàng chục MB, trong khi giao diện chỉ cần danh sách + trạng thái.
  getOutline(id: string): Promise<StoredStory | undefined>;
  getChapter(storyId: string, order: number): Promise<StoredChapter | undefined>;
  save(story: StoredStory): Promise<void>;
  saveChapter(storyId: string, chapter: StoredChapter): Promise<void>;
  // Thay thông tin sách (tên/tác giả/ngôn ngữ/bìa) mà không đụng tới chapter —
  // dùng cho nút "Lưu thông tin". Trường bỏ trống nghĩa là xoá giá trị cũ.
  updateMeta(id: string, meta: StoryMeta): Promise<boolean>;
  // Bật/tắt theo dõi chương mới. Tắt thì xoá số chương mới và lỗi kiểm tra
  // (giữ lastCheckedAt để hiển thị "kiểm tra lần cuối").
  setWatching(id: string, watching: boolean): Promise<boolean>;
  // Ghi kết quả kiểm tra TOC; trường vắng mặt giữ nguyên giá trị cũ,
  // `error: null` xoá lỗi.
  setCheckResult(
    id: string,
    result: { newChapterCount?: number; checkedAt?: string; error?: string | null }
  ): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

const STORY_ID_RE = /^[0-9a-f]{16}$/;

interface StoryRow {
  id: string;
  story_url: string;
  site: string;
  title: string;
  author: string | null;
  language: string | null;
  cover_url: string | null;
  watching: number;
  new_chapter_count: number;
  last_checked_at: string | null;
  check_error: string | null;
  created_at: string;
  updated_at: string;
}

interface ChapterRow {
  story_id: string;
  order: number;
  url: string;
  title: string;
  status: string;
  error: string | null;
  blocks: string | null;
}

export function createStoryStore(baseDir: string): StoryStore {
  fs.mkdirSync(baseDir, { recursive: true });
  const db = new DatabaseSync(path.join(baseDir, "stories.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      story_url TEXT NOT NULL,
      site TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      language TEXT,
      cover_url TEXT,
      watching INTEGER NOT NULL DEFAULT 0,
      new_chapter_count INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      check_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chapters (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      blocks TEXT,
      PRIMARY KEY (story_id, "order")
    );
  `);

  // DB tạo trước khi có các cột mới vẫn phải mở được (dữ liệu thật của người
  // dùng), nên thêm cột còn thiếu thay vì bắt tạo lại DB.
  const storyColumns = db.prepare("PRAGMA table_info(stories)").all() as unknown as { name: string }[];
  const hasColumn = (name: string) => storyColumns.some((column) => column.name === name);
  const addColumnIfMissing: [string, string][] = [
    ["language", "language TEXT"],
    ["watching", "watching INTEGER NOT NULL DEFAULT 0"],
    ["new_chapter_count", "new_chapter_count INTEGER NOT NULL DEFAULT 0"],
    ["last_checked_at", "last_checked_at TEXT"],
    ["check_error", "check_error TEXT"],
  ];
  for (const [name, definition] of addColumnIfMissing) {
    if (!hasColumn(name)) db.exec(`ALTER TABLE stories ADD COLUMN ${definition}`);
  }

  const upsertStory = db.prepare(`
    INSERT INTO stories (id, story_url, site, title, author, language, cover_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      story_url = excluded.story_url,
      site = excluded.site,
      title = excluded.title,
      author = excluded.author,
      language = excluded.language,
      cover_url = excluded.cover_url,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  const upsertChapter = db.prepare(`
    INSERT INTO chapters (story_id, "order", url, title, status, error, blocks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(story_id, "order") DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      status = excluded.status,
      error = excluded.error,
      blocks = excluded.blocks
  `);
  const deleteChapters = db.prepare(`DELETE FROM chapters WHERE story_id = ?`);
  const selectStory = db.prepare(`SELECT * FROM stories WHERE id = ?`);
  const selectChapters = db.prepare(`SELECT * FROM chapters WHERE story_id = ? ORDER BY "order"`);
  const selectChapterOutlines = db.prepare(
    `SELECT "order", url, title, status, error FROM chapters WHERE story_id = ? ORDER BY "order"`
  );
  const selectChapter = db.prepare(`SELECT * FROM chapters WHERE story_id = ? AND "order" = ?`);
  const selectSummaries = db.prepare(`
    SELECT s.id, s.story_url, s.site, s.title, s.updated_at,
           s.watching, s.new_chapter_count, s.last_checked_at, s.check_error,
           COUNT(c."order") AS chapter_count,
           COALESCE(SUM(c.status = 'done'), 0) AS done_count,
           COALESCE(SUM(c.status = 'error'), 0) AS error_count
    FROM stories s
    LEFT JOIN chapters c ON c.story_id = s.id
    GROUP BY s.id
    ORDER BY s.updated_at DESC
  `);
  const deleteStory = db.prepare(`DELETE FROM stories WHERE id = ?`);
  const touchStory = db.prepare(`UPDATE stories SET updated_at = ? WHERE id = ?`);
  const updateStoryMeta = db.prepare(`
    UPDATE stories SET title = ?, author = ?, language = ?, cover_url = ?, updated_at = ?
    WHERE id = ?
  `);
  const setStoryWatching = db.prepare(`
    UPDATE stories
    SET watching = ?,
        new_chapter_count = CASE WHEN ? = 1 THEN new_chapter_count ELSE 0 END,
        check_error = CASE WHEN ? = 1 THEN check_error ELSE NULL END
    WHERE id = ?
  `);
  const setStoryCheckResult = db.prepare(`
    UPDATE stories
    SET new_chapter_count = COALESCE(?, new_chapter_count),
        last_checked_at = COALESCE(?, last_checked_at),
        check_error = CASE WHEN ? = 1 THEN ? ELSE check_error END
    WHERE id = ?
  `);

  function inTransaction<T>(fn: () => T): T {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  function chapterParams(storyId: string, chapter: StoredChapter): (string | number | null)[] {
    return [
      storyId,
      chapter.order,
      chapter.url,
      chapter.title,
      chapter.status,
      chapter.error ?? null,
      chapter.blocks ? JSON.stringify(chapter.blocks) : null,
    ];
  }

  return {
    async list(): Promise<StorySummary[]> {
      const rows = selectSummaries.all() as unknown as Array<
        StoryRow & { chapter_count: number; done_count: number; error_count: number }
      >;
      return rows.map((row) => ({
        id: row.id,
        storyUrl: row.story_url,
        site: row.site,
        title: row.title,
        chapterCount: Number(row.chapter_count),
        doneCount: Number(row.done_count),
        errorCount: Number(row.error_count),
        watching: row.watching === 1,
        newChapterCount: Number(row.new_chapter_count),
        lastCheckedAt: row.last_checked_at ?? undefined,
        checkError: row.check_error ?? undefined,
        updatedAt: row.updated_at,
      }));
    },

    async get(id: string): Promise<StoredStory | undefined> {
      if (!STORY_ID_RE.test(id)) return undefined;
      const story = selectStory.get(id) as unknown as StoryRow | undefined;
      if (!story) return undefined;
      const rows = selectChapters.all(id) as unknown as ChapterRow[];
      return {
        id: story.id,
        storyUrl: story.story_url,
        site: story.site,
        title: story.title,
        author: story.author ?? undefined,
        language: story.language ?? undefined,
        coverUrl: story.cover_url ?? undefined,
        watching: story.watching === 1,
        newChapterCount: Number(story.new_chapter_count),
        lastCheckedAt: story.last_checked_at ?? undefined,
        checkError: story.check_error ?? undefined,
        chapters: rows.map((row) => ({
          order: row.order,
          url: row.url,
          title: row.title,
          status: row.status as StoredChapter["status"],
          error: row.error ?? undefined,
          blocks: row.blocks ? (JSON.parse(row.blocks) as ContentBlock[]) : undefined,
        })),
        createdAt: story.created_at,
        updatedAt: story.updated_at,
      };
    },

    async getOutline(id: string): Promise<StoredStory | undefined> {
      if (!STORY_ID_RE.test(id)) return undefined;
      const story = selectStory.get(id) as unknown as StoryRow | undefined;
      if (!story) return undefined;
      const rows = selectChapterOutlines.all(id) as unknown as Omit<ChapterRow, "blocks" | "story_id">[];
      return {
        id: story.id,
        storyUrl: story.story_url,
        site: story.site,
        title: story.title,
        author: story.author ?? undefined,
        language: story.language ?? undefined,
        coverUrl: story.cover_url ?? undefined,
        watching: story.watching === 1,
        newChapterCount: Number(story.new_chapter_count),
        lastCheckedAt: story.last_checked_at ?? undefined,
        checkError: story.check_error ?? undefined,
        chapters: rows.map((row) => ({
          order: row.order,
          url: row.url,
          title: row.title,
          status: row.status as StoredChapter["status"],
          error: row.error ?? undefined,
        })),
        createdAt: story.created_at,
        updatedAt: story.updated_at,
      };
    },

    async getChapter(storyId: string, order: number): Promise<StoredChapter | undefined> {
      if (!STORY_ID_RE.test(storyId) || !Number.isInteger(order)) return undefined;
      const row = selectChapter.get(storyId, order) as unknown as ChapterRow | undefined;
      if (!row) return undefined;
      return {
        order: row.order,
        url: row.url,
        title: row.title,
        status: row.status as StoredChapter["status"],
        error: row.error ?? undefined,
        blocks: row.blocks ? (JSON.parse(row.blocks) as ContentBlock[]) : undefined,
      };
    },

    async save(story: StoredStory): Promise<void> {
      if (!STORY_ID_RE.test(story.id)) {
        throw new Error(`Mã truyện không hợp lệ: ${story.id}`);
      }
      inTransaction(() => {
        upsertStory.run(
          story.id,
          story.storyUrl,
          story.site,
          story.title,
          story.author ?? null,
          story.language ?? null,
          story.coverUrl ?? null,
          story.createdAt,
          story.updatedAt
        );
        deleteChapters.run(story.id);
        for (const chapter of story.chapters) {
          upsertChapter.run(...chapterParams(story.id, chapter));
        }
      });
    },

    async updateMeta(id: string, meta: StoryMeta): Promise<boolean> {
      if (!STORY_ID_RE.test(id)) return false;
      const result = updateStoryMeta.run(
        meta.title,
        meta.author ?? null,
        meta.language ?? null,
        meta.coverUrl ?? null,
        new Date().toISOString(),
        id
      );
      return Number(result.changes) > 0;
    },

    async setWatching(id: string, watching: boolean): Promise<boolean> {
      if (!STORY_ID_RE.test(id)) return false;
      const flag = watching ? 1 : 0;
      return Number(setStoryWatching.run(flag, flag, flag, id).changes) > 0;
    },

    async setCheckResult(
      id: string,
      result: { newChapterCount?: number; checkedAt?: string; error?: string | null }
    ): Promise<boolean> {
      if (!STORY_ID_RE.test(id)) return false;
      // `undefined` bind thành NULL + COALESCE để giữ giá trị cũ; riêng error
      // cần cờ riêng vì `null` là "xoá lỗi" chứ không phải "giữ nguyên".
      const setError = result.error !== undefined ? 1 : 0;
      const updated = setStoryCheckResult.run(
        result.newChapterCount ?? null,
        result.checkedAt ?? null,
        setError,
        result.error ?? null,
        id
      );
      return Number(updated.changes) > 0;
    },

    async saveChapter(id: string, chapter: StoredChapter): Promise<void> {
      if (!STORY_ID_RE.test(id)) {
        throw new Error(`Mã truyện không hợp lệ: ${id}`);
      }
      inTransaction(() => {
        const result = touchStory.run(new Date().toISOString(), id);
        if (Number(result.changes) === 0) {
          throw new Error(`Không tìm thấy truyện: ${id}`);
        }
        upsertChapter.run(...chapterParams(id, chapter));
      });
    },

    async remove(id: string): Promise<boolean> {
      if (!STORY_ID_RE.test(id)) return false;
      return Number(deleteStory.run(id).changes) > 0;
    },
  };
}

export const storyStore = createStoryStore(DATA_DIR);
