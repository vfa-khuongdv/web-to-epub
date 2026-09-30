import { useState } from "react";
import { useLang } from "../i18n";
import { Icon } from "./Icon";
import { ChipState, StatusChip } from "./StatusChip";

// A chapter the crawl has not reached yet — or has just finished, while the
// view still holds the pre-crawl snapshot: no content to edit or include, just
// its place in the list, its live state, and a way to look at the source page.
export default function PendingChapterRow({
  order,
  title,
  url,
  state = "pending",
  onSaveTitle,
  onDelete,
  deleteDisabled,
}: {
  order: number;
  title: string;
  url: string;
  state?: ChipState;
  // Missing when the row isn't editable in this context. The site's own TOC-derived
  // name can be wrong; fixing it here — before the chapter is even crawled — means the
  // corrected title is what ends up in the book, not something patched up afterwards.
  onSaveTitle?: (title: string) => Promise<void>;
  // Missing when the chapter cannot be deleted from this context (e.g. no library yet).
  onDelete?: () => Promise<void>;
  deleteDisabled?: boolean;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch {
      // The detail pane's banner reports the failure; keep the confirm open to retry.
    } finally {
      setDeleting(false);
    }
  }

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
      <td className="w-44">
        {confirmDelete ? (
          <span className="flex items-center justify-end gap-1.5">
            <button type="button" className="btn btn-tiny btn-danger" disabled={deleting} onClick={handleDelete}>
              {t("Delete")}
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
            >
              {t("Cancel")}
            </button>
          </span>
        ) : (
          <span className="flex items-center justify-end gap-1">
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
            {onDelete && (
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                title={deleteDisabled ? t("Crawling, cannot delete") : t("Delete chapter")}
                aria-label={t("Delete chapter {order}", { order })}
                disabled={deleteDisabled}
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </span>
        )}
      </td>
    </tr>
  );
}
