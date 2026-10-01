import type { SiteModule } from "../types";
import { xtruyenAdapter } from "./toc";

// No chapter fetcher: chapters go through the shared renderer + extractor.
export const xtruyen: SiteModule = {
  id: "xtruyen",
  supported: [{ domain: "xtruyen.vn", name: "XTruyện" }],
  toc: xtruyenAdapter,
};
