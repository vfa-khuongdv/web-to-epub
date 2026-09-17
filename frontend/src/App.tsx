import { useEffect, useState } from "react";
import LibraryView from "./components/LibraryView";
import ManualCrawlView from "./components/ManualCrawlView";
import { fetchSupportedSites } from "./api";
import { SupportedSite } from "./types";

export default function App() {
  const [supportedSites, setSupportedSites] = useState<SupportedSite[]>([]);
  const [tab, setTab] = useState<"manual" | "library">("manual");

  useEffect(() => {
    fetchSupportedSites().then(setSupportedSites).catch(() => setSupportedSites([]));
  }, []);

  return (
    <>
      <header>
        <h1>Web → EPUB cho Kindle</h1>
        <p className="subtitle">
          Trích xuất nội dung đang hiển thị trên trang web (kể cả trang chặn copy) và xuất thành EPUB.
        </p>
      </header>
      <main>
        <nav className="tabs">
          <button className={tab === "manual" ? "active" : ""} onClick={() => setTab("manual")}>
            Crawl thủ công
          </button>
          <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>
            Truyện của tôi
          </button>
        </nav>
        {tab === "manual" ? (
          <ManualCrawlView supportedSites={supportedSites} />
        ) : (
          <LibraryView supportedSites={supportedSites} />
        )}
      </main>
    </>
  );
}
