import { ChevronLeft, ChevronRight, Copy, Download, Ellipsis, File, History, PanelLeftOpen, Pencil, SquareTerminal } from "lucide-react";
import { ReactNode, RefObject, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ChapterText } from "../../hooks/useChapterLines";
import { ChapterLine } from "../../lib/skins/chapterLines";
import { useLang } from "../../i18n";
import { stripUrls } from "../../lib/skins/crawlLog";
import { ShownStatus } from "../../lib/skins/chapters";
import { Avatar, BOX, BTN, FOCUS, ICON_BTN, Spinner, StatusIcon } from "./RepoChrome";
import { BOT, RawRow, commitMessage, fileStats, firstVisible, formatSize, rawRows, relativeTime, shortSha } from "./repoModel";

export type BlobMode = "preview" | "code";

export interface FileLink {
  order: number;
  name: string;
}

/**
 * One file of a repository, the way the site shows a Markdown file: breadcrumb, the
 * file's last commit, then a box whose header stays on screen while scrolling (Preview |
 * Code, size, previous/next file) and the file itself — rendered as a readable article,
 * or as numbered source lines. The line at the top of the screen is reported as it
 * changes, and the file opens at `startLine`.
 */
export function BlobView({
  storyId,
  repo,
  file,
  status,
  failure,
  missing,
  text,
  error,
  mode,
  onMode,
  previous,
  next,
  onStep,
  onRepo,
  onDownload,
  scroller,
  startLine,
  onTopLine,
  committedAt,
  now,
  sidebar,
  onShowTree,
}: {
  storyId: string;
  repo: string;
  file: FileLink;
  // The file's state; null while the file list loads.
  status: ShownStatus | null;
  failure: string | null;
  missing: boolean;
  text: ChapterText | null;
  error: string | null;
  mode: BlobMode;
  onMode: (mode: BlobMode) => void;
  previous: FileLink | null;
  next: FileLink | null;
  onStep: (direction: 1 | -1) => void;
  onRepo: () => void;
  onDownload: (() => void) | null;
  scroller: RefObject<HTMLDivElement | null>;
  startLine: number;
  onTopLine: (line: number) => void;
  committedAt: string | null;
  now: number;
  // The file tree beside the file (FileTreePanel); with it folded away, `onShowTree` brings
  // it back from a button before the path.
  sidebar?: ReactNode;
  onShowTree?: () => void;
}) {
  const { t } = useLang();
  const header = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const fileKey = `${storyId}:${file.order}`;
  // The line at the top of the screen, starting where the file was left.
  const top = useRef(startLine);
  const shownKey = useRef(fileKey);
  if (shownKey.current !== fileKey) {
    shownKey.current = fileKey;
    top.current = startLine;
  }
  const report = useRef(onTopLine);
  report.current = onTopLine;

  const lines = text?.lines ?? null;
  const rows = useMemo(() => (lines ? rawRows(lines) : []), [lines]);
  const stats = useMemo(() => fileStats(rows), [rows]);
  const ready = !!lines && lines.length > 0;

  const scrollToLine = useCallback(
    (line: number) => {
      const box = scroller.current;
      if (!box) return;
      const target = line > 0 ? body.current?.querySelector<HTMLElement>(`[data-line="${line}"]`) : null;
      if (!target) {
        box.scrollTop = 0;
        return;
      }
      const offset = header.current?.offsetHeight ?? 0;
      box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - offset - 8;
    },
    [scroller]
  );

  // A new file, its text arriving, or the other mode: back to the line at the top.
  useLayoutEffect(() => {
    if (ready) scrollToLine(top.current);
    else if (scroller.current) scroller.current.scrollTop = 0;
  }, [ready, fileKey, mode, scrollToLine, scroller]);

  useEffect(() => {
    const box = scroller.current;
    if (!box || !ready) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const marked = body.current?.querySelectorAll<HTMLElement>("[data-line]");
      if (!marked || marked.length === 0) return;
      const threshold = box.getBoundingClientRect().top + (header.current?.offsetHeight ?? 0) + 1;
      const index = firstVisible(marked.length, (at) => marked[at].getBoundingClientRect().bottom, threshold);
      const line = Number(marked[index].dataset.line);
      if (Number.isNaN(line) || line === top.current) return;
      top.current = line;
      report.current(line);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ready, fileKey, mode, scroller]);

  let content;
  if (missing) content = <Notice>{t("This file no longer exists.")}</Notice>;
  else if (status === null) content = <Spinner label={t("Loading…")} />;
  else if (status === "error")
    content = (
      <Notice tone="danger">
        {failure ? t("Download failed: {message}", { message: stripUrls(failure) }) : t("Download failed")}
      </Notice>
    );
  else if (status !== "done")
    content = (
      <Notice>
        <p>{t("Not downloaded yet.")}</p>
        {onDownload && (
          <button type="button" className={`${BTN} mt-4`} onClick={onDownload}>
            {t("Download the rest")}
          </button>
        )}
      </Notice>
    );
  else if (error && !lines) content = <Notice tone="danger">{`${t("Could not open this file")}: ${stripUrls(error)}`}</Notice>;
  else if (!lines) content = <Spinner label={t("Loading…")} />;
  else if (lines.length === 0) content = <Notice>{t("This file is empty.")}</Notice>;
  else content = <FileBody lines={lines} rows={rows} mode={mode} />;

  const segment = (value: BlobMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => onMode(value)}
      className={`h-7 rounded-md px-3 text-[14px] ${FOCUS} ${
        mode === value ? "border border-repo-border bg-repo-canvas font-semibold" : "border border-transparent text-repo-muted hover:text-repo-fg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex w-full">
      {sidebar}
      <div className="min-w-0 flex-1 px-4 py-4 md:px-6">
        <div className="mb-3 flex items-center gap-2">
          {!sidebar && onShowTree && (
            <button type="button" className={`${ICON_BTN} hidden md:grid`} aria-label="Expand file tree" title="Expand file tree" onClick={onShowTree}>
              <PanelLeftOpen size={16} aria-hidden="true" />
            </button>
          )}
          <nav aria-label="File path" className="flex min-w-0 items-center gap-1 text-[16px]">
            <button type="button" onClick={onRepo} className={`flex-none font-semibold text-repo-accent hover:underline ${FOCUS}`}>
              {repo}
            </button>
            <span className="text-repo-muted">/</span>
            <h1 className="min-w-0 truncate font-semibold">{file.name}</h1>
            <span className="ml-1 flex-none text-repo-muted" aria-hidden="true">
              <Copy size={16} />
            </span>
          </nav>
        </div>

        <div className={`${BOX} mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]`}>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar seed={BOT} size={20} square />
            <b className="flex-none">{BOT}</b>
            {status && (
              <span className="flex min-w-0 items-center gap-1.5 text-repo-muted">
                <span className="truncate">{commitMessage(file.order, status)}</span>
                {status === "running" && <StatusIcon status="running" size={14} />}
              </span>
            )}
          </span>
          <span className="flex flex-none items-center gap-3 text-[12px] text-repo-muted">
            <span className="font-repo-mono">{shortSha(`${storyId}:${file.order}`)}</span>
            {committedAt && <span>· {relativeTime(committedAt, now)}</span>}
            <span className="flex items-center gap-1 text-[14px] text-repo-fg" aria-hidden="true">
              <History size={16} className="text-repo-muted" />
              History
            </span>
          </span>
        </div>

        <section className={BOX} aria-label={file.name}>
          <div
            ref={header}
            className="sticky top-0 z-10 flex items-center gap-2 rounded-t-md border-b border-repo-border bg-repo-subtle px-2 py-2"
          >
            <div className="flex flex-none items-center rounded-md border border-repo-border bg-repo-btn p-0.5" role="group" aria-label="View">
              {segment("preview", "Preview")}
              {segment("code", "Code")}
            </div>
            {ready && (
              <span className="hidden min-w-0 truncate text-[12px] text-repo-muted sm:block">
                {stats.lines} lines ({stats.loc} loc) · {formatSize(stats.bytes)}
              </span>
            )}
            <span className="ml-auto hidden items-center gap-1 lg:flex" aria-hidden="true">
              <span className="flex h-7 items-center rounded-md border border-repo-border px-2 text-[12px] font-medium">Raw</span>
              <span className="grid size-7 place-items-center rounded-md border border-repo-border text-repo-muted">
                <Copy size={14} />
              </span>
              <span className="grid size-7 place-items-center rounded-md border border-repo-border text-repo-muted">
                <Download size={14} />
              </span>
              <span className="grid size-7 place-items-center rounded-md text-repo-muted">
                <Pencil size={14} />
              </span>
              <span className="grid size-7 place-items-center rounded-md text-repo-muted">
                <SquareTerminal size={14} />
              </span>
            </span>
            <span className="ml-auto flex items-center gap-1 lg:ml-2">
              <button
                type="button"
                className={`${ICON_BTN} size-7`}
                disabled={!previous}
                onClick={() => onStep(-1)}
                aria-label={t("Previous file")}
                title={`${t("Previous file")} ([)`}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`${ICON_BTN} size-7`}
                disabled={!next}
                onClick={() => onStep(1)}
                aria-label={t("Next file")}
                title={`${t("Next file")} (])`}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <span className="grid size-7 place-items-center text-repo-muted" aria-hidden="true">
                <Ellipsis size={16} />
              </span>
            </span>
          </div>
          <div ref={body}>{content}</div>
        </section>

        <div className="mt-4 flex flex-wrap justify-between gap-2">
          {previous ? (
            <button type="button" className={`${BTN} max-w-[48%]`} onClick={() => onStep(-1)}>
              <ChevronLeft size={16} className="flex-none text-repo-muted" aria-hidden="true" />
              <span className="truncate">{previous.name}</span>
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button type="button" className={`${BTN} max-w-[48%]`} onClick={() => onStep(1)}>
              <span className="truncate">{next.name}</span>
              <ChevronRight size={16} className="flex-none text-repo-muted" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ children, tone }: { children: ReactNode; tone?: "danger" }) {
  return (
    <div className={`flex flex-col items-center px-6 py-16 text-center text-[14px] ${tone === "danger" ? "text-repo-danger" : "text-repo-muted"}`}>
      <File size={24} className="mb-3 text-repo-muted" aria-hidden="true" />
      <div className="max-w-[560px] break-words">{children}</div>
    </div>
  );
}

// The file itself, kept out of the header's re-renders: a download ticking in the
// background changes the file list on every event, never these lines.
const FileBody = memo(function FileBody({ lines, rows, mode }: { lines: ChapterLine[]; rows: RawRow[]; mode: BlobMode }) {
  if (mode === "preview") {
    return (
      <article aria-label="Preview" className="px-5 py-8 sm:px-10">
        <div className="mx-auto max-w-[46rem] break-words text-[16px] leading-[1.7]">
          {lines.map((line, index) => {
            if (line.kind === "heading") {
              return index === 0 ? (
                <h1 key={index} data-line={index} className="mb-4 border-b border-repo-border-muted pb-2 text-[2em] font-semibold leading-tight">
                  {line.text}
                </h1>
              ) : (
                <h2 key={index} data-line={index} className="mb-4 mt-8 border-b border-repo-border-muted pb-1.5 text-[1.5em] font-semibold leading-tight">
                  {line.text}
                </h2>
              );
            }
            return (
              <p key={index} data-line={index} className={`mb-4 ${line.kind === "media" ? "italic text-repo-muted" : ""}`}>
                {line.text}
              </p>
            );
          })}
        </div>
      </article>
    );
  }
  return (
    <div className="overflow-x-auto py-2">
      <table aria-label="Code" className="w-full border-collapse font-repo-mono text-[13px] leading-[20px]">
        <tbody>
          {rows.map((row) => {
            const kind = row.line !== null ? lines[row.line].kind : "text";
            return (
              <tr key={row.number} data-line={row.line ?? undefined}>
                <td className="w-[1%] select-none whitespace-nowrap pl-4 pr-4 text-right align-top text-repo-muted">{row.number}</td>
                <td className="pr-4 align-top">
                  <div
                    className={`max-w-[56rem] whitespace-pre-wrap break-words ${
                      kind === "heading" ? "font-semibold text-repo-accent" : kind === "media" ? "text-repo-muted" : ""
                    }`}
                  >
                    {row.text || "\u200b"}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
