import { useEffect, useState } from "react";
import { createStory, deleteStory, fetchStories, fetchStory } from "../api";
import { StoredStory, StorySummary, SupportedSite } from "../types";
import { isSupportedUrl } from "../isSupportedUrl";
import StoryDetail from "./StoryDetail";

export default function LibraryView({ supportedSites }: { supportedSites: SupportedSite[] }) {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [storyUrl, setStoryUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<StoredStory | null>(null);

  async function loadStories() {
    try {
      setStories(await fetchStories());
    } catch (err) {
      alert((err as Error).message);
    }
  }

  useEffect(() => {
    loadStories();
  }, []);

  async function handleCreate() {
    const url = storyUrl.trim();
    if (!url) {
      alert("Vui lòng nhập URL truyện.");
      return;
    }
    if (!isSupportedUrl(url, supportedSites)) {
      alert("URL không thuộc trang được hỗ trợ.");
      return;
    }
    setBusy(true);
    try {
      setSelected(await createStory(url));
      setStoryUrl("");
      await loadStories();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Xoá truyện này khỏi danh sách? Toàn bộ nội dung đã crawl của truyện sẽ bị xoá.")) return;
    try {
      await deleteStory(id);
      await loadStories();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleStoryChanged() {
    await loadStories();
    if (selected) {
      try {
        setSelected(await fetchStory(selected.id));
      } catch {
        /* danh sách đã báo lỗi nếu có */
      }
    }
  }

  if (selected) {
    return (
      <StoryDetail
        story={selected}
        onBack={() => setSelected(null)}
        onStoryChanged={handleStoryChanged}
      />
    );
  }

  return (
    <section className="card">
      <h2>Truyện của tôi</h2>
      <p className="hint">Dán URL trang truyện (ví dụ https://truyenfull.live/dau-xuan-tuoi-sang/) để load toàn bộ danh sách chương.</p>
      <div className="story-add">
        <input
          type="text"
          placeholder="https://truyenfull.live/ten-truyen/"
          value={storyUrl}
          onChange={(e) => setStoryUrl(e.target.value)}
        />
        <button disabled={busy} onClick={handleCreate}>
          {busy ? "Đang tải danh sách chương..." : "Tải danh sách chương"}
        </button>
      </div>

      {stories.length === 0 ? (
        <p className="hint">Chưa có truyện nào.</p>
      ) : (
        <ul className="story-list">
          {stories.map((s) => {
            const pct = s.chapterCount > 0 ? (s.doneCount / s.chapterCount) * 100 : 0;
            return (
              <li key={s.id} className="story-item">
                <div className="story-item-main" onClick={() => fetchDetail(s.id)}>
                  <strong>{s.title}</strong>
                  <span className="story-site">{s.site}</span>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="story-progress">
                    {s.doneCount}/{s.chapterCount} chương{s.errorCount > 0 ? `, ${s.errorCount} lỗi` : ""}
                  </span>
                </div>
                <button type="button" className="btn-delete" onClick={() => handleDelete(s.id)}>
                  Xoá
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  async function fetchDetail(id: string) {
    try {
      setSelected(await fetchStory(id));
    } catch (err) {
      alert((err as Error).message);
    }
  }
}
