import { useEffect, useState } from "react";
import LibraryView from "./components/LibraryView";
import ManualCrawlView from "./components/ManualCrawlView";
import { JobStrip } from "./components/JobStrip";
import { Icon } from "./components/Icon";
import { fetchSupportedSites } from "./api";
import { SupportedSite } from "./types";
import { useCrawlJob } from "./useCrawlJob";

export default function App() {
  const [supportedSites, setSupportedSites] = useState<SupportedSite[]>([]);
  const [tab, setTab] = useState<"library" | "manual">("library");
  const { job, live, run, attach, subscribe, clearChapters } = useCrawlJob();

  useEffect(() => {
    fetchSupportedSites().then(setSupportedSites).catch(() => setSupportedSites([]));
  }, []);

  // Kênh realtime chung: mở một lần cho cả app, đóng khi unmount.
  useEffect(() => subscribe(), [subscribe]);

  return (
    <div className="app">
      <header className="cmdbar">
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-sm font-semibold tracking-[-0.01em]">Web → EPUB</span>
          <small className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-2">cho Kindle</small>
        </span>

        <nav className="tabs" role="tablist" aria-label="Khu vực làm việc">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "library"}
            onClick={() => setTab("library")}
          >
            <Icon name="library" size={14} />
            Truyện của tôi
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "manual"}
            onClick={() => setTab("manual")}
          >
            <Icon name="crawl" size={14} />
            Crawl thủ công
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-3 text-xs text-ink-2">
          {job.running ? (
            <span className="chip chip-running">
              <Icon name="dot" size={12} className="animate-pulse" />
              {job.total > 0 ? `Đang crawl ${job.cursor}/${job.total}` : "Đang crawl"}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Icon name="info" size={13} className="text-ink-3" />
              {supportedSites.length > 0 ? `${supportedSites.length} trang hỗ trợ` : "Đang tải danh sách trang hỗ trợ…"}
            </span>
          )}
        </div>
      </header>

      <div className="workbench">
        {tab === "library" ? (
          <LibraryView job={job} live={live} attach={attach} clearChapters={clearChapters} supportedSites={supportedSites} />
        ) : (
          <ManualCrawlView run={run} job={job} clearChapters={clearChapters} supportedSites={supportedSites} />
        )}
      </div>

      <JobStrip job={job} />
    </div>
  );
}
