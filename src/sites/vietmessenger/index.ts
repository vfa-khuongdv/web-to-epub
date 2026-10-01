import type { SiteModule } from "../types";
import { fetchVietmessengerChapter } from "./chapter";
import { VIETMESSENGER_DOMAINS, vietmessengerAdapter } from "./toc";

// Its chapter pages ship no text: the site's script POSTs to gethtml.php for it
// (AES-obfuscated), which the fetcher does directly. Books the site marks members-only
// are refused with a clear error — the app never signs in.
export const vietmessenger: SiteModule = {
  id: "vietmessenger",
  supported: [{ domain: "vietmessenger.com", name: "Viet Messenger" }], // public-domain ebook library
  toc: vietmessengerAdapter,
  chapter: { domains: VIETMESSENGER_DOMAINS, fetchChapter: fetchVietmessengerChapter },
};
