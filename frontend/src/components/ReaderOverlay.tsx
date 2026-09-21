import { useEffect, useMemo, useRef, useState } from "react";
import {
  createHighlight,
  deleteHighlight,
  fetchHighlights,
  Highlight,
  HIGHLIGHT_COLORS,
  HighlightColor,
  recolorHighlight,
} from "../lib/api";
import * as hl from "../lib/highlightDom";
import { CONTENT_ID } from "../lib/highlightDom";
import { useLang } from "../i18n";
import {
  FONT_SIZE_RANGE,
  LINE_HEIGHTS,
  READER_FONTS,
  ReaderPrefs,
  ReaderTheme,
  readPosition,
  readPrefs,
  readerDocument,
  savePosition,
  savePrefs,
} from "../lib/readerPreview";
import { Icon } from "./Icon";

export interface ReaderChapter {
  order: number;
  title: string;
}

// Long stories have thousands of chapters, and the chapter list would pay the same
// cost the chapter table pays (which is why that one paginates): show one slice.
// Slices are fixed rather than centred on the current chapter so the list does not
// shift by a row under the pointer every time a chapter is turned.
const TOC_WINDOW = 200;
// Scrolling fires continuously; only write the position once the reader settles.
const SCROLL_SAVE_DELAY = 400;
// Height the palette needs above a selection before it has to flip below it.
const PALETTE_CLEARANCE = 56;
// Rough silent-reading pace for Vietnamese prose (~200 words/min at ~5 characters a
// word). It only drives an estimate the reader glances at, so being off by a fifth
// costs nothing — but it is the one number here worth tuning if it reads wrong.
const CHARS_PER_MINUTE = 1000;
// Below this there is nothing to scroll, so the chapter is fully in view.
const MIN_SCROLLABLE = 8;

const THEME_LABEL: Record<ReaderTheme, string> = { light: "Paper", sepia: "Sepia", dark: "Night" };
const LINE_HEIGHT_LABEL: Record<string, string> = { "1.4": "Tight", "1.5": "Book", "1.8": "Loose" };
const COLOR_LABEL: Record<HighlightColor, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
};

// Where the colour palette sits: over a fresh selection, or over a highlight that was
// clicked (which can also be recoloured or removed).
interface Palette {
  left: number;
  top: number;
  below: boolean;
  target: { kind: "selection"; start: number; end: number; text: string } | { kind: "highlight"; id: string };
}

/**
 * Full-screen reader: shows one chapter at a time inside an iframe carrying the book's
 * own stylesheet, so what is on screen is what the exported EPUB will show. The iframe
 * is sandboxed without allow-scripts — chapter HTML comes from crawled pages — but keeps
 * allow-same-origin so this component can still restore scroll and catch arrow keys.
 */
export default function ReaderOverlay({
  storyId,
  storyTitle,
  author,
  language,
  coverSrc,
  chapters,
  loadChapterHtml,
  onClose,
}: {
  storyId: string;
  storyTitle: string;
  author: string;
  language: string;
  coverSrc?: string;
  chapters: ReaderChapter[];
  loadChapterHtml: (order: number) => Promise<string>;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [resume] = useState(() => {
    const position = readPosition(storyId);
    const found = position ? chapters.findIndex((c) => c.order === position.order) : -1;
    return found >= 0 ? { index: found, scroll: position!.scroll } : { index: 0, scroll: 0 };
  });
  const [index, setIndex] = useState(resume.index);
  const [prefs, setPrefs] = useState<ReaderPrefs>(readPrefs);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tocPage, setTocPage] = useState(() => Math.floor(resume.index / TOC_WINDOW));
  const [sidebar, setSidebar] = useState<"chapters" | "highlights">("chapters");
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [full, setFull] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLButtonElement>(null);
  // Scroll offset the next iframe load should land on: the saved position when the
  // reader opens, and the current offset when a preference change reloads the page.
  const pendingScroll = useRef(resume.scroll);
  const cache = useRef(new Map<number, string>());
  // Chapters a prefetch has been started for, so a second pass does not refetch them.
  const prefetching = useRef(new Set<number>());
  // The iframe load handler runs outside React's render, so the values it needs live in
  // refs rather than the closure it was created in.
  const highlightsRef = useRef<Highlight[]>([]);
  const chapterRef = useRef(0);
  const scrollToOnLoad = useRef<string | null>(null);
  const scrollTimer = useRef<number | undefined>(undefined);
  // Progress is written straight into these two nodes instead of through state: it
  // changes on every scroll frame, and a re-render would redraw the whole chapter list
  // (up to 200 rows) with it.
  const progressFill = useRef<HTMLDivElement>(null);
  const progressLabel = useRef<HTMLSpanElement>(null);
  const chapterChars = useRef(0);

  const chapter = chapters[index];
  highlightsRef.current = highlights;
  chapterRef.current = chapter?.order ?? 0;

  // Listeners live on the iframe document, which is replaced on every load, so they
  // can only reach the current chapter through a ref.
  const handlers = useRef({
    onScroll: (_win: Window) => {},
    onKey: (_e: KeyboardEvent) => {},
    onPick: () => {},
    onClick: (_e: MouseEvent) => {},
  });

  useEffect(() => {
    if (!chapter) return;
    const cached = cache.current.get(chapter.order);
    if (cached !== undefined) {
      setHtml(cached);
      setError(null);
      return;
    }
    let cancelled = false;
    setHtml(null);
    setError(null);
    loadChapterHtml(chapter.order)
      .then((content) => {
        if (cancelled) return;
        cache.current.set(chapter.order, content);
        setHtml(content);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
    // loadChapterHtml closes over the parent's editor state and is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.order]);

  // The whole story's highlights, not just the open chapter's: the sidebar lists them
  // all, and a chapter turn should not wait on a request.
  useEffect(() => {
    let cancelled = false;
    fetchHighlights(storyId)
      .then((saved) => {
        if (!cancelled) setHighlights(saved);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [storyId]);

  // Reading straight through is the common case, so have the next chapter in hand
  // before it is asked for: the turn becomes instant instead of a blank pane and a
  // request. Starts only once the current chapter is showing, so it never competes
  // with the chapter the reader is waiting on.
  useEffect(() => {
    const next = chapters[index + 1];
    if (html === null || !next) return;
    // The cache alone cannot gate this: the effect runs again when `html` settles, while
    // the first prefetch is still in flight and has nothing in the cache yet — which
    // fetched the same chapter twice. Track what is already on its way.
    if (cache.current.has(next.order) || prefetching.current.has(next.order)) return;
    prefetching.current.add(next.order);
    loadChapterHtml(next.order)
      .then((content) => cache.current.set(next.order, content))
      // Speculative: if it really fails, turning the page reports it properly. Forget it
      // so a later pass can try again.
      .catch(() => prefetching.current.delete(next.order));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, html]);

  // Arrow keys and Escape work while focus is anywhere in the app chrome; the same
  // handler is attached inside the iframe, where focus sits while reading.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handlers.current.onKey(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Full screen is the browser's, not ours: it can also be left with Escape or the
  // window chrome, so the button follows the document rather than its own state. Leaving
  // the reader leaves full screen too — the library behind it is not a full screen page.
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  // Closing mid-scroll must not lose the last few hundred milliseconds of reading.
  useEffect(() => {
    return () => {
      window.clearTimeout(scrollTimer.current);
      const win = frame.current?.contentWindow;
      const order = chapters[index]?.order;
      if (win && order !== undefined) savePosition(storyId, { order, scroll: win.scrollY });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paging the list by hand shows another slice, but turning a chapter brings the list
  // back to where the reader actually is.
  useEffect(() => setTocPage(Math.floor(index / TOC_WINDOW)), [index]);

  // The docked list is always in sight, so it has to follow along: after twenty presses
  // of Next the current chapter would otherwise be far above the visible rows.
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [index, tocPage, prefs.toc]);

  function paintProgress(win: Window) {
    const scrollable = win.document.documentElement.scrollHeight - win.innerHeight;
    const fraction =
      scrollable > MIN_SCROLLABLE ? Math.min(1, Math.max(0, win.scrollY / scrollable)) : 1;
    if (progressFill.current) progressFill.current.style.width = `${fraction * 100}%`;
    if (progressLabel.current) {
      const percent = Math.round(fraction * 100);
      const minutes = Math.ceil(((1 - fraction) * chapterChars.current) / CHARS_PER_MINUTE);
      progressLabel.current.textContent =
        minutes >= 1 ? t("{percent}% · ~{minutes} min left", { percent, minutes }) : `${percent}%`;
    }
  }

  function goTo(next: number) {
    if (next < 0 || next >= chapters.length) return;
    setPalette(null);
    pendingScroll.current = 0;
    setIndex(next);
    savePosition(storyId, { order: chapters[next].order, scroll: 0 });
  }

  function toggleFull() {
    // Either call rejects when the browser refuses full screen (an embedded frame, a
    // policy): the reader is unchanged and still readable, so there is nothing to report.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void root.current?.requestFullscreen().catch(() => {});
  }

  function updatePrefs(patch: Partial<ReaderPrefs>) {
    // Only the preferences written into the page rebuild the srcdoc, which reloads the
    // iframe back to the top; showing or hiding the chapter list leaves it alone.
    if (
      patch.fontSize !== undefined ||
      patch.lineHeight !== undefined ||
      patch.theme !== undefined ||
      patch.font !== undefined
    ) {
      pendingScroll.current = frame.current?.contentWindow?.scrollY ?? 0;
    }
    setPalette(null);
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  }

  handlers.current = {
    onScroll: (win) => {
      paintProgress(win);
      window.clearTimeout(scrollTimer.current);
      if (!chapter) return;
      const order = chapter.order;
      const scroll = win.scrollY;
      scrollTimer.current = window.setTimeout(
        () => savePosition(storyId, { order, scroll }),
        SCROLL_SAVE_DELAY
      );
    },
    onKey: (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.isContentEditable) return;
      // Escape dismisses the palette first: it is the thing most recently opened.
      if (e.key === "Escape") {
        // In full screen the browser takes Escape for itself; where it still reaches us,
        // the keypress belongs to leaving full screen, not to closing the reader.
        if (document.fullscreenElement) return;
        if (palette) setPalette(null);
        else onClose();
      } else if (e.key === "f" || e.key === "F") toggleFull();
      else if (e.key === "ArrowLeft") goTo(index - 1);
      else if (e.key === "ArrowRight") goTo(index + 1);
    },
    onPick: () => {
      const doc = frame.current?.contentDocument;
      const picked = doc ? hl.readSelection(doc) : null;
      if (!picked) return;
      setPalette(paletteAt(picked.rect, { kind: "selection", ...picked }));
    },
    onClick: (e) => {
      const found = hl.markAt(e.target);
      // A click that lands on plain text closes the palette; a drag that ends there is
      // handled by mouseup, which runs first and opens it again.
      if (!found) {
        setPalette((open) => (open?.target.kind === "highlight" ? null : open));
        return;
      }
      setPalette(paletteAt(found.rect, { kind: "highlight", id: found.id }));
    },
  };

  function handleFrameLoad() {
    const win = frame.current?.contentWindow;
    const doc = frame.current?.contentDocument;
    if (!win || !doc) return;
    chapterChars.current = doc.getElementById(CONTENT_ID)?.textContent?.length ?? 0;
    hl.paintAll(doc, highlightsRef.current.filter((h) => h.chapterOrder === chapterRef.current));
    if (scrollToOnLoad.current) {
      hl.scrollToHighlight(doc, scrollToOnLoad.current);
      scrollToOnLoad.current = null;
    } else {
      win.scrollTo(0, pendingScroll.current);
    }
    pendingScroll.current = 0;
    // On the document, not the window: a preference change reloads the iframe, and only
    // listeners bound to the replaced document are guaranteed to go with it.
    doc.addEventListener("scroll", () => handlers.current.onScroll(win), { passive: true });
    // Showing or hiding the chapter list renarrows the page without reloading it, so the
    // same scroll offset is now a different fraction of a taller chapter.
    win.addEventListener("resize", () => paintProgress(win));
    doc.addEventListener("keydown", (e) => handlers.current.onKey(e));
    // mouseup rather than selectionchange: the palette should appear once the reader has
    // finished dragging, not follow the selection as it grows.
    doc.addEventListener("mouseup", () => handlers.current.onPick());
    doc.addEventListener("click", (e) => handlers.current.onClick(e));
    paintProgress(win);
  }

  // Place the palette in the app's coordinates: the rect comes from inside the iframe,
  // which is offset from the stage the palette is positioned in.
  function paletteAt(rect: DOMRect, target: Palette["target"]): Palette | null {
    const frameBox = frame.current?.getBoundingClientRect();
    const stageBox = stage.current?.getBoundingClientRect();
    if (!frameBox || !stageBox) return null;
    const left = frameBox.left - stageBox.left + rect.left + rect.width / 2;
    const top = frameBox.top - stageBox.top + rect.top;
    // Near the top of the page there is no room above the selection, so flip underneath.
    const below = top < PALETTE_CLEARANCE;
    return { left, top: below ? top + rect.height : top, below, target };
  }

  async function applyColor(color: HighlightColor) {
    const current = palette;
    if (!current) return;
    setPalette(null);
    const doc = frame.current?.contentDocument;
    try {
      if (current.target.kind === "highlight") {
        const id = current.target.id;
        await recolorHighlight(storyId, id, color);
        setHighlights((all) => all.map((h) => (h.id === id ? { ...h, color } : h)));
        if (doc) hl.recolor(doc, id, color);
        return;
      }
      const saved = await createHighlight(storyId, {
        chapterOrder: chapter.order,
        start: current.target.start,
        end: current.target.end,
        color,
        text: current.target.text,
      });
      setHighlights((all) => [...all, saved]);
      if (doc) {
        doc.getSelection()?.removeAllRanges();
        hl.paint(doc, saved);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeHighlight(id: string) {
    setPalette(null);
    try {
      await deleteHighlight(storyId, id);
      setHighlights((all) => all.filter((h) => h.id !== id));
      const doc = frame.current?.contentDocument;
      if (doc) hl.unpaint(doc, id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function goToHighlight(highlight: Highlight) {
    const target = chapters.findIndex((c) => c.order === highlight.chapterOrder);
    if (target < 0) return;
    if (target === index) {
      const doc = frame.current?.contentDocument;
      if (doc) hl.scrollToHighlight(doc, highlight.id);
      return;
    }
    // The chapter has to render before its highlights exist to scroll to, so leave the
    // request for the load handler.
    scrollToOnLoad.current = highlight.id;
    goTo(target);
  }

  const srcDoc = useMemo(
    () => (html === null || !chapter ? null : readerDocument(chapter.title, html, language, prefs)),
    [html, chapter?.order, chapter?.title, language, prefs]
  );

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? chapters.filter((c) => c.title.toLowerCase().includes(needle) || String(c.order) === needle)
    : chapters;
  const pageCount = Math.max(1, Math.ceil(matches.length / TOC_WINDOW));
  // A search is its own list: show the best matches from the top instead of the slice
  // the reader happens to be sitting in.
  const page = needle ? 0 : Math.min(tocPage, pageCount - 1);
  const from = page * TOC_WINDOW;
  const shown = matches.slice(from, from + TOC_WINDOW);
  const hiddenMatches = needle ? matches.length - shown.length : 0;

  return (
    <div
      className="reader"
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t("Reading {title}", { title: storyTitle })}
    >
      <div className="reader-bar">
        <button type="button" className="btn btn-quiet btn-tiny" onClick={onClose}>
          <Icon name="x" size={12} />
          {t("Close")}
        </button>
        <div className="reader-where">
          <b>{storyTitle}</b>
          <span>{t("Chapter {number} / {total}", { number: index + 1, total: chapters.length })}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-tiny"
            aria-pressed={prefs.toc}
            title={prefs.toc ? t("Hide the chapter list") : t("Show the chapter list")}
            onClick={() => updatePrefs({ toc: !prefs.toc })}
          >
            <Icon name="chapter" size={13} />
            {t("Chapters")}
          </button>
          <button
            type="button"
            className="btn btn-tiny"
            aria-pressed={full}
            title={full ? t("Leave full screen (F)") : t("Read full screen (F)")}
            aria-label={full ? t("Leave full screen") : t("Read full screen")}
            onClick={toggleFull}
          >
            <Icon name={full ? "collapse" : "expand"} size={13} />
          </button>
          <button
            type="button"
            className="btn btn-tiny"
            aria-pressed={textOpen}
            aria-label={t("Text settings")}
            onClick={() => setTextOpen(!textOpen)}
          >
            <span className="reader-aa">Aa</span>
          </button>
        </div>
      </div>

      <div className="reader-stage" ref={stage}>
        {prefs.toc && (
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
              <button type="button" aria-selected={sidebar === "chapters"} onClick={() => setSidebar("chapters")}>
                {t("Chapters")}
              </button>
              <button type="button" aria-selected={sidebar === "highlights"} onClick={() => setSidebar("highlights")}>
                {t("Highlights ({count})", { count: highlights.length })}
              </button>
            </div>

            {sidebar === "highlights" ? (
              <ul className="reader-toc">
                {highlights.map((highlight) => (
                  <li key={highlight.id}>
                    <button
                      type="button"
                      className="reader-hl-row"
                      aria-current={highlight.chapterOrder === chapter?.order ? "true" : undefined}
                      onClick={() => goToHighlight(highlight)}
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
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="reader-toc">
              {shown.map((c) => {
                const current = c.order === chapter?.order;
                return (
                  <li key={c.order}>
                    <button
                      type="button"
                      ref={current ? activeRow : undefined}
                      aria-current={current ? "true" : undefined}
                      onClick={() => goTo(chapters.indexOf(c))}
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
                  onClick={() => setTocPage(page - 1)}
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
                  onClick={() => setTocPage(page + 1)}
                >
                  <Icon name="chevron" size={12} />
                </button>
              </div>
            )}
              </>
            )}
          </nav>
        )}

        {srcDoc ? (
          <iframe
            ref={frame}
            className="reader-page"
            title={t("{title} — EPUB preview", { title: chapter.title })}
            sandbox="allow-same-origin"
            srcDoc={srcDoc}
            onLoad={handleFrameLoad}
          />
        ) : (
          <div className="reader-note">
            {error ? (
              <span className="banner">
                <Icon name="alert" size={14} />
                <span className="min-w-0">{error}</span>
              </span>
            ) : (
              <span className="text-ink-2">{t("Loading chapter…")}</span>
            )}
          </div>
        )}

        {palette && (
          <div
            className={palette.below ? "reader-palette reader-palette-below" : "reader-palette"}
            style={{ left: palette.left, top: palette.top }}
            role="group"
            aria-label={t("Highlight colour")}
          >
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="reader-swatch"
                style={{ background: hl.SWATCH[color] }}
                title={t(COLOR_LABEL[color])}
                aria-label={t(COLOR_LABEL[color])}
                onClick={() => applyColor(color)}
              />
            ))}
            {palette.target.kind === "highlight" && (
              <button
                type="button"
                className="reader-swatch reader-swatch-remove"
                title={t("Remove highlight")}
                aria-label={t("Remove highlight")}
                onClick={() => removeHighlight((palette.target as { id: string }).id)}
              >
                <Icon name="trash" size={12} />
              </button>
            )}
          </div>
        )}

        {textOpen && (
          <aside className="reader-panel" aria-label={t("Text settings")}>
            <div className="field">
              <label>{t("Text size")}</label>
              <div className="reader-seg">
                <button
                  type="button"
                  disabled={prefs.fontSize <= FONT_SIZE_RANGE.min}
                  aria-label={t("Smaller text")}
                  onClick={() => updatePrefs({ fontSize: prefs.fontSize - FONT_SIZE_RANGE.step })}
                >
                  A−
                </button>
                <span className="reader-seg-value">{prefs.fontSize}px</span>
                <button
                  type="button"
                  disabled={prefs.fontSize >= FONT_SIZE_RANGE.max}
                  aria-label={t("Larger text")}
                  onClick={() => updatePrefs({ fontSize: prefs.fontSize + FONT_SIZE_RANGE.step })}
                >
                  A+
                </button>
              </div>
            </div>
            <div className="field">
              <label>{t("Line spacing")}</label>
              <div className="reader-seg">
                {LINE_HEIGHTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={prefs.lineHeight === value}
                    onClick={() => updatePrefs({ lineHeight: value })}
                  >
                    {t(LINE_HEIGHT_LABEL[String(value)])}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{t("Font")}</label>
              {/* Each choice is written in the family it selects, so the list is its own
                  sample — the reason to pick one is what it looks like. */}
              <div className="reader-seg reader-seg-col">
                {READER_FONTS.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    style={{ fontFamily: font.stack }}
                    aria-pressed={prefs.font === font.id}
                    onClick={() => updatePrefs({ font: font.id })}
                  >
                    {t(font.label)}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{t("Page")}</label>
              <div className="reader-seg">
                {(Object.keys(THEME_LABEL) as ReaderTheme[]).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    aria-pressed={prefs.theme === theme}
                    onClick={() => updatePrefs({ theme })}
                  >
                    {t(THEME_LABEL[theme])}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-ink-3">
              {t(
                "Spacing and images come from the book's own stylesheet, so this page is what the exported EPUB contains. These settings only change how you read here — like the text controls on a Kindle, they are not written into the file."
              )}
            </p>
          </aside>
        )}
      </div>

      <div className="reader-foot">
        <div className="reader-progress" aria-hidden="true">
          <div className="reader-progress-fill" ref={progressFill} />
        </div>
        <button type="button" className="btn" disabled={index === 0} onClick={() => goTo(index - 1)}>
          <Icon name="chevron" size={12} className="rotate-180" />
          {t("Previous")}
        </button>
        <span className="reader-now">
          <span className="truncate">{chapter?.title}</span>
          <span className="reader-progress-label" ref={progressLabel} />
        </span>
        <button
          type="button"
          className="btn"
          disabled={index >= chapters.length - 1}
          onClick={() => goTo(index + 1)}
        >
          {t("Next")}
          <Icon name="chevron" size={12} />
        </button>
      </div>
    </div>
  );
}
