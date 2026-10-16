import type { SiteModule } from "../types";
import { fetchTruyendecuChapter } from "./chapter";
import { truyendecuAdapter } from "./toc";

export const truyendecu: SiteModule = {
  id: "truyendecu",
  supported: [{ domain: "truyendecu.store", name: "Truyện Đề Cử" }],
  toc: truyendecuAdapter,
  chapter: { domains: ["truyendecu.store"], fetchChapter: fetchTruyendecuChapter },
};
