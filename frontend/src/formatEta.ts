// ETA backend là ước lượng trung bình nên chỉ cần mức làm tròn phút; dưới một
// phút hiện chữ thay vì "~0 phút".
export function formatEta(ms: number): string {
  if (ms < 60_000) return "dưới 1 phút";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `~${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `~${hours} giờ` : `~${hours} giờ ${rest} phút`;
}
