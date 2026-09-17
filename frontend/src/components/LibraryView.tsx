import { useEffect, useState } from "react";
import { createStory, deleteStory, fetchStories, fetchStory } from "../api";
import { isSupportedUrl } from "../isSupportedUrl";
import { StoredStory, StorySummary, SupportedSite } from "../types";
import { RunCrawl } from "../useCrawlJob";
import { Icon } from "./Icon";
import StoryDetail from "./StoryDetail";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(then).toLocaleDateString("vi-VN");
}

export default function LibraryView({
  run,
  running,
  supportedSites,
}: {
  run: RunCrawl;
  running: boolean;
  supportedSites: SupportedSite[];
}) {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [storyUrl, setStoryUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StoredStory | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStories() {
    try {
      setStories(await fetchStories());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    loadStories().finally(() => setLoading(false));
  }, []);

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

  return (
    <>
      <section className="pane">
        <div className="pane-head">
          <h2>Truyện của tôi</h2>
          <span className="end text-xs text-ink-2">
            {stories.length > 0 ? `${stories.length} truyện` : ""}
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
            Dán URL trang truyện để nạp toàn bộ mục lục. Tự động load được:{" "}
            {[...new Set(supportedSites.map((s) => s.name))].join(", ") || "đang tải…"}
          </p>
        </div>

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
              <p>
                Với metruyenchu.com (chưa có mục lục tự động), dán URL từng chương ở tab Crawl thủ công.
              </p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Truyện</th>
                  <th className="w-28"> Site </th>
                  <th className="num w-20">Chương</th>
                  <th className="num w-14">Xong</th>
                  <th className="num w-14">Lỗi</th>
                  <th className="w-24">Cập nhật</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {stories.map((s) => (
                  <tr
                    key={s.id}
                    className={selected?.id === s.id ? "is-selected" : undefined}
                    onClick={() => openStory(s.id)}
                  >
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
                      <b>{s.doneCount}</b>
                    </td>
                    <td className={s.errorCount > 0 ? "num bad" : "num"}>
                      <b>{s.errorCount}</b>
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
                        <button
                          type="button"
                          className="btn btn-quiet btn-tiny"
                          title="Xoá truyện khỏi thư viện"
                          aria-label={`Xoá ${s.title}`}
                          onClick={() => setConfirmDelete(s.id)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {selected ? (
        <StoryDetail
          key={selected.id}
          story={selected}
          run={run}
          running={running}
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
