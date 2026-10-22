import { Activity, BookOpen, ChevronDown, Code, Eye, File, GitBranch, GitFork, History, Star, Tag } from "lucide-react";
import { KeyboardEvent, RefObject, useMemo } from "react";
import { LiveCrawl } from "../../hooks/useCrawlJob";
import { useLang } from "../../i18n";
import { stripUrls } from "../../lib/skins/crawlLog";
import { ShownStatus } from "../../lib/skins/chapters";
import {
  Avatar,
  BOX,
  BTN,
  BTN_PRIMARY,
  BTN_SM,
  Blankslate,
  FOCUS,
  Flash,
  INPUT,
  Kbd,
  Pagination,
  Spinner,
  StatusIcon,
} from "./RepoChrome";
import { BOT, BRANCH, FILES_PER_PAGE, clampPage, commitMessage, fileTime, pageCount, pageSlice, relativeTime, shortSha } from "./repoModel";

export interface FileEntry {
  order: number;
  name: string;
  status: ShownStatus;
}

const STATUS_KIND = { running: "running", pending: "queued", error: "failure", done: "success" } as const;

/**
 * A repository's Code tab: the branch bar, the latest commit, one row per file (a
 * chapter, paged a hundred at a time), then the README and the About column. The file
 * read last is marked, and the page it is on is the one shown when the repository opens.
 */
export function CodeTab({
  storyId,
  repo,
  description,
  updatedAt,
  files,
  loading,
  error,
  onRetry,
  crawl,
  page,
  onPage,
  query,
  onQuery,
  filterRef,
  onOpenFile,
  lastRead,
  onActions,
  onDownload,
  now,
}: {
  storyId: string;
  repo: string;
  description: string;
  updatedAt: string | null;
  files: FileEntry[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  crawl: LiveCrawl | undefined;
  page: number;
  onPage: (page: number) => void;
  query: string;
  onQuery: (query: string) => void;
  filterRef: RefObject<HTMLInputElement>;
  onOpenFile: (order: number) => void;
  lastRead: FileEntry | null;
  onActions: () => void;
  onDownload: (() => void) | null;
  now: number;
}) {
  const { t } = useLang();
  const matches = useMemo(() => {
    if (!files) return null;
    const wanted = query.trim().toLowerCase();
    return wanted ? files.filter((file) => file.name.toLowerCase().includes(wanted)) : files;
  }, [files, query]);
  const lastOrder = files && files.length > 0 ? files[files.length - 1].order : 0;
  const latest = useMemo(() => {
    if (!files) return null;
    for (let index = files.length - 1; index >= 0; index--) if (files[index].status === "done") return files[index];
    return files[files.length - 1] ?? null;
  }, [files]);
  const pages = matches ? pageCount(matches.length, FILES_PER_PAGE) : 1;
  // The list may have shrunk under a remembered page (a filter, a re-fetch).
  const current = matches ? clampPage(page, matches.length, FILES_PER_PAGE) : 0;
  const shown = matches ? pageSlice(matches, current, FILES_PER_PAGE) : [];
  const stamp = (order: number) => (updatedAt ? relativeTime(fileTime(updatedAt, order, lastOrder), now) : "");

  const onFilterKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && matches?.[0]) {
      event.preventDefault();
      onOpenFile(matches[0].order);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onQuery("");
      event.currentTarget.blur();
    }
  };

  let table;
  if (!files && loading) table = <Spinner label={t("Loading…")} />;
  else if (!files && error)
    table = (
      <div className="p-4">
        <Flash tone="danger">
          <p>{stripUrls(error)}</p>
          <button type="button" className={`${BTN_SM} mt-3`} onClick={onRetry}>
            {t("Retry")}
          </button>
        </Flash>
      </div>
    );
  else if (!files || files.length === 0)
    table = (
      <Blankslate icon={<File size={24} />} title={t("This repository is empty.")}>
        {onDownload && (
          <button type="button" className={`${BTN} mt-4`} onClick={onDownload}>
            {t("Download the rest")}
          </button>
        )}
      </Blankslate>
    );
  else if (matches && matches.length === 0)
    table = <Blankslate icon={<File size={24} />} title={t("No files matched your search.")} />;
  else
    table = (
      <table aria-label="Files" className="w-full table-fixed border-collapse text-[14px]">
        <thead className="sr-only">
          <tr>
            <th>Name</th>
            <th>Last commit message</th>
            <th>Last commit date</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((file) => {
            const marked = lastRead?.order === file.order;
            return (
              <tr
                key={file.order}
                data-file-order={file.order}
                className={`h-10 border-t border-repo-border-muted ${marked ? "bg-repo-attention-soft" : "hover:bg-repo-hover"}`}
              >
                <td className="w-[40%] py-0 pl-4 pr-2 sm:w-[34%]">
                  <span className="flex min-w-0 items-center gap-2">
                    <File size={16} className="flex-none text-repo-muted" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => onOpenFile(file.order)}
                      className={`min-w-0 truncate text-left text-repo-fg hover:text-repo-accent hover:underline ${FOCUS}`}
                      title={file.name}
                    >
                      {file.name}
                    </button>
                  </span>
                </td>
                <td className="hidden px-2 text-repo-muted sm:table-cell">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {file.status !== "done" && <StatusIcon status={STATUS_KIND[file.status]} size={14} />}
                    <span className="truncate">{commitMessage(file.order, file.status)}</span>
                  </span>
                </td>
                <td className="w-[120px] whitespace-nowrap pl-2 pr-4 text-right text-repo-muted sm:w-[150px]">{stamp(file.order)}</td>
              </tr>
            );
          })}
          {current === pages - 1 && !query && (
            <tr className="h-10 border-t border-repo-border-muted hover:bg-repo-hover">
              <td className="py-0 pl-4 pr-2">
                <span className="flex items-center gap-2">
                  <File size={16} className="flex-none text-repo-muted" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => document.getElementById("readme")?.scrollIntoView({ block: "start" })}
                    className={`text-repo-fg hover:text-repo-accent hover:underline ${FOCUS}`}
                  >
                    README.md
                  </button>
                </span>
              </td>
              <td className="hidden truncate px-2 text-repo-muted sm:table-cell">docs: add README</td>
              <td className="whitespace-nowrap pl-2 pr-4 text-right text-repo-muted">{files.length > 0 ? stamp(files[0].order) : ""}</td>
            </tr>
          )}
        </tbody>
      </table>
    );

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_296px]">
      <div className="min-w-0">
        {lastRead && (
          <div className="mb-4">
            <Flash tone="attention">
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <History size={16} className="flex-none text-repo-attention" aria-hidden="true" />
                  <span className="min-w-0 truncate">{t("You were reading {file}", { file: lastRead.name })}</span>
                </span>
                <button type="button" className={BTN_SM} onClick={() => onOpenFile(lastRead.order)}>
                  {t("Open")}
                </button>
              </span>
            </Flash>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className={BTN} aria-hidden="true">
            <GitBranch size={16} className="text-repo-muted" />
            {BRANCH}
            <ChevronDown size={14} className="text-repo-muted" />
          </span>
          <span className="hidden items-center gap-4 px-2 text-[14px] text-repo-muted lg:flex" aria-hidden="true">
            <span className="flex items-center gap-1">
              <GitBranch size={16} />
              <b className="text-repo-fg">1</b> Branch
            </span>
            <span className="flex items-center gap-1">
              <Tag size={16} />
              <b className="text-repo-fg">0</b> Tags
            </span>
          </span>
          <label className="relative ml-auto flex min-w-0 flex-1 items-center sm:max-w-[260px]">
            <input
              ref={filterRef}
              type="search"
              data-boss-key=""
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={onFilterKey}
              placeholder="Go to file"
              aria-label={t("Go to file…")}
              className={`${INPUT} w-full pr-9`}
            />
            <span className="pointer-events-none absolute right-2">
              <Kbd>t</Kbd>
            </span>
          </label>
          <span className={BTN_PRIMARY} aria-hidden="true">
            <Code size={16} />
            Code
            <ChevronDown size={14} />
          </span>
        </div>

        <div className={BOX}>
          <div className="flex min-h-[60px] flex-wrap items-center gap-x-3 gap-y-1 rounded-t-md bg-repo-subtle px-4 py-3 text-[14px]">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Avatar seed={BOT} size={20} square />
              <b className="flex-none">{BOT}</b>
              {crawl ? (
                <button type="button" onClick={onActions} className={`flex min-w-0 items-center gap-1.5 text-repo-muted hover:text-repo-accent ${FOCUS}`}>
                  <StatusIcon status="running" size={14} />
                  <span className="truncate">{t("Downloading {done}/{total}", { done: crawl.cursor, total: crawl.total })}</span>
                </button>
              ) : (
                latest && (
                  <span className="flex min-w-0 items-center gap-1.5 text-repo-muted">
                    <span className="truncate">{commitMessage(latest.order, latest.status)}</span>
                    <StatusIcon status={STATUS_KIND[latest.status]} size={14} />
                  </span>
                )
              )}
            </span>
            <span className="flex flex-none items-center gap-3 text-[12px] text-repo-muted">
              <span className="font-repo-mono">{shortSha(`${storyId}:${latest?.order ?? 0}`)}</span>
              <span>· {updatedAt ? relativeTime(updatedAt, now) : ""}</span>
              <span className="flex items-center gap-1 text-[14px] text-repo-fg">
                <History size={16} className="text-repo-muted" aria-hidden="true" />
                <b>{(files?.length ?? 0) + 3}</b> Commits
              </span>
            </span>
          </div>
          {table}
        </div>
        <Pagination page={current} pages={pages} onPage={onPage} label="Pagination" previousLabel={t("Previous page")} nextLabel={t("Next page")} />

        <Readme repo={repo} description={description} />
      </div>

      <aside className="hidden text-[14px] md:block" aria-label="About">
        <h2 className="mb-4 text-[16px] font-semibold">About</h2>
        <p className="mb-4 text-[16px] leading-normal">{description}</p>
        <ul className="space-y-2 text-repo-muted" aria-hidden="true">
          <li className="flex items-center gap-2">
            <BookOpen size={16} />
            Readme
          </li>
          <li className="flex items-center gap-2">
            <Activity size={16} />
            Activity
          </li>
          <li className="flex items-center gap-2">
            <Star size={16} />
            <b className="text-repo-fg">0</b> stars
          </li>
          <li className="flex items-center gap-2">
            <Eye size={16} />
            <b className="text-repo-fg">1</b> watching
          </li>
          <li className="flex items-center gap-2">
            <GitFork size={16} />
            <b className="text-repo-fg">0</b> forks
          </li>
        </ul>
        <div className="mt-6 border-t border-repo-border pt-6">
          <h2 className="mb-2 text-[16px] font-semibold">Releases</h2>
          <p className="text-[12px] text-repo-muted">No releases published</p>
        </div>
        <div className="mt-6 border-t border-repo-border pt-6">
          <h2 className="mb-3 text-[16px] font-semibold">Languages</h2>
          <span className="block h-2 rounded-full bg-repo-md" aria-hidden="true" />
          <p className="mt-2 flex items-center gap-1.5 text-[12px]">
            <span className="size-2 rounded-full bg-repo-md" aria-hidden="true" />
            <b>Markdown</b>
            <span className="text-repo-muted">100.0%</span>
          </p>
        </div>
      </aside>
    </div>
  );
}

// The README card: generic text about the repository, never anything from the story.
function Readme({ repo, description }: { repo: string; description: string }) {
  const { t } = useLang();
  return (
    <section id="readme" aria-label="README" className={`${BOX} mt-6 scroll-mt-4`}>
      <div className="flex items-center gap-2 border-b border-repo-border px-4">
        <span className="relative flex items-center gap-2 py-3 text-[14px] font-semibold after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-repo-tab-active">
          <BookOpen size={16} className="text-repo-muted" aria-hidden="true" />
          README
        </span>
      </div>
      <article className="px-6 py-6 text-[16px] leading-[1.6] md:px-8">
        <h1 className="mb-4 border-b border-repo-border-muted pb-2 text-[2em] font-semibold leading-tight">{repo}</h1>
        <p className="mb-4">{description}</p>
        <h2 className="mb-4 mt-6 border-b border-repo-border-muted pb-1.5 text-[1.5em] font-semibold leading-tight">{t("Layout")}</h2>
        <ul className="mb-4 list-disc space-y-1 pl-8">
          <li>{t("One Markdown file per part, numbered in order.")}</li>
          <li>
            {t("Open a file to view it; [ and ] move to the previous or next file.")}
          </li>
          <li>
            {t("Press / to search and run commands.")}
          </li>
        </ul>
        <h2 className="mb-4 mt-6 border-b border-repo-border-muted pb-1.5 text-[1.5em] font-semibold leading-tight">{t("Contributing")}</h2>
        <p className="mb-0">
          {t("Changes go through pull requests and are reviewed before merging.")}{" "}
          <span className="text-repo-accent">CONTRIBUTING.md</span>
        </p>
      </article>
    </section>
  );
}
