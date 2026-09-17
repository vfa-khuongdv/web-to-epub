import { useState } from "react";
import { ExtractedChapter } from "../types";
import { blocksToHtml } from "../blocksToHtml";

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
  bodyRef: (el: HTMLDivElement | null) => void;
}

// The chapter body is intentionally uncontrolled: dangerouslySetInnerHTML is
// set once from the chapter's extracted blocks (lazy state init) and never
// updated by React afterwards, so a user's manual contentEditable edits
// aren't wiped out by re-renders triggered by, say, toggling the checkbox.
// Its live content is read back via `bodyRef` at export time.
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
  bodyRef,
}: ChapterCardProps) {
  const [initialHtml] = useState(() => blocksToHtml(chapter.blocks));
  // Lets the user paste in content they viewed and copied themselves from a
  // normal browser (e.g. a chapter gated behind the site's own anti-adblock
  // wall) instead of this tool trying to defeat that gate automatically.
  const [manualMode, setManualMode] = useState(false);

  if (chapter.error && !manualMode) {
    return (
      <div className="chapter chapter-failed">
        <div className="chapter-head">
          <span className="chapter-order">#{order}</span>
          <input type="checkbox" className="chapter-include" checked={false} disabled />
          <input type="text" className="chapter-title" value={chapter.sourceUrl} disabled />
        </div>
        <p className="chapter-source">Nguồn: {chapter.sourceUrl}</p>
        <div className="chapter-error">
          <p>⚠️ Lỗi trích xuất: {chapter.error}</p>
          <div className="chapter-error-actions">
            <button type="button" className="btn-retry-chapter" disabled={retrying} onClick={onRetry}>
              {retrying ? "Đang thử lại..." : "Thử lại"}
            </button>
            {retriedOnce && (
              <button
                type="button"
                className="btn-manual-entry"
                onClick={() => {
                  setManualMode(true);
                  onIncludedChange(true);
                }}
              >
                Nhập nội dung thủ công
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`chapter${manualMode ? " chapter-manual" : ""}`}>
      <div className="chapter-head">
        <span className="chapter-order">#{order}</span>
        <input
          type="checkbox"
          className="chapter-include"
          checked={included}
          onChange={(e) => onIncludedChange(e.target.checked)}
        />
        <input
          type="text"
          className="chapter-title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />
      </div>
      <p className="chapter-source">
        Nguồn: {chapter.sourceUrl}
        {manualMode && " — nội dung nhập thủ công"}
      </p>
      <div
        className="chapter-body"
        contentEditable
        suppressContentEditableWarning
        ref={bodyRef}
        dangerouslySetInnerHTML={{ __html: initialHtml }}
      />
    </div>
  );
}
