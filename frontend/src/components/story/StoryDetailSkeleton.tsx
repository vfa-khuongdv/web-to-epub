import { useLang } from "../../i18n";
import { SkeletonBar } from "../ui/Skeleton";

// Enough skeleton rows to reach the bottom of the pane on a normal window; past that
// they would only be drawn to be scrolled to.
const SKELETON_ROWS = 12;
// Ragged widths read as chapter names; one width for every row reads as a barcode.
const SKELETON_TITLE_WIDTHS = ["w-4/5", "w-3/5", "w-11/12", "w-2/3", "w-3/4", "w-1/2"];

/**
 * What the right pane shows while a story's outline is being fetched. It is this
 * component's own layout with the text taken out — same pane head, same 96px cover
 * column, same field grid, same table header — so nothing shifts when the story lands.
 *
 * It earns its place on real libraries: a 2,500-chapter outline is a few hundred KB, and
 * without this the pane sits on the previous story (or on "No story selected") long
 * enough for the click to read as ignored.
 */
export default function StoryDetailSkeleton() {
  const { t } = useLang();
  return (
    <section className="pane">
      <div className="pane-head">
        <SkeletonBar className="h-4 w-20" />
        <h2 className="ml-auto">{t("Story details")}</h2>
      </div>

      {/* Outside the aria-hidden blocks below, or it would be hidden along with them. */}
      <p className="visually-hidden" role="status">
        {t("Loading story details")}
      </p>

      <div className="detail" aria-hidden="true">
        <div className="detail-cover">
          <SkeletonBar className="h-[140px] w-24" />
        </div>
        <div className="detail-main">
          <div>
            <SkeletonBar className="h-4 w-3/5" />
            {/* Site, then the story URL — long enough to wrap onto a second line on
                the sites this app crawls. */}
            <SkeletonBar className="mt-2 h-3 w-2/5" />
            <SkeletonBar className="mt-1.5 h-3 w-11/12" />
            <SkeletonBar className="mt-1.5 h-3 w-1/4" />
          </div>
          {/* The crawled-count readout: one big number over a line of detail. */}
          <div>
            <SkeletonBar className="h-[50px] w-44" />
            <SkeletonBar className="mt-2.5 h-3 w-28" />
          </div>
          {/* Crawl, read, export, watch, save info — five buttons that wrap to three
              rows at this pane's width. */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <SkeletonBar className="h-8 w-44" />
              <SkeletonBar className="h-8 w-32" />
            </div>
            <div className="flex gap-2">
              <SkeletonBar className="h-8 w-28" />
              <SkeletonBar className="h-8 w-40" />
            </div>
            <SkeletonBar className="h-8 w-32" />
          </div>
          <div className="fields">
            {[0, 1, 2, 3].map((field) => (
              <div key={field} className="field">
                <SkeletonBar className="h-2.5 w-16" />
                <SkeletonBar className="h-8 w-full" />
                {/* The cover field explains itself in three lines below the control. */}
                {field === 3 && (
                  <>
                    <SkeletonBar className="mt-1 h-3 w-full" />
                    <SkeletonBar className="h-3 w-5/6" />
                    <SkeletonBar className="h-3 w-1/3" />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="pane-body" aria-hidden="true">
        <table className="tbl">
          <thead>
            <tr>
              <th className="num w-11">#</th>
              <th>{t("Chapter")}</th>
              <th className="w-32">{t("Status")}</th>
              <th className="w-44" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SKELETON_ROWS }, (_, row) => (
              <tr key={row}>
                <td>
                  <SkeletonBar className="h-3 w-5" />
                </td>
                <td>
                  <SkeletonBar className={`h-3 ${SKELETON_TITLE_WIDTHS[row % SKELETON_TITLE_WIDTHS.length]}`} />
                </td>
                <td>
                  <SkeletonBar className="h-3 w-16" />
                </td>
                <td>
                  <SkeletonBar className="h-3 w-14" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
