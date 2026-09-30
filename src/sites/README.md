# Adding a site

One folder per site, `src/sites/<id>/`:

| File | What it holds |
|---|---|
| `toc.ts` | `TocAdapter`: story URL → title, author, cover, chapter list. Needed for "Load chapters". |
| `chapter.ts` | `ChapterFetcher`: chapter URL → `ExtractedChapter`. Skip it when the shared renderer + extractor reads the site fine. |
| `index.ts` | The `SiteModule` manifest: allowlist rows, the adapter, the fetcher, a saved-session slug. |
| `*.test.ts`, `__fixtures__/` | Tests next to the code, fixtures are real page captures. |

Then:

1. Add the manifest to `SITES` in `src/sites/index.ts` (the order is the order of the add box's list).
2. `supported` rows are the crawl allowlist — the trust boundary. A book-file source that is imported
   instead of crawled goes in `imports`, never in `supported`.
3. User-facing text goes through `t()` (`services/lang.ts` server-side, `frontend/src/i18n/`).
4. A site that needs a browser session sets `session: { slug, domain }`; the dialog copy lives in
   `frontend/src/lib/siteSessions.ts`.
5. A browser step only that site needs (a click-through gate, say) is a function you pass to
   `renderPageHtml(url, { afterOpen })` from your own `toc.ts`/`chapter.ts`; the renderer stays site-agnostic
   (see `asianfanfics/ageGate.ts`).

`src/sites/index.test.ts` checks the derived lists (allowlist order, import sources kept apart, session
slugs, each adapter's domains belong to its own manifest).
