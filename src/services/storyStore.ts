import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { ContentBlock, StoredChapter, StoredStory, StorySummary } from "../types";

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
  save(story: StoredStory): Promise<void>;
  saveChapter(storyId: string, chapter: StoredChapter): Promise<void>;
  // Thay thông tin sách (tên/tác giả/ngôn ngữ/bìa) mà không đụng tới chapter —
  // dùng cho nút "Lưu thông tin". Trường bỏ trống nghĩa là xoá giá trị cũ.
  updateMeta(id: string, meta: StoryMeta): Promise<boolean>;
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

  // DB tạo trước khi có cột language vẫn phải mở được (dữ liệu thật của người
  // dùng), nên thêm cột còn thiếu thay vì bắt tạo lại DB.
  const storyColumns = db.prepare("PRAGMA table_info(stories)").all() as unknown as { name: string }[];
  if (!storyColumns.some((column) => column.name === "language")) {
    db.exec("ALTER TABLE stories ADD COLUMN language TEXT");
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
  const selectSummaries = db.prepare(`
    SELECT s.id, s.story_url, s.site, s.title, s.updated_at,
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

export const storyStore = createStoryStore(path.resolve("data"));
