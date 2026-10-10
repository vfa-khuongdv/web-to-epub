import { ContentBlock } from "../../types";

/**
 * A chapter the agent rewrote for narration. The rewritten text is what the chapter now
 * holds; this row keeps the blocks it had before the first rewrite, so the original can
 * be restored (and a second rewrite cannot overwrite the backup).
 */
export interface ChapterRewriteRecord {
  order: number;
  agent?: string;
  createdAt: string;
}

export interface ChapterRewrite extends ChapterRewriteRecord {
  originalBlocks: ContentBlock[];
}
