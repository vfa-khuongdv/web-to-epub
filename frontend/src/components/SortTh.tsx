import { useLang } from "../i18n";
import type { SortKey, SortState } from "../lib/libraryRows";
import { Icon } from "./Icon";

export default function SortTh({
  label,
  sortKey,
  sorts,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sorts: SortState[];
  onSort: (key: SortKey, additive: boolean) => void;
  className?: string;
}) {
  const { t } = useLang();
  const rank = sorts.findIndex((s) => s.key === sortKey);
  const active = sorts[rank];
  return (
    <th
      className={className}
      aria-sort={active ? (active.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1"
        title={t("Sort by {label} — hold Shift to add secondary criteria", { label: t(label) })}
        onClick={(e) => onSort(sortKey, e.shiftKey)}
      >
        {t(label)}
        {active && (
          <>
            <Icon name="chevron" size={10} className={active.dir === "asc" ? "-rotate-90" : "rotate-90"} />
            {sorts.length > 1 && <span className="text-[9px] font-semibold">{rank + 1}</span>}
          </>
        )}
      </button>
    </th>
  );
}
