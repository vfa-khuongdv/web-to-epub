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
