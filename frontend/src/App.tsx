import { useEffect, useState } from "react";
import LibraryView from "./components/LibraryView";
import ManualCrawlView from "./components/ManualCrawlView";
import { JobStrip } from "./components/JobStrip";
import { Icon, IconName } from "./components/Icon";
import { fetchSupportedSites } from "./api";
import { SupportedSite } from "./types";
import { useCrawlJob } from "./useCrawlJob";

type Theme = "system" | "light" | "dark";

const THEME_KEY = "theme";
// Bấm một nút để xoay vòng: tự động -> sáng -> tối -> tự động.
const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
const THEME_LABEL: Record<Theme, string> = { system: "Tự động", light: "Sáng", dark: "Tối" };
const THEME_ICON: Record<Theme, IconName> = { system: "display", light: "sun", dark: "moon" };

// localStorage có thể ném lỗi (cửa sổ riêng tư, chặn cookie): vẫn đổi được
// giao diện, chỉ là không nhớ cho lần mở sau.
function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme): void {
  const dark = theme === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export default function App() {
  const [supportedSites, setSupportedSites] = useState<SupportedSite[]>([]);
  const [tab, setTab] = useState<"library" | "manual">("library");
  const [theme, setTheme] = useState<Theme>(readTheme);
  const { job, live, run, attach, subscribe, clearChapters } = useCrawlJob();
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];

  useEffect(() => {
    fetchSupportedSites().then(setSupportedSites).catch(() => setSupportedSites([]));
  }, []);

  // Kênh realtime chung: mở một lần cho cả app, đóng khi unmount.
  useEffect(() => subscribe(), [subscribe]);

  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* không lưu được thì thôi, giao diện vẫn đổi cho phiên này */
    }
    if (theme !== "system") return;
    // Đang để tự động: đổi ngay khi hệ điều hành chuyển sáng/tối.
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme("system");
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

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
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            title={`Giao diện: ${THEME_LABEL[theme]}${theme === "system" ? " (theo hệ điều hành)" : ""} — bấm để chuyển sang ${THEME_LABEL[nextTheme]}`}
            aria-label={`Giao diện: ${THEME_LABEL[theme]}. Bấm để chuyển sang ${THEME_LABEL[nextTheme]}`}
            onClick={() => setTheme(nextTheme)}
          >
            <Icon name={THEME_ICON[theme]} size={14} />
          </button>

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
