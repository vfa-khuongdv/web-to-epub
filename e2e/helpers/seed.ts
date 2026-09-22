import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { DATA_DIR, FIXTURE_URL, REPO_ROOT } from "./env";
import type { ContentBlock, StoredChapter, StoredStory } from "../../src/types";
import type { HighlightColor, StoryStore } from "../../src/services/storyStore";

// config/paths.ts reads DATA_DIR at import time and the store opens the DB immediately,
// so the env must be set before the compiled module is required.
process.env.DATA_DIR = DATA_DIR;

const require = createRequire(__filename);
const app = require(path.join(REPO_ROOT, "dist", "services", "storyStore.js")) as typeof import(
  "../../src/services/storyStore"
);

export const store = app.storyStore;
export { DATA_DIR, FIXTURE_URL };

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export interface SeedChapter {
  title: string;
  url: string;
  status?: StoredChapter["status"];
  error?: string;
  errorKind?: StoredChapter["errorKind"];
  blocks?: ContentBlock[];
}

export interface SeedStoryInput {
  title: string;
  slug?: string;
  url?: string;
  author?: string;
  language?: string;
  coverUrl?: string;
  watching?: boolean;
  newChapterCount?: number;
  checkError?: string;
  chapters?: SeedChapter[];
}

export function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`Cannot slugify title: ${title}`);
  return slug;
}

export function fixtureChapterUrl(
  slug: string,
  n: number,
  opts?: { mode?: "flaky" | "locked" | "cookie"; fails?: number }
): string {
  if (!opts?.mode) return `${FIXTURE_URL}/truyen/${slug}/chuong-${n}`;
  const query =
    opts.mode === "flaky" ? `mode=flaky&fails=${opts.fails ?? 1}` : `mode=${opts.mode}`;
  return `${FIXTURE_URL}/truyen/${slug}/chuong-${n}?${query}`;
}

// Enough paragraphs to make the page scroll (reading-position test needs > one screen).
export function blocksFor(marker: string, paragraphs = 3): ContentBlock[] {
  return [
    { type: "heading", level: 1, text: `Chương ${marker}` },
    ...Array.from({ length: paragraphs }, (_, i) => ({
      type: "paragraph" as const,
      text: `Đoạn ${i + 1} của ${marker}: ${"nội dung để trang đủ dài và có thể cuộn. ".repeat(4)}`,
    })),
    { type: "image", src: `${FIXTURE_URL}/media/pixel.png`, alt: "minh họa" },
  ];
}

export function audioBlock(): ContentBlock {
  return { type: "audio", src: `${FIXTURE_URL}/media/tone.mp3` };
}

async function seedInto(target: StoryStore, input: SeedStoryInput): Promise<StoredStory> {
  const slug = input.slug ?? slugify(input.title);
  const storyUrl = input.url ?? `${FIXTURE_URL}/truyen/${slug}/`;
  const id = app.storyId(storyUrl);
  const now = new Date().toISOString();
  await target.save({
    id,
    storyUrl,
    site: "127.0.0.1",
    title: input.title,
    author: input.author,
    language: input.language,
    coverUrl: input.coverUrl,
    watching: false,
    newChapterCount: 0,
    chapters: (input.chapters ?? []).map((chapter, index) => ({
      order: index + 1,
      url: chapter.url,
      title: chapter.title,
      status: chapter.status ?? "pending",
      error: chapter.error,
      errorKind: chapter.errorKind,
      blocks: chapter.blocks,
    })),
    createdAt: now,
    updatedAt: now,
  });
  await target.setWatching(id, Boolean(input.watching));
  if (input.newChapterCount !== undefined || input.checkError !== undefined) {
    await target.setCheckResult(id, {
      newChapterCount: input.newChapterCount,
      checkedAt: now,
      error: input.checkError ?? null,
    });
  }
  const story = await target.get(id);
  if (!story) throw new Error(`Seed failed: story ${id} not found after save`);
  return story;
}

export const seedStory = (input: SeedStoryInput): Promise<StoredStory> => seedInto(store, input);

export function privateStore(): StoryStore {
  return app.createStoryStore(path.join(DATA_DIR, "private"));
}

export const seedPrivateStory = (input: SeedStoryInput): Promise<StoredStory> =>
  seedInto(privateStore(), input);

export function seedHighlight(
  storyId: string,
  input: { chapterOrder: number; start: number; end: number; color: HighlightColor; text: string },
  target: StoryStore = store
) {
  return target.addHighlight(storyId, input);
}

export async function resetHighlights(storyId: string, target: StoryStore = store): Promise<void> {
  for (const highlight of await target.listHighlights(storyId)) {
    await target.removeHighlight(storyId, highlight.id);
  }
}

export async function resetLibrary(target: StoryStore = store): Promise<void> {
  for (const summary of await target.list()) await target.remove(summary.id);
}

export function writeCoverFixture(): string {
  const file = path.join(DATA_DIR, "cover-fixture.png");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, PNG_1X1);
  return file;
}

// Writes an already-downloaded cover ("covers/<id>.png"), the shape the store/export
// expect, without needing a crawl first.
export function writeStoredCover(storyId: string): string {
  const dir = path.join(DATA_DIR, "covers");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${storyId}.png`), PNG_1X1);
  return `covers/${storyId}.png`;
}
