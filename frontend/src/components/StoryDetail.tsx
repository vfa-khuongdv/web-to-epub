import { useEffect, useRef, useState } from "react";
import { fetchChapterContent, fetchStory, refreshStoryToc, saveChapterEdit, saveStoryMeta, setStoryWatch, startStoryCrawl } from "../api";
import { blocksToHtml } from "../blocksToHtml";
import { formatEta } from "../formatEta";
import { timeAgo } from "../timeAgo";
import { ExtractedChapter, StoredChapter, StoredStory } from "../types";
import { CrawlJobState, liveCounts } from "../useCrawlJob";
import { exportProgressLabel, useEpubExport } from "../useEpubExport";
import ChapterCard, { PendingChapterRow } from "./ChapterCard";
import { Icon } from "./Icon";

// Truyện dài vài nghìn chương: dựng hết một lúc là hàng chục nghìn node DOM,
// mỗi lần bấm một ô tick cũng phải vẽ lại từng ấy dòng.
const CHAPTERS_PER_PAGE = 100;

interface ChapterState {
  id: string;
  order: number;
  data: ExtractedChapter;
  title: string;
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
    retrying: false,
    version,
    retriedOnce: chapter.status === "error",
  };
}

export default function StoryDetail({
  story,
  job,
  attach,
  clearChapters,
  onStoryChanged,
  onClear,
}: {
  story: StoredStory;
  job: CrawlJobState;
  attach: (label: string, storyId: string) => () => void;
  clearChapters: () => void;
  onStoryChanged: () => void | Promise<void>;
  onClear: () => void;
}) {
  const [chapters, setChapters] = useState<ChapterState[]>(() =>
    story.chapters.filter((c) => c.status !== "pending").map((c) => toChapterState(c, 0))
  );
  const [bookTitle, setBookTitle] = useState(story.title);
  const [author, setAuthor] = useState(story.author || "");
  const [language, setLanguage] = useState(story.language || "vi");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  // Bìa đã lưu (tải từ trang truyện khi crawl hoặc URL còn lại từ TOC); đổi sau
  // mỗi lần crawl xong vì refreshStory nạp lại từ server.
  const [coverUrl, setCoverUrl] = useState(story.coverUrl);
  const [coverBroken, setCoverBroken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapterPage, setChapterPage] = useState(1);
  const [loadingNew, setLoadingNew] = useState(false);
  const { isExporting, progress, exportStoryBook } = useEpubExport();

  // Live chapter HTML by chapter id: kept for every chapter the user has
  // opened, so a collapsed chapter still exports its edited content.
  const bodies = useRef(new Map<string, string>());
  // Chapters the run in flight rewrites (their cached editor HTML goes stale)
  // and the orders it was asked for, so the refetch after it ends can tell a
  // single-chapter retry from a batch.
  const rewrittenIds = useRef<string[]>([]);
  const runOrders = useRef<number[] | undefined>(undefined);
  const watchingRun = useRef(false);

  // Live overlay for the run in progress: chapters the server still reports as
  // pending, but that this crawl has already finished or failed. Once the run
  // ends and the story is refetched, these come from the server instead.
  const live = liveCounts(story.chapters, job.chapters);
  const errorCount = story.chapters.filter((c) => c.status === "error").length + live.error;
  const doneCount =
    story.chapters.filter((c) => c.status === "done").length + live.done;
  const pendingCount = story.chapters.length - doneCount - errorCount;
  const remaining = pendingCount + errorCount;

  // Tốc độ suy từ ETA: eta = thời-gian-trung-bình × số-chương-còn-lại, nên
  // số-chương-còn-lại / ETA chính là chương/phút — không cần field riêng.
  const etaText =
    job.running && job.etaMs !== undefined && job.total > job.cursor
      ? `còn ${formatEta(job.etaMs)} · ${Math.max(1, Math.round((job.total - job.cursor) / (job.etaMs / 60_000)))} ch/phút`
      : null;

  // Tra theo Map thay vì find() trong vòng lặp: find() biến mỗi lần vẽ bảng
  // thành O(n²) — với 2468 chương là vài triệu phép so sánh.
  const stateByOrder = new Map(chapters.map((c) => [c.order, c]));
  const chapterPageCount = Math.max(1, Math.ceil(story.chapters.length / CHAPTERS_PER_PAGE));
  const currentChapterPage = Math.min(chapterPage, chapterPageCount);
  const visibleChapters = story.chapters.slice(
    (currentChapterPage - 1) * CHAPTERS_PER_PAGE,
    currentChapterPage * CHAPTERS_PER_PAGE
  );

  // Truyện đang mở được nghe qua kênh realtime: crawl do phiên này hay phiên
  // khác bắt đầu đều cập nhật trực tiếp vào bảng chương.
  useEffect(() => attach(`Truyện: ${story.title}`, story.id), [attach, story.id, story.title]);

  // Khi một lượt crawl kết thúc, nạp lại nội dung từ server (kênh realtime chỉ
  // mang trạng thái, không mang nội dung chương).
  useEffect(() => {
    if (job.running) {
      watchingRun.current = true;
      return;
    }
    if (!watchingRun.current) return;
    watchingRun.current = false;
    void refreshStory(runOrders.current);
    runOrders.current = undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.running]);

  async function refreshStory(orders?: number[]) {
    const single = orders?.length === 1 ? orders[0] : undefined;
    try {
      const fresh = await fetchStory(story.id);
      setCoverUrl(fresh.coverUrl);
      setCoverBroken(false);
      rewrittenIds.current.forEach((id) => bodies.current.delete(id));
      rewrittenIds.current = [];
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
      clearChapters();
    } catch (err) {
      setError((err as Error).message);
    }
    onStoryChanged();
  }

  async function handleCrawl(orders?: number[]) {
    setError(null);
    const single = orders?.length === 1 ? orders[0] : undefined;

    if (single !== undefined) {
      setChapters((cs) => cs.map((c) => (c.order === single ? { ...c, retrying: true, retriedOnce: true } : c)));
    }
    rewrittenIds.current =
      single !== undefined
        ? [`stored-${single}`]
        : story.chapters.filter((c) => c.status !== "done").map((c) => `stored-${c.order}`);

    try {
      await startStoryCrawl(story.id, orders);
      runOrders.current = orders;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // "Tải N chương mới": nạp lại TOC (chương mới thành pending) rồi crawl toàn
  // bộ chương chưa xong — đúng các chương vừa thêm. Chỉ chạy khi người dùng bấm.
  async function handleLoadNew() {
    setError(null);
    setLoadingNew(true);
    try {
      await refreshStoryToc(story.id);
      // Chờ cha nạp lại prop story để bảng chương có danh sách mới trước khi crawl.
      await onStoryChanged();
      await handleCrawl();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingNew(false);
    }
  }

  async function handleWatchToggle() {
    setError(null);
    try {
      await setStoryWatch(story.id, !story.watching);
      await onStoryChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Nhấp nháy "Đã lưu" trên nút sau khi lưu thành công.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(timer);
  }, [saved]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const form = new FormData();
      form.append("title", bookTitle);
      form.append("author", author);
      form.append("language", language);
      if (coverFile) form.append("cover", coverFile);
      const updated = await saveStoryMeta(story.id, form);
      setBookTitle(updated.title);
      setAuthor(updated.author ?? "");
      setLanguage(updated.language || "vi");
      setCoverUrl(updated.coverUrl);
      setCoverBroken(false);
      setCoverFile(null);
      if (coverInput.current) coverInput.current.value = "";
      setSaved(true);
      onStoryChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setError(null);
    try {
      // Chỉ gửi chương đang sửa dở; chương chưa mở thì server tự dựng từ DB,
      // khỏi phải tải cả truyện về rồi đẩy ngược lên.
      // Sách gồm mọi chương đã có nội dung; chương lỗi chưa dọn thì bỏ qua.
      const payload = chapters
        .filter((c) => !c.data.error)
        .map((c) => ({ order: c.order, title: c.title, contentHtml: bodies.current.get(c.id) }));
      await exportStoryBook(
        story.id,
        { title: bookTitle || story.title, author: author || "Unknown", language, coverUrl },
        payload,
        null
      );
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
        <div className="detail-cover">
          {coverUrl && !coverBroken ? (
            <img
              className="cover-thumb"
              // Chưa tải về nội bộ (truyện đã crawl xong trước khi có tính năng)
              // thì xem tạm ảnh từ URL gốc; tải lỗi thì hiện khung trống.
              src={
                coverUrl.startsWith("http")
                  ? coverUrl
                  : `/api/stories/${encodeURIComponent(story.id)}/cover?v=${encodeURIComponent(coverUrl)}`
              }
              alt={`Ảnh bìa ${story.title}`}
              // Một số CDN (Google Drive) chặn hotlink theo Referer.
              referrerPolicy="no-referrer"
              onError={() => setCoverBroken(true)}
            />
          ) : (
            <div className="cover-empty">
              <Icon name="library" size={20} />
            </div>
          )}
        </div>

        <div className="detail-main">
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
          {etaText && <p className="mt-1.5 text-xs text-ink-2">{etaText}</p>}
          {story.watching && (
            <p className="mt-1.5 text-xs text-ink-3">
              {story.lastCheckedAt ? `Kiểm tra lần cuối ${timeAgo(story.lastCheckedAt)}` : "Chưa kiểm tra lần nào"}
            </p>
          )}
        </div>

        {story.newChapterCount > 0 && (
          <div className="banner banner-new">
            <Icon name="bell" size={14} />
            <p className="min-w-0">Có {story.newChapterCount} chương mới kể từ lần crawl trước.</p>
            <button
              type="button"
              className="btn btn-tiny ml-auto"
              disabled={loadingNew || job.running}
              onClick={handleLoadNew}
            >
              {loadingNew ? "Đang tải chương mới…" : `Tải ${story.newChapterCount} chương mới`}
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={job.running || remaining === 0}
            onClick={() => handleCrawl()}
          >
            <Icon name="play" size={12} className={job.running ? "animate-pulse" : undefined} />
            {job.running ? "Đang crawl…" : `Crawl tiếp (${remaining} chương)`}
          </button>
          <button type="button" className="btn" disabled={isExporting || doneCount === 0} onClick={handleExport}>
            <Icon name="download" size={14} />
            {isExporting ? "Đang xuất…" : "Xuất EPUB"}
          </button>
          {isExporting && (
            <span className="export-progress" role="status">
              {progress ? exportProgressLabel(progress) : "Đang chuẩn bị…"}
            </span>
          )}
          <button
            type="button"
            className="btn"
            aria-pressed={story.watching}
            title={story.watching ? "Bỏ theo dõi chương mới" : "Kiểm tra chương mới khi mở app"}
            onClick={handleWatchToggle}
          >
            <Icon name="bell" size={13} className={story.watching ? "text-select" : undefined} />
            {story.watching ? "Đang theo dõi" : "Theo dõi chương mới"}
          </button>
          <button type="button" className="btn" disabled={saving} onClick={handleSave}>
            <Icon name={saved ? "check" : "upload"} size={13} />
            {saving ? "Đang lưu…" : saved ? "Đã lưu" : "Lưu thông tin"}
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
            <label htmlFor="story-cover">Ảnh bìa</label>
            <input
              id="story-cover"
              ref={coverInput}
              type="file"
              className="file-input"
              accept="image/*"
              onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
            />
            <p className="cover-hint">Bìa tự tải về khi crawl. Chọn ảnh mới rồi bấm Lưu thông tin để thay bìa.</p>
          </div>
        </div>
        </div>
      </div>

      <div className="pane-body">
        <table className="tbl">
          <thead>
            <tr>
              <th className="num w-11">#</th>
              <th>Chương</th>
              <th className="w-32">Trạng thái</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {visibleChapters.map((sc) => {
              const c = stateByOrder.get(sc.order);
              if (!c) {
                return (
                  <PendingChapterRow
                    key={`pending-${sc.order}`}
                    order={sc.order}
                    title={sc.title}
                    url={sc.url}
                    state={job.chapters[sc.url] ?? "pending"}
                  />
                );
              }
              return (
                <ChapterCard
                  key={`${c.id}-${c.version}`}
                  chapter={c.data}
                  order={c.order}
                  title={c.title}
                  retrying={c.retrying}
                  retriedOnce={c.retriedOnce}
                  onTitleChange={(title) =>
                    setChapters((cs) => cs.map((x) => (x.id === c.id ? { ...x, title } : x)))
                  }
                  onRetry={() => handleCrawl([c.order])}
                  onBodyChange={(html) => bodies.current.set(c.id, html)}
                  loadBody={async () => blocksToHtml((await fetchChapterContent(story.id, c.order)).blocks ?? [])}
                  onSave={async (title, contentHtml) => {
                    const updated = await saveChapterEdit(story.id, c.order, { title, contentHtml });
                    // Lấy lại đúng bản server đã chuẩn hoá để lúc xuất EPUB
                    // khớp với những gì đang nằm trong DB.
                    bodies.current.set(c.id, blocksToHtml(updated.blocks ?? []));
                    setChapters((cs) =>
                      cs.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              title: updated.title,
                              // Chương từng lỗi nay đã có nội dung -> vào sách.
                              data: { sourceUrl: updated.url, title: updated.title, blocks: updated.blocks ?? [] },
                            }
                          : x
                      )
                    );
                    onStoryChanged();
                  }}
                />
              );
            })}
          </tbody>
        </table>

        {chapterPageCount > 1 && (
          <div className="flex items-center gap-2 border-t border-rule px-3 py-2 text-xs text-ink-2">
            <span>
              Chương {(currentChapterPage - 1) * CHAPTERS_PER_PAGE + 1}–
              {Math.min(currentChapterPage * CHAPTERS_PER_PAGE, story.chapters.length)} / {story.chapters.length}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                disabled={currentChapterPage <= 1}
                onClick={() => setChapterPage(currentChapterPage - 1)}
              >
                Trước
              </button>
              <span>
                Trang {currentChapterPage}/{chapterPageCount}
              </span>
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                disabled={currentChapterPage >= chapterPageCount}
                onClick={() => setChapterPage(currentChapterPage + 1)}
              >
                Sau
              </button>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
