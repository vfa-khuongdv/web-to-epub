import { ReactNode } from "react";
import { useLang } from "../../i18n";
import { Icon, IconName } from "../ui/Icon";

/**
 * One card per place a story can be published to. Each says whether the account is
 * connected, how many chapters are already there, and offers what is specific to that
 * place (YouTube: sync and the playlist link; Facebook: the Page link). Choosing where to
 * publish happens in the publish dialog, not here — the cards only show state.
 */
export interface Destination {
  id: "youtube" | "facebook";
  name: string;
  icon: IconName;
  connected: boolean;
  // "Connected: Truyện FM" / "Not connected to Facebook yet."
  status: string;
  // Chapters already published there, out of the story's chapters with a prepared record.
  published: number;
  total: number;
  connectLabel: string;
  settingsLabel: string;
  actions?: ReactNode;
  details?: ReactNode;
}

export default function PublishDestinations({
  destinations,
  onOpenSettings,
}: {
  destinations: Destination[];
  onOpenSettings: () => void;
}) {
  const { t } = useLang();
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={t("Where to publish")}>
      {destinations.map((destination) => (
        <div key={destination.id} className="flex flex-col gap-1.5 rounded-tool border border-rule bg-raised px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Icon name={destination.icon} size={16} />
            <b>{destination.name}</b>
            <span className={destination.connected ? "text-ink-2" : "text-ink-3"}>{destination.status}</span>
            <div className="ml-auto flex items-center gap-1.5">
              {destination.actions}
              <button type="button" className="btn btn-tiny" onClick={onOpenSettings}>
                {destination.connected ? destination.settingsLabel : destination.connectLabel}
              </button>
            </div>
          </div>
          {destination.connected && (
            <p className="text-[12px] leading-snug text-ink-3">
              {t("{published}/{total} chapters published", { published: destination.published, total: destination.total })}
            </p>
          )}
          {destination.details}
        </div>
      ))}
    </section>
  );
}
