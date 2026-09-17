import { useRef, useState } from "react";
import { crawlStory, fetchStory } from "../api";
import { blocksToHtml } from "../blocksToHtml";
import { ExtractedChapter, StoredChapter, StoredStory } from "../types";
import { RunCrawl } from "../useCrawlJob";
import { useEpubExport } from "../useEpubExport";
import ChapterCard, { PendingChapterRow } from "./ChapterCard";
import { Icon } from "./Icon";

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
  run,
  running,
  onStoryChanged,
  onClear,
}: {
  story: StoredStory;
  run: RunCrawl;
  running: boolean;
  onStoryChanged: () => void;
  onClear: () => void;
}) {
  const [chapters, setChapters] = useState<ChapterState[]>(() =>
    story.chapters.filter((c) => c.status !== "pending").map((c) => toChapterState(c, 0))
  );
  const [crawlingUrl, setCrawlingUrl] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState(story.title);
  const [author, setAuthor] = useState(story.author || "");
  const [language, setLanguage] = useState("vi");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isExporting, exportBook } = useEpubExport();

  // Live chapter HTML by chapter id: kept for every chapter the user has
  // opened, so a collapsed chapter still exports its edited content.
  const bodies = useRef(new Map<string, string>());

  const pendingCount = story.chapters.filter((c) => c.status === "pending").length;
  const errorCount = story.chapters.filter((c) => c.status === "error").length;
  const doneCount = story.chapters.length - pendingCount - errorCount;
  const remaining = pendingCount + errorCount;

  async function handleCrawl(orders?: number[]) {
    setError(null);
    const single = orders?.length === 1 ? orders[0] : undefined;
    // Every chapter this run rewrites: the freshly extracted content replaces
    // whatever was cached for its editor, so the cached HTML goes with it.
    const rewritten =
      single !== undefined
        ? [`stored-${single}`]
        : story.chapters.filter((c) => c.status !== "done").map((c) => `stored-${c.order}`);

    if (single !== undefined) {
      setChapters((cs) => cs.map((c) => (c.order === single ? { ...c, retrying: true, retriedOnce: true } : c)));
    }

    await run(`Truyện: ${story.title}`, (emit) => crawlStory(story.id, orders, emit), (event) => {
      if ((event.type === "progress" || event.type === "error") && event.url) setCrawlingUrl(event.url);
    });

    try {
      const fresh = await fetchStory(story.id);
      rewritten.forEach((id) => bodies.current.delete(id));
      if (single !== undefined) {
        const updated = fresh.chapters.find((c) => c.order === single);
        if (updated) {
          setChapters((cs) => cs.map((c) => (c.order === single ? toChapterState(updated, c.version + 1) : c)));
        }
      } else {
        // Bumping the version remounts each rewritten row, so its editor shows
        // the new extraction instead of the content it held before the crawl.
        setChapters((cs) =>
          fresh.chapters
            .filter((c) => c.status !== "pending")
            .map((c) => toChapterState(c, (cs.find((x) => x.order === c.order)?.version ?? -1) + 1))
        );
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setCrawlingUrl(null);
    onStoryChanged();
  }

  async function handleExport() {
    setError(null);
    try {
      const payload = chapters
        .filter((c) => c.included)
        .map((c) => ({
          title: c.title,
          includeInBook: true,
          contentHtml: bodies.current.get(c.id) ?? blocksToHtml(c.data.blocks),
        }));
      await exportBook({ title: bookTitle || story.title, author: author || "Unknown", language }, payload, coverFile);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="pane">
      <div className="pane-head">
        <button type="button" className="btn btn-quiet btn-tiny" onClick={onClear}>
          <Icon name="chevron" size={12} className="rotate-180" />
          Danh sách truyện
        </button>
        <h2 className="ml-auto">Chi tiết truyện</h2>
      </div>

      <div className="detail">
        <div>
          <h3 className="story-title">{story.title}</h3>
          <div className="story-src mt-1">
            <span>{story.site}</span>
            <span aria-hidden="true">·</span>
            <a href={story.storyUrl} target="_blank" rel="noreferrer" className="break-all">
              {story.storyUrl}
            </a>
          </div>
        </div>

        <div>
          <div className="readout">
            <span className="readout-n">{doneCount}</span>
            <span className="readout-of">/{story.chapters.length}</span>
            <span className="readout-what">chương đã crawl</span>
          </div>
          <p className="mt-1.5 text-xs text-ink-2">
            {pendingCount > 0 && <span>{pendingCount} chờ crawl</span>}
            {pendingCount > 0 && errorCount > 0 && <span> · </span>}
            {errorCount > 0 && <span className="font-semibold text-error">{errorCount} lỗi</span>}
            {remaining === 0 && <span>Mọi chương đã crawl xong</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={running || remaining === 0}
            onClick={() => handleCrawl()}
          >
            <Icon name="play" size={12} className={running ? "animate-pulse" : undefined} />
            {running ? "Đang crawl…" : `Crawl tiếp (${remaining} chương)`}
          </button>
          <button type="button" className="btn" disabled={isExporting || doneCount === 0} onClick={handleExport}>
            <Icon name="download" size={14} />
            {isExporting ? "Đang xuất…" : "Xuất EPUB"}
          </button>
        </div>

        {error && (
          <div className="banner">
            <Icon name="alert" size={14} />
            <p className="min-w-0">{error}</p>
          </div>
        )}

        <div className="fields">
          <div className="field">
            <label htmlFor="story-title">Tên sách</label>
            <input
              id="story-title"
              type="text"
              className="input"
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="story-author">Tác giả</label>
            <input
              id="story-author"
              type="text"
              className="input"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="story-language">Ngôn ngữ</label>
            <select
              id="story-language"
              className="input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="story-cover">Ảnh bìa (tùy chọn)</label>
            <input
              id="story-cover"
              type="file"
              className="file-input"
              accept="image/*"
              onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>
      </div>

      <div className="pane-body">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-9" />
              <th className="num w-11">#</th>
              <th>Chương</th>
              <th className="w-32">Trạng thái</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {story.chapters.map((sc) => {
              const c = chapters.find((x) => x.order === sc.order);
              if (!c) {
                return (
                  <PendingChapterRow
                    key={`pending-${sc.order}`}
                    order={sc.order}
                    title={sc.title}
                    url={sc.url}
                    crawling={crawlingUrl === sc.url}
                  />
                );
              }
              return (
                <ChapterCard
                  key={`${c.id}-${c.version}`}
                  chapter={c.data}
                  order={c.order}
                  title={c.title}
                  included={c.included}
                  retrying={c.retrying}
                  retriedOnce={c.retriedOnce}
                  onTitleChange={(title) =>
                    setChapters((cs) => cs.map((x) => (x.id === c.id ? { ...x, title } : x)))
                  }
                  onIncludedChange={(included) =>
                    setChapters((cs) => cs.map((x) => (x.id === c.id ? { ...x, included } : x)))
                  }
                  onRetry={() => handleCrawl([c.order])}
                  onBodyChange={(html) => bodies.current.set(c.id, html)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
