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

const STORY_ID_RE = /^[0-9a-f]{16}$/;

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
      if (!STORY_ID_RE.test(id)) return undefined;
      try {
        return JSON.parse(await fs.readFile(filePath(id), "utf8")) as StoredStory;
      } catch {
        return undefined;
      }
    },

    async save(story: StoredStory): Promise<void> {
      if (!STORY_ID_RE.test(story.id)) {
        throw new Error(`Mã truyện không hợp lệ: ${story.id}`);
      }
      await fs.mkdir(baseDir, { recursive: true });
      const tmp = `${filePath(story.id)}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(story, null, 2), "utf8");
      await fs.rename(tmp, filePath(story.id));
    },

    async remove(id: string): Promise<boolean> {
      if (!STORY_ID_RE.test(id)) return false;
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
