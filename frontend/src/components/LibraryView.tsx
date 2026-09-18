import { useEffect, useRef, useState } from "react";
import { checkStoryUpdates, createStory, deleteStory, fetchStories, fetchStory, setStoryWatch } from "../api";
import { isSupportedUrl } from "../isSupportedUrl";
import { timeAgo } from "../timeAgo";
import { StoredStory, StorySummary, SupportedSite } from "../types";
import { CrawlJobState, LiveCrawl, liveCounts } from "../useCrawlJob";
import { Icon } from "./Icon";
import { ChipState, StatusChip } from "./StatusChip";
import StoryDetail from "./StoryDetail";

// Trạng thái crawl của cả truyện, gộp số đã lưu với crawl đang chạy: còn
// chương chờ thì báo còn bao nhiêu, hết chương chờ là crawl xong (kèm số lỗi
// nếu có) — để nhìn danh sách là biết truyện nào đã crawl đủ. Truyện theo dõi
// có chương mới được ưu tiên báo trước phần còn lại vì cần người dùng bấm.
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
      label: crawling.total > 0 ? `Đang crawl ${crawling.cursor}/${crawling.total}` : "Đang crawl",
    };
  }
  if (newChapterCount > 0) {
    return { state: "new", label: `${newChapterCount} chương mới` };
  }
  const remaining = total - done - errors;
  if (remaining > 0) return { state: "pending", label: `Còn ${remaining} chương` };
  if (errors > 0) return { state: "error", label: `Xong · ${errors} lỗi` };
  return { state: "done", label: "Đã crawl xong" };
}

const PAGE_SIZE = 10;

type SortKey = "title" | "site" | "chapterCount" | "done" | "errors" | "remaining" | "updatedAt";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

// Sort nhiều cấp: phần tử đầu là tiêu chí chính, các phần tử sau chỉ dùng để
// gỡ hoà. Shift-click thêm cột phụ, click thường thay toàn bộ bằng một cột.
const DEFAULT_SORTS: SortState[] = [{ key: "updatedAt", dir: "desc" }];

// Một dòng trong bảng: số liệu đã lưu cộng phần crawl đang chạy, tính sẵn để
// lọc/sắp xếp làm việc trên cùng con số mà người dùng nhìn thấy.
interface StoryRow extends StorySummary {
  done: number;
  errors: number;
  remaining: number;
  crawling?: LiveCrawl;
  status: { state: ChipState; label: string };
}

// Bỏ dấu để gõ "dau xuan" vẫn tìm ra "Đấu Xuân".
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
      // ISO nên so chuỗi là so thời gian.
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
        title={`Sắp xếp theo ${label} — giữ Shift để thêm tiêu chí phụ`}
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

  // Kiểm tra TOC các truyện đang theo dõi, tối đa 2 truyện song song; kết quả
  // nào về thì cập nhật dòng đó ngay, lỗi giữ số cũ và hiện cảnh báo.
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
          // Truyện đang crawl thì server từ chối kiểm tra — chip crawl đã thay thế.
          if (/đang được crawl/.test(message)) continue;
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

  // Mở app: kiểm tra một lần cho các truyện đang theo dõi (không chạy nền,
  // không hẹn giờ). Truyện đang crawl bị bỏ qua — server cũng chặn.
  useEffect(() => {
    if (loading || checkedOnOpen.current) return;
    checkedOnOpen.current = true;
    const targets = stories.filter((s) => s.watching && !live[s.id]);
    if (targets.length > 0) void runChecks(targets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, stories, live]);

  // Truyện đang chọn đã có StoryDetail tải lại khi crawl xong; truyện khác thì
  // không, nên tự tải lại khi một truyện rời kênh realtime để chip trạng thái
  // không kẹt ở số liệu cũ.
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
      setError("Dán URL trang truyện trước đã.");
      return;
    }
    if (!isSupportedUrl(url, supportedSites)) {
      setError(
        `URL không thuộc trang được hỗ trợ. Chỉ nhận: ${supportedSites.map((s) => s.domain).join(", ")}.`
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

  // Bật/tắt theo dõi rồi tải lại danh sách: server xoá số chương mới + lỗi khi
  // tắt, nên state cục bộ phải theo bản đã lưu chứ không tự đoán.
  async function handleWatchToggle(story: StorySummary) {
    try {
      await setStoryWatch(story.id, !story.watching);
      await loadStories();
      if (selected?.id === story.id) {
        try {
          setSelected(await fetchStory(story.id));
        } catch {
          /* loadStories đã hiện lỗi */
        }
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Xoá nhiều truyện: gọi lần lượt DELETE /stories/:id — thư viện chỉ vài chục
  // dòng nên không đáng thêm endpoint xoá hàng loạt ở backend.
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

  // Lọc, sắp xếp và phân trang ngay ở client: thư viện là danh sách truyện của
  // một người nên chỉ vài chục dòng, tải hết một lần vẫn nhẹ hơn thêm tham số
  // cho API và phân trang ở SQL.
  const rows: StoryRow[] = stories.map((s) => {
    // The selected story may be mid-crawl: its stored summary lags
    // behind the chapters this run has already finished.
    const overlay = selected?.id === s.id ? liveCounts(selected.chapters, job.chapters) : { done: 0, error: 0 };
    const done = s.doneCount + overlay.done;
    const errors = s.errorCount + overlay.error;
    // Trạng thái crawl của MỌI truyện đến từ kênh realtime chung, nên dòng
    // đang crawl có chip dù chưa được chọn.
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
  // Kẹp trang thay vì sửa state trong effect: danh sách ngắn đi (xoá truyện,
  // lọc) thì tự lùi về trang cuối còn hợp lệ.
  const currentPage = Math.min(page, pageCount);
  const visible = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  // Truyện đang crawl không xoá được nên cũng không cho chọn; chọn được giữ qua
  // các trang để xoá một lượt.
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
          <h2>Truyện của tôi</h2>
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
                {checking ? "Đang kiểm tra…" : "Kiểm tra chương mới"}
              </button>
            )}
            <span>
              {stories.length === 0 ? "" : needle ? `${filtered.length}/${stories.length} truyện` : `${stories.length} truyện`}
            </span>
          </span>
        </div>

        <div className="border-b border-rule p-3">
          <div className="flex gap-2">
            <label className="visually-hidden" htmlFor="story-url">
              URL trang truyện
            </label>
            <input
              id="story-url"
              type="text"
              className="input"
              placeholder="https://truyenfull.live/ten-truyen/"
              value={storyUrl}
              onChange={(e) => setStoryUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleCreate}>
              {busy ? "Đang tải…" : "Tải danh sách chương"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-3">
            Dán URL trang truyện để nạp toàn bộ mục lục — ví dụ truyenfull.live/dau-xuan-tuoi-sang/ hoặc
            wattpad.com/story/44634431-pumpkin-patch-princess. Tự động load được:{" "}
            {[...new Set(supportedSites.map((s) => s.name))].join(", ") || "đang tải…"}
          </p>
        </div>

        {!loading && stories.length > 0 && (
          <div className="border-b border-rule p-3">
            <label className="visually-hidden" htmlFor="story-search">
              Tìm truyện
            </label>
            <input
              id="story-search"
              type="search"
              className="input"
              placeholder="Tìm theo tên truyện hoặc site…"
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
            <span>Đã chọn {pickedIds.length} truyện</span>
            <span className="ml-auto flex gap-1.5">
              {confirmBulk ? (
                <>
                  <button
                    type="button"
                    className="btn btn-tiny btn-danger"
                    disabled={bulkBusy}
                    onClick={() => handleBulkDelete(pickedIds)}
                  >
                    {bulkBusy ? "Đang xoá…" : `Xoá ${pickedIds.length} truyện`}
                  </button>
                  <button type="button" className="btn btn-tiny btn-quiet" onClick={() => setConfirmBulk(false)}>
                    Huỷ
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-tiny btn-quiet" onClick={() => setConfirmBulk(true)}>
                    <Icon name="trash" size={12} />
                    Xoá đã chọn
                  </button>
                  <button type="button" className="btn btn-tiny btn-quiet" onClick={() => setPicked(new Set())}>
                    Bỏ chọn
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
              <span className="visually-hidden">Đang tải danh sách truyện</span>
            </div>
          ) : stories.length === 0 ? (
            <div className="empty">
              <h3>Thư viện đang trống</h3>
              <ol>
                <li>Dán URL trang truyện vào ô trên rồi bấm Tải danh sách chương.</li>
                <li>Toàn bộ mục lục được nạp về với trạng thái Chờ crawl.</li>
                <li>
                  Bấm Crawl tiếp để crawl dần. Đóng tab lúc nào cũng được — tiến độ nằm trong thư viện, mở lại là
                  thấy đang ở đâu.
                </li>
              </ol>
            </div>
          ) : sorted.length === 0 ? (
            <div className="empty">
              <h3>Không có truyện nào khớp</h3>
              <p>Không tìm thấy truyện nào có tên hoặc site chứa “{query.trim()}”. Thử từ khoá ngắn hơn.</p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-9">
                    <input
                      type="checkbox"
                      className="checkbox"
                      aria-label="Chọn tất cả truyện trong trang"
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
                  <SortTh label="Truyện" sortKey="title" sorts={sorts} onSort={toggleSort} />
                  <SortTh label="Site" sortKey="site" sorts={sorts} onSort={toggleSort} className="w-28" />
                  <SortTh label="Chương" sortKey="chapterCount" sorts={sorts} onSort={toggleSort} className="num w-20" />
                  <SortTh label="Xong" sortKey="done" sorts={sorts} onSort={toggleSort} className="num w-16" />
                  <SortTh label="Lỗi" sortKey="errors" sorts={sorts} onSort={toggleSort} className="num w-14" />
                  <SortTh label="Trạng thái" sortKey="remaining" sorts={sorts} onSort={toggleSort} className="w-40" />
                  <SortTh label="Cập nhật" sortKey="updatedAt" sorts={sorts} onSort={toggleSort} className="w-24" />
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
                        aria-label={`Chọn ${s.title}`}
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
                          Lỗi kiểm tra
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
                            Xoá
                          </button>
                          <button
                            type="button"
                            className="btn btn-tiny btn-quiet"
                            onClick={() => setConfirmDelete(null)}
                          >
                            Huỷ
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-quiet btn-tiny"
                            title={s.watching ? "Bỏ theo dõi chương mới" : "Theo dõi chương mới"}
                            aria-label={s.watching ? `Bỏ theo dõi ${s.title}` : `Theo dõi ${s.title}`}
                            aria-pressed={s.watching}
                            onClick={() => handleWatchToggle(s)}
                          >
                            <Icon name="bell" size={13} className={s.watching ? "text-select" : undefined} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet btn-tiny"
                            title={s.crawling ? "Đang crawl, chưa xoá được" : "Xoá truyện khỏi thư viện"}
                            aria-label={`Xoá ${s.title}`}
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
              Trang {currentPage}/{pageCount}
            </span>
            <span className="ml-auto flex gap-1.5">
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Trước
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Sau
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
            <h2 className="ml-auto">Chi tiết truyện</h2>
          </div>
          <div className="empty">
            <h3>Chưa chọn truyện nào</h3>
            <p>
              Bảng bên trái liệt kê các truyện đã lưu kèm tiến độ. Chọn một truyện để xem danh sách chương, crawl
              tiếp, sửa nội dung và xuất EPUB.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
