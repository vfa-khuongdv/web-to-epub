// "https://site.com/truyen/abc/chuong-12/" -> "https://site.com/truyen/abc/"
// "https://site.com/de-ba/chuong-118.html" -> "https://site.com/de-ba/"
export function normalizeStoryUrl(url: string): string {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && last && /^chuong-/i.test(last.replace(/\.html$/i, ""))) {
    parts.pop();
  }
  u.pathname = `/${parts.join("/")}${parts.length > 0 ? "/" : ""}`;
  u.search = "";
  u.hash = "";
  return u.toString();
}
