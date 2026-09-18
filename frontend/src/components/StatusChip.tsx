import { Icon, IconName } from "./Icon";

export type ChipState = "pending" | "running" | "done" | "error" | "new";

const defaults: Record<ChipState, { icon: IconName; label: string; modifier: string }> = {
  pending: { icon: "clock", label: "Chờ crawl", modifier: "" },
  running: { icon: "dot", label: "Đang crawl", modifier: "chip-running" },
  done: { icon: "check", label: "Xong", modifier: "" },
  error: { icon: "alert", label: "Lỗi", modifier: "chip-error" },
  new: { icon: "bell", label: "Chương mới", modifier: "chip-new" },
};

export function StatusChip({ state, label }: { state: ChipState; label?: string }) {
  const spec = defaults[state];
  return (
    <span className={`chip ${spec.modifier}`.trim()}>
      <Icon name={spec.icon} size={12} className={state === "running" ? "animate-pulse" : undefined} />
      {label ?? spec.label}
    </span>
  );
}
