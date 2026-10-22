import { gutterWidth } from "./FileLines";

/**
 * What an editor shows for a file it cannot show yet (loading, not downloaded, failed):
 * a comment in the file, in the editor's own look, with the way forward under it.
 */
export function FileNotice({
  message,
  tone = "comment",
  action,
}: {
  message: string;
  tone?: "comment" | "error" | "dim";
  action?: { label: string; run: () => void } | null;
}) {
  const gutter = gutterWidth(1);
  const color = tone === "error" ? "text-code-error" : tone === "dim" ? "text-code-dim" : "text-code-comment";
  return (
    <div className="pt-1 font-mono text-[14px] leading-[22px]" role={tone === "error" ? "alert" : undefined}>
      <div className="flex">
        <span aria-hidden="true" className="flex-none select-none pr-[3ch] text-right text-code-gutter-active" style={{ width: gutter }}>
          1
        </span>
        <span className={`min-w-0 max-w-[100ch] flex-1 whitespace-pre-wrap break-words pr-8 ${color}`}>
          {tone === "dim" ? message : `<!-- ${message} -->`}
        </span>
      </div>
      {action && (
        <div className="mt-3 flex">
          <span className="flex-none" style={{ width: gutter }} />
          <button
            type="button"
            className="rounded-[2px] bg-code-status px-3 py-[3px] font-ui text-[13px] text-code-status-fg outline-none hover:opacity-90 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-code-focus"
            onClick={action.run}
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}
