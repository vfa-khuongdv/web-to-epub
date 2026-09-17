import { useEffect, useState } from "react";
import ManualCrawlView from "./components/ManualCrawlView";
import { fetchSupportedSites } from "./api";
import { SupportedSite } from "./types";

export default function App() {
  const [supportedSites, setSupportedSites] = useState<SupportedSite[]>([]);

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
        <ManualCrawlView supportedSites={supportedSites} />
      </main>
    </>
  );
}
