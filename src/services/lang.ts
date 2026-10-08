/**
 * Server-side wording for messages the user reads.
 *
 * The server phrases its own errors and the frontend shows them verbatim, so they
 * have to be in the reader's language. Threading a language through every service,
 * TOC adapter and chapter fetcher would touch code that has nothing else to do with
 * presentation, so the current language is module state instead, set from the
 * `X-Lang` header by the middleware in routes/index.ts.
 *
 * That is a deliberate trade for this app and not a general pattern: it is local-first
 * and single-process (see `runningCrawls` in routes/library.ts), so there is exactly one
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
  // Request validation
  "url is required": "url là bắt buộc",
  "metadata and chapters are required": "metadata và chapters là bắt buộc",
  "watching must be true or false": "watching phải là true hoặc false",
  "autoScanOnOpen must be true or false": "autoScanOnOpen phải là true hoặc false",
  "Unsupported book language": "Ngôn ngữ sách không được hỗ trợ",
  "Default author is too long": "Tên tác giả mặc định quá dài",
  "Book title is required": "Tên sách là bắt buộc",
  "Chapter title is required": "Tên chương là bắt buộc",
  "Chapter content is required": "Nội dung chương là bắt buộc",
  "Chapter content cannot be empty": "Nội dung chương không được để trống",
  "Chapter URL is required": "URL chương là bắt buộc",
  "Chapter URL is not a valid URL": "URL chương không hợp lệ",
  "Invalid chapter order": "Số thứ tự chương không hợp lệ",
  "Invalid spell-check flag": "Trạng thái sửa chính tả không hợp lệ",
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
  "Story is not currently crawling": "Truyện hiện không đang crawl",
  "Crawl stopped by user": "Đã dừng crawl theo yêu cầu",

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
  "{title} - Part {index}/{total}": "{title} - Phần {index}/{total}",

  // Crawling and extraction
  "Loading & extracting…{attempt}": "Đang tải & trích xuất…{attempt}",
  "Could not extract main content from {url}": "Không trích xuất được nội dung chính từ {url}",
  "Could not download a page picture of {url}: {picture}": "Không tải được một trang ảnh của {url}: {picture}",
  "This chapter needs a login on the site, which the app does not bypass: {url}": "Chương này cần đăng nhập vào trang, ứng dụng không vượt qua bước đăng nhập: {url}",
  "Page loaded empty (temporary error, can retry): {url}":
    "Trang tải về rỗng (lỗi tạm thời, thử lại được): {url}",
  "Failed to fetch {url} (HTTP {status}){hint}": "Không tải được {url} (HTTP {status}){hint}",
  "This site is not yet supported: {url}": "Trang này chưa được hỗ trợ: {url}",
  "This is not a Wattpad story page: {url} — paste a URL like https://www.wattpad.com/story/<id>":
    "URL này không phải trang truyện Wattpad: {url} — cần dán URL dạng https://www.wattpad.com/story/<id>",
  "{site} does not yet support automatic chapter list loading":
    "{site} chưa hỗ trợ tự động load danh sách chương",

  "Chapter is locked behind an ad blocker notice (requires disabling/enabling ads), cannot extract: {url}":
    "Chương này đang bị website khóa nội dung (yêu cầu tắt/mở lại quảng cáo), không thể trích xuất: {url}",
  "This chapter is part of Wattpad's Paid Stories program and cannot be extracted: {url}":
    "Chương này thuộc chương trình trả phí (Paid Stories) của Wattpad, không thể trích xuất: {url}",
  "This is not a Viet Messenger chapter page: {url}": "URL này không phải trang chương của Viet Messenger: {url}",
  "Viet Messenger did not return chapter content — the chapter may have been removed or the site changed ({url})":
    "Viet Messenger không trả về nội dung chương — chương có thể đã bị xoá hoặc trang đã đổi cấu trúc ({url})",
  "Could not find the book's category on the Viet Messenger page ({url})":
    "Không tìm thấy thể loại (cat) của sách trên trang Viet Messenger ({url})",
  "Could not find chapter content at {url} — the site may have changed structure or the chapter is locked":
    "Không tìm thấy nội dung chương tại {url} — trang có thể đã đổi cấu trúc hoặc chương bị khoá",
  "Cloudflare verification did not finish — try again in a moment ({url})":
    "Cloudflare chưa xác minh xong — thử lại sau một lát ({url})",
  "Saved session is no longer accepted by Cloudflare — open the page in your browser, then re-import the session in Settings → Site sessions: {url}":
    "Cloudflare không còn chấp nhận phiên đã lưu — mở trang bằng trình duyệt rồi nhập lại phiên trong Cài đặt → Phiên theo trang: {url}",
  "This site is behind a Cloudflare check the app cannot pass on its own — open the page in your browser, then import a session in Settings → Site sessions and retry: {url}":
    "Trang này đang bị Cloudflare chặn mà app không tự qua được — mở trang bằng trình duyệt rồi nhập phiên trong Cài đặt → Phiên theo trang và thử lại: {url}",
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
  "This is not a Viet Messenger book page: {url} — paste a URL like https://vietmessenger.com/books/?title=<name>":
    "URL này không phải trang truyện Viet Messenger: {url} — cần dán URL dạng https://vietmessenger.com/books/?title=<tên>",
  "This book is members-only on Viet Messenger — it needs a member account, which this app cannot sign in to: {url}":
    "Sách này trên Viet Messenger chỉ dành cho thành viên — cần tài khoản thành viên, app không tự đăng nhập được: {url}",
  "Story not found on Asianfanfics — check the story URL again ({url})":
    "Không tìm thấy truyện trên Asianfanfics — kiểm tra lại URL truyện ({url})",
  "This Asianfanfics content is for subscribers only — it needs an account subscribed to the author: {url}":
    "Nội dung Asianfanfics này chỉ dành cho người đăng ký — cần tài khoản đã đăng ký theo dõi tác giả: {url}",
  "This Asianfanfics content is rated M (mature) — it needs a logged-in account with mature content enabled. Turn off Settings → Content filter → \"Filter mature content\" on asianfanfics.com, then retry: {url}":
    "Nội dung Asianfanfics này được đánh dấu M (người lớn) — cần tài khoản đã đăng nhập và bật nội dung người lớn. Hãy tắt Cài đặt → Content filter → \"Filter mature content\" trên asianfanfics.com rồi thử lại: {url}",
  "This is not a Scribd document page: {url} — paste a URL like https://www.scribd.com/document/<id>":
    "URL này không phải trang tài liệu Scribd: {url} — hãy dán URL dạng https://www.scribd.com/document/<id>",
  "Scribd's bot check did not finish — try again in a moment ({url})":
    "Scribd chưa xác minh xong bước kiểm tra bot — thử lại sau một lát ({url})",
  "This Scribd document needs a login — import a Scribd session from your browser (Settings → Site sessions), then try again: {url}":
    "Tài liệu Scribd này cần đăng nhập — hãy nhập phiên Scribd từ trình duyệt của bạn (Cài đặt → Phiên theo trang) rồi thử lại: {url}",
  "No document viewer found at {url} — check the document URL again; if it needs a login, import a Scribd session first":
    "Không tìm thấy trình xem tài liệu tại {url} — kiểm tra lại URL; nếu tài liệu cần đăng nhập, hãy nhập phiên Scribd trước",
  "No document viewer found at {url}": "Không tìm thấy trình xem tài liệu tại {url}",
  "This Scribd document is only partly viewable (page {page} is locked) — import a Scribd session from an account that can view it, then try again: {url}":
    "Tài liệu Scribd này chỉ xem được một phần (trang {page} bị khoá) — hãy nhập phiên của tài khoản xem được toàn bộ tài liệu rồi thử lại: {url}",
  "Scribd returned an unreadable page ({page}) — try again": "Scribd trả về trang không đọc được ({page}) — thử lại",
  "This is not a Scribd chapter URL: {url} — add the document again to refresh its chapter list":
    "URL này không phải chương của Scribd: {url} — hãy thêm lại tài liệu để làm mới danh sách chương",
  "No pages found for this Scribd chapter range ({from}–{to}): {url}":
    "Không tìm thấy trang nào trong khoảng chương Scribd ({from}–{to}): {url}",
  "Could not read any content from this Scribd chapter: {url}":
    "Không đọc được nội dung nào từ chương Scribd này: {url}",
  "Could not load page {page} of this Scribd document — try again ({url})":
    "Không tải được trang {page} của tài liệu Scribd này — thử lại ({url})",
  "Page {page} of this Scribd document is locked for your account — import a session from an account that can view the whole document, then retry: {url}":
    "Trang {page} của tài liệu Scribd này bị khoá với tài khoản của bạn — hãy nhập phiên của tài khoản xem được toàn bộ tài liệu rồi thử lại: {url}",
  "Could not store this Scribd document's page images — retry the crawl ({url})":
    "Không lưu được ảnh các trang của tài liệu Scribd này — hãy chạy lại crawl ({url})",

  // Saved site sessions
  "Saved login session is unreadable — delete {file} and log in again":
    "Không đọc được phiên đăng nhập đã lưu — hãy xoá {file} rồi đăng nhập lại",
  "Paste the cURL copy from your browser first": "Hãy dán nội dung cURL đã copy từ trình duyệt trước",
  "Could not find a URL in the pasted cURL": "Không tìm thấy URL trong nội dung cURL đã dán",
  "That cURL is not for {domain} — copy a request from the site itself":
    "cURL này không phải của {domain} — hãy copy một request từ chính trang đó",
  "No cookies found in that cURL — copy a request from the site while logged in":
    "Không thấy cookie trong cURL này — hãy copy một request từ chính trang đó khi đã đăng nhập",
  "Saved Asianfanfics session has expired — log in again in your browser, then re-import it in Settings → Site sessions: {url}":
    "Phiên đăng nhập Asianfanfics đã hết hạn — đăng nhập lại bằng trình duyệt rồi nhập lại phiên trong Cài đặt → Phiên theo trang: {url}",

  // Narration (text-to-speech)
  "Narration is not supported on this platform": "Giọng đọc chưa hỗ trợ nền tảng này",
  "Narration is being installed — wait for it to finish": "Đang cài giọng đọc — hãy chờ cài xong",
  "Narration is running — stop it first": "Đang đọc truyện — hãy dừng trước",
  "Download failed ({status})": "Tải về thất bại ({status})",
  "Narration is not installed — install it in Settings → Narration":
    "Chưa cài giọng đọc — hãy cài trong Cài đặt → Giọng đọc",
  "Narration is only available for Vietnamese stories": "Giọng đọc chỉ dùng được cho truyện tiếng Việt",
  "Give the voice a name": "Hãy đặt tên cho giọng",
  "The voice clip is too large (10 MB at most)": "File giọng mẫu quá lớn (tối đa 10 MB)",
  "Unsupported audio file — use MP3, WAV, FLAC or OGG": "File audio không hỗ trợ — hãy dùng MP3, WAV, FLAC hoặc OGG",
  "This custom voice no longer exists — pick another in Settings → Narration":
    "Giọng tự tải lên này không còn nữa — hãy chọn giọng khác trong Cài đặt → Giọng đọc",
  "Voice not found": "Không tìm thấy giọng",
  "This story is already being narrated": "Truyện này đang được đọc",
  "This story is not being narrated": "Truyện này không đang được đọc",
  "Story is being narrated, cannot delete": "Truyện đang được đọc, không xoá được",
  "Chapter audio has not been generated yet — narrate the chapter first":
    "Chương này chưa có audio — hãy tạo giọng đọc cho chương trước",
  "This story's audio is already being joined": "Audio của truyện này đang được ghép",
  "Every chapter needs audio before the story can be joined into one file — {count} chapters have none yet": "Mọi chương cần có audio trước khi ghép thành một file — còn {count} chương chưa có",
  "Background music track not found": "Không tìm thấy bài nhạc nền",
  "Could not join the audio: {message}": "Không ghép được audio: {message}",
  "No narrated chapters to export": "Không có chương nào đã có giọng đọc để xuất",
  "Unsupported narration variant": "Kiểu giọng đọc không hợp lệ",
  "Unsupported narration engine": "Bộ đọc không hợp lệ",
  "The transcript is too long (1000 characters at most)": "Lời thoại quá dài (tối đa 1000 ký tự)",
  "OmniVoice has no default voice — pick one in Settings → Narration":
    "OmniVoice không có giọng mặc định — hãy chọn một giọng trong Cài đặt → Giọng đọc",
  "This voice is no longer available — pick another in Settings → Narration":
    "Giọng này không còn nữa — hãy chọn giọng khác trong Cài đặt → Giọng đọc",
  "Voice name is too long": "Tên giọng quá dài",
  Narration: "Giọng đọc",
  "Give the track a name": "Hãy đặt tên cho bản nhạc",
  "The music file is too large (50 MB at most)": "File nhạc quá lớn (tối đa 50 MB)",
  "Unsupported audio file — use MP3, M4A, WAV, FLAC or OGG": "File audio không hỗ trợ — hãy dùng MP3, M4A, WAV, FLAC hoặc OGG",
  "Track not found": "Không tìm thấy bản nhạc",

  // EPUB import
  "This file is not an EPUB book": "File này không phải là sách EPUB",
  "This EPUB file is too large to import": "File EPUB quá lớn để nhập",
  "This EPUB file is locked with DRM and cannot be imported": "File EPUB này bị khoá DRM, không thể nhập",
  "Please choose an EPUB or PDF file": "Hãy chọn một file EPUB hoặc PDF",
  "The file is too large (maximum {size} MB)": "File quá lớn (tối đa {size} MB)",
  "This book is already in the library": "Truyện này đã có trong thư viện",
  "Could not import the EPUB file": "Không nhập được file EPUB",

  // PDF import
  "This file is not a readable PDF": "File này không phải PDF đọc được",
  "This PDF has too many pages to import (maximum {count})": "File PDF có quá nhiều trang để nhập (tối đa {count})",
  "This PDF is password-protected or does not allow copying, so it cannot be imported":
    "File PDF này có mật khẩu hoặc không cho phép sao chép nội dung, không thể nhập",
  "Could not import the PDF file": "Không nhập được file PDF",
  "Pages {from}–{to}": "Trang {from}–{to}",
  "Book image not found": "Không tìm thấy ảnh của sách",
  "Imported books cannot be crawled": "Truyện nhập từ file không crawl được",
  "Imported books have no chapter list to watch": "Truyện nhập từ file không có danh sách chương để theo dõi",

  // Internet Archive import
  "This is not an Internet Archive book page: {url} — paste a URL like https://archive.org/details/<id>":
    "URL này không phải trang sách Internet Archive: {url} — hãy dán URL dạng https://archive.org/details/<id>",
  "Internet Archive item not found: {id}": "Không tìm thấy sách trên Internet Archive: {id}",
  "This Internet Archive item is not a book: {url}": "Mục này trên Internet Archive không phải là sách: {url}",
  "This Internet Archive item is access-restricted (borrow-only) and cannot be imported: {url}":
    "Sách này trên Internet Archive bị giới hạn truy cập (phải mượn/đăng nhập), không thể nhập: {url}",
  "This Internet Archive item is borrow-only. Sign in to archive.org (Settings → Site sessions) and import again: {url}":
    "Sách này trên Internet Archive chỉ cho mượn. Hãy đăng nhập archive.org (Cài đặt → Phiên trang web) rồi import lại: {url}",
  "No copy of this Internet Archive book is available to borrow right now — try again later: {url}":
    "Hiện không còn bản nào của sách này để mượn trên Internet Archive — thử lại sau: {url}",
  "The saved archive.org session is not logged in — import a fresh one (Settings → Site sessions).":
    "Phiên archive.org đã lưu chưa đăng nhập — hãy nhập phiên mới (Cài đặt → Phiên trang web).",
  "The archive.org loan ended while importing — run the import again: {url}":
    "Phiên mượn trên archive.org hết hạn giữa chừng — hãy chạy import lại: {url}",
  "Could not read page {page} of this Internet Archive book: {url}":
    "Không đọc được trang {page} của sách Internet Archive này: {url}",
  "No readable EPUB, PDF, or text file is available for this Internet Archive item: {url}":
    "Không có file EPUB, PDF hay text đọc được cho sách này trên Internet Archive: {url}",
  "This Internet Archive book has too many pages to import (maximum {count})":
    "Sách từ Internet Archive có quá nhiều trang để nhập (tối đa {count})",
  "Could not import from Internet Archive": "Không nhập được sách từ Internet Archive",
  "Internet Archive books are imported, not crawled": "Sách Internet Archive được nhập về, không crawl",
  "DTV Ebook could not serve this book: {url}": "DTV Ebook không phục vụ được sách này: {url}",
  "This DTV Ebook book has no EPUB to import — the site only offers other formats: {url}":
    "Sách DTV Ebook này không có file EPUB để nhập — site chỉ có định dạng khác: {url}",
  "This site is behind a Cloudflare check the app cannot pass — download the file in your browser and import it with Import EPUB / PDF instead: {url}":
    "Trang này đang bị Cloudflare chặn, app không tự qua được — hãy tải file bằng trình duyệt rồi nhập bằng Nhập EPUB / PDF: {url}",
  "Could not import from DTV Ebook": "Không nhập được sách từ DTV Ebook",
  "DTV Ebook books are imported, not crawled": "Sách DTV Ebook được nhập về, không crawl",
  "This is not a DTV Ebook book page: {url} — paste a URL like https://dtv-ebook.com.vn/<name>_<id>.html":
    "Đây không phải trang sách DTV Ebook: {url} — dán URL dạng https://dtv-ebook.com.vn/<ten>_<id>.html",
  "Heyzine could not serve this flipbook: {url}": "Heyzine không phục vụ được flipbook này: {url}",
  "This Heyzine flipbook is not publicly readable (it may be password-protected or removed): {url}":
    "Flipbook Heyzine này không đọc được công khai (có thể đang được bảo vệ bằng mật khẩu hoặc đã bị xoá): {url}",
  "Could not import from Heyzine": "Không nhập được sách từ Heyzine",
  "Heyzine flipbooks are imported, not crawled": "Flipbook Heyzine được nhập về, không crawl",
  "This is not a Heyzine flipbook: {url} — paste a URL like https://heyzine.com/flip-book/<id>.html":
    "Đây không phải flipbook Heyzine: {url} — dán URL dạng https://heyzine.com/flip-book/<id>.html",

  // Agent crawler
  "The agent crawler is off or its agent is not installed (Settings → Agent crawler)":
    "Trình thu thập bằng agent đang tắt hoặc agent chưa được cài (Cài đặt → Agent crawler)",
  "The agent could not write a crawler for {host}: {reason}": "Agent không viết được crawler cho {host}: {reason}",
  "The saved crawler for {host} stopped working ({reason}). Open the story's details and rewrite it with the agent.":
    "Crawler đã lưu cho {host} không còn chạy được ({reason}). Hãy mở chi tiết truyện và nhờ agent viết lại.",
  "The agent could not rewrite the crawler": "Agent không viết lại được crawler",
  "This page needs a login on the site, which the app does not bypass: {url}": "Trang này cần đăng nhập vào trang web, ứng dụng không vượt qua bước này: {url}",
  "Could not read this page": "Không đọc được trang này",
  "Unknown agent": "Agent không hợp lệ",
  "This agent is not installed on this computer": "Agent này chưa được cài trên máy",
  "model must be text": "model phải là chuỗi",
  "enabled must be true or false": "enabled phải là true hoặc false",

  // Chapter rewrite for narration
  "The agent could not rewrite this chapter: {reason}": "Agent không viết lại được chương này: {reason}",
  "Only Vietnamese stories can be rewritten for narration": "Chỉ truyện tiếng Việt mới viết lại để đọc thành tiếng",
  "This story's chapters are already being rewritten": "Các chương của truyện này đang được viết lại",
  "No chapters to rewrite": "Không có chương nào để viết lại",
  "No rewrite is running for this story": "Truyện này không có tiến trình viết lại nào đang chạy",

  // YouTube publishing
  "Could not read the OAuth client file: {path}": "Không đọc được file OAuth client: {path}",
  "That file is not a Google OAuth client JSON": "File đó không phải JSON OAuth client của Google",
  "Google refused the sign-in: {reason}": "Google từ chối đăng nhập: {reason}",
  "Not signed in to YouTube — connect the account in Settings → YouTube":
    "Chưa đăng nhập YouTube — hãy kết nối tài khoản trong Cài đặt → YouTube",
  "YouTube publishing is not available in private mode": "Không đăng YouTube được khi đang ở chế độ ẩn danh",
  "YouTube request failed (HTTP {status})": "Yêu cầu tới YouTube thất bại (HTTP {status})",
  "YouTube request failed": "Yêu cầu tới YouTube thất bại",
  "YouTube did not return the new playlist": "YouTube không trả về danh sách phát mới",
  "YouTube refused the upload": "YouTube từ chối tải video lên",
  "YouTube did not open an upload session": "YouTube không mở được phiên tải lên",
  "YouTube ended the upload without a video id": "YouTube kết thúc tải lên mà không có video id",
  "Upload stopped": "Đã dừng tải lên",
  "Stopped": "Đã dừng",
  "The agent could not write a summary for chapter {order}": "Agent không viết được tóm tắt cho chương {order}",
  "ffmpeg was not found. Install it (for example: brew install ffmpeg) or set its path in Settings → YouTube.":
    "Không tìm thấy ffmpeg. Hãy cài đặt (ví dụ: brew install ffmpeg) hoặc đặt đường dẫn trong Cài đặt → YouTube.",
  "Could not run ffmpeg: {message}": "Không chạy được ffmpeg: {message}",
  "ffmpeg failed: {message}": "ffmpeg báo lỗi: {message}",
  "The playlist \"{name}\" does not exist yet": "Danh sách phát \"{name}\" chưa tồn tại",
  "Chapter {order} has no audio yet — narrate it first": "Chương {order} chưa có audio — hãy tạo giọng đọc trước",
  "This story has no cover image yet — add one before making videos":
    "Truyện chưa có ảnh bìa — hãy thêm bìa trước khi tạo video",
  "Chapter {order} has no video yet — make the videos first": "Chương {order} chưa có video — hãy tạo video trước",
  "The video file for chapter {order} is missing — make the videos again":
    "File video của chương {order} bị thiếu — hãy tạo lại video",
  "YouTube's daily limit is reached. Try again after midnight Pacific time (about 14:00–15:00 Vietnam time).":
    "Đã hết hạn mức trong ngày của YouTube. Hãy thử lại sau 0h giờ Thái Bình Dương (khoảng 14h–15h giờ Việt Nam).",
  "musicId must be text": "musicId phải là chuỗi",
  "musicVolume must be a number between 0 and 4": "musicVolume phải là số từ 0 đến 4",
  "syntheticMedia must be true or false": "syntheticMedia phải là true hoặc false",
  "Sign-in failed or expired. Open Settings → YouTube and try again.":
    "Đăng nhập thất bại hoặc đã hết hạn. Mở Cài đặt → YouTube và thử lại.",
  "YouTube connected: {channel}. You can close this tab.": "Đã kết nối YouTube: {channel}. Bạn có thể đóng tab này.",
  "Could not connect YouTube": "Không kết nối được YouTube",
  "A YouTube job is already running for this story": "Truyện này đang có tiến trình YouTube chạy",
  "Choose at least one chapter": "Hãy chọn ít nhất một chương",
  "No chapters are ready to render": "Không có chương nào sẵn sàng để tạo video",
  "No videos are ready to upload": "Không có video nào sẵn sàng để tải lên",
  "No YouTube job is running for this story": "Truyện này không có tiến trình YouTube nào đang chạy",
  "No upload info for this chapter yet": "Chương này chưa có thông tin đăng tải",
  "The title cannot be empty": "Tiêu đề không được để trống",
  "description must be text": "description phải là chuỗi",
  "tags must be text": "tags phải là chuỗi",
  "publishAt must be an ISO 8601 time": "publishAt phải là thời gian ISO 8601",
  "No video for this chapter yet": "Chương này chưa có video",
  "This chapter is already on YouTube; delete the video in YouTube Studio first":
    "Chương này đã ở trên YouTube; hãy xoá video trong YouTube Studio trước",
  "The YouTube job failed": "Tiến trình YouTube thất bại",
  "Story is being rewritten or published, cannot delete":
    "Truyện đang được viết lại hoặc đang đăng YouTube, không thể xoá",
  "{field} must be text": "{field} phải là chuỗi",
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
