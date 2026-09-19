import { useEffect, useRef, useState } from "react";
import { fetchChapterContent, fetchStory, refreshStoryToc, saveChapterEdit, saveStoryMeta, setStoryWatch, startStoryCrawl } from "../api";
import { blocksToHtml } from "../blocksToHtml";
import { formatEta } from "../formatEta";
import { Translate, useLang } from "../i18n";
import { timeAgo } from "../timeAgo";
import { ExtractedChapter, StoredChapter, StoredStory } from "../types";
import { CrawlJobState, liveCounts } from "../useCrawlJob";
import { exportProgressLabel, useEpubExport } from "../useEpubExport";
import ChapterCard, { PendingChapterRow } from "./ChapterCard";
import { Icon } from "./Icon";
import ReaderOverlay from "./ReaderOverlay";

// Long stories with thousands of chapters: rendering all at once creates tens of
// thousands of DOM nodes, and each checkbox click redraws that many rows.
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

function toChapterState(chapter: StoredChapter, version: number, t: Translate): ChapterState {
  const data: ExtractedChapter =
    chapter.status === "error"
      ? { sourceUrl: chapter.url, title: chapter.title, blocks: [], error: chapter.error || t("Unknown error") }
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
  // Before the state below: the chapter list's lazy initializer already needs `t`.
  const { lang, t } = useLang();
  const [chapters, setChapters] = useState<ChapterState[]>(() =>
    story.chapters.filter((c) => c.status !== "pending").map((c) => toChapterState(c, 0, t))
  );
  const [bookTitle, setBookTitle] = useState(story.title);
  const [author, setAuthor] = useState(story.author || "");
  const [language, setLanguage] = useState(story.language || "vi");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  // Saved cover (loaded from story page during crawl or lingering URL from TOC);
  // changes each time crawl finishes since refreshStory reloads from server.
  const [coverUrl, setCoverUrl] = useState(story.coverUrl);
  const [coverBroken, setCoverBroken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapterPage, setChapterPage] = useState(1);
  const [loadingNew, setLoadingNew] = useState(false);
  const [reading, setReading] = useState(false);
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

  // Speed derived from ETA: eta = avg-time × remaining-chapters, so
  // remaining-chapters / ETA = chapters/minute — no separate field needed.
  const etaText =
    job.running && job.etaMs !== undefined && job.total > job.cursor
      ? t("{eta} remaining · {rate} ch/min", {
          eta: formatEta(job.etaMs, lang),
          rate: Math.max(1, Math.round((job.total - job.cursor) / (job.etaMs / 60_000))),
        })
      : null;

  // Look up via Map instead of find() in loop: find() turns each table render
  // into O(n²) — with 2468 chapters, millions of comparisons.
  const stateByOrder = new Map(chapters.map((c) => [c.order, c]));

  // Exactly what the book will contain, with the titles currently in the editor —
  // the reader is a preview of the export, not of what is on the server.
  const readableChapters = story.chapters
    .filter((c) => c.status === "done")
    .map((c) => ({ order: c.order, title: stateByOrder.get(c.order)?.title ?? c.title }));

  const coverSrc =
    coverUrl && !coverBroken
      ? // Not downloaded internally (stories completed before this feature existed)
        // show temp image from original URL; load error shows empty frame.
        coverUrl.startsWith("http")
        ? coverUrl
        : `/api/stories/${encodeURIComponent(story.id)}/cover?v=${encodeURIComponent(coverUrl)}`
      : undefined;
  const chapterPageCount = Math.max(1, Math.ceil(story.chapters.length / CHAPTERS_PER_PAGE));
  const currentChapterPage = Math.min(chapterPage, chapterPageCount);
  const visibleChapters = story.chapters.slice(
    (currentChapterPage - 1) * CHAPTERS_PER_PAGE,
    currentChapterPage * CHAPTERS_PER_PAGE
  );

  // Open story listens on realtime channel: crawl started by this or another
  // session both update the chapter table directly.
  useEffect(() => attach(t("Story: {title}", { title: story.title }), story.id), [attach, story.id, story.title]);

  // When a crawl run ends, refetch content from server (realtime channel carries
  // state only, not chapter content).
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
          setChapters((cs) => cs.map((c) => (c.order === single ? toChapterState(updated, c.version + 1, t) : c)));
        }
      } else {
        // Bumping the version remounts each rewritten row, so its editor shows
        // the new extraction instead of the content it held before the crawl.
        setChapters((cs) =>
          fresh.chapters
            .filter((c) => c.status !== "pending")
            .map((c) => toChapterState(c, (cs.find((x) => x.order === c.order)?.version ?? -1) + 1, t))
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

  // "Load N new chapters": refetch TOC (new chapters become pending) then crawl
  // all unfinished chapters — exactly the newly added ones. Only runs on user click.
  async function handleLoadNew() {
    setError(null);
    setLoadingNew(true);
    try {
      await refreshStoryToc(story.id);
      // Wait for parent to refetch story prop so chapter table has new list before crawl.
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

  // Flash "Saved" on button after successful save.
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
      // Only send chapters being edited; unopened chapters, server builds from DB,
      // no need to load the whole story and push back.
      // Book includes all chapters with content; error chapters not yet cleaned are skipped.
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
          {t("Story list")}
        </button>
        <h2 className="ml-auto">{t("Story details")}</h2>
      </div>

      <div className="detail">
        <div className="detail-cover">
          {coverSrc ? (
            <img
              className="cover-thumb"
              src={coverSrc}
              alt={t("Cover image for {title}", { title: story.title })}
              // Some CDNs (Google Drive) block hotlinks by Referer.
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
              <span className="readout-what">{t("chapters crawled")}</span>
            </div>
            <p className="mt-1.5 text-xs text-ink-2">
              {pendingCount > 0 && <span>{t("{count} pending crawl", { count: pendingCount })}</span>}
              {pendingCount > 0 && errorCount > 0 && <span> · </span>}
              {errorCount > 0 && <span className="font-semibold text-error">{t("{count} errors", { count: errorCount })}</span>}
              {remaining === 0 && <span>{t("All chapters crawled")}</span>}
          </p>
            {etaText && <p className="mt-1.5 text-xs text-ink-2">{etaText}</p>}
            {story.watching && (
              <p className="mt-1.5 text-xs text-ink-3">
                {story.lastCheckedAt
                  ? t("Last checked {when}", { when: timeAgo(story.lastCheckedAt, lang) })
                  : t("Never checked")}
              </p>
            )}
        </div>

          {story.newChapterCount > 0 && (
            <div className="banner banner-new">
              <Icon name="bell" size={14} />
              <p className="min-w-0">
                {t("{count} new chapters since the last crawl.", { count: story.newChapterCount })}
              </p>
              <button
                type="button"
                className="btn btn-tiny ml-auto"
                disabled={loadingNew || job.running}
                onClick={handleLoadNew}
              >
                {loadingNew
                  ? t("Loading new chapters…")
                  : t("Load {count} new chapters", { count: story.newChapterCount })}
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
              {job.running ? t("Crawling…") : t("Continue crawl ({count} chapters)", { count: remaining })}
            </button>
            <button
              type="button"
              className="btn"
              disabled={readableChapters.length === 0}
              title={t("See the chapters exactly as the exported EPUB will show them — and read them here")}
              onClick={() => setReading(true)}
            >
              <Icon name="book" size={14} />
              {t("Read / preview")}
            </button>
            <button type="button" className="btn" disabled={isExporting || doneCount === 0} onClick={handleExport}>
              <Icon name="download" size={14} />
              {isExporting ? t("Exporting…") : t("Export EPUB")}
            </button>
            {isExporting && (
              <span className="export-progress" role="status">
                {progress ? exportProgressLabel(progress, t) : t("Preparing…")}
              </span>
            )}
            <button
              type="button"
              className="btn"
              aria-pressed={story.watching}
              title={story.watching ? t("Stop watching for new chapters") : t("Check for new chapters when opening app")}
              onClick={handleWatchToggle}
            >
              <Icon name="bell" size={13} className={story.watching ? "text-select" : undefined} />
              {story.watching ? t("Watching") : t("Watch for new chapters")}
            </button>
            <button type="button" className="btn" disabled={saving} onClick={handleSave}>
              <Icon name={saved ? "check" : "upload"} size={13} />
              {saving ? t("Saving…") : saved ? t("Saved") : t("Save metadata")}
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
              <label htmlFor="story-title">{t("Book title")}</label>
            <input
              id="story-title"
              type="text"
              className="input"
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
            />
            </div>
            <div className="field">
              <label htmlFor="story-author">{t("Author")}</label>
            <input
              id="story-author"
              type="text"
              className="input"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
            </div>
            <div className="field">
              <label htmlFor="story-language">{t("Book language")}</label>
            <select
              id="story-language"
              className="input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="vi">{t("Vietnamese")}</option>
              <option value="en">{t("English")}</option>
            </select>
            </div>
            <div className="field">
              <label htmlFor="story-cover">{t("Cover image")}</label>
            <input
              id="story-cover"
              ref={coverInput}
              type="file"
              className="file-input"
              accept="image/*"
              onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
            />
              <p className="cover-hint">{t("Cover auto-downloads during crawl. Select a new image, then click Save metadata to change it.")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="pane-body">
        <table className="tbl">
          <thead>
            <tr>
              <th className="num w-11">#</th>
              <th>{t("Chapter")}</th>
              <th className="w-32">{t("Status")}</th>
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
                    // Fetch the server's normalized version so EPUB export
                    // matches what's stored in the database.
                    bodies.current.set(c.id, blocksToHtml(updated.blocks ?? []));
                    setChapters((cs) =>
                      cs.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              title: updated.title,
                              // Chapter that had error now has content -> goes into book.
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
              {t("Chapters {from}–{to} / {total}", {
                from: (currentChapterPage - 1) * CHAPTERS_PER_PAGE + 1,
                to: Math.min(currentChapterPage * CHAPTERS_PER_PAGE, story.chapters.length),
                total: story.chapters.length,
              })}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                disabled={currentChapterPage <= 1}
                onClick={() => setChapterPage(currentChapterPage - 1)}
              >
                {t("Previous")}
              </button>
              <span>{t("Page {page}/{total}", { page: currentChapterPage, total: chapterPageCount })}</span>
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                disabled={currentChapterPage >= chapterPageCount}
                onClick={() => setChapterPage(currentChapterPage + 1)}
              >
                {t("Next")}
              </button>
            </span>
          </div>
        )}
      </div>

      {reading && (
        <ReaderOverlay
          storyId={story.id}
          storyTitle={bookTitle || story.title}
          author={author}
          language={language}
          coverSrc={coverSrc}
          chapters={readableChapters}
          // Chapters open in the editor export their unsaved HTML, so the preview must
          // show that too; the rest come from the DB like the export builds them.
          loadChapterHtml={async (order) =>
            bodies.current.get(`stored-${order}`) ??
            blocksToHtml((await fetchChapterContent(story.id, order)).blocks ?? [])
          }
          onClose={() => setReading(false)}
        />
      )}
    </section>
  );
}
