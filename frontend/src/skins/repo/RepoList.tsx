import { BookMarked, ChevronDown, FileText, Star } from "lucide-react";
import { KeyboardEvent, RefObject, useMemo } from "react";
import { LiveCrawl } from "../../hooks/useCrawlJob";
import { useLang } from "../../i18n";
import { StorySummary } from "../../types";
import { stripUrls } from "../../lib/skins/crawlLog";
import {
  BTN,
  BTN_PRIMARY,
  BTN_SM,
  Blankslate,
  Flash,
  INPUT,
  LINK,
  Label,
  Pagination,
  Spinner,
  StatusIcon,
} from "./RepoChrome";
import { REPOS_PER_PAGE, clampPage, descriptionKey, pageCount, pageSlice, relativeTime } from "./repoModel";

export interface RepoEntry {
  story: StorySummary;
  name: string;
  // Position in the library, which picks the description.
  index: number;
}

/**
 * The team's repositories: one per story, named by its folder name (module-01 with
 * neutral names), with a generic description, the file count and when it last changed.
 * A story downloading right now carries the yellow "in progress" dot.
 */
export function RepoList({
  entries,
  loading,
  error,
  onRetry,
  live,
  query,
  onQuery,
  page,
  onPage,
  onOpen,
  filterRef,
  now,
}: {
  entries: RepoEntry[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  live: Record<string, LiveCrawl | undefined>;
  query: string;
  onQuery: (query: string) => void;
  page: number;
  onPage: (page: number) => void;
  onOpen: (storyId: string) => void;
  filterRef: RefObject<HTMLInputElement>;
  now: number;
}) {
  const { t } = useLang();
  const matches = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return wanted ? entries.filter((entry) => entry.name.toLowerCase().includes(wanted)) : entries;
  }, [entries, query]);
  const pages = pageCount(matches.length, REPOS_PER_PAGE);
  const current = clampPage(page, matches.length, REPOS_PER_PAGE);
  const shown = pageSlice(matches, current, REPOS_PER_PAGE);

  const onFilterKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && matches[0]) {
      event.preventDefault();
      onOpen(matches[0].story.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onQuery("");
      event.currentTarget.blur();
    }
  };

  let body;
  if (loading && entries.length === 0) body = <Spinner label={t("Loading…")} />;
  else if (error && entries.length === 0)
    body = (
      <div className="py-6">
        <Flash tone="danger">
          <p className="font-semibold">{t("Could not load the repositories.")}</p>
          <p className="mt-1 text-repo-muted">{stripUrls(error)}</p>
          <button type="button" className={`${BTN_SM} mt-3`} onClick={onRetry}>
            {t("Retry")}
          </button>
        </Flash>
      </div>
    );
  else if (entries.length === 0)
    body = (
      <div className="mt-6 rounded-md border border-repo-border">
        <Blankslate icon={<BookMarked size={24} />} title={t("This organization has no repositories yet.")}>
          {t("Add them in the normal view.")}
        </Blankslate>
      </div>
    );
  else if (matches.length === 0)
    body = (
      <div className="mt-6 rounded-md border border-repo-border">
        <Blankslate icon={<BookMarked size={24} />} title={t("No repositories matched your search.")} />
      </div>
    );
  else
    body = (
      <>
        <ul aria-label="Repositories">
          {shown.map(({ story, name, index }) => {
            const crawl = live[story.id];
            return (
              <li key={story.id} className="flex gap-6 border-b border-repo-border py-6">
                <div className="min-w-0 flex-1">
                  <h3 className="mb-1 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={`${LINK} break-all text-left text-[20px] font-semibold leading-tight`}
                      onClick={() => onOpen(story.id)}
                    >
                      {name}
                    </button>
                    <Label>Private</Label>
                  </h3>
                  <p className="mb-2 max-w-[75%] text-[14px] text-repo-muted">{t(descriptionKey(index))}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-repo-muted">
                    <span className="flex items-center gap-1">
                      <span className="size-3 rounded-full border border-black/10 bg-repo-md" aria-hidden="true" />
                      Markdown
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText size={14} aria-hidden="true" />
                      {story.chapterCount}
                    </span>
                    {story.errorCount > 0 && (
                      <span className="flex items-center gap-1 text-repo-danger" title={t("Download errors: {count}", { count: story.errorCount })}>
                        <StatusIcon status="failure" size={14} />
                        {story.errorCount}
                      </span>
                    )}
                    {crawl && (
                      <span className="flex items-center gap-1 text-repo-attention">
                        <StatusIcon status="running" size={12} />
                        {t("Downloading {done}/{total}", { done: crawl.cursor, total: crawl.total })}
                      </span>
                    )}
                    <span>Updated {relativeTime(story.updatedAt, now)}</span>
                  </div>
                </div>
                <div className="hidden flex-none flex-col items-end gap-3 sm:flex" aria-hidden="true">
                  <span className={BTN_SM}>
                    <Star size={14} />
                    Star
                    <ChevronDown size={12} className="ml-1" />
                  </span>
                  <Sparkline seed={story.id} done={story.doneCount} />
                </div>
              </li>
            );
          })}
        </ul>
        <Pagination
          page={current}
          pages={pages}
          onPage={onPage}
          label="Pagination"
          previousLabel={t("Previous page")}
          nextLabel={t("Next page")}
        />
      </>
    );

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-repo-border pb-4">
        <input
          ref={filterRef}
          type="search"
          // Nobody types a backquote into a repository search: the boss key still hides.
          data-boss-key=""
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={onFilterKey}
          placeholder="Find a repository…"
          aria-label={t("Find a repository")}
          className={`${INPUT} min-w-[200px] flex-1`}
        />
        <span className="flex gap-1" aria-hidden="true">
          {["Type", "Language", "Sort"].map((name) => (
            <span key={name} className={BTN}>
              {name}
              <ChevronDown size={14} className="text-repo-muted" />
            </span>
          ))}
        </span>
        <span className={BTN_PRIMARY} aria-hidden="true">
          <BookMarked size={16} />
          New
        </span>
      </div>
      {body}
    </main>
  );
}

// The little activity graph beside each repository: made up, but steady per repository.
function Sparkline({ seed, done }: { seed: string; done: number }) {
  const points = useMemo(() => {
    let value = 0;
    for (const char of seed) value = (value * 31 + char.charCodeAt(0)) >>> 0;
    const heights: number[] = [];
    for (let index = 0; index < 20; index++) {
      value = (value * 1103515245 + 12345) >>> 0;
      heights.push(done > 0 ? 2 + ((value >>> 8) % 24) : 1);
    }
    return heights.map((height, index) => `${index * 8},${28 - height}`).join(" ");
  }, [seed, done]);
  return (
    <svg width="155" height="30" viewBox="0 0 155 30" className="text-repo-success">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

