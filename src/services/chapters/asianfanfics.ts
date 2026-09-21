import { JSDOM } from "jsdom";
import { ContentBlock, ExtractedChapter } from "../../types";
import { LockedContentError, walkToBlocks } from "../extractor";
import { renderPageHtml } from "../renderer";
import { loadSiteSession } from "../siteSession";
import { t } from "../lang";

export const ASIANFANFICS_DOMAINS = ["asianfanfics.com"];

// The chapter body is swapped in by htmx and the container keeps its hx-get afterwards. It
// lives inside #bodyText: a chapter uses /htmx/chapter/<id>/<token>, a foreword uses
// /htmx/story/<id>/<token>. The page has other htmx targets (comments, author box, feed) and,
// for a subscribers-only story the account is not subscribed to, a /htmx/teaser/ div holding
// only the first few paragraphs — picking any of those would file another part of the page,
// or a partial chapter, as the chapter body.
const CONTENT_TARGET_RE = /^\/htmx\/(chapter\/|story\/\d+\/)/;
const TEASER_TARGET_RE = /^\/htmx\/teaser\//;
// Cloudflare's interstitial, whatever it renders instead of the page.
const CLOUDFLARE_RE = /just a moment|performing security verification|enable javascript and cookies to continue/i;

function findContentDiv(doc: Document): Element | null {
  for (const el of Array.from(doc.querySelectorAll("#bodyText [hx-get]"))) {
    if (CONTENT_TARGET_RE.test(el.getAttribute("hx-get") ?? "")) return el;
  }
  return null;
}

function hasTeaser(doc: Document): boolean {
  for (const el of Array.from(doc.querySelectorAll("#bodyText [hx-get]"))) {
    if (TEASER_TARGET_RE.test(el.getAttribute("hx-get") ?? "")) return true;
  }
  return false;
}

// The site renders this bar on every page; a Log In link in it means the request was
// served as a guest, whatever cookies we sent.
function isLoggedOut(doc: Document): boolean {
  const bar = doc.querySelector("header[data-aff-userbar-shell]");
  return !!bar && !!bar.querySelector('a[href="/login"]');
}

export function parseAsianfanficsChapter(
  html: string,
  url: string,
  options: { sessionSaved?: boolean } = {}
): ExtractedChapter {
  const doc = new JSDOM(html, { url }).window.document;
  // h1 is the chapter title; the <title> tag is unreliable here because a Cloudflare
  // challenge can leave it stale ("Just a moment...") even on a fully rendered page.
  const title = doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() || url;
  const content = findContentDiv(doc);
  const blocks: ContentBlock[] = [];
  if (content) walkToBlocks(content, blocks);

  if (blocks.length === 0) {
    const body = doc.body?.textContent ?? "";
    // A saved session the site no longer honours: the account's access token lasts about
    // an hour. Say that instead of reporting the guest-level lock the site showed us.
    if (options.sessionSaved && isLoggedOut(doc)) {
      throw new LockedContentError(
        t(
          "Saved Asianfanfics session has expired — log in again in your browser, then re-import it in Settings → Site sessions: {url}",
          { url }
        )
      );
    }
    // Subscribers-only content is served as a teaser: the beginning of the chapter plus a
    // notice. Saving that would silently export a truncated chapter, so it stays locked.
    // The teaser div is the signal, not the notice text: the site translates its wording.
    if (hasTeaser(doc)) {
      throw new LockedContentError(
        t("This Asianfanfics content is for subscribers only — it needs an account subscribed to the author: {url}", {
          url,
        })
      );
    }
    if (/are you over 18\?/i.test(body)) {
      throw new LockedContentError(
        t(
          "This Asianfanfics content is rated M (mature) — it needs a logged-in account with mature content enabled: {url}",
          { url }
        )
      );
    }
    // A "Subscribers only" story page carries that badge in its header on every chapter,
    // readable or not — treating the badge as a lock would turn a failed load (below) into a
    // permanent error with no retry. Only the teaser above means the text was withheld.
    if (CLOUDFLARE_RE.test(doc.title) || CLOUDFLARE_RE.test(body)) {
      throw new Error(t("Cloudflare verification did not finish — try again in a moment ({url})", { url }));
    }
    throw new Error(
      t("Could not find chapter content at {url} — the site may have changed structure or the chapter is locked", {
        url,
      })
    );
  }

  return { sourceUrl: url, title, blocks };
}

export async function fetchAsianfanficsChapter(url: string): Promise<ExtractedChapter> {
  return parseAsianfanficsChapter(await renderPageHtml(url), url, { sessionSaved: !!loadSiteSession(url) });
}
