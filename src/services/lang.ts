/**
 * Server-side wording for messages the user reads.
 *
 * The server phrases its own errors and the frontend shows them verbatim, so they
 * have to be in the reader's language. Threading a language through every service,
 * TOC adapter and chapter fetcher would touch code that has nothing else to do with
 * presentation, so the current language is module state instead, set from the
 * `X-Lang` header by the middleware in routes/api.ts.
 *
 * That is a deliberate trade for this app and not a general pattern: it is local-first
 * and single-process (see `runningCrawls` in routes/api.ts), so there is exactly one
 * reader, and a background crawl started from a request inherits that request's
 * language. In a multi-user server this would have to be per-request.
 *
 * Keys are the English text, so a message with no entry here falls back to readable
 * English rather than a blank or a key name.
 */
export type Lang = "vi" | "en";

// English when the client does not say, the way content negotiation normally works:
// the frontend states the reader's language on every request (and defaults it to
// Vietnamese), so a request without the header is a direct API call or a test, and
// those are better served the source wording than a guess.
const DEFAULT_LANG: Lang = "en";

const vi: Record<string, string> = {
  // UI names the server has to spell out inside a message
  "Manual Crawl": "Crawl thủ công",

  // Request validation
  "url is required": "url là bắt buộc",
  "urls is required and must be a non-empty array": "urls là bắt buộc và phải là mảng không rỗng",
  "metadata and chapters are required": "metadata và chapters là bắt buộc",
  "watching must be true or false": "watching phải là true hoặc false",
  "Book title is required": "Tên sách là bắt buộc",
  "Chapter title is required": "Tên chương là bắt buộc",
  "Chapter content is required": "Nội dung chương là bắt buộc",
  "Chapter content cannot be empty": "Nội dung chương không được để trống",
  "Invalid chapter order": "Số thứ tự chương không hợp lệ",
  "Cover file is required": "Thiếu file cover",
  "Invalid cover file — only JPG, PNG, WebP, or GIF accepted":
    "File bìa không hợp lệ — chỉ nhận JPG, PNG, WebP hoặc GIF",

  // Highlights
  "Invalid highlight range": "Vùng tô màu không hợp lệ",
  "Invalid highlight colour": "Màu tô không hợp lệ",
  "Highlighted text is required": "Thiếu đoạn văn bản được tô",
  "Highlight not found": "Không tìm thấy đoạn đã tô",

  // Story and chapter lookup
  "Story not found": "Không tìm thấy truyện",
  "Story not found: {id}": "Không tìm thấy truyện: {id}",
  "Chapter not found": "Không tìm thấy chương",
  "Invalid story ID: {id}": "Mã truyện không hợp lệ: {id}",
  "No cover image for this story": "Truyện chưa có ảnh bìa",
  "This story has no TOC adapter": "Truyện này không có adapter mục lục",
  "This story has no TOC adapter for checking": "Truyện này không có adapter mục lục để kiểm tra",

  // Crawl in progress
  "Story is currently crawling": "Truyện đang được crawl",
  "Story is currently crawling, cannot delete": "Truyện đang được crawl, không thể xoá",
  "Story is currently crawling, cannot edit chapters": "Truyện đang được crawl, không sửa được chương",
  "Story is currently crawling, cannot update chapter list":
    "Truyện đang được crawl, không thể cập nhật danh sách chương",

  // Private mode
  "The code must be exactly 6 digits": "Mã phải gồm đúng 6 chữ số",
  "Wrong code": "Mã không đúng",
  "Too many wrong codes — wait {seconds}s and try again":
    "Sai mã quá nhiều lần — chờ {seconds}s rồi thử lại",
  "A code has already been set for private mode": "Chế độ ẩn danh đã được đặt mã từ trước",
  "No code has been set for private mode yet": "Chế độ ẩn danh chưa được đặt mã",
  "Private mode has locked — enter your code again": "Chế độ ẩn danh đã khoá lại — nhập mã để mở",

  // Export
  "No chapters selected for export": "Không có chapter nào được chọn để export",
  "Export has expired or already been downloaded — click Export EPUB again":
    "Bản xuất đã hết hạn hoặc đã tải rồi — bấm Xuất EPUB lại",

  // Crawling and extraction
  "Loading & extracting…{attempt}": "Đang tải & trích xuất…{attempt}",
  "Could not extract main content from {url}": "Không trích xuất được nội dung chính từ {url}",
  "Page loaded empty (temporary error, can retry): {url}":
    "Trang tải về rỗng (lỗi tạm thời, thử lại được): {url}",
  "Failed to fetch {url} (HTTP {status}){hint}": "Không tải được {url} (HTTP {status}){hint}",
  "This site is not yet supported: {url}": "Trang này chưa được hỗ trợ: {url}",
  "This is not a Wattpad story page: {url} — paste a URL like https://www.wattpad.com/story/<id>":
    "URL này không phải trang truyện Wattpad: {url} — cần dán URL dạng https://www.wattpad.com/story/<id>",
  "{count} URL(s) are from unsupported sites": "{count} URL không thuộc trang được hỗ trợ",
  "{site} does not yet support automatic chapter list loading — enter chapter URLs manually in the {tab} tab":
    "{site} chưa hỗ trợ tự động load danh sách chương — hãy nhập URL từng chương ở tab {tab}",

  "Chapter is locked behind an ad blocker notice (requires disabling/enabling ads), cannot extract: {url}":
    "Chương này đang bị website khóa nội dung (yêu cầu tắt/mở lại quảng cáo), không thể trích xuất: {url}",
  "This chapter is part of Wattpad's Paid Stories program and cannot be extracted: {url}":
    "Chương này thuộc chương trình trả phí (Paid Stories) của Wattpad, không thể trích xuất: {url}",
  "Could not find chapter content at {url} — the site may have changed structure or the chapter is locked":
    "Không tìm thấy nội dung chương tại {url} — trang có thể đã đổi cấu trúc hoặc chương bị khoá",
  "Page blanked before content could be read (temporary error, can retry): {url}":
    "Trang bị xoá trắng trước khi kịp đọc nội dung (lỗi tạm thời, thử lại được): {url}",
  "Failed to connect to {host} ({code}) — connection dropped before getting a response. If your network is blocking this site or the site is blocking your IP, try a VPN/proxy and run again. URL: {url}":
    "Không kết nối được tới {host} ({code}) — kết nối bị ngắt trước khi có phản hồi. Nếu mạng đang chặn site này hoặc site chặn IP của bạn, hãy thử VPN/proxy rồi chạy lại. URL: {url}",
  " — page is rate-limiting access, try again in a few minutes":
    " — trang đang giới hạn tần suất truy cập, thử lại sau ít phút",

  // Table of contents adapters
  "No chapter list found at {url} — check the story URL again":
    "Không tìm thấy danh sách chương tại {url} — kiểm tra lại URL truyện",
  "Story ID not found on the page at {url} — check the story URL again":
    "Không tìm thấy mã truyện trên trang {url} — kiểm tra lại URL truyện",
  "Story not found on Wattpad{detail} — check the story URL again ({url})":
    "Không tìm thấy truyện trên Wattpad{detail} — kiểm tra lại URL truyện ({url})",
  "Wattpad API error ({type}){detail} ({url})": "API Wattpad báo lỗi ({type}){detail} ({url})",
  "Wattpad's chapter list API did not return JSON ({url})":
    "API danh sách chương của Wattpad trả về không phải JSON ({url})",
  "xtruyen's chapter list API did not return JSON": "API danh sách chương của xtruyen trả về không phải JSON",
  "xtruyen's chapter list API returned the wrong format":
    "API danh sách chương của xtruyen trả về sai định dạng",
};

let current: Lang = DEFAULT_LANG;

export function setLang(lang: string | undefined): void {
  current = lang === "vi" ? "vi" : DEFAULT_LANG;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const text = (current === "vi" ? vi[key] : undefined) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole));
}
