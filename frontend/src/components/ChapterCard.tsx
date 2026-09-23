import { useEffect, useRef, useState } from "react";
import { ExtractedChapter } from "../types";
import { blocksToHtml } from "../lib/blocksToHtml";
import { useLang } from "../i18n";
import { Icon } from "./Icon";
import { ChipState, StatusChip } from "./StatusChip";

// A chapter the crawl has not reached yet — or has just finished, while the
// view still holds the pre-crawl snapshot: no content to edit or include, just
// its place in the list, its live state, and a way to look at the source page.
export function PendingChapterRow({
  order,
  title,
  url,
  state = "pending",
  onSaveTitle,
}: {
  order: number;
  title: string;
  url: string;
  state?: ChipState;
  // Missing when the row isn't editable in this context. The site's own TOC-derived
  // name can be wrong; fixing it here — before the chapter is even crawled — means the
  // corrected title is what ends up in the book, not something patched up afterwards.
  onSaveTitle?: (title: string) => Promise<void>;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (!onSaveTitle) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    setError(null);
    setSaving(true);
    try {
      await onSaveTitle(trimmed);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td className="num w-11">
        <b>{order}</b>
      </td>
      <td>
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <label className="visually-hidden" htmlFor={`pending-title-${order}`}>
              {t("Title for chapter {order}", { order })}
            </label>
            <input
              id={`pending-title-${order}`}
              type="text"
              className="input min-w-[10rem] flex-1 text-xs"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={saving}
              autoFocus
            />
            <button type="submit" className="btn btn-tiny" disabled={saving || !draft.trim()}>
              <Icon name="check" size={13} />
              {saving ? t("Saving…") : t("Save title")}
            </button>
            <button type="button" className="btn btn-quiet btn-tiny" disabled={saving} onClick={() => setEditing(false)}>
              {t("Cancel")}
            </button>
            {error && <span className="w-full text-xs text-error">{error}</span>}
          </form>
        ) : (
          <span className="cell-title">
            <span className="t">{title || url}</span>
            {onSaveTitle && (
              <button type="button" className="btn btn-quiet btn-tiny shrink-0" onClick={startEdit}>
                <Icon name="edit" size={12} />
                <span className="visually-hidden">{t("Edit title for chapter {order}", { order })}</span>
              </button>
            )}
          </span>
        )}
      </td>
      <td className="w-32">
        <StatusChip state={state} />
      </td>
      <td className="w-28">
        <a
          className="btn btn-quiet btn-tiny"
          href={url}
          target="_blank"
          rel="noreferrer"
          title={t("Open source page")}
        >
          <Icon name="open" size={13} />
          <span className="visually-hidden">{t("Open source page for chapter {order}", { order })}</span>
        </a>
      </td>
    </tr>
  );
}

interface ChapterCardProps {
  chapter: ExtractedChapter;
  order: number;
  title: string;
  onTitleChange: (title: string) => void;
  onRetry: () => void;
  retrying: boolean;
  retriedOnce: boolean;
  onBodyChange: (html: string) => void;
  // Chapter content no longer pairs with chapter list: open a chapter, load it.
  loadBody?: () => Promise<string>;
  // Missing when the chapter is not in the library yet: nothing to save, just
  // edit temporarily then export.
  onSave?: (title: string, contentHtml: string) => Promise<void>;
  // Missing for the same reason as onSave. Only persists the URL — content/status are
  // untouched, so the user still clicks Retry afterwards to re-crawl from the new URL.
  onSaveUrl?: (url: string) => Promise<void>;
}

// Playwright's failure text arrives with time annotations from Call log still
// in it ("[22m", "[2m"); they're noise in a sentence a user reads.
function tidyError(message: string): string {
  return message
    .split("\n")
    .map((line) => line.replace(/\[\d+m/g, "").trimEnd())
    .join("\n")
    .trim();
}

// A chapter is one collapsed row — number, title, state, action — that expands
// into its editor. The body is intentionally uncontrolled: React writes the
// extracted HTML once (lazy state init) and never again, so a user's manual
// contentEditable edits aren't wiped out by re-renders triggered by, say,
// the crawl progress updating or the row being collapsed. Its live HTML is
// handed to the parent on input, and again on collapse before the editor
// unmounts, so a collapsed chapter still exports what the user typed into it.
//
// Edits stay in the browser until "Save chapter" writes them to the DB: crawled
// text usually carries leftovers from the source page, and cleaning it up is
// only worth doing once if it survives a reload.
export default function ChapterCard({
  chapter,
  order,
  title,
  onTitleChange,
  onRetry,
  retrying,
  retriedOnce,
  onBodyChange,
  loadBody,
  onSave,
  onSaveUrl,
}: ChapterCardProps) {
  const initialHtml = () => blocksToHtml(chapter.blocks);
  const [html, setHtml] = useState(initialHtml);
  // Lets the user paste in content they viewed and copied themselves from a
  // normal browser (e.g. a chapter gated behind the site's own anti-adblock
  // wall) instead of this tool trying to defeat that gate automatically.
  const [manualMode, setManualMode] = useState(false);
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const bodyEl = useRef<HTMLDivElement | null>(null);

  // Latest saved version: used for "Undo" to revert to correct DB content.
  const [savedTitle, setSavedTitle] = useState(title);
  const [savedHtml, setSavedHtml] = useState(initialHtml);
  // Flag instead of string comparison: browser auto-normalizes HTML when pasting
  // into editor (`<img />` -> `<img>`), string comparison would report "modified" on open.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Editing the source URL is independent of the title/content editor above: a wrong
  // URL is often exactly why a chapter failed, so it must be fixable without touching
  // (or requiring) the content editor.
  const [urlEditing, setUrlEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState(chapter.sourceUrl);
  const [urlSaving, setUrlSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadedBody = useRef(false);
  // Increment to remount editor — only way to force an uncontrolled contentEditable
  // to accept new content on undo.
  const [editorKey, setEditorKey] = useState(0);

  const failed = !!chapter.error && !manualMode;
  // A locked chapter is not a transient failure: the site withholds the text until the
  // reader has access (login/session, mature opt-in, subscription), so it reads differently.
  const locked = failed && chapter.errorKind === "locked";
  // Withheld until the reader subscribes, or behind the mature opt-in: same kind of dead
  // end as a lock, but each has its own fix worth naming.
  const subscribers = failed && chapter.errorKind === "subscribers";
  const mature = failed && chapter.errorKind === "mature";
  const gated = locked || subscribers || mature;
  const panelId = `chapter-panel-${order}`;
  const chip: ChipState | null = retrying
    ? "running"
    : gated
      ? subscribers
        ? "subscribers"
        : mature
          ? "mature"
          : "locked"
      : failed
        ? "error"
        : manualMode
          ? null
          : "done";

  // Flash "Saved" on button after successful save.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(timer);
  }, [saved]);

  function liveHtml(): string {
    return bodyEl.current?.innerHTML ?? html;
  }

  function toggle() {
    if (open) {
      const live = bodyEl.current?.innerHTML;
      if (live !== undefined) {
        setHtml(live);
        onBodyChange(live);
      }
      setOpen(false);
      return;
    }
    setOpen(true);
    void loadOnce();
  }

  // Load content exactly once per card mount: close and reopen doesn't refetch,
  // and unsaved user edits aren't overwritten.
  async function loadOnce() {
    if (!loadBody || loadedBody.current) return;
    loadedBody.current = true;
    setLoadError(null);
    setLoadingBody(true);
    try {
      const loaded = await loadBody();
      setHtml(loaded);
      setSavedHtml(loaded);
      setEditorKey((k) => k + 1);
    } catch (err) {
      loadedBody.current = false;
      setLoadError((err as Error).message);
    } finally {
      setLoadingBody(false);
    }
  }

  function enterManualMode() {
    setManualMode(true);
    setOpen(true);
  }

  async function handleSave() {
    if (!onSave) return;
    const contentHtml = liveHtml();
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(title, contentHtml);
      setSavedTitle(title);
      setSavedHtml(contentHtml);
      setDirty(false);
      setSaved(true);
      // Manually pasted content now lives in DB like a normal chapter.
      setManualMode(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEditUrl() {
    setUrlDraft(chapter.sourceUrl);
    setUrlError(null);
    setUrlEditing(true);
  }

  function cancelEditUrl() {
    setUrlEditing(false);
    setUrlError(null);
  }

  async function handleSaveUrl() {
    if (!onSaveUrl) return;
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    setUrlError(null);
    setUrlSaving(true);
    try {
      await onSaveUrl(trimmed);
      setUrlEditing(false);
    } catch (err) {
      setUrlError((err as Error).message);
    } finally {
      setUrlSaving(false);
    }
  }

  function handleRevert() {
    onTitleChange(savedTitle);
    setHtml(savedHtml);
    onBodyChange(savedHtml);
    setEditorKey((k) => k + 1);
    setDirty(false);
    setSaveError(null);
  }

  // Re-crawling a chapter that already has content overwrites it (including any
  // manual edits saved earlier), so confirm first — unlike Retry on a failed
  // chapter, there's nothing worth losing there.
  function handleRecrawl() {
    if (window.confirm(t("Re-crawling will overwrite this chapter's saved content. Continue?"))) onRetry();
  }

  return (
    <>
      <tr className={open ? "row-open" : undefined}>
        <td className="num w-11">
          <b>{order}</b>
        </td>
        <td>
          <button
            type="button"
            className="row-btn"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
          >
            <Icon
              name="chevron"
              size={13}
              className={`text-ink-3 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            />
            <span className="t">{title || chapter.sourceUrl}</span>
            {dirty && <span className="chip shrink-0">{t("Unsaved")}</span>}
          </button>
        </td>
        <td className="w-32">
          {chip ? (
            <StatusChip state={chip} label={retrying ? t("Retrying") : undefined} />
          ) : (
            <span className="chip">
              <Icon name="edit" size={12} />
              {t("Manual input")}
            </span>
          )}
        </td>
        <td className="w-28">
          {failed && (
            <button type="button" className="btn btn-tiny" disabled={retrying} onClick={onRetry}>
              <Icon name="retry" size={13} className={retrying ? "animate-spin" : undefined} />
              {retrying ? t("Retrying…") : t("Retry")}
            </button>
          )}
          {chip === "done" && (
            <button type="button" className="btn btn-quiet btn-tiny" disabled={retrying} onClick={handleRecrawl}>
              <Icon name="retry" size={13} className={retrying ? "animate-spin" : undefined} />
              {retrying ? t("Retrying…") : t("Re-crawl")}
            </button>
          )}
        </td>
      </tr>

      {open && (
        <tr className="chapter-open" id={panelId}>
          <td colSpan={4}>
            {urlEditing ? (
              <form
                className="flex flex-wrap items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveUrl();
                }}
              >
                <label className="visually-hidden" htmlFor={`chapter-url-${order}`}>
                  {t("Source URL for chapter {order}", { order })}
                </label>
                <input
                  id={`chapter-url-${order}`}
                  type="text"
                  className="input min-w-[16rem] flex-1 text-xs"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  disabled={urlSaving}
                  autoFocus
                />
                <button type="submit" className="btn btn-tiny" disabled={urlSaving || !urlDraft.trim()}>
                  <Icon name="check" size={13} />
                  {urlSaving ? t("Saving…") : t("Save URL")}
                </button>
                <button type="button" className="btn btn-quiet btn-tiny" disabled={urlSaving} onClick={cancelEditUrl}>
                  {t("Cancel")}
                </button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                <span className="break-all">
                  {t("Source:")}{" "}
                  <a href={chapter.sourceUrl} target="_blank" rel="noreferrer">
                    {chapter.sourceUrl}
                  </a>
                </span>
                {onSaveUrl && (
                  <button type="button" className="btn btn-quiet btn-tiny" onClick={startEditUrl}>
                    <Icon name="edit" size={12} />
                    {t("Edit URL")}
                  </button>
                )}
              </div>
            )}
            {urlError && (
              <div className="banner mt-2">
                <Icon name="alert" size={14} />
                <p className="min-w-0">{urlError}</p>
              </div>
            )}

            {failed ? (
              <>
                <div className="banner mt-2">
                  <Icon name={gated ? "lock" : "alert"} size={14} />
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {gated
                        ? subscribers
                          ? t("This chapter is for subscribers only")
                          : mature
                            ? t("This chapter is rated M (18+)")
                            : t("This chapter is locked")
                        : t("Could not extract this chapter")}
                    </p>
                    <p className="mt-0.5 font-mono text-[11.5px] leading-relaxed">{tidyError(chapter.error ?? "")}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-tiny" disabled={retrying} onClick={onRetry}>
                    <Icon name="retry" size={13} className={retrying ? "animate-spin" : undefined} />
                    {retrying ? t("Retrying…") : t("Retry")}
                  </button>
                  {retriedOnce ? (
                    <button type="button" className="btn btn-tiny" onClick={enterManualMode}>
                      <Icon name="edit" size={13} />
                      {t("Enter content manually")}
                    </button>
                  ) : (
                    !gated && <span className="text-xs text-ink-3">{t("Many errors are temporary — try again first.")}</span>
                  )}
                  {gated && (
                    <span className="text-xs text-ink-3">
                      {subscribers
                        ? t("Subscribe to the author on asianfanfics.com, then retry.")
                        : mature
                          ? t("Enable mature content on your asianfanfics.com account, then retry.")
                          : t("Unlock it on the site first — subscribe, enable mature content, or import a fresh session — then retry.")}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="mt-2">
                  <label className="visually-hidden" htmlFor={`chapter-title-${order}`}>
                    {t("Title for chapter {order}", { order })}
                  </label>
                  <input
                    id={`chapter-title-${order}`}
                    type="text"
                    className="input font-semibold"
                    value={title}
                    onChange={(e) => {
                      onTitleChange(e.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
                {loadingBody && <p className="mt-2 text-xs text-ink-3">{t("Loading chapter content…")}</p>}
                {loadError && (
                  <div className="banner mt-2">
                    <Icon name="alert" size={14} />
                    <p className="min-w-0">{loadError}</p>
                  </div>
                )}
                <div
                  key={editorKey}
                  className="chapter-body"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  aria-label={t("Content for chapter {order}", { order })}
                  data-placeholder={t("Paste chapter content here")}
                  ref={bodyEl}
                  onInput={() => {
                    const live = bodyEl.current?.innerHTML;
                    if (live !== undefined) onBodyChange(live);
                    setDirty(true);
                  }}
                  dangerouslySetInnerHTML={{ __html: html }}
                />

                {saveError && (
                  <div className="banner mt-2">
                    <Icon name="alert" size={14} />
                    <p className="min-w-0">{saveError}</p>
                  </div>
                )}

                {onSave && (
                  <div className="chapter-actions mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-tiny"
                      disabled={saving || !dirty}
                      onClick={handleSave}
                    >
                      <Icon name={saved ? "check" : "upload"} size={13} />
                      {saving ? t("Saving…") : saved ? t("Saved") : t("Save chapter")}
                    </button>
                    <button type="button" className="btn btn-quiet btn-tiny" disabled={saving || !dirty} onClick={handleRevert}>
                      <Icon name="retry" size={13} />
                      {t("Undo")}
                    </button>
                    <button type="button" className="btn btn-quiet btn-tiny" disabled={retrying} onClick={handleRecrawl}>
                      <Icon name="retry" size={13} className={retrying ? "animate-spin" : undefined} />
                      {retrying ? t("Retrying…") : t("Re-crawl")}
                    </button>
                    <span className="text-xs text-ink-3">
                      {dirty
                        ? t("Remember to click Save chapter after editing, or changes will be lost when you close.")
                        : t("Edit the title and content to remove unwanted source page elements.")}
                    </span>
                  </div>
                )}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
