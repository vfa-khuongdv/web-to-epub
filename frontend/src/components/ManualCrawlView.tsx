import { useRef, useState } from "react";
import { extractChapters } from "../api";
import { blocksToHtml } from "../blocksToHtml";
import { isSupportedUrl } from "../isSupportedUrl";
import { ExtractedChapter, SupportedSite } from "../types";
import { CrawlJobState, RunCrawl } from "../useCrawlJob";
import { exportProgressLabel, useEpubExport } from "../useEpubExport";
import ChapterCard, { PendingChapterRow } from "./ChapterCard";
import { Icon } from "./Icon";

interface ChapterState {
  id: string;
  order: number;
  url: string;
  title: string;
  data: ExtractedChapter | null;
  included: boolean;
  version: number;
  retriedOnce: boolean;
}

function toChapterState(data: ExtractedChapter, order: number, version: number, retriedOnce: boolean): ChapterState {
  return {
    id: `chapter-${order}`,
    order,
    url: data.sourceUrl,
    title: data.error ? data.sourceUrl : data.title,
    data,
    included: !data.error,
    version,
    retriedOnce,
  };
}

export default function ManualCrawlView({
  run,
  job,
  clearChapters,
  supportedSites,
}: {
  run: RunCrawl;
  job: CrawlJobState;
  clearChapters: () => void;
  supportedSites: SupportedSite[];
}) {
  const [urlsText, setUrlsText] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("vi");
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const [chapters, setChapters] = useState<ChapterState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [badUrls, setBadUrls] = useState<string[]>([]);
  const { isExporting, progress, exportBook } = useEpubExport();

  // Live chapter HTML by chapter id: kept for every chapter the user has
  // opened, so a collapsed chapter still exports its edited content.
  const bodies = useRef(new Map<string, string>());

  // Chapters this run has already finished or failed but whose content has not
  // arrived yet (the stream carries state per chapter, content only at the end).
  const liveDone = chapters.filter((c) => !c.data && job.chapters[c.url] === "done").length;
  const liveFailed = chapters.filter((c) => !c.data && job.chapters[c.url] === "error").length;
  const crawled = chapters.filter((c) => c.data !== null);
  const ok = crawled.filter((c) => !c.data?.error).length + liveDone;
  const failed = crawled.filter((c) => c.data?.error).length + liveFailed;
  const waiting = chapters.filter((c) => !c.data).length - liveDone - liveFailed;
  const failedOrders = [
    ...crawled.filter((c) => c.data?.error).map((c) => c.order),
  ];

  function readUrls(): string[] {
    return urlsText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
  }

  async function handleExtract() {
    const urls = readUrls();
    setBadUrls([]);
    setError(null);

    if (urls.length === 0) {
      setError("Enter at least one chapter URL.");
      return;
    }
    const unsupported = urls.filter((u) => !isSupportedUrl(u, supportedSites));
    if (unsupported.length > 0) {
      setBadUrls(unsupported);
      setError(`${unsupported.length} URLs are not from supported sites.`);
      return;
    }

    setChapters(
      urls.map((url, i) => ({
        id: `chapter-${i + 1}`,
        order: i + 1,
        url,
        title: url,
        data: null,
        included: false,
        version: 0,
        retriedOnce: false,
      }))
    );

    await run("Manual crawl", (emit) => extractChapters(urls, emit), (event) => {
      if (event.type === "error" && event.index !== undefined && event.message) {
        const order = event.index + 1;
        setChapters((cs) =>
          cs.map((c) =>
            c.order === order && !c.data
              ? { ...c, data: { sourceUrl: c.url, title: c.title, blocks: [], error: event.message } }
              : c
          )
        );
      }
      if (event.type === "done" && event.chapters) {
        const results = event.chapters;
        setChapters((cs) =>
          cs.map((c) => {
            const data = results[c.order - 1];
            if (!data) return c;
            // A row that was already marked failed has to remount to pick up the
            // content this pass extracted, hence the version bump.
            return toChapterState(data, c.order, c.version + (c.data ? 1 : 0), false);
          })
        );
        const firstOk = results.find((r) => !r.error);
        if (firstOk) setBookTitle((current) => current || firstOk.title);
        clearChapters();
      }
    });
  }

  async function retryOrders(orders: number[]) {
    const targets = chapters.filter((c) => orders.includes(c.order));
    if (targets.length === 0) return;
    setError(null);

    await run(
      targets.length === 1 ? "Retry one chapter" : `Retry ${targets.length} failed chapters`,
      (emit) => extractChapters(targets.map((c) => c.url), emit),
      (event) => {
        if (event.type === "done" && event.chapters) {
          const results = event.chapters;
          targets.forEach((t) => bodies.current.delete(t.id));
          setChapters((cs) =>
            cs.map((c) => {
              const i = targets.findIndex((t) => t.order === c.order);
              if (i === -1 || !results[i]) return c;
              return toChapterState(results[i], c.order, c.version + 1, true);
            })
          );
        }
      }
    );
  }

  async function handleExport() {
    setError(null);
    try {
      const payload = chapters
        .filter((c) => c.included && c.data && !c.data.error)
        .map((c) => ({
          title: c.title,
          includeInBook: true,
          contentHtml: bodies.current.get(c.id) ?? blocksToHtml(c.data!.blocks),
        }));
      await exportBook({ title: bookTitle || "Untitled Book", author: author || "Unknown", language }, payload, coverFile);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <section className="pane">
        <div className="pane-head">
          <h2>Content source</h2>
          <span className="end text-xs text-ink-2">No story account needed — just URLs</span>
        </div>

        <div className="pane-body p-3">
          <div className="field">
            <label htmlFor="urls">URL list — one chapter per line, in order</label>
            <textarea
              id="urls"
              className="input"
              rows={8}
              placeholder={"https://example.com/story/chapter-1/\nhttps://example.com/story/chapter-2/"}
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
            />
          </div>

          <div className="sites-line mt-2">
            <span className="text-xs text-ink-2">Supported sites:</span>
            {supportedSites.length === 0 ? (
              <span className="text-xs text-ink-3">loading site list...</span>
            ) : (
              supportedSites.map((s) => (
                <span className="chip" key={s.domain}>
                  {s.name}
                  <span className="text-ink-3">{s.domain}</span>
                </span>
              ))
            )}
          </div>

          {error && (
            <div className="banner mt-3">
              <Icon name="alert" size={14} />
              <div className="min-w-0">
                <p>{error}</p>
                {badUrls.length > 0 && (
                  <ul>
                    {badUrls.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="fields mt-4">
            <div className="field">
              <label htmlFor="title">Book title</label>
              <input
                id="title"
                type="text"
                className="input"
                placeholder="Leave empty to use the first chapter's title"
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="author">Author</label>
              <input
                id="author"
                type="text"
                className="input"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="language">Language</label>
              <select
                id="language"
                className="input"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="vi">Vietnamese</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cover-file">Cover image (optional)</label>
              <input
                id="cover-file"
                type="file"
                className="file-input"
                accept="image/*"
                onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>

          <button type="button" className="btn btn-primary mt-3" disabled={job.running} onClick={handleExtract}>
            <Icon name="crawl" size={14} />
            {job.running ? "Crawling..." : "Crawl & extract content"}
          </button>
        </div>
      </section>

      <section className="pane">
        <div className="pane-head">
          <h2>Results</h2>
          <span className="end">
            {failedOrders.length > 0 && (
              <button
                type="button"
                className="btn btn-tiny"
                disabled={job.running}
                onClick={() => retryOrders(failedOrders)}
              >
                <Icon name="retry" size={13} />
                Retry {failedOrders.length} failed chapters
              </button>
            )}
            <button
              type="button"
              className="btn btn-tiny"
              disabled={isExporting || ok === 0}
              onClick={handleExport}
            >
              <Icon name="download" size={13} />
              {isExporting ? "Exporting..." : "Export EPUB"}
            </button>
            {isExporting && (
              <span className="export-progress" role="status">
                {progress ? exportProgressLabel(progress) : "Preparing..."}
              </span>
            )}
          </span>
        </div>

        {chapters.length === 0 ? (
          <div className="pane-body">
            <div className="empty">
              <h3>No content yet</h3>
              <p>
                Paste a list of chapter URLs in the left panel — one chapter per line, in the order you want them in the book — then click Crawl &amp; extract content.
              </p>
              <ol>
                <li>The tool opens each page in a headless browser and reads the rendered content, so it's not blocked by copy-protection.</li>
                <li>Failed chapters have a Retry button; if retry doesn't work, you can paste the content manually.</li>
                <li>Edit the title and content right in the table, then export to EPUB to read on Kindle.</li>
              </ol>
              <p>
                For stories with hundreds of chapters, use the "My Stories" tab instead: just paste the story page URL and progress is saved.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="detail">
              <div className="readout">
                <span className="readout-n">{ok}</span>
                <span className="readout-of">/{chapters.length}</span>
                <span className="readout-what">chapters extracted</span>
              </div>
              <p className="text-xs text-ink-2">
                {waiting > 0 && <span>{waiting} pending crawl</span>}
                {waiting > 0 && failed > 0 && <span> · </span>}
                {failed > 0 && <span className="font-semibold text-error">{failed} errors</span>}
                {crawled.length > 0 && failed === 0 && waiting === 0 && (
                  <span>All chapters extracted successfully</span>
                )}
              </p>
            </div>

            <div className="pane-body">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-9" />
                    <th className="num w-11">#</th>
                    <th>Chapter</th>
                    <th className="w-32">Status</th>
                    <th className="w-28" />
                  </tr>
                </thead>
                <tbody>
                  {chapters.map((c) =>
                    c.data === null ? (
                      <PendingChapterRow
                        includeColumn
                        key={`pending-${c.order}-${c.version}`}
                        order={c.order}
                        title={c.title}
                        url={c.url}
                        state={job.chapters[c.url] ?? "pending"}
                      />
                    ) : (
                      <ChapterCard
                        key={`${c.id}-${c.version}`}
                        chapter={c.data}
                        order={c.order}
                        title={c.title}
                        included={c.included}
                        retrying={job.chapters[c.url] === "running"}
                        retriedOnce={c.retriedOnce}
                        onTitleChange={(title) =>
                          setChapters((cs) => cs.map((x) => (x.order === c.order ? { ...x, title } : x)))
                        }
                        onIncludedChange={(included) =>
                          setChapters((cs) => cs.map((x) => (x.order === c.order ? { ...x, included } : x)))
                        }
                        onRetry={() => retryOrders([c.order])}
                        onBodyChange={(html) => bodies.current.set(c.id, html)}
                      />
                    )
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
