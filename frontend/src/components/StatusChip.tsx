import { useLang } from "../i18n";
import { Icon, IconName } from "./Icon";

export type ChipState = "pending" | "running" | "done" | "error" | "locked" | "subscribers" | "mature" | "new";

const defaults: Record<ChipState, { icon: IconName; label: string; modifier: string }> = {
  pending: { icon: "clock", label: "Pending crawl", modifier: "" },
  running: { icon: "dot", label: "Crawling", modifier: "chip-running" },
  done: { icon: "check", label: "Done", modifier: "" },
  error: { icon: "alert", label: "Error", modifier: "chip-error" },
  // Retrying cannot help until the site grants access — a different problem from an error.
  locked: { icon: "lock", label: "Locked", modifier: "chip-error" },
  // Same as locked, but the reader knows the fix: subscribe to the author.
  subscribers: { icon: "lock", label: "Subscribers only", modifier: "chip-error" },
  // The other lock with a known fix: log in with the mature opt-in enabled.
  mature: { icon: "lock", label: "Rated M (18+)", modifier: "chip-error" },
  new: { icon: "bell", label: "New chapters", modifier: "chip-new" },
};

export function StatusChip({ state, label }: { state: ChipState; label?: string }) {
  const { t } = useLang();
  const spec = defaults[state];
  return (
    <span className={`chip ${spec.modifier}`.trim()}>
      <Icon name={spec.icon} size={12} className={state === "running" ? "animate-pulse" : undefined} />
      {label ?? t(spec.label)}
    </span>
  );
}
