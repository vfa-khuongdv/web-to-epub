import { useEffect, useRef, useState } from "react";
import { ExtractedChapter } from "../types";
import { blocksToHtml } from "../blocksToHtml";
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
  includeColumn = false,
}: {
  order: number;
  title: string;
  url: string;
  state?: ChipState;
  // Giữ đúng số cột với bảng đang dùng nó (xem ChapterCardProps.included).
  includeColumn?: boolean;
}) {
  return (
    <tr>
      {includeColumn && (
        <td className="w-9 pr-1">
          <input type="checkbox" className="checkbox" disabled aria-label={`Chương ${order} chưa crawl`} />
        </td>
      )}
      <td className="num w-11">
        <b>{order}</b>
      </td>
      <td>
        <span className="cell-title">
          <span className="t">{title || url}</span>
        </span>
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
          title="Mở trang nguồn"
        >
          <Icon name="open" size={13} />
          <span className="visually-hidden">Mở trang nguồn của chương {order}</span>
        </a>
      </td>
    </tr>
  );
}

interface ChapterCardProps {
  chapter: ExtractedChapter;
  order: number;
  title: string;
  // Vắng mặt ở tab thư viện: truyện đã lưu thì xuất hết chương đã crawl, không
  // có gì để chọn. Tab "Crawl thủ công" vẫn cần vì người dùng dán từng chương.
  included?: boolean;
  onTitleChange: (title: string) => void;
  onIncludedChange?: (included: boolean) => void;
  onRetry: () => void;
  retrying: boolean;
  retriedOnce: boolean;
  onBodyChange: (html: string) => void;
  // Nội dung chương không còn đi kèm danh sách chương: mở chương nào thì tải
  // chương đó. Vắng mặt ở tab "Crawl thủ công" vì nội dung đã có sẵn trong RAM.
  loadBody?: () => Promise<string>;
  // Vắng mặt ở tab "Crawl thủ công": chương chưa nằm trong thư viện nên không
  // có gì để lưu vào, chỉ sửa tạm rồi xuất EPUB.
  onSave?: (title: string, contentHtml: string) => Promise<void>;
}

// Playwright's failure text arrives with the time annotations from its Call
// log still in it ("[22m", "[2m"); they are noise in a sentence a person reads.
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
// Edits stay in the browser until "Lưu chương" writes them to the DB: crawled
// text usually carries leftovers from the source page, and cleaning it up is
// only worth doing once if it survives a reload.
export default function ChapterCard({
  chapter,
  order,
  title,
  included,
  onTitleChange,
  onIncludedChange,
  onRetry,
  retrying,
  retriedOnce,
  onBodyChange,
  loadBody,
  onSave,
}: ChapterCardProps) {
  const initialHtml = () => blocksToHtml(chapter.blocks);
  const [html, setHtml] = useState(initialHtml);
  // Lets the user paste in content they viewed and copied themselves from a
  // normal browser (e.g. a chapter gated behind the site's own anti-adblock
  // wall) instead of this tool trying to defeat that gate automatically.
  const [manualMode, setManualMode] = useState(false);
  const [open, setOpen] = useState(false);
  const bodyEl = useRef<HTMLDivElement | null>(null);

  // Bản đã lưu gần nhất: dùng để "Hoàn tác" quay về đúng nội dung trong DB.
  const [savedTitle, setSavedTitle] = useState(title);
  const [savedHtml, setSavedHtml] = useState(initialHtml);
  // Cờ tự đặt thay vì so chuỗi: trình duyệt tự chuẩn hoá HTML lúc gắn vào khung
  // soạn thảo (`<img />` -> `<img>`), so chuỗi sẽ báo "đã sửa" ngay khi vừa mở.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadedBody = useRef(false);
  // Tăng lên để remount khung soạn thảo — cách duy nhất ép một vùng
  // contentEditable không kiểm soát nhận lại nội dung cũ khi hoàn tác.
  const [editorKey, setEditorKey] = useState(0);

  const failed = !!chapter.error && !manualMode;
  const panelId = `chapter-panel-${order}`;
  const chip: ChipState | null = retrying ? "running" : failed ? "error" : manualMode ? null : "done";

  // Nhấp nháy "Đã lưu" trên nút sau khi lưu thành công.
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

  // Tải nội dung đúng một lần cho mỗi lần dựng thẻ: đóng rồi mở lại không gọi
  // thêm request, và bản người dùng đang sửa dở không bị ghi đè.
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
    onIncludedChange?.(true);
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
      // Nội dung dán tay giờ đã nằm trong DB như một chương bình thường.
      setManualMode(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
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

  return (
    <>
      <tr className={open ? "row-open" : undefined}>
        {onIncludedChange && (
          <td className="w-9 pr-1">
            <input
              type="checkbox"
              className="checkbox"
              checked={included}
              disabled={failed}
              onChange={(e) => onIncludedChange(e.target.checked)}
              aria-label={`Đưa chương ${order} vào sách`}
            />
          </td>
        )}
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
            {dirty && <span className="chip shrink-0">Chưa lưu</span>}
          </button>
        </td>
        <td className="w-32">
          {chip ? (
            <StatusChip state={chip} label={retrying ? "Đang thử lại" : undefined} />
          ) : (
            <span className="chip">
              <Icon name="edit" size={12} />
              Nhập thủ công
            </span>
          )}
        </td>
        <td className="w-28">
          {failed && (
            <button type="button" className="btn btn-tiny" disabled={retrying} onClick={onRetry}>
              <Icon name="retry" size={13} className={retrying ? "animate-spin" : undefined} />
              {retrying ? "Đang thử…" : "Thử lại"}
            </button>
          )}
        </td>
      </tr>

      {open && (
        <tr className="chapter-open" id={panelId}>
          <td colSpan={onIncludedChange ? 5 : 4}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
              <span className="break-all">
                Nguồn:{" "}
                <a href={chapter.sourceUrl} target="_blank" rel="noreferrer">
                  {chapter.sourceUrl}
                </a>
              </span>
            </div>

            {failed ? (
              <>
                <div className="banner mt-2">
                  <Icon name="alert" size={14} />
                  <div className="min-w-0">
                    <p className="font-semibold">Không trích xuất được chương này</p>
                    <p className="mt-0.5 font-mono text-[11.5px] leading-relaxed">{tidyError(chapter.error ?? "")}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-tiny" disabled={retrying} onClick={onRetry}>
                    <Icon name="retry" size={13} className={retrying ? "animate-spin" : undefined} />
                    {retrying ? "Đang thử lại…" : "Thử lại"}
                  </button>
                  {retriedOnce ? (
                    <button type="button" className="btn btn-tiny" onClick={enterManualMode}>
                      <Icon name="edit" size={13} />
                      Nhập nội dung thủ công
                    </button>
                  ) : (
                    <span className="text-xs text-ink-3">Nhiều lỗi chỉ là tạm thời — thử lại trước đã.</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="mt-2">
                  <label className="visually-hidden" htmlFor={`chapter-title-${order}`}>
                    Tiêu đề chương {order}
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
                {loadingBody && <p className="mt-2 text-xs text-ink-3">Đang tải nội dung chương…</p>}
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
                  aria-label={`Nội dung chương ${order}`}
                  data-placeholder="Dán nội dung chương vào đây"
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
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={saving || !dirty}
                    onClick={handleSave}
                  >
                    <Icon name={saved ? "check" : "upload"} size={13} />
                    {saving ? "Đang lưu…" : saved ? "Đã lưu" : "Lưu chương"}
                  </button>
                  <button type="button" className="btn btn-quiet btn-tiny" disabled={saving || !dirty} onClick={handleRevert}>
                    <Icon name="retry" size={13} />
                    Hoàn tác
                  </button>
                  <span className="text-xs text-ink-3">
                    {dirty ? "Sửa xong nhớ bấm Lưu chương, nếu không đóng app là mất." : "Sửa tên và nội dung để bỏ phần thừa của trang nguồn."}
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
