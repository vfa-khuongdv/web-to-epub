import fs from "fs/promises";
import path from "path";
import type { CoverStore } from "./coverStore";
import { storyMediaDir } from "./epubMedia";
import type { StoryStore } from "./storyStore";
import { storyAudioBytes } from "./tts/audioCache";

/**
 * What one story takes on disk, split the way the reader thinks of it: the crawled text (in the
 * database), the pictures kept for it (an imported book's images, a comic's pages), its narration
 * audio and its cover. The same three folders are what deleting the story removes, so the number
 * is also what deleting it gives back.
 */
export interface StoryUsage {
  text: number;
  images: number;
  audio: number;
  cover: number;
  total: number;
}

async function folderBytes(dir: string): Promise<number> {
  try {
    const names = await fs.readdir(dir);
    const sizes = await Promise.all(
      names.map(async (name) => {
        const stat = await fs.stat(path.join(dir, name));
        return stat.isFile() ? stat.size : 0;
      })
    );
    return sizes.reduce((sum, size) => sum + size, 0);
  } catch {
    return 0;
  }
}

export async function storyUsage(
  library: { dataDir: string; stories: StoryStore; covers: CoverStore },
  id: string
): Promise<StoryUsage> {
  const found = library.covers.find(id);
  const [text, images, audio, cover] = await Promise.all([
    library.stories.contentBytes(id),
    folderBytes(storyMediaDir(library.dataDir, id)),
    storyAudioBytes(library.dataDir, id),
    found ? fs.stat(found.filePath).then((stat) => stat.size, () => 0) : Promise.resolve(0),
  ]);
  return { text, images, audio, cover, total: text + images + audio + cover };
}
