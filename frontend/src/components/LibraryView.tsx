import { useEffect, useRef, useState } from "react";
import { checkStoryUpdates, createStory, deleteStory, fetchStories, fetchStory, setStoryWatch } from "../api";
import { isSupportedUrl } from "../isSupportedUrl";
import { timeAgo } from "../timeAgo";
import { StoredStory, StorySummary, SupportedSite } from "../types";
import { CrawlJobState, LiveCrawl, liveCounts } from "../useCrawlJob";
import { Icon } from "./Icon";
import { ChipState, StatusChip } from "./StatusChip";
import StoryDetail from "./StoryDetail";

// Crawl status for the entire story, combining saved count with running crawl: if
// chapters are waiting, report how many remain; if all waiting chapters are done,
// report crawl complete (with error count if any) — at a glance, know which stories
// are fully crawled. Watched stories with new chapters are prioritized before remaining.
function crawlStatus(
  total: number,
  done: number,
  errors: number,
  newChapterCount: number,
  crawling?: LiveCrawl
): { state: ChipState; label: string } {
  if (crawling) {
    return {
      state: "running",
      label: crawling.total > 0 ? `Crawling ${crawling.cursor}/${crawling.total}` : "Crawling",
    };
  }
  if (newChapterCount > 0) {
    return { state: "new", label: `${newChapterCount} new chapters` };
  }
  const remaining = total - done - errors;
  if (remaining > 0) return { state: "pending", label: `${remaining} chapters pending` };
  if (errors > 0) return { state: "error", label: `Done · ${errors} errors` };
  return { state: "done", label: "Crawl complete" };
}

const PAGE_SIZE = 10;

type SortKey = "title" | "site" | "chapterCount" | "done" | "errors" | "remaining" | "updatedAt";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

// Multi-level sort: first element is primary criteria, subsequent elements are
// tie-breakers. Shift+click adds a secondary column, regular click replaces all.
const DEFAULT_SORTS: SortState[] = [{ key: "updatedAt", dir: "desc" }];

// A table row: combines saved data plus running crawl, pre-calculated for
// filtering/sorting to work on the same numbers the user sees.
interface StoryRow extends StorySummary {
  done: number;
  errors: number;
  remaining: number;
  crawling?: LiveCrawl;
  status: { state: ChipState; label: string };
}

// Remove diacritics so typing "van" still finds "Văn".
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function compareRows(a: StoryRow, b: StoryRow, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title, "vi");
    case "site":
      return a.site.localeCompare(b.site, "vi");
    case "updatedAt":
      // ISO format, so string comparison = time comparison.
      return a.updatedAt.localeCompare(b.updatedAt);
    default:
      return a[key] - b[key];
  }
}

function SortTh({
  label,
  sortKey,
  sorts,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sorts: SortState[];
  onSort: (key: SortKey, additive: boolean) => void;
  className?: string;
}) {
  const rank = sorts.findIndex((s) => s.key === sortKey);
  const active = sorts[rank];
  return (
    <th
      className={className}
      aria-sort={active ? (active.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1"
        title={`Sort by ${label} — hold Shift to add secondary criteria`}
        onClick={(e) => onSort(sortKey, e.shiftKey)}
      >
        {label}
        {active && (
          <>
            <Icon name="chevron" size={10} className={active.dir === "asc" ? "-rotate-90" : "rotate-90"} />
            {sorts.length > 1 && <span className="text-[9px] font-semibold">{rank + 1}</span>}
          </>
        )}
      </button>
    </th>
  );
}

export default function LibraryView({
  job,
  live,
  attach,
  clearChapters,
  supportedSites,
}: {
  job: CrawlJobState;
  live: Record<string, LiveCrawl | undefined>;
  attach: (label: string, storyId: string) => () => void;
  clearChapters: () => void;
  supportedSites: SupportedSite[];
}) {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [storyUrl, setStoryUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StoredStory | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sorts, setSorts] = useState<SortState[]>(DEFAULT_SORTS);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [checking, setChecking] = useState(false);
  const checkedOnOpen = useRef(false);

  async function loadStories() {
    try {
      setStories(await fetchStories());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Check TOC for watched stories, max 2 in parallel; update each row when its
  // result arrives, preserve old count and show warning on error.
  async function runChecks(targets: StorySummary[]) {
    if (targets.length === 0) return;
    setChecking(true);
    const queue = [...targets];
    const worker = async () => {
      while (queue.length > 0) {
        const story = queue.shift();
        if (!story) break;
        try {
          const result = await checkStoryUpdates(story.id);
          setStories((current) =>
            current.map((s) => (s.id === story.id ? { ...s, ...result, checkError: undefined } : s))
          );
        } catch (err) {
          const message = (err as Error).message;
          // Story being crawled: server refuses checks — crawl chip replaces it.
          if (/is being crawled/.test(message)) continue;
          setStories((current) =>
            current.map((s) => (s.id === story.id ? { ...s, checkError: message } : s))
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, targets.length) }, worker));
    setChecking(false);
    await loadStories();
  }

  useEffect(() => {
    loadStories().finally(() => setLoading(false));
  }, []);

  // On app open: check watched stories once (no background, no schedule). Crawling
  // stories are skipped — server blocks them too.
  useEffect(() => {
    if (loading || checkedOnOpen.current) return;
    checkedOnOpen.current = true;
    const targets = stories.filter((s) => s.watching && !live[s.id]);
    if (targets.length > 0) void runChecks(targets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, stories, live]);

  // Selected story: StoryDetail refetches when crawl done. Others don't, so we
  // refetch when a story leaves the realtime channel so status chip doesn't stale.
  const crawlingIds = Object.keys(live).filter((id) => live[id]).sort().join(",");
  const prevCrawlingIds = useRef(crawlingIds);
  useEffect(() => {
    const before = prevCrawlingIds.current.split(",").filter(Boolean);
    const after = crawlingIds.split(",").filter(Boolean);
    prevCrawlingIds.current = crawlingIds;
    if (before.some((id) => !after.includes(id))) void loadStories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crawlingIds]);

  async function openStory(id: string) {
    try {
      setSelected(await fetchStory(id));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreate() {
    const url = storyUrl.trim();
    if (!url) {
      setError("Paste a story URL first.");
      return;
    }
    if (!isSupportedUrl(url, supportedSites)) {
      setError(
        `URL is not from a supported site. Supported: ${supportedSites.map((s) => s.domain).join(", ")}.`
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setSelected(await createStory(url));
      setStoryUrl("");
      await loadStories();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteStory(id);
      setConfirmDelete(null);
      if (selected?.id === id) setSelected(null);
      await loadStories();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Toggle watch, then refetch: server clears new chapter + error counts when
  // unwatching, so local state must follow saved version, not guess.
  async function handleWatchToggle(story: StorySummary) {
    try {
      await setStoryWatch(story.id, !story.watching);
      await loadStories();
      if (selected?.id === story.id) {
        try {
          setSelected(await fetchStory(story.id));
        } catch {
          /* loadStories already showed the error */
        }
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Delete multiple stories: call DELETE /stories/:id sequentially — library is
  // just a few dozen rows, not worth adding a batch delete endpoint.
  async function handleBulkDelete(ids: string[]) {
    setBulkBusy(true);
    try {
      for (const id of ids) await deleteStory(id);
      setPicked(new Set());
      setConfirmBulk(false);
      if (selected && ids.includes(selected.id)) setSelected(null);
      await loadStories();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  function togglePicked(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmBulk(false);
  }

  async function handleStoryChanged() {
    await loadStories();
    if (selected) {
      try {
        setSelected(await fetchStory(selected.id));
      } catch {
        /* loadStories already surfaced the failure */
      }
    }
  }

  // Filter, sort, and paginate on client: library is one person's stories (just
  // a few dozen rows), loading once is lighter than adding API params and SQL pagination.
  const rows: StoryRow[] = stories.map((s) => {
    // The selected story may be mid-crawl: its stored summary lags
    // behind the chapters this run has already finished.
    const overlay = selected?.id === s.id ? liveCounts(selected.chapters, job.chapters) : { done: 0, error: 0 };
    const done = s.doneCount + overlay.done;
    const errors = s.errorCount + overlay.error;
    // Crawl status for ALL stories comes from the shared realtime channel, so
    // crawling rows show chips even if not selected.
    const crawling = live[s.id];
    return {
      ...s,
      done,
      errors,
      remaining: s.chapterCount - done - errors,
      crawling,
      status: crawlStatus(s.chapterCount, done, errors, s.newChapterCount, crawling),
    };
  });

  const needle = fold(query.trim());
  const filtered = needle ? rows.filter((r) => fold(`${r.title} ${r.site}`).includes(needle)) : rows;
  const sorted = [...filtered].sort((a, b) => {
    for (const s of sorts) {
      const diff = compareRows(a, b, s.key) * (s.dir === "asc" ? 1 : -1);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Clamp page instead of fixing in effect: when list shrinks (delete, filter),
  // automatically go back to the last valid page.
  const currentPage = Math.min(page, pageCount);
  const visible = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  // Crawling stories can't be deleted, so don't let them be picked; selections
  // persist across pages so you can delete many at once.
  const pickable = visible.filter((r) => !r.crawling);
  const pickedIds = rows.filter((r) => picked.has(r.id) && !r.crawling).map((r) => r.id);
  const allPagePicked = pickable.length > 0 && pickable.every((r) => picked.has(r.id));
  const somePagePicked = pickable.some((r) => picked.has(r.id));

  function toggleSort(key: SortKey, additive: boolean) {
    const firstDir = key === "title" || key === "site" ? "asc" : "desc";
    setSorts((current) => {
      const at = current.findIndex((s) => s.key === key);
      const flipped = (s: SortState): SortState => ({ key: s.key, dir: s.dir === "asc" ? "desc" : "asc" });
      if (!additive) {
        return at === 0 && current.length === 1 ? [flipped(current[0])] : [{ key, dir: firstDir }];
      }
      if (at === -1) return [...current, { key, dir: firstDir }];
      return current.map((s, i) => (i === at ? flipped(s) : s));
    });
    setPage(1);
  }

  return (
    <>
      <section className="pane">
        <div className="pane-head">
          <h2>My Stories</h2>
          <span className="end flex items-center gap-2 text-xs text-ink-2">
            {stories.some((s) => s.watching) && (
              <button
                type="button"
                className="btn btn-tiny btn-quiet"
                disabled={checking}
                onClick={() => runChecks(stories.filter((s) => s.watching && !live[s.id]))}
              >
                <Icon
                  name={checking ? "dot" : "retry"}
                  size={12}
                  className={checking ? "animate-pulse" : undefined}
                />
                {checking ? "Checking..." : "Check for new chapters"}
              </button>
            )}
            <span>
              {stories.length === 0 ? "" : needle ? `${filtered.length}/${stories.length} stories` : `${stories.length} stories`}
            </span>
          </span>
        </div>

        <div className="border-b border-rule p-3">
          <div className="flex gap-2">
            <label className="visually-hidden" htmlFor="story-url">
              Story page URL
            </label>
            <input
              id="story-url"
              type="text"
              className="input"
              placeholder="https://example.com/story-title/"
              value={storyUrl}
              onChange={(e) => setStoryUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleCreate}>
              {busy ? "Loading..." : "Load chapters"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-3">
            Paste a story page URL to load the full chapter list. Auto-loading sites:{" "}
            {[...new Set(supportedSites.map((s) => s.name))].join(", ") || "loading..."}
          </p>
        </div>

        {!loading && stories.length > 0 && (
          <div className="border-b border-rule p-3">
            <label className="visually-hidden" htmlFor="story-search">
              Search stories
            </label>
            <input
              id="story-search"
              type="search"
              className="input"
              placeholder="Search by story name or site..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
        )}

        {pickedIds.length > 0 && (
          <div className="flex items-center gap-2 border-b border-rule px-3 py-2 text-xs text-ink-2">
            <span>Selected {pickedIds.length} stories</span>
            <span className="ml-auto flex gap-1.5">
              {confirmBulk ? (
                <>
                  <button
                    type="button"
                    className="btn btn-tiny btn-danger"
                    disabled={bulkBusy}
                    onClick={() => handleBulkDelete(pickedIds)}
                  >
                    {bulkBusy ? "Deleting..." : `Delete ${pickedIds.length} stories`}
                  </button>
                  <button type="button" className="btn btn-tiny btn-quiet" onClick={() => setConfirmBulk(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-tiny btn-quiet" onClick={() => setConfirmBulk(true)}>
                    <Icon name="trash" size={12} />
                    Delete selected
                  </button>
                  <button type="button" className="btn btn-tiny btn-quiet" onClick={() => setPicked(new Set())}>
                    Deselect
                  </button>
                </>
              )}
            </span>
          </div>
        )}

        {error && (
          <div className="banner m-3">
            <Icon name="alert" size={14} />
            <p className="min-w-0">{error}</p>
          </div>
        )}

        <div className="pane-body">
          {loading ? (
            <div className="flex flex-col gap-3 p-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-3 animate-pulse rounded-[2px] bg-sunken" style={{ width: `${92 - i * 14}%` }} />
              ))}
              <span className="visually-hidden">Loading story list</span>
            </div>
          ) : stories.length === 0 ? (
            <div className="empty">
              <h3>Library is empty</h3>
              <ol>
                <li>Paste a story URL above and click "Load chapters".</li>
                <li>The entire chapter list loads with "Pending" status.</li>
                <li>
                  Click "Crawl" to crawl gradually. Close the tab anytime — progress is saved in the library, reopen to see where you left off.
                </li>
              </ol>
            </div>
          ) : sorted.length === 0 ? (
            <div className=”empty”>
              <h3>No stories match</h3>
              <p>No stories with name or site containing “{query.trim()}”. Try shorter keywords.</p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-9">
                    <input
                      type="checkbox"
                      className="checkbox"
                      aria-label="Select all stories on this page"
                      checked={allPagePicked}
                      ref={(el) => {
                        if (el) el.indeterminate = somePagePicked && !allPagePicked;
                      }}
                      disabled={pickable.length === 0}
                      onChange={() => {
                        setPicked((current) => {
                          const next = new Set(current);
                          for (const row of pickable) {
                            if (allPagePicked) next.delete(row.id);
                            else next.add(row.id);
                          }
                          return next;
                        });
                        setConfirmBulk(false);
                      }}
                    />
                  </th>
                  <SortTh label="Story" sortKey="title" sorts={sorts} onSort={toggleSort} />
                  <SortTh label="Site" sortKey="site" sorts={sorts} onSort={toggleSort} className="w-28" />
                  <SortTh label="Chapters" sortKey="chapterCount" sorts={sorts} onSort={toggleSort} className="num w-20" />
                  <SortTh label="Done" sortKey="done" sorts={sorts} onSort={toggleSort} className="num w-16" />
                  <SortTh label="Errors" sortKey="errors" sorts={sorts} onSort={toggleSort} className="num w-14" />
                  <SortTh label="Status" sortKey="remaining" sorts={sorts} onSort={toggleSort} className="w-40" />
                  <SortTh label="Updated" sortKey="updatedAt" sorts={sorts} onSort={toggleSort} className="w-24" />
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr
                    key={s.id}
                    className={selected?.id === s.id ? "is-selected" : undefined}
                    onClick={() => openStory(s.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="checkbox"
                        aria-label={`Select ${s.title}`}
                        checked={picked.has(s.id)}
                        disabled={!!s.crawling}
                        onChange={() => togglePicked(s.id)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="row-btn"
                        aria-current={selected?.id === s.id ? "true" : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          openStory(s.id);
                        }}
                      >
                        <span className="t" title={s.title}>
                          {s.title}
                        </span>
                      </button>
                    </td>
                    <td className="dim">{s.site}</td>
                    <td className="num">{s.chapterCount}</td>
                    <td className="num">
                      <b>{s.done}</b>
                    </td>
                    <td className={s.errors > 0 ? "num bad" : "num"}>
                      <b>{s.errors}</b>
                    </td>
                    <td>
                      <StatusChip state={s.status.state} label={s.status.label} />
                      {s.checkError && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-error" title={s.checkError}>
                          <Icon name="alert" size={11} />
                          Check error
                        </span>
                      )}
                    </td>
                    <td className="dim">{timeAgo(s.updatedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {confirmDelete === s.id ? (
                        <span className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn btn-tiny btn-danger"
                            onClick={() => handleDelete(s.id)}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="btn btn-tiny btn-quiet"
                            onClick={() => setConfirmDelete(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-quiet btn-tiny"
                            title={s.watching ? "Stop watching for new chapters" : "Watch for new chapters"}
                            aria-label={s.watching ? `Stop watching ${s.title}` : `Watch ${s.title}`}
                            aria-pressed={s.watching}
                            onClick={() => handleWatchToggle(s)}
                          >
                            <Icon name="bell" size={13} className={s.watching ? "text-select" : undefined} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet btn-tiny"
                            title={s.crawling ? "Crawling, cannot delete" : "Delete story from library"}
                            aria-label={`Delete ${s.title}`}
                            disabled={!!s.crawling}
                            onClick={() => setConfirmDelete(s.id)}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {pageCount > 1 && (
          <div className="flex items-center gap-2 border-t border-rule px-3 py-2 text-xs text-ink-2">
            <span>
              Page {currentPage}/{pageCount}
            </span>
            <span className="ml-auto flex gap-1.5">
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </span>
          </div>
        )}
      </section>

      {selected ? (
        <StoryDetail
          key={selected.id}
          story={selected}
          job={job}
          attach={attach}
          clearChapters={clearChapters}
          onStoryChanged={handleStoryChanged}
          onClear={() => setSelected(null)}
        />
      ) : (
        <section className="pane">
          <div className="pane-head">
            <h2 className="ml-auto">Story Details</h2>
          </div>
          <div className="empty">
            <h3>No story selected</h3>
            <p>
              The table on the left lists saved stories with progress. Select a story to view its chapters, continue crawling, edit content, and export to EPUB.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
