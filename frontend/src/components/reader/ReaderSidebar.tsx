import type { RefObject } from "react";
import type { Highlight } from "../../lib/api";
import * as hl from "../../lib/reader/highlightDom";
import { useLang } from "../../i18n";
import { Icon } from "../ui/Icon";
import type { ReaderChapter } from "./ReaderOverlay";

// The reader's left panel: the book header, then either the chapter list (searchable, one
// slice at a time — see TOC_WINDOW in ReaderOverlay) or the highlights list. The overlay
// owns the state and computes the slice; this only draws it.
export default function ReaderSidebar({
  coverSrc,
  storyTitle,
  author,
  chapters,
  currentOrder,
  tab,
  onTab,
  highlights,
  onGoToHighlight,
  query,
  onQuery,
  needle,
  shown,
  hiddenMatches,
  activeRow,
  onGoToChapter,
  page,
  pageCount,
  from,
  onTocPage,
}: {
  coverSrc?: string;
  storyTitle: string;
  author: string;
  chapters: ReaderChapter[];
  currentOrder?: number;
  tab: "chapters" | "highlights";
  onTab: (tab: "chapters" | "highlights") => void;
  highlights: Highlight[];
  onGoToHighlight: (highlight: Highlight) => void;
  query: string;
  onQuery: (query: string) => void;
  needle: string;
  shown: ReaderChapter[];
  hiddenMatches: number;
  activeRow: RefObject<HTMLButtonElement>;
  onGoToChapter: (index: number) => void;
  page: number;
  pageCount: number;
  from: number;
  onTocPage: (page: number) => void;
}) {
  const { t } = useLang();
  return (
    <nav className="reader-panel reader-panel-left" aria-label={t("Chapters")}>
      <div className="reader-book">
        {coverSrc ? (
          <img className="reader-cover" src={coverSrc} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="reader-cover reader-cover-empty">
            <Icon name="library" size={16} />
          </div>
        )}
        <div className="min-w-0">
          <b className="block truncate">{storyTitle}</b>
          <span className="block truncate text-xs text-ink-2">{author || t("Unknown")}</span>
          <span className="block text-xs text-ink-3">{t("{count} chapters in the book", { count: chapters.length })}</span>
        </div>
      </div>
      <div className="tabs">
        <button type="button" aria-selected={tab === "chapters"} onClick={() => onTab("chapters")}>
          {t("Chapters")}
        </button>
        <button type="button" aria-selected={tab === "highlights"} onClick={() => onTab("highlights")}>
          {t("Highlights ({count})", { count: highlights.length })}
        </button>
      </div>

      {tab === "highlights" ? (
        <ul className="reader-toc">
          {highlights.map((highlight) => (
            <li key={highlight.id}>
              <button
                type="button"
                className="reader-hl-row"
                aria-current={highlight.chapterOrder === currentOrder ? "true" : undefined}
                onClick={() => onGoToHighlight(highlight)}
              >
                <span className="reader-hl-dot" style={{ background: hl.SWATCH[highlight.color] }} />
                <span className="min-w-0">
                  <span className="reader-hl-text">{highlight.text}</span>
                  <span className="reader-hl-where">
                    {t("Chapter {order}", { order: highlight.chapterOrder })}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {highlights.length === 0 && (
            <li className="reader-toc-note">
              {t("Nothing highlighted yet — select any text in the page to colour it.")}
            </li>
          )}
        </ul>
      ) : (
        <>
      <input
        type="search"
        className="input"
        placeholder={t("Find a chapter…")}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <ul className="reader-toc">
        {shown.map((c) => {
          const current = c.order === currentOrder;
          return (
            <li key={c.order}>
              <button
                type="button"
                ref={current ? activeRow : undefined}
                aria-current={current ? "true" : undefined}
                onClick={() => onGoToChapter(chapters.indexOf(c))}
              >
                <span className="num">{c.order}</span>
                <span className="truncate">{c.title}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="reader-toc-note">{t("No chapter matches “{query}”.", { query: query.trim() })}</li>}
      </ul>
      {hiddenMatches > 0 && (
        <p className="reader-toc-note">{t("{count} more matches — type a longer search.", { count: hiddenMatches })}</p>
      )}
      {!needle && pageCount > 1 && (
        <div className="reader-toc-foot">
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            disabled={page === 0}
            aria-label={t("Earlier chapters")}
            onClick={() => onTocPage(page - 1)}
          >
            <Icon name="chevron" size={12} className="rotate-180" />
          </button>
          <span>
            {t("{from}–{to} of {total}", { from: from + 1, to: from + shown.length, total: chapters.length })}
          </span>
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            disabled={page >= pageCount - 1}
            aria-label={t("Later chapters")}
            onClick={() => onTocPage(page + 1)}
          >
            <Icon name="chevron" size={12} />
          </button>
        </div>
      )}
        </>
      )}
    </nav>
  );
}
