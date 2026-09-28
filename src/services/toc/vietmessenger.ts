import { JSDOM } from "jsdom";
import { fetchText } from "./http";
import { TocAdapter, TocChapter, TocResult } from "./types";
import { t } from "../lang";

export const VIETMESSENGER_DOMAINS = ["vietmessenger.com"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// This archive is slow under load — a real story page took 38s to answer — so the
// shared 15s fetch timeout would fail on requests the site does serve.
const REQUEST_TIMEOUT_MS = 60_000;

// Story pages are /books/?title=<name>; chapters are the same URL plus &page=<n>.
// The name is the whole identity of a book (there is no numeric id), so it must
// survive normalization; a chapter URL normalizes to its story URL.
export function normalizeVietmessengerStoryUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!/^(www\.)?vietmessenger\.com$/i.test(parsed.hostname) || parsed.pathname.replace(/\/+$/, "") !== "/books") {
    return url;
  }
  const title = parsed.searchParams.get("title")?.trim();
  if (!title) return url;
  return `https://vietmessenger.com/books/?${new URLSearchParams({ title })}`;
}

export function parseStoryPage(html: string, pageUrl: string): TocResult {
  const doc = new JSDOM(html).window.document;
  const title =
    doc.querySelector("h1.t3")?.textContent?.replace(/\s+/g, " ").trim() ||
    doc.title.split(" - ")[0]?.trim() ||
    "Untitled";
  const author =
    doc
      .querySelector('.book-title a.title[href^="/books/?author="]')
      ?.textContent?.replace(/\s+/g, " ")
      .trim() || undefined;

  // The cover <img> points at "?cat=…&imh=<file>", a script URL that answers 500 on
  // direct fetch; the file itself is static under /books/covers/<file>.
  let coverUrl: string | undefined;
  const coverRaw = doc.querySelector<HTMLImageElement>("#book-content img.cover")?.getAttribute("src");
  if (coverRaw) {
    try {
      const resolved = new URL(coverRaw, pageUrl);
      const imh = resolved.searchParams.get("imh");
      coverUrl = imh ? new URL(`/books/covers/${imh}`, pageUrl).toString() : resolved.toString();
    } catch {
      coverUrl = undefined;
    }
  }

  // The list renders on every page and marks the page being viewed with <b> instead
  // of a link; that entry's URL is the page itself. Page 1's own URL carries no
  // &page=1 (the site's own convention), so drop it if a normalized URL has it.
  const currentUrl = new URL(pageUrl);
  if (currentUrl.searchParams.get("page") === "1") currentUrl.searchParams.delete("page");
  currentUrl.hash = "";

  const chapters: TocChapter[] = [];
  doc.querySelectorAll<HTMLLIElement>("#ml ul li").forEach((li) => {
    const href = li.querySelector<HTMLAnchorElement>("a")?.getAttribute("href");
    let url: string | undefined;
    if (href) {
      try {
        url = new URL(href, pageUrl).toString();
      } catch {
        return;
      }
    } else if (li.querySelector("b")) {
      url = currentUrl.toString();
    }
    if (!url) return;
    const text = li.textContent?.replace(/\s+/g, " ").trim();
    chapters.push({ url, title: text || url });
  });

  // A part heading ("II. NƯỚC Ý") is another <li> that links to the same page as the
  // chapter opening that part; the page's own content already carries the part name
  // (as an <h2>), so keep only the chapter entry — otherwise that page would be
  // fetched twice and both chapters would hold the same text.
  const deduped = chapters.filter((chapter, i) => i === chapters.length - 1 || chapter.url !== chapters[i + 1].url);

  if (deduped.length === 0) {
    // Members-only books replace the whole book page with a sign-in form. The app never
    // signs in, so say that plainly instead of "no chapter list" (which reads like a bad URL).
    if (doc.querySelector("#member-login")) {
      throw new Error(
        t("This book is members-only on Viet Messenger — it needs a member account, which this app cannot sign in to: {url}", {
          url: pageUrl,
        })
      );
    }
    throw new Error(t("No chapter list found at {url} — check the story URL again", { url: pageUrl }));
  }

  return { title, author, coverUrl, chapters: deduped };
}

// The site's other sections (comics) use the same ?title=&page= query shape, so only
// /books/ pages are accepted — otherwise a comics URL would parse as a book by accident.
function bookPageTitle(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/^(www\.)?vietmessenger\.com$/i.test(parsed.hostname)) return undefined;
    if (parsed.pathname.replace(/\/+$/, "") !== "/books") return undefined;
    return parsed.searchParams.get("title")?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  if (!bookPageTitle(storyUrl)) {
    throw new Error(
      t("This is not a Viet Messenger book page: {url} — paste a URL like https://vietmessenger.com/books/?title=<name>", {
        url: storyUrl,
      })
    );
  }
  return parseStoryPage(
    await fetchText(storyUrl, { headers: { "User-Agent": USER_AGENT } }, { timeoutMs: REQUEST_TIMEOUT_MS }),
    storyUrl
  );
}

export const vietmessengerAdapter: TocAdapter = {
  domains: VIETMESSENGER_DOMAINS,
  fetchToc,
  normalizeStoryUrl: normalizeVietmessengerStoryUrl,
};
