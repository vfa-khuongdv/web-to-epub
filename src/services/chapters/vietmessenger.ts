import { createDecipheriv, createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { ContentBlock, ExtractedChapter } from "../../types";
import { walkToBlocks } from "../extractor";
import { t } from "../lang";
import { fetchText } from "../toc/http";

export const VIETMESSENGER_DOMAINS = ["vietmessenger.com"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// This archive is slow under load — a real story page took 38s to answer — so the
// shared 15s fetch timeout would fail on requests the site does serve.
const REQUEST_TIMEOUT_MS = 60_000;

// The passphrase and payload format come from the site's own books.js: the chapter page
// ships no text, its script POSTs to gethtml.php and decrypts the answer before showing
// it. This is obfuscation of free, public content — no account or paywall involved.
const AES_PASSPHRASE = "VXJ6dj^@L";
const GETHTML_URL = "https://vietmessenger.com/books/gethtml.php";

// gethtml.php needs the book's category (`cat` on #book-page) and its internal name
// (`source`, e.g. "batuocmontecristo" for the URL title "ba tuoc monte cristo"); chapter
// URLs carry neither, so the story page is loaded once per story per process.
const bookRefByTitle = new Map<string, { cat: string; source: string }>();

// The response is HTML-entity-encoded because the site's script puts it through the DOM
// before decrypting. Only these entities appear in a payload of base64/hex strings.
function decodeEntities(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// CryptoJS derives key and IV from the passphrase with OpenSSL's EVP_BytesToKey (MD5).
function evpBytesToKey(passphrase: string, salt: Buffer): { key: Buffer; iv: Buffer } {
  const pass = Buffer.from(passphrase, "utf8");
  let derived = Buffer.alloc(0);
  let previous = Buffer.alloc(0);
  while (derived.length < 48) {
    previous = createHash("md5").update(Buffer.concat([previous, pass, salt])).digest();
    derived = Buffer.concat([derived, previous]);
  }
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

export function decodeChapterHtml(raw: string, url: string): string {
  const fail = () =>
    new Error(
      t("Viet Messenger did not return chapter content — the chapter may have been removed or the site changed ({url})", {
        url,
      })
    );

  let envelope: { ct?: unknown; s?: unknown };
  try {
    envelope = JSON.parse(decodeEntities(raw)) as { ct?: unknown; s?: unknown };
  } catch {
    throw fail();
  }
  if (typeof envelope.ct !== "string" || typeof envelope.s !== "string") throw fail();

  try {
    const { key, iv } = evpBytesToKey(AES_PASSPHRASE, Buffer.from(envelope.s, "hex"));
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.ct, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const html: unknown = JSON.parse(plain);
    if (typeof html !== "string") throw fail();
    return html;
  } catch {
    throw fail();
  }
}

export function parseChapterHtml(html: string, url: string): ExtractedChapter {
  const doc = new JSDOM(html).window.document;

  // The page ends with a bare "----" text node (no element) separating the story from its
  // footnotes, and the footnotes themselves are a two-column table. walkToBlocks reads
  // only elements and never joins a row's cells, so normalize both into paragraphs:
  // without this the separator vanishes and each footnote number lands on its own line.
  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === 3 && node.textContent?.trim()) {
      const paragraph = doc.createElement("p");
      paragraph.textContent = node.textContent.trim();
      node.replaceWith(paragraph);
    }
  }
  doc.querySelectorAll("table").forEach((table) => {
    const rows = Array.from(table.querySelectorAll("tr")).map((row) => {
      const paragraph = doc.createElement("p");
      paragraph.innerHTML = Array.from(row.querySelectorAll("td, th"))
        .map((cell) => cell.innerHTML.trim())
        .filter(Boolean)
        .join(" ");
      return paragraph;
    });
    table.replaceWith(...rows);
  });

  // The chapter's own heading is the one carrying the <a name="n"> anchor; page 1 also
  // holds front matter under its own headings, so "first heading" would name the wrong thing.
  const title =
    doc.querySelector("h3 a[name]")?.closest("h3")?.textContent?.replace(/\s+/g, " ").trim() ||
    doc.querySelector("h3")?.textContent?.replace(/\s+/g, " ").trim() ||
    url;

  const blocks: ContentBlock[] = [];
  walkToBlocks(doc.body, blocks);
  // The chapter heading is part of the content HTML; the stored/exported chapter already
  // has this title, so keep only the headings that are actual content (front matter etc.).
  const headingIndex = blocks.findIndex((b) => b.type === "heading" && b.text === title);
  if (headingIndex >= 0) blocks.splice(headingIndex, 1);

  return { sourceUrl: url, title, blocks };
}

async function loadBookRef(title: string, url: string): Promise<{ cat: string; source: string }> {
  const cached = bookRefByTitle.get(title);
  if (cached) return cached;

  const storyUrl = `https://vietmessenger.com/books/?${new URLSearchParams({ title })}`;
  const doc = new JSDOM(
    await fetchText(storyUrl, { headers: { "User-Agent": USER_AGENT } }, { timeoutMs: REQUEST_TIMEOUT_MS })
  ).window.document;
  const bookPage = doc.querySelector<HTMLElement>("#book-page");
  const cat = bookPage?.getAttribute("cat")?.trim();
  if (!cat) {
    if (doc.querySelector("#member-login")) {
      throw new Error(
        t("This book is members-only on Viet Messenger — it needs a member account, which this app cannot sign in to: {url}", {
          url: storyUrl,
        })
      );
    }
    throw new Error(t("Could not find the book's category on the Viet Messenger page ({url})", { url: storyUrl }));
  }
  const ref = { cat, source: bookPage?.getAttribute("source")?.trim() || title };
  bookRefByTitle.set(title, ref);
  return ref;
}

// The site's other sections (comics) use the same ?title=&page= query shape, so only
// /books/ chapter URLs are accepted.
function parseChapterUrl(url: string): { title: string; page: number } | undefined {
  try {
    const parsed = new URL(url);
    if (!/^(www\.)?vietmessenger\.com$/i.test(parsed.hostname)) return undefined;
    if (parsed.pathname.replace(/\/+$/, "") !== "/books") return undefined;
    const title = parsed.searchParams.get("title")?.trim();
    if (!title) return undefined;
    return { title, page: Number(parsed.searchParams.get("page")) || 1 };
  } catch {
    return undefined;
  }
}

export async function fetchVietmessengerChapter(url: string): Promise<ExtractedChapter> {
  const chapterUrl = parseChapterUrl(url);
  if (!chapterUrl) {
    throw new Error(t("This is not a Viet Messenger chapter page: {url}", { url }));
  }
  const { title, page } = chapterUrl;

  const bookRef = await loadBookRef(title, url);
  const raw = await fetchText(
    GETHTML_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        Referer: url,
      },
      body: new URLSearchParams({ c: bookRef.cat, t: bookRef.source, p: String(page) }).toString(),
    },
    { timeoutMs: REQUEST_TIMEOUT_MS }
  );
  return parseChapterHtml(decodeChapterHtml(raw, url), url);
}
