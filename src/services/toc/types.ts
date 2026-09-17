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
