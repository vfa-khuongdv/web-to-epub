# Thiết kế: Quản lý truyện đã crawl + tự động load toàn bộ chương

Ngày: 2026-09-17
Trạng thái: Chờ duyệt spec

## 1. Mục tiêu

1. **Quản lý truyện đã crawl**: lưu tiến độ crawl theo từng truyện (những chương
   đã xong / lỗi / còn chờ + nội dung đã trích xuất), để người dùng biết crawler
   tới đâu và có thể crawl tiếp sau này (kể cả khi đã đóng tab/trình duyệt).
2. **Nhập URL truyện → load toàn bộ chương**: chỉ cần dán URL trang truyện
   (ví dụ `https://truyenfull.live/dau-xuan-tuoi-sang/`), hệ thống tự lấy danh
   sách toàn bộ chương và nạp vào truyện để crawl dần.

Ngoài phạm vi (non-goals):

- Không persist các chỉnh sửa thủ công (sửa tiêu đề/nội dung chương) — như hiện
  tại, các chỉnh sửa chỉ phục vụ export trong phiên làm việc.
- Không tự động crawl ngay khi vừa load danh sách chương (người dùng bấm
  "Crawl tiếp").
- Không hỗ trợ adapter TOC cho `metruyenchu.com` (đang bị Cloudflare chặn,
  crawl chương thủ công vẫn hoạt động như cũ).

## 2. Bối cảnh hiện tại

- Backend Express (`src/`), frontend React+Vite (`frontend/`), không có
  persistence: đóng tab là mất toàn bộ kết quả crawl.
- `/api/extract` nhận danh sách URL chương, render từng trang bằng Playwright
  (`src/services/renderer.ts`), trích xuất bằng Readability + walk DOM
  (`src/services/extractor.ts`), retry trong `extractWithRetry`
  (`src/routes/api.ts`).
- Frontend một trang: textarea URL chương → crawl → preview/sửa → export EPUB.

## 3. Kiến trúc

### 3.1 Story store (file JSON)

- Lưu tại `data/stories/<id>.json` (thêm `data/` vào `.gitignore`).
- `id = sha1(normalizedStoryUrl).slice(0, 16)` (node crypto) — ổn định giữa các
  lần chạy, tránh trùng khi 2 truyện khác nhau.
- Ghi atomic: ghi `<id>.json.tmp` rồi `rename` đè file chính.
- `list()` bỏ qua file hỏng (log cảnh báo), không làm sập API.

Model dữ liệu:

```ts
interface StoredChapter {
  order: number;                                  // vị trí trong TOC
  url: string;
  title: string;                                  // từ TOC, cập nhật lại từ kết quả extract
  status: "pending" | "done" | "error";
  error?: string;
  blocks?: ContentBlock[];                        // nội dung đã trích xuất
}

interface StoredStory {
  id: string;
  storyUrl: string;                               // URL truyện đã chuẩn hoá
  site: string;                                   // domain, ví dụ "truyenfull.live"
  title: string;
  author?: string;
  coverUrl?: string;
  chapters: StoredChapter[];
  createdAt: string;                              // ISO
  updatedAt: string;
}
```

Quy ước:

- `GET /api/stories` trả summary: `{id, storyUrl, site, title, chapterCount,
  doneCount, errorCount, updatedAt}` (không kèm blocks).
- Refresh TOC cho truyện đã tồn tại: giữ nguyên `status`/`blocks`/`error` của
  chương cũ theo URL; chương mới thêm thành `pending`; `order` cập nhật theo
  TOC mới; cập nhật `title`/`author`/`coverUrl` từ TOC.
- Không persist chỉnh sửa của người dùng (giới hạn v1, ghi README).

### 3.2 TOC adapters

Interface chung (`src/services/toc/`):

```ts
interface TocResult {
  title: string;
  author?: string;
  coverUrl?: string;
  chapters: { url: string; title: string }[];
}

interface TocAdapter {
  domains: string[];                              // khớp hostname chính xác
  fetchToc(storyUrl: string): Promise<TocResult>;
  normalizeStoryUrl(url: string): string;         // cắt URL chương -> URL truyện
}
```

`src/services/toc/index.ts` chọn adapter theo hostname; trả lỗi rõ ràng
("Trang này chưa hỗ trợ tự động load danh sách chương") nếu không có adapter.

**a) Adapter template truyenfull** (`truyenfullTemplate.ts`), dùng cho
`truyenfull.live`, `truyenfull.vn`, `truyencom.com`:

- Fetch HTML bằng `fetch` thường (server-rendered, không cần Playwright).
- Trang truyện: title `[itemprop="name"]` → `h1` → `<title>`; author
  `a[itemprop="author"]`; cover `img[itemprop="image"]`.
- TOC: `#list-chapter ul.list-chapter a[href]`, giữ thứ tự tài liệu, dedupe.
- Tổng số trang: `#total-page` nếu có; nếu không (truyencom): lấy số trang lớn
  nhất từ `ul.pagination`; nếu vẫn không xác định được thì lặp cho tới khi
  trang không còn chương mới.
- Các trang tiếp theo: `{storyUrl}trang-N/`, ghép chương theo thứ tự.
- `normalizeStoryUrl`: cắt đoạn `chuong-...` cuối path (kể cả `.html`).

**b) Adapter xtruyen** (`xtruyen.ts`), dùng cho `xtruyen.vn`:

- Fetch HTML trang truyện → lấy `manga_id` từ
  `#manga-chapters-holder[data-id]`; title/author best-effort từ `h1`/`title`.
- Gọi `POST {origin}/api/api-chapters.php` với body
  `manga_id=<id>&from=<a>&to=<b>&vol=`, headers:
  `x-custom-auth: abC0000011111`, `X-Requested-With: XMLHttpRequest`,
  `Referer: <storyUrl>`, content-type form-urlencoded.
- Lặp cửa sổ 200 chương (`1-200`, `201-400`, ...) tới khi response rỗng hoặc
  ít hơn cửa sổ; response JSON `[{"s":"chuong-1","n":"Chương 1","e":""}]`.
- URL chương = `{storyUrl}{s}/`; title = `n`.
- `normalizeStoryUrl`: cắt đoạn `chuong-...` cuối path.

### 3.3 Crawl service dùng chung

- Chuyển `MAX_ATTEMPTS` + `extractWithRetry` từ `src/routes/api.ts` sang
  `src/services/crawl.ts`; `/api/extract` và crawl truyện cùng dùng.
- Không đổi logic retry hiện có (giữ nguyên xử lý `LockedContentError`).

### 3.4 API mới

| Endpoint | Mô tả |
|---|---|
| `POST /api/stories` `{url}` | Chuẩn hoá URL, kiểm tra site hỗ trợ + adapter, fetch TOC, tạo/cập nhật record, trả story đầy đủ (kèm chapters) |
| `GET /api/stories` | Danh sách summary + tiến độ |
| `GET /api/stories/:id` | Story đầy đủ (kèm blocks của chương `done`) |
| `POST /api/stories/:id/crawl` `{orders?}` | NDJSON như `/api/extract`. Mặc định crawl `pending` + `error`; nếu có `orders` thì chỉ các chương đó (kể cả `done` — dùng cho "crawl lại"). Mỗi chương xong/lỗi được lưu vào store ngay |
| `DELETE /api/stories/:id` | Xoá record; trả 409 nếu đang crawl |

Chi tiết `/crawl`:

- Khoá in-memory theo `storyId` (Set) — crawl trùng trả 409
  (`{message: "Truyện đang được crawl"}`). Xoá khoá trong `finally`.
- Sự kiện NDJSON giữ nguyên định dạng hiện tại: `progress` (mỗi lần thử),
  `error` (chương lỗi), `done` (kèm toàn bộ chapter từ store sau khi crawl
  xong). Frontend log realtime như tab thủ công.
- Nếu client ngắt kết nối giữa chừng, vòng lặp vẫn tiếp tục và vẫn lưu từng
  chương (mở lại xem tiến độ sau). Ghi chú rõ trong README.
- Sau mỗi chương: cập nhật `status`, `title` (từ kết quả extract), `error`,
  `blocks`, `updatedAt` rồi ghi file.

Lỗi:

- URL không thuộc site hỗ trợ → 400 như hiện tại.
- Site hỗ trợ nhưng không có adapter TOC (metruyenchu) → 400 với message riêng.
- Fetch TOC lỗi/timeout → 502 `{message}`; không tạo record rác.

### 3.5 Frontend

- `App.tsx` còn vai trò vỏ + 2 tab (state cục bộ, mặc định tab "Crawl thủ công"):
  - Tab **"Crawl thủ công"**: toàn bộ UI hiện tại dời nguyên sang
    `frontend/src/components/ManualCrawlView.tsx` (không đổi hành vi).
  - Tab **"Truyện của tôi"**: `LibraryView.tsx` + `StoryDetail.tsx`.
- Phần export (upload cover + gọi `exportEpub` + tải file) được tách thành
  component/hook dùng chung cho cả 2 tab, tránh lặp code.
- `LibraryView`:
  - Ô nhập URL truyện + nút "Tải danh sách chương" → `POST /api/stories`
    → mở thẳng StoryDetail.
  - Danh sách truyện: tên, site, tiến độ `done/total` (progress bar), số lỗi,
    `updatedAt`; click mở chi tiết; nút xoá (confirm).
- `StoryDetail`:
  - Thông tin truyện: title/author/cover (từ TOC; cover chỉ hiển thị thumbnail,
    export v1 vẫn dùng file cover upload như hiện tại).
  - Progress + nút "Crawl tiếp (N chương)" (N = pending + error) và log tiến độ.
  - Danh sách chương tái dùng `ChapterCard`, thêm badge trạng thái
    `pending | error | done`; chương lỗi có "Thử lại" gọi
    `POST /api/stories/:id/crawl {orders:[n]}`.
  - Export EPUB với metadata (title/author/language) prefill từ truyện.
  - Sau khi crawl xong (sự kiện `done`), cập nhật chapters từ payload store.
- `frontend/src/api.ts` + `types.ts`: thêm hàm/type cho 4 endpoint trên.

## 4. Testing & verify

- Thêm `vitest` (devDependency) + script `"test": "vitest run"`; test đặt cạnh
  source (`src/services/...test.ts`), fixtures trong `__fixtures__/`.
  - Test parser TOC template truyenfull: fixture HTML trang truyện
    (truyenfull.live) → title/author/cover, danh sách chương, tính tổng trang.
  - Test parser truyencom (không có `#total-page`).
  - Test parser xtruyen: fixture HTML + fixture JSON API → ghép URL chương.
  - Test `normalizeStoryUrl` cho cả 2 nhóm adapter (URL chương có/không `.html`).
  - Test storyStore: create/update/list/delete + ghi atomic (thư mục tmp).
- Verify tay (sau khi code xong):
  1. `POST /api/stories` với `https://truyenfull.live/dau-xuan-tuoi-sang/`
     → đủ ~150 chương / 3 trang.
  2. Crawl một phần → đóng tab → mở lại: đúng số chương `done`, "Crawl tiếp"
     chỉ crawl phần còn lại.
  3. Thêm truyện từ `xtruyen.vn` → danh sách chương khớp TOC trên web.
  4. Export EPUB từ truyện đã crawl ra file đọc được.
  5. Tab "Crawl thủ công" hoạt động y như trước (không hồi quy).
  6. `npm test` pass; `npm run build` pass.

## 5. Thành phần bị ảnh hưởng

- `.gitignore` (thêm `data/`), `package.json` (vitest + script test), `README.md`.
- Backend: `src/services/storyStore.ts` (mới), `src/services/crawl.ts` (mới,
  tách từ routes), `src/services/toc/{index,truyenfullTemplate,xtruyen}.ts`
  (mới), `src/routes/api.ts`, `src/types.ts`.
- Frontend: `App.tsx`, `api.ts`, `types.ts`,
  `components/{ManualCrawlView,LibraryView,StoryDetail}.tsx` (mới).

## 6. Tiêu chí thành công

- Nhập URL truyện được hỗ trợ → thấy toàn bộ danh sách chương với trạng thái
  `pending`.
- Crawl dở dang rồi đóng tab → mở lại thấy đúng tiến độ; "Crawl tiếp" chỉ chạy
  phần chưa xong; chương lỗi thử lại được.
- Export EPUB từ truyện đã crawl hoạt động như flow hiện tại.
- Không hồi quy tab thủ công; unit test TOC/store pass.

## 7. Giới hạn đã biết (ghi README)

- Chỉ tự động load TOC cho `truyenfull.live`, `truyenfull.vn`, `truyencom.com`,
  `xtruyen.vn`; `metruyenchu.com` phải nhập URL chương thủ công.
- Không persist chỉnh sửa chương/thông tin sách (chỉ lưu kết quả crawl thô).
- Truyện rất dài (hàng nghìn chương) có thể làm UI nặng khi mở chi tiết vì
  load toàn bộ nội dung đã crawl.
- Nếu site đổi cấu trúc HTML/API thì adapter TOC có thể hỏng (lỗi rõ ràng,
  không tạo record rác).
