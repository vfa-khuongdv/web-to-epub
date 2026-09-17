import { useRef, useState } from "react";
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
}: {
  order: number;
  title: string;
  url: string;
  state?: ChipState;
}) {
  return (
    <tr>
      <td className="w-9 pr-1">
        <input type="checkbox" className="checkbox" disabled aria-label={`Chương ${order} chưa crawl`} />
      </td>
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
  included: boolean;
  onTitleChange: (title: string) => void;
  onIncludedChange: (included: boolean) => void;
  onRetry: () => void;
  retrying: boolean;
  retriedOnce: boolean;
  onBodyChange: (html: string) => void;
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
}: ChapterCardProps) {
  const [html, setHtml] = useState(() => blocksToHtml(chapter.blocks));
  // Lets the user paste in content they viewed and copied themselves from a
  // normal browser (e.g. a chapter gated behind the site's own anti-adblock
  // wall) instead of this tool trying to defeat that gate automatically.
  const [manualMode, setManualMode] = useState(false);
  const [open, setOpen] = useState(false);
  const bodyEl = useRef<HTMLDivElement | null>(null);

  const failed = !!chapter.error && !manualMode;
  const panelId = `chapter-panel-${order}`;
  const chip: ChipState | null = retrying ? "running" : failed ? "error" : manualMode ? null : "done";

  function toggle() {
    if (open) {
      const live = bodyEl.current?.innerHTML;
      if (live !== undefined) {
        setHtml(live);
        onBodyChange(live);
      }
    }
    setOpen((o) => !o);
  }

  function enterManualMode() {
    setManualMode(true);
    setOpen(true);
    onIncludedChange(true);
  }

  return (
    <>
      <tr>
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
          <td colSpan={5}>
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
                    onChange={(e) => onTitleChange(e.target.value)}
                  />
                </div>
                <div
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
                  }}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
