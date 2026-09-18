# Thiết kế: Theo dõi chương mới + ETA thời gian còn lại

Ngày: 2026-09-18
Trạng thái: Chờ duyệt spec

## 1. Mục tiêu

1. **Theo dõi truyện + phát hiện chương mới**: người dùng bật "theo dõi" cho
   từng truyện đang đọc; khi mở app (và khi bấm "Kiểm tra chương mới"), công cụ
   tự so TOC hiện tại với thư viện và báo "N chương mới" — bấm một nút là nạp
   TOC rồi crawl đúng các chương còn thiếu.
2. **ETA thời gian còn lại**: trong lúc crawl, hiện thời gian dự kiến còn lại
   (kèm tốc độ chương/phút ở chi tiết truyện) ở JobStrip, bảng thư viện và chi
   tiết truyện — để một job chạy hàng chục phút vẫn dễ theo dõi.

Ngoài phạm vi (non-goals):

- Không hẹn giờ chạy nền, không kiểm tra định kỳ khi app không mở; không
  notification hệ điều hành.
- Không tự động crawl khi phát hiện chương mới — luôn cần người dùng bấm.
- Không phát hiện chương bị xoá/đổi tên/đổi URL; chỉ đếm URL có trong TOC mới
  mà chưa có trong thư viện.
- Không theo dõi truyện nhập thủ công (không có TOC).
- ETA không persist qua restart server (crawl cũng dừng khi restart).

## 2. Bối cảnh hiện tại

- `POST /api/stories` (`src/routes/api.ts:229`) nạp TOC, `mergeStory`
  (`src/services/storyService.ts:5`) giữ nguyên chương cũ theo URL, thêm chương
  mới ở trạng thái `pending`, và bỏ chương không còn trong TOC.
- Crawl truyện chạy hậu trường (`api.ts:515`), tiến độ đẩy qua SSE; trạng thái
  in-memory `runningCrawls: Map<storyId, {cursor,total}>` (`api.ts:199`), ảnh
  chụp gửi lúc kết nối `/api/stories/live`.
- Cột `stories` đã có tiền lệ migration thêm cột `language` bằng
  `PRAGMA table_info` + `ALTER TABLE` (`src/services/storyStore.ts:89`).
- `StoredStory`/`StorySummary` (`src/types.ts`) chưa có thông tin theo dõi;
  frontend types phản chiếu ở `frontend/src/types.ts`.
- `LibraryView` tính chip trạng thái bằng `crawlStatus` (`LibraryView.tsx:26`)
  từ summary + `live`; StoryDetail (`StoryDetail.tsx`) hiện `doneCount` và nút
  "Crawl tiếp".
- Chưa có ETA: event chỉ mang `index/cursor/total` (`ProgressEvent`,
  `src/types.ts:40`).

## 3. Thiết kế

### 3.1 ETA thời gian còn lại

**Hàm thuần** trong `src/services/crawl.ts`:

```ts
// Trả undefined khi chưa đủ mẫu (nhiễu) hoặc đã xong.
export function estimateRemainingMs(input: {
  startedAt: number;
  completed: number;
  total: number;
  now?: number;
}): number | undefined;
```

- `now` mặc định `Date.now()`.
- Trả `undefined` nếu `completed < 3`, `completed >= total`, hoặc
  `elapsed = now - startedAt <= 0`.
- Ngược lại: `elapsed / completed * (total - completed)` (làm tròn ms).
- Thời gian retry nằm trong `elapsed`, nên ETA tự phản ánh cả chương chậm.

**Backend** (`src/routes/api.ts`):

- `runningCrawls` đổi thành
  `Map<string, { cursor: number; total: number; startedAt: number; etaMs?: number }>`;
  khởi tạo `startedAt: Date.now()` cùng lúc set map (`api.ts:542`).
- Sau mỗi chương xong (cả thành công lẫn lỗi), tính lại
  `etaMs = estimateRemainingMs({ startedAt, completed: i + 1, total: plan.length })`
  và gắn vào event `chapter-done`/`error`; snapshot `/api/stories/live` gửi kèm
  `etaMs` đang có (phiên mở giữa chừng thấy ETA ngay).
- Crawl thủ công `/api/extract` (`api.ts:44`): lấy `startedAt` đầu request, gắn
  `etaMs` tương tự vào event `chapter-done`/`error`.
- `ProgressEvent` thêm `etaMs?: number` (`src/types.ts`).

**Frontend**:

- `frontend/src/types.ts`: `ProgressEvent.etaMs?`.
- `frontend/src/formatEta.ts` (mới): `formatEta(ms)` → `"dưới 1 phút"`,
  `"~18 phút"`, `"~1 giờ 20 phút"` (bỏ phần phút khi tròn giờ).
- `frontend/src/useCrawlJob.ts`:
  - `CrawlJobState.etaMs?: number`, `LiveCrawl.etaMs?: number`.
  - `applyEvent` cập nhật `etaMs` từ event (giữ giá trị cũ nếu event thiếu);
    event `done`/`idle` xoá ETA; snapshot và `attach` cũng nạp ETA.
- Hiển thị:
  - `JobStrip`: cạnh `12/150 chương` thêm `· còn ~18 phút` khi có ETA.
  - `LibraryView`: giữ nguyên chip `Đang crawl 12/150`, thêm dòng chữ nhỏ
    `còn ~18 phút` dưới chip khi `live[s.id]?.etaMs` có giá trị.
  - `StoryDetail`: cạnh "chương đã crawl", khi `job.running && job.etaMs` hiện
    `còn ~18 phút · 12 ch/phút`; tốc độ suy từ
    `(job.total - job.cursor) / (etaMs / 60000)`, không thêm field backend.

### 3.2 Theo dõi truyện + chương mới

#### 3.2.1 Dữ liệu

Migration theo pattern sẵn có (`storyStore.ts:89`), thêm 4 cột vào `stories`:

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `watching` | `INTEGER NOT NULL DEFAULT 0` | Truyện có được kiểm tra định kỳ |
| `new_chapter_count` | `INTEGER NOT NULL DEFAULT 0` | Số chương mới lần kiểm tra gần nhất |
| `last_checked_at` | `TEXT` | ISO, lần kiểm tra thành công gần nhất |
| `check_error` | `TEXT` | Lỗi của lần kiểm tra gần nhất (nếu có) |

Quy ước:

- 4 cột này **không** nằm trong `upsertStory` → `save()` (refresh TOC, tạo
  truyện) không bao giờ ghi đè; chỉ sửa qua 2 method mới.
- Không cập nhật `updated_at` khi bật/tắt theo dõi hay khi kiểm tra: cột này
  đang là "lần cuối nội dung thay đổi", dùng để sắp xếp thư viện.
- `StoredStory` và `StorySummary` (`src/types.ts` + frontend) thêm:
  `watching: boolean`, `newChapterCount: number`, `lastCheckedAt?: string`,
  `checkError?: string`.
- `mergeStory` (`storyService.ts`) mang 4 field này từ `existing` (mặc định
  `false`/`0`) để object trả về đủ kiểu; giá trị vẫn không được ghi bởi `save()`.

Store methods mới:

```ts
setWatching(id: string, watching: boolean): Promise<boolean>;
// undefined = giữ nguyên giá trị cũ; error: null = xoá lỗi.
setCheckResult(
  id: string,
  result: { newChapterCount?: number; checkedAt?: string; error?: string | null }
): Promise<boolean>;
```

- `setWatching(true)`: chỉ set `watching = 1`.
- `setWatching(false)`: set `watching = 0`, đồng thời xoá `new_chapter_count`
  và `check_error` (không còn theo dõi thì không hiện chip).
- `setCheckResult` đọc row rồi update các field được cung cấp.
- `list()`, `get()`, `getOutline()` map thêm 4 cột (INTEGER → boolean).

#### 3.2.2 Phát hiện chương mới

Hàm thuần trong `src/services/storyService.ts`:

```ts
export function countNewChapters(
  stored: { url: string }[],
  toc: TocChapter[]
): number;
```

- Đếm URL trong `toc` chưa có trong set URL của `stored` (giữ nguyên thứ tự
  không quan trọng vì chỉ trả số lượng).
- Không quan tâm chương bị mất khỏi TOC (hành vi refresh hiện tại đã xử lý).

#### 3.2.3 API

| Endpoint | Mô tả |
|---|---|
| `POST /api/stories/:id/watch` `{ watching: boolean }` | Bật/tắt theo dõi; trả `{ story }` (outline) |
| `POST /api/stories/:id/check` | Fetch TOC, đếm chương mới, lưu kết quả; trả `{ newChapterCount, lastCheckedAt, checkError }` |
| `POST /api/stories/:id/refresh` | Nạp lại TOC cho truyện đã có (như `POST /api/stories` nhưng không cần client gửi URL), merge + lưu bìa; reset `new_chapter_count = 0`, cập nhật `last_checked_at`; trả `{ story }` |

Chi tiết:

- `watch`: 404 nếu không có truyện; `watching` phải là boolean, nếu không → 400.
- `check`: 404 nếu không có truyện; 400 nếu không có TOC adapter; 409
  `{ message: "Truyện đang được crawl" }` nếu `runningCrawls.has(id)` (client
  cũng lọc trước, đây là chốt an toàn).
  - Thành công: `setCheckResult(id, { newChapterCount, checkedAt: now, error: null })`.
  - Lỗi fetch TOC: **giữ nguyên** `new_chapter_count` và `last_checked_at` cũ,
    lưu `check_error`, trả 502 `{ message }`.
- `refresh`: 404/409 như trên; dùng chung helper với `POST /api/stories`
  (normalize URL → adapter → fetchToc → mergeStory → coverStore.save →
  storyStore.save). `POST /api/stories` sau khi lưu thành công cũng reset
  `new_chapter_count = 0` + `last_checked_at = now` (truyện không theo dõi thì
  vô hại) để không hiện chip cũ sau khi người dùng đã nạp TOC.

#### 3.2.4 Frontend

`frontend/src/api.ts` thêm `setStoryWatch(id, watching)`,
`checkStoryUpdates(id)` (throw message khi 502), `refreshStoryToc(id)`.

`LibraryView`:

- Nút chuông theo dõi trong cột hành động (cạnh nút xoá), `aria-pressed`, tooltip
  "Theo dõi chương mới"/"Bỏ theo dõi"; gọi `setStoryWatch` rồi `loadStories()`.
- `crawlStatus` ưu tiên mới: đang crawl → `newChapterCount > 0` (chip mới
  `"N chương mới"`) → còn chương → lỗi → xong. Thêm `ChipState = "new"` +
  `.chip-new` trong `styles.css` (token select), icon `bell`.
- Thanh công cụ: nút "Kiểm tra chương mới" hiện khi có ít nhất một truyện
  `watching`; chạy kiểm tra tối đa 2 truyện song song, truyện đang crawl bị bỏ
  qua; mỗi kết quả cập nhật dòng tương ứng ngay, cuối cùng `loadStories()` để
  đồng bộ; lỗi check hiện icon cảnh báo + tooltip `checkError`, giữ số cũ.
- Mở app: sau lần `loadStories()` đầu, chạy đúng luồng trên một lần cho các
  truyện `watching` (ref guard), không hỏi, không chặn UI.

`StoryDetail`:

- Nút "Theo dõi"/"Đang theo dõi" (icon `bell`, `aria-pressed`) cạnh "Lưu thông
  tin"; hiện `timeAgo(lastCheckedAt)` ("Kiểm tra lần cuối …").
- Banner khi `story.newChapterCount > 0`: "Có N chương mới kể từ lần crawl
  trước." + nút **"Tải N chương mới"**:
  1. `refreshStoryToc(id)` → chương mới thành `pending`, chương cũ giữ nội dung;
  2. `await onStoryChanged()` để prop `story` có danh sách mới;
  3. `handleCrawl()` → crawl toàn bộ chương chưa xong (tức các chương mới).
  Nút disabled trong lúc chạy, nhãn "Đang tải chương mới…".
- `onStoryChanged` đổi kiểu thành `() => void | Promise<void>` để await được.
- `timeAgo` chuyển từ `LibraryView` sang `frontend/src/timeAgo.ts` dùng chung.
- Icon `bell` thêm vào `Icon.tsx`.

## 4. Testing & verify

Unit test (vitest, cạnh source):

- `estimateRemainingMs`: `completed` 0/1/2 → undefined; `completed >= total` →
  undefined; `elapsed <= 0` → undefined; công thức chuẩn; giá trị làm tròn.
- `countNewChapters`: TOC dài hơn, ngắn hơn, trùng URL hoàn toàn, TOC rỗng.
- `storyStore`: DB cũ thiếu cột vẫn mở được và tự thêm 4 cột; `setWatching` bật
  giữ nguyên count, tắt xoá count + error; `setCheckResult` từng phần
  (count / checkedAt / error null); `save()` không ghi đè 4 field; `list()`
  trả đúng field mới.

Verify tay:

1. Crawl một truyện ~10 chương: thấy `còn ~… phút` ở JobStrip, bảng thư viện
   và chi tiết; reload tab giữa chừng thấy ETA ngay; crawl xong ETA biến mất.
2. Bật theo dõi một truyện đã crawl xong → bấm "Kiểm tra chương mới" → không có
   chương mới thì count = 0, `last_checked_at` cập nhật.
3. Xoá vài dòng `chapters` của một truyện test trong DB (hoặc dùng truyện có TOC
   vừa tăng thật) → mở app thấy chip "N chương mới" → bấm "Tải N chương mới":
   TOC được nạp lại, chỉ các chương thiếu được crawl, chương cũ giữ nguyên nội
   dung và bản sửa.
4. Ngắt mạng rồi bấm "Kiểm tra chương mới": dòng hiện cảnh báo, số chương mới
   cũ giữ nguyên; có mạng lại thì check thành công và xoá cảnh báo.
5. Tắt theo dõi: chip mới biến mất, không còn bị check khi mở app.
6. `npm test`, `npm run build`, `npx tsc -p frontend --noEmit` đều pass.

## 5. Thành phần bị ảnh hưởng

- Backend: `src/types.ts`, `src/services/crawl.ts` (hàm ETA),
  `src/services/storyService.ts` (`countNewChapters`, merge giữ field),
  `src/services/storyStore.ts` (migration + 2 method + mapping),
  `src/routes/api.ts` (ETA trong 2 luồng crawl + 3 endpoint mới + helper
  refresh, `runningCrawls`).
- Frontend: `frontend/src/types.ts`, `api.ts`, `useCrawlJob.ts`,
  `formatEta.ts` (mới), `timeAgo.ts` (mới), `components/{JobStrip,
  LibraryView, StoryDetail, StatusChip, Icon}.tsx`, `styles.css` (`.chip-new`).
- Tests: `src/services/crawl.test.ts`, `storyService.test.ts`,
  `storyStore.test.ts`.
- Docs: `README.md` (mục Tính năng + Giới hạn đã biết).

## 6. Tiêu chí thành công

- Trong lúc crawl, ETA hiện ở cả ba chỗ, cập nhật theo từng chương, ẩn khi
  chưa đủ mẫu hoặc đã xong; tab reload vẫn thấy ngay.
- Truyện được theo dõi được kiểm tra khi mở app và khi bấm nút; chương mới hiện
  chip/banner kèm số lượng chính xác; một nút nạp TOC + crawl đúng phần thiếu;
  truyện không theo dõi không bị đụng tới.
- Không có tiến trình nền, không auto-crawl, không notification.
- Lỗi kiểm tra không làm mất số liệu cũ và hiển thị rõ ràng.
- Test + build pass, không hồi quy luồng crawl/export hiện có.

## 7. Giới hạn đã biết (ghi README)

- Kiểm tra chỉ chạy khi app đang mở; mỗi truyện theo dõi tốn một lần fetch TOC
  (truyện nhiều trang có thể mất vài giây, chạy tối đa 2 truyện song song).
- Phát hiện chương mới dựa trên URL: chương đổi URL/tên vẫn tính là mới;
  chương bị xoá khỏi TOC không được báo.
- Hai tab mở cùng lúc có thể check trùng một truyện (chỉ là fetch thừa, không
  sai dữ liệu).
- ETA là ước lượng trung bình, đổi khi gặp chương chậm/retry; không giữ qua
  restart server.
