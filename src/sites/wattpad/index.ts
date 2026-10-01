import type { SiteModule } from "../types";
import { fetchWattpadChapter } from "./chapter";
import { WATTPAD_DOMAINS, wattpadAdapter } from "./toc";

export const wattpad: SiteModule = {
  id: "wattpad",
  supported: [{ domain: "wattpad.com", name: "Wattpad" }], // English site; paid chapters (Paid Stories) not supported
  toc: wattpadAdapter,
  chapter: { domains: WATTPAD_DOMAINS, fetchChapter: fetchWattpadChapter },
};
