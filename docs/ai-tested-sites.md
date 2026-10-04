# Sites tested with the AI crawler

Each site was read through `createAiTocAdapter` (chapter list) and `fetchChapterWithAi` (one chapter)
with the AI provider configured in Settings → AI crawler. Tested 2026-10-02, one story per site.

## Supported (in `src/sites/`, need the AI crawler on)

| Site | Kind | Result |
|---|---|---|
| royalroad.com | text, EN | 106 chapters, text correct |
| docln.net (Hako) | text, VN | 74 chapters, text correct |
| truyenfullok.com | text, VN | 178 chapters, titles and text correct |

## Tested, not added

| Site | Kind | Why |
|---|---|---|
| wetruyen.com | text, VN | All 86 chapters found (after the pager fix), but every list title is just "Chương" |
| wuxiaworld.com | text, EN | Chapter list reads only 2 entries |
| mangapill.com | comic | List has 68 of ~145 chapter links; one chapter's pictures download fine |
| webtoons.com | comic | List has chapters 55–120 only (the list is paged); one chapter's pictures download fine |
| truyenchu.com.vn | text, VN | Chapter list appears after a click the AI did not find (`NoChapterListError`) |
| truyenyy.mobi | text, VN | Story page not found by the AI (the address tried was a chapter) |
| archiveofourown.org | text, EN | Not tested: Cloudflare answers HTTP 525 |
| hottruyen.vn, doctruyenvip.net, metruyenchu.com.vn, others | — | Unreachable from the test machine |

## Fixed on the way

`moreChapters` only offered the 8 biggest link groups, so a page-number row (`/story.1/trang-2/`) ranking
below genre/tag links was never offered, and a picked button that brought nothing ended the search.
It now also offers every group continuing the story's own address, and tries those as a pager when the
control picked adds no chapters. The sites that already worked return the same lists as before.
