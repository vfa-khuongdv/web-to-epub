import { useLang } from "../i18n";

// Footer of the chapter table on a long story: which slice is shown and Previous / Next.
export default function ChapterPager({
  page,
  pageCount,
  perPage,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  perPage: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useLang();
  return (
        <div className="flex items-center gap-2 border-t border-rule px-3 py-2 text-xs text-ink-2">
          <span>
            {t("Chapters {from}–{to} / {total}", {
              from: (page - 1) * perPage + 1,
              to: Math.min(page * perPage, total),
              total,
            })}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            >
              {t("Previous")}
            </button>
            <span>{t("Page {page}/{total}", { page, total: pageCount })}</span>
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              disabled={page >= pageCount}
              onClick={() => onPage(page + 1)}
            >
              {t("Next")}
            </button>
          </span>
        </div>
  );
}
