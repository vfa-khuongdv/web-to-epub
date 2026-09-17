import { useRef, useState } from "react";
import ChapterCard from "./ChapterCard";
import { extractChapters, extractOne } from "../api";
import { isSupportedUrl } from "../isSupportedUrl";
import { ExtractedChapter, SupportedSite } from "../types";
import { useEpubExport } from "../useEpubExport";

interface ChapterState {
  id: string;
  order: number;
  data: ExtractedChapter;
  title: string;
  included: boolean;
  retrying: boolean;
  version: number;
  // Whether the user has clicked "Thử lại" for this chapter at least once —
  // the manual-entry fallback only shows up after that, so people try an
  // actual retry (many failures are transient) before resorting to it.
  retriedOnce: boolean;
}

interface LogLine {
  text: string;
  isError: boolean;
}

function toChapterState(
  data: ExtractedChapter,
  order: number,
  id: string,
  version: number,
  retriedOnce = false
): ChapterState {
  return {
    id,
    order,
    data,
    title: data.error ? data.sourceUrl : data.title,
    included: !data.error,
    retrying: false,
    version,
    retriedOnce,
  };
}

export default function ManualCrawlView({ supportedSites }: { supportedSites: SupportedSite[] }) {
  const [urlsText, setUrlsText] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("vi");
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const [isCrawling, setIsCrawling] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [logLines, setLogLines] = useState<LogLine[]>([]);

  const [chapters, setChapters] = useState<ChapterState[]>([]);
  const [retryAllRunning, setRetryAllRunning] = useState(false);
  const [retryAllLabel, setRetryAllLabel] = useState("Thử lại tất cả chương lỗi");
  const { isExporting, exportBook } = useEpubExport();

  const bodyRefs = useRef(new Map<string, HTMLDivElement | null>());

  async function handleExtract() {
    const urls = urlsText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      alert("Vui lòng nhập ít nhất một URL.");
      return;
    }

    const unsupported = urls.filter((u) => !isSupportedUrl(u, supportedSites));
    if (unsupported.length > 0) {
      alert(`Các URL sau không thuộc trang được hỗ trợ:\n${unsupported.join("\n")}`);
      return;
    }

    setIsCrawling(true);
    setProgressPct(0);
    setLogLines([]);
    setChapters([]);

    try {
      await extractChapters(urls, (event) => {
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
        } else if (event.type === "done" && event.chapters) {
          setProgressPct(100);
          const newChapters = event.chapters.map((data, i) => toChapterState(data, i + 1, `${i}-${data.sourceUrl}`, 0));
          setChapters(newChapters);

          const firstOk = newChapters.find((c) => !c.data.error);
          if (firstOk) {
            setBookTitle((current) => current || firstOk.title);
          }
        }
      });
    } catch (err) {
      setLogLines((lines) => [...lines, { text: `Lỗi kết nối: ${(err as Error).message}`, isError: true }]);
    } finally {
      setIsCrawling(false);
    }
  }

  async function retrySingle(id: string): Promise<boolean> {
    const target = chapters.find((c) => c.id === id);
    if (!target) return false;

    setChapters((cs) => cs.map((c) => (c.id === id ? { ...c, retrying: true, retriedOnce: true } : c)));
    try {
      const data = await extractOne(target.data.sourceUrl);
      setChapters((cs) =>
        cs.map((c) => (c.id === id ? toChapterState(data, c.order, c.id, c.version + 1, true) : c))
      );
      return !data.error;
    } catch (err) {
      setChapters((cs) => cs.map((c) => (c.id === id ? { ...c, retrying: false } : c)));
      alert((err as Error).message);
      return false;
    }
  }

  async function handleRetryAll() {
    // Fixed snapshot: a chapter that fails again during this pass isn't
    // re-queued, so one persistently-failing URL can't loop forever.
    const failedIds = chapters.filter((c) => c.data.error).map((c) => c.id);
    setRetryAllRunning(true);
    for (let i = 0; i < failedIds.length; i++) {
      setRetryAllLabel(`Đang thử lại ${i + 1}/${failedIds.length}...`);
      await retrySingle(failedIds[i]);
    }
    setRetryAllRunning(false);
    setRetryAllLabel("Thử lại tất cả chương lỗi");
  }

  async function handleExport() {
    try {
      const payload = chapters.map((c) => ({
        title: c.title,
        includeInBook: c.included,
        contentHtml: bodyRefs.current.get(c.id)?.innerHTML || "",
      }));
      await exportBook({ title: bookTitle || "Untitled Book", author: author || "Unknown", language }, payload, coverFile);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const failedCount = chapters.filter((c) => c.data.error).length;
  const okCount = chapters.length - failedCount;

  return (
    <>
      <section className="card">
        <h2>1. Nguồn nội dung</h2>
        <label htmlFor="urls">Danh sách URL (mỗi dòng là một chapter, theo đúng thứ tự)</label>
        <textarea
          id="urls"
          rows={6}
          placeholder={"https://example.com/chuong-1\nhttps://example.com/chuong-2"}
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
        />
        <p className="supported-sites">
          {supportedSites.length === 0
            ? "Đang tải danh sách trang được hỗ trợ..."
            : `Chỉ hỗ trợ các trang: ${supportedSites.map((s) => `${s.name} (${s.domain})`).join(", ")}`}
        </p>

        <div className="grid">
          <div>
            <label htmlFor="title">Tên sách (để trống sẽ lấy từ chapter đầu tiên)</label>
            <input id="title" type="text" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="author">Tác giả</label>
            <input id="author" type="text" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div>
            <label htmlFor="language">Ngôn ngữ</label>
            <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label htmlFor="cover-file">Ảnh bìa (tùy chọn)</label>
            <input
              id="cover-file"
              type="file"
              accept="image/*"
              onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <button disabled={isCrawling} onClick={handleExtract}>
          Crawl & Trích xuất nội dung
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
      </section>

      {chapters.length > 0 && (
        <section className="card">
          <h2>2. Preview & chỉnh sửa</h2>
          <p className="hint">
            Bạn có thể sửa tiêu đề, nội dung từng chapter, hoặc bỏ chọn chapter không muốn đưa vào sách.
          </p>

          <div className={`result-summary${failedCount > 0 ? " has-errors" : ""}`}>
            {failedCount === 0
              ? `✅ Hoàn tất: ${okCount}/${chapters.length} chapter trích xuất thành công.`
              : `⚠️ Hoàn tất: ${okCount}/${chapters.length} chapter thành công, ${failedCount} chapter lỗi.`}
          </div>

          {failedCount > 0 && (
            <button id="btn-retry-all" disabled={retryAllRunning} onClick={handleRetryAll}>
              {retryAllLabel}
            </button>
          )}

          <div id="chapters">
            {chapters.map((c) => (
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
                onRetry={() => retrySingle(c.id)}
                bodyRef={(el) => bodyRefs.current.set(c.id, el)}
              />
            ))}
          </div>

          <button disabled={isExporting} onClick={handleExport}>
            {isExporting ? "Đang xuất..." : "Xuất EPUB"}
          </button>
        </section>
      )}
    </>
  );
}
