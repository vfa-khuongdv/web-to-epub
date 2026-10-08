import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { ContentBlock, StoredChapter, StoredStory, StorySummary } from "../types";
import { DATA_DIR } from "../config/paths";
import { sanitizeBlocks } from "./sanitizeHtml";
import { t } from "./lang";
import { ChapterRewrite, ChapterRewriteRecord } from "./rewrite/types";
import { YouTubeStoryRecord, YouTubeVideoRecord } from "./youtube/types";

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
  // Like get() but excludes chapter content: a story with thousands of chapters already
  // crawled weighs tens of MB, while the UI only needs a list and status.
  getOutline(id: string): Promise<StoredStory | undefined>;
  getChapter(storyId: string, order: number): Promise<StoredChapter | undefined>;
  // Bytes of crawled chapter text this story holds in the database (the blocks as stored), for the
  // size shown on the story page. Images and audio are files, counted from their folders.
  contentBytes(id: string): Promise<number>;
  save(story: StoredStory): Promise<void>;
  saveChapter(storyId: string, chapter: StoredChapter): Promise<void>;
  // Drop one chapter (and its highlights) from the library. Order is the TOC position,
  // so the rest keeps theirs — the list shows a gap, not a renumbering.
  removeChapter(storyId: string, order: number): Promise<boolean>;
  // Update book metadata (title/author/language/cover) without touching chapters —
  // used for the "Save info" button. An empty field means delete the old value.
  updateMeta(id: string, meta: StoryMeta): Promise<boolean>;
  // Enable/disable watching for new chapters. Disabling clears the new chapter count
  // and check error (preserves lastCheckedAt to show "last checked").
  setWatching(id: string, watching: boolean): Promise<boolean>;
  // Record TOC check results; missing fields keep their old values,
  // `error: null` deletes the error.
  setCheckResult(
    id: string,
    result: { newChapterCount?: number; checkedAt?: string; error?: string | null }
  ): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  listHighlights(storyId: string): Promise<Highlight[]>;
  addHighlight(storyId: string, highlight: Omit<Highlight, "id" | "createdAt">): Promise<Highlight>;
  setHighlightColor(storyId: string, id: string, color: HighlightColor): Promise<boolean>;
  removeHighlight(storyId: string, id: string): Promise<boolean>;
  // Chapter rewrites for narration: which chapters the agent rewrote, and the blocks
  // each held before its first rewrite (so the original can be restored).
  listRewrites(storyId: string): Promise<ChapterRewriteRecord[]>;
  getRewrite(storyId: string, order: number): Promise<ChapterRewrite | undefined>;
  saveRewrite(storyId: string, order: number, originalBlocks: ContentBlock[], agent?: string): Promise<void>;
  removeRewrite(storyId: string, order: number): Promise<boolean>;
  // YouTube publishing state: one row per story (playlist + credits) and one per chapter
  // (metadata, rendered file, upload result).
  getYouTubeStory(storyId: string): Promise<YouTubeStoryRecord | undefined>;
  saveYouTubeStory(record: YouTubeStoryRecord): Promise<void>;
  listYouTubeVideos(storyId: string): Promise<YouTubeVideoRecord[]>;
  getYouTubeVideo(storyId: string, order: number): Promise<YouTubeVideoRecord | undefined>;
  saveYouTubeVideo(record: YouTubeVideoRecord & { storyId: string }): Promise<void>;
  removeYouTubeVideo(storyId: string, order: number): Promise<boolean>;
}

const STORY_ID_RE = /^[0-9a-f]{16}$/;

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/**
 * A highlighted passage. `start`/`end` are character offsets into the chapter's plain
 * text — not DOM positions — because the reader rebuilds that HTML on every open, and
 * a re-crawl can rebuild it differently. `text` is kept so the sidebar can list the
 * passage without loading the chapter, and so a highlight whose offsets no longer line
 * up can still be shown rather than silently lost.
 */
export interface Highlight {
  id: string;
  chapterOrder: number;
  start: number;
  end: number;
  color: HighlightColor;
  text: string;
  createdAt: string;
}

interface HighlightRow {
  id: string;
  chapter_order: number;
  start: number;
  end: number;
  color: string;
  text: string;
  created_at: string;
}

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
  error_kind: string | null;
  spell_checked: number;
  blocks: string | null;
}

interface RewriteRow {
  order: number;
  original_blocks?: string;
  agent: string | null;
  created_at: string;
}

interface YouTubeStoryRow {
  story_id: string;
  playlist_title: string;
  playlist_id: string | null;
  playlist_url: string | null;
  playlist_checked_at: string | null;
  author: string | null;
  translator: string | null;
  genre_tags: string | null;
  created_at: string;
  updated_at: string;
}

interface YouTubeVideoRow {
  order: number;
  status: string;
  title: string | null;
  description: string | null;
  tags: string | null;
  publish_at: string | null;
  summary: string | null;
  music_id: string | null;
  music_volume: number | null;
  video_path: string | null;
  video_seconds: number | null;
  video_id: string | null;
  video_url: string | null;
  privacy: string | null;
  audio_key: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function toYouTubeVideo(row: YouTubeVideoRow): YouTubeVideoRecord {
  return {
    order: row.order,
    status: row.status as YouTubeVideoRecord["status"],
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    tags: row.tags ?? undefined,
    publishAt: row.publish_at ?? undefined,
    summary: row.summary ?? undefined,
    musicId: row.music_id ?? undefined,
    musicVolume: row.music_volume ?? undefined,
    videoPath: row.video_path ?? undefined,
    videoSeconds: row.video_seconds ?? undefined,
    videoId: row.video_id ?? undefined,
    videoUrl: row.video_url ?? undefined,
    privacy: row.privacy ?? undefined,
    audioKey: row.audio_key ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toYouTubeStory(row: YouTubeStoryRow): YouTubeStoryRecord {
  return {
    storyId: row.story_id,
    playlistTitle: row.playlist_title,
    playlistId: row.playlist_id ?? undefined,
    playlistUrl: row.playlist_url ?? undefined,
    playlistCheckedAt: row.playlist_checked_at ?? undefined,
    author: row.author ?? undefined,
    translator: row.translator ?? undefined,
    genreTags: row.genre_tags ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      chapter_order INTEGER NOT NULL,
      start INTEGER NOT NULL,
      "end" INTEGER NOT NULL,
      color TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS highlights_by_chapter
      ON highlights (story_id, chapter_order, start);
    CREATE TABLE IF NOT EXISTS chapters (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      error_kind TEXT,
      blocks TEXT,
      PRIMARY KEY (story_id, "order")
    );
    CREATE TABLE IF NOT EXISTS chapter_rewrites (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      original_blocks TEXT NOT NULL,
      agent TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (story_id, "order")
    );
    CREATE TABLE IF NOT EXISTS youtube_stories (
      story_id TEXT PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
      playlist_title TEXT NOT NULL,
      playlist_id TEXT,
      playlist_url TEXT,
      playlist_checked_at TEXT,
      author TEXT,
      translator TEXT,
      genre_tags TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS youtube_videos (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      status TEXT NOT NULL,
      title TEXT,
      description TEXT,
      tags TEXT,
      publish_at TEXT,
      summary TEXT,
      music_id TEXT,
      music_volume REAL,
      video_path TEXT,
      video_seconds REAL,
      video_id TEXT,
      video_url TEXT,
      privacy TEXT,
      audio_key TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (story_id, "order")
    );
  `);

  // DBs created before the new columns exist must still open (real user data),
  // so add missing columns instead of forcing a rebuild.
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

  const chapterColumns = db.prepare("PRAGMA table_info(chapters)").all() as unknown as { name: string }[];
  if (!chapterColumns.some((column) => column.name === "error_kind")) {
    db.exec("ALTER TABLE chapters ADD COLUMN error_kind TEXT");
  }
  if (!chapterColumns.some((column) => column.name === "spell_checked")) {
    db.exec("ALTER TABLE chapters ADD COLUMN spell_checked INTEGER NOT NULL DEFAULT 0");
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
    INSERT INTO chapters (story_id, "order", url, title, status, error, error_kind, spell_checked, blocks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(story_id, "order") DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      status = excluded.status,
      error = excluded.error,
      error_kind = excluded.error_kind,
      spell_checked = excluded.spell_checked,
      blocks = excluded.blocks
  `);
  const deleteChapters = db.prepare(`DELETE FROM chapters WHERE story_id = ?`);
  // CAST to BLOB so LENGTH counts bytes, not characters: Vietnamese text is mostly 2-3 bytes a letter.
  const selectContentBytes = db.prepare(
    `SELECT COALESCE(SUM(LENGTH(CAST(blocks AS BLOB))), 0) AS bytes FROM chapters WHERE story_id = ?`
  );
  const deleteChapter = db.prepare(`DELETE FROM chapters WHERE story_id = ? AND "order" = ?`);
  const deleteChapterHighlights = db.prepare(`DELETE FROM highlights WHERE story_id = ? AND chapter_order = ?`);
  const selectHighlights = db.prepare(
    `SELECT id, chapter_order, start, "end", color, text, created_at FROM highlights
     WHERE story_id = ? ORDER BY chapter_order, start`
  );
  const insertHighlight = db.prepare(
    `INSERT INTO highlights (id, story_id, chapter_order, start, "end", color, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateHighlightColor = db.prepare(`UPDATE highlights SET color = ? WHERE id = ? AND story_id = ?`);
  const deleteHighlight = db.prepare(`DELETE FROM highlights WHERE id = ? AND story_id = ?`);
  const selectStory = db.prepare(`SELECT * FROM stories WHERE id = ?`);
  const selectChapters = db.prepare(`SELECT * FROM chapters WHERE story_id = ? ORDER BY "order"`);
  const selectChapterOutlines = db.prepare(
    `SELECT "order", url, title, status, error, error_kind, spell_checked FROM chapters WHERE story_id = ? ORDER BY "order"`
  );
  const selectChapter = db.prepare(`SELECT * FROM chapters WHERE story_id = ? AND "order" = ?`);
  const selectSummaries = db.prepare(`
    SELECT s.id, s.story_url, s.site, s.title, s.cover_url, s.updated_at,
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
  const selectRewrites = db.prepare(
    `SELECT "order", agent, created_at FROM chapter_rewrites WHERE story_id = ? ORDER BY "order"`
  );
  const selectRewrite = db.prepare(
    `SELECT "order", original_blocks, agent, created_at FROM chapter_rewrites WHERE story_id = ? AND "order" = ?`
  );
  // The first original wins: a chapter rewritten twice must still restore to the text the
  // agent first saw, not to the previous rewrite.
  const insertRewrite = db.prepare(`
    INSERT INTO chapter_rewrites (story_id, "order", original_blocks, agent, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(story_id, "order") DO NOTHING
  `);
  const deleteRewrite = db.prepare(`DELETE FROM chapter_rewrites WHERE story_id = ? AND "order" = ?`);
  const selectYouTubeStory = db.prepare(`SELECT * FROM youtube_stories WHERE story_id = ?`);
  const upsertYouTubeStory = db.prepare(`
    INSERT INTO youtube_stories
      (story_id, playlist_title, playlist_id, playlist_url, playlist_checked_at, author, translator, genre_tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(story_id) DO UPDATE SET
      playlist_title = excluded.playlist_title,
      playlist_id = excluded.playlist_id,
      playlist_url = excluded.playlist_url,
      playlist_checked_at = excluded.playlist_checked_at,
      author = excluded.author,
      translator = excluded.translator,
      genre_tags = excluded.genre_tags,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  const selectYouTubeVideos = db.prepare(`SELECT * FROM youtube_videos WHERE story_id = ? ORDER BY "order"`);
  const selectYouTubeVideo = db.prepare(`SELECT * FROM youtube_videos WHERE story_id = ? AND "order" = ?`);
  const upsertYouTubeVideo = db.prepare(`
    INSERT INTO youtube_videos
      (story_id, "order", status, title, description, tags, publish_at, summary, music_id, music_volume,
       video_path, video_seconds, video_id, video_url, privacy, audio_key, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(story_id, "order") DO UPDATE SET
      status = excluded.status,
      title = excluded.title,
      description = excluded.description,
      tags = excluded.tags,
      publish_at = excluded.publish_at,
      summary = excluded.summary,
      music_id = excluded.music_id,
      music_volume = excluded.music_volume,
      video_path = excluded.video_path,
      video_seconds = excluded.video_seconds,
      video_id = excluded.video_id,
      video_url = excluded.video_url,
      privacy = excluded.privacy,
      audio_key = excluded.audio_key,
      error = excluded.error,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  const deleteYouTubeVideo = db.prepare(`DELETE FROM youtube_videos WHERE story_id = ? AND "order" = ?`);

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
      chapter.errorKind ?? null,
      chapter.spellChecked ? 1 : 0,
      chapter.blocks ? JSON.stringify(sanitizeBlocks(chapter.blocks)) : null,
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
        coverUrl: row.cover_url ?? undefined,
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
          errorKind: (row.error_kind as StoredChapter["errorKind"]) ?? undefined,
          ...(row.spell_checked ? { spellChecked: true } : {}),
          blocks: row.blocks ? (JSON.parse(row.blocks) as ContentBlock[]) : undefined,
        })),
        createdAt: story.created_at,
        updatedAt: story.updated_at,
      };
    },

    async contentBytes(id: string): Promise<number> {
      if (!STORY_ID_RE.test(id)) return 0;
      return Number((selectContentBytes.get(id) as unknown as { bytes: number }).bytes);
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
          errorKind: (row.error_kind as StoredChapter["errorKind"]) ?? undefined,
          ...(row.spell_checked ? { spellChecked: true } : {}),
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
        errorKind: (row.error_kind as StoredChapter["errorKind"]) ?? undefined,
        ...(row.spell_checked ? { spellChecked: true } : {}),
        blocks: row.blocks ? (JSON.parse(row.blocks) as ContentBlock[]) : undefined,
      };
    },

    async save(story: StoredStory): Promise<void> {
      if (!STORY_ID_RE.test(story.id)) {
        throw new Error(t("Invalid story ID: {id}", { id: story.id }));
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
      // `undefined` binds to NULL + COALESCE to keep the old value; error needs its own flag
      // because `null` means "delete error", not "keep the value".
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
        throw new Error(t("Invalid story ID: {id}", { id }));
      }
      inTransaction(() => {
        const result = touchStory.run(new Date().toISOString(), id);
        if (Number(result.changes) === 0) {
          throw new Error(t("Story not found: {id}", { id }));
        }
        upsertChapter.run(...chapterParams(id, chapter));
      });
    },

    async removeChapter(id: string, order: number): Promise<boolean> {
      if (!STORY_ID_RE.test(id) || !Number.isInteger(order)) return false;
      return inTransaction(() => {
        const result = deleteChapter.run(id, order);
        if (Number(result.changes) === 0) return false;
        deleteChapterHighlights.run(id, order);
        touchStory.run(new Date().toISOString(), id);
        return true;
      });
    },

    async remove(id: string): Promise<boolean> {
      if (!STORY_ID_RE.test(id)) return false;
      return Number(deleteStory.run(id).changes) > 0;
    },

    async listHighlights(id: string): Promise<Highlight[]> {
      if (!STORY_ID_RE.test(id)) return [];
      const rows = selectHighlights.all(id) as unknown as HighlightRow[];
      return rows.map((row) => ({
        id: row.id,
        chapterOrder: row.chapter_order,
        start: row.start,
        end: row.end,
        color: row.color as HighlightColor,
        text: row.text,
        createdAt: row.created_at,
      }));
    },

    async addHighlight(id: string, highlight: Omit<Highlight, "id" | "createdAt">): Promise<Highlight> {
      if (!STORY_ID_RE.test(id)) {
        throw new Error(t("Invalid story ID: {id}", { id }));
      }
      const saved: Highlight = { ...highlight, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      insertHighlight.run(
        saved.id,
        id,
        saved.chapterOrder,
        saved.start,
        saved.end,
        saved.color,
        saved.text,
        saved.createdAt
      );
      return saved;
    },

    async setHighlightColor(id: string, highlightId: string, color: HighlightColor): Promise<boolean> {
      if (!STORY_ID_RE.test(id)) return false;
      return Number(updateHighlightColor.run(color, highlightId, id).changes) > 0;
    },

    async removeHighlight(id: string, highlightId: string): Promise<boolean> {
      if (!STORY_ID_RE.test(id)) return false;
      return Number(deleteHighlight.run(highlightId, id).changes) > 0;
    },

    async listRewrites(id: string): Promise<ChapterRewriteRecord[]> {
      if (!STORY_ID_RE.test(id)) return [];
      const rows = selectRewrites.all(id) as unknown as RewriteRow[];
      return rows.map((row) => ({
        order: row.order,
        agent: row.agent ?? undefined,
        createdAt: row.created_at,
      }));
    },

    async getRewrite(id: string, order: number): Promise<ChapterRewrite | undefined> {
      if (!STORY_ID_RE.test(id) || !Number.isInteger(order)) return undefined;
      const row = selectRewrite.get(id, order) as unknown as RewriteRow | undefined;
      if (!row?.original_blocks) return undefined;
      return {
        order: row.order,
        originalBlocks: JSON.parse(row.original_blocks) as ContentBlock[],
        agent: row.agent ?? undefined,
        createdAt: row.created_at,
      };
    },

    async saveRewrite(id: string, order: number, originalBlocks: ContentBlock[], agent?: string): Promise<void> {
      if (!STORY_ID_RE.test(id)) {
        throw new Error(t("Invalid story ID: {id}", { id }));
      }
      insertRewrite.run(id, order, JSON.stringify(sanitizeBlocks(originalBlocks)), agent ?? null, new Date().toISOString());
    },

    async removeRewrite(id: string, order: number): Promise<boolean> {
      if (!STORY_ID_RE.test(id) || !Number.isInteger(order)) return false;
      return Number(deleteRewrite.run(id, order).changes) > 0;
    },

    async getYouTubeStory(id: string): Promise<YouTubeStoryRecord | undefined> {
      if (!STORY_ID_RE.test(id)) return undefined;
      const row = selectYouTubeStory.get(id) as unknown as YouTubeStoryRow | undefined;
      return row ? toYouTubeStory(row) : undefined;
    },

    async saveYouTubeStory(record: YouTubeStoryRecord): Promise<void> {
      if (!STORY_ID_RE.test(record.storyId)) {
        throw new Error(t("Invalid story ID: {id}", { id: record.storyId }));
      }
      const existing = selectYouTubeStory.get(record.storyId) as unknown as YouTubeStoryRow | undefined;
      const createdAt = existing?.created_at ?? record.createdAt ?? new Date().toISOString();
      upsertYouTubeStory.run(
        record.storyId,
        record.playlistTitle,
        record.playlistId ?? null,
        record.playlistUrl ?? null,
        record.playlistCheckedAt ?? null,
        record.author ?? null,
        record.translator ?? null,
        record.genreTags ?? null,
        createdAt,
        new Date().toISOString()
      );
    },

    async listYouTubeVideos(id: string): Promise<YouTubeVideoRecord[]> {
      if (!STORY_ID_RE.test(id)) return [];
      return (selectYouTubeVideos.all(id) as unknown as YouTubeVideoRow[]).map(toYouTubeVideo);
    },

    async getYouTubeVideo(id: string, order: number): Promise<YouTubeVideoRecord | undefined> {
      if (!STORY_ID_RE.test(id) || !Number.isInteger(order)) return undefined;
      const row = selectYouTubeVideo.get(id, order) as unknown as YouTubeVideoRow | undefined;
      return row ? toYouTubeVideo(row) : undefined;
    },

    async saveYouTubeVideo(record: YouTubeVideoRecord & { storyId: string }): Promise<void> {
      if (!STORY_ID_RE.test(record.storyId)) {
        throw new Error(t("Invalid story ID: {id}", { id: record.storyId }));
      }
      const existing = selectYouTubeVideo.get(record.storyId, record.order) as unknown as YouTubeVideoRow | undefined;
      const createdAt = existing?.created_at ?? record.createdAt ?? new Date().toISOString();
      upsertYouTubeVideo.run(
        record.storyId,
        record.order,
        record.status,
        record.title ?? null,
        record.description ?? null,
        record.tags ?? null,
        record.publishAt ?? null,
        record.summary ?? null,
        record.musicId ?? null,
        record.musicVolume ?? null,
        record.videoPath ?? null,
        record.videoSeconds ?? null,
        record.videoId ?? null,
        record.videoUrl ?? null,
        record.privacy ?? null,
        record.audioKey ?? null,
        record.error ?? null,
        createdAt,
        new Date().toISOString()
      );
    },

    async removeYouTubeVideo(id: string, order: number): Promise<boolean> {
      if (!STORY_ID_RE.test(id) || !Number.isInteger(order)) return false;
      return Number(deleteYouTubeVideo.run(id, order).changes) > 0;
    },
  };
}

export const storyStore = createStoryStore(DATA_DIR);
