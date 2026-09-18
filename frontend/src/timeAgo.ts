// "Cập nhật" và "kiểm tra lần cuối" đều cần khoảng thời gian tương đối; giữ
// chung một chỗ để hai chỗ hiển thị khớp nhau.
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(then).toLocaleDateString("vi-VN");
}
