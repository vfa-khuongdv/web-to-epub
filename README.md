# Web → EPUB cho Kindle

Trích xuất nội dung **đang thực sự hiển thị** trên một trang web — kể cả khi trang
đó dùng CSS/JS để chặn bôi đen, copy, chuột phải — rồi đóng gói thành file
**EPUB** để đọc trên Kindle.

> Công cụ chỉ xử lý nội dung mà bạn đã có quyền truy cập (trang public, hoặc bạn
> đã đăng nhập sẵn trong trình duyệt thường của bạn). Nó không bypass đăng nhập,
> paywall hay DRM.

## 1. Kiến trúc hệ thống

```
┌─────────────┐   URLs    ┌──────────────────────────────┐
│  Frontend   │ ────────▶ │           Backend             │
│ (HTML/JS)   │           │                                │
│ - Nhập URL  │           │  ┌─────────┐  ┌─────────────┐  │
│ - Preview   │◀─NDJSON/SSE│  │Renderer │→│  Extractor   │  │
│ - Edit      │  progress │  │Playwright│  │ Readability  │  │
│ - Export    │           │  └─────────┘  │  + jsdom     │  │
└─────────────┘           │               └──────┬──────┘  │
      │                   │                      ▼         │
      │  edited chapters  │               ┌─────────────┐  │
      └──────────────────▶│               │ EPUB Builder │  │
                           │               │ (epub-gen)   │  │
                           │               └──────┬──────┘  │
                           └──────────────────────┼─────────┘
                                                   ▼
                                              file.epub
```

**Vì sao vượt qua được chặn copy?** Renderer không mô phỏng thao tác
copy/bôi đen của người dùng — nó dùng Playwright để mở trang như trình duyệt
thật (chạy đầy đủ JS/CSS), sau đó đọc thẳng `page.content()` — tức cây DOM đã
render, không đi qua clipboard hay sự kiện chuột. `user-select: none`,
`oncopy`, `oncontextmenu`, hay JS chặn phím tắt chỉ chặn **hành vi người dùng
trong trình duyệt**, không ảnh hưởng gì tới việc đọc DOM bằng code phía server.

## 2. Tech stack

| Thành phần | Công nghệ | Lý do |
|---|---|---|
| Render trang | **Playwright** (Chromium headless) | Chạy JS thật, xử lý lazy-load/infinite-scroll bằng auto-scroll |
| Trích xuất nội dung chính | **@mozilla/readability** + **jsdom** | Thuật toán Readability (dùng trong Firefox Reader View) tự động loại header/nav/sidebar/ads |
| Phân loại cấu trúc | Bộ duyệt DOM tự viết (`extractor.ts`) | Map heading/paragraph/image thành block có kiểu dữ liệu rõ ràng |
| Sinh EPUB | **epub-gen** | Tạo EPUB hợp lệ với TOC (NCX + nav), metadata, cover, tự tải ảnh remote |
| Backend server | **Node.js + TypeScript + Express** | Một process duy nhất phục vụ cả API và frontend đã build |
| Lưu tiến độ truyện | **node:sqlite** (SQLite built-in của Node) | Hai bảng `stories`/`chapters`, ghi từng chương ngay khi xong, không thêm dependency native |
| Frontend | **React + TypeScript + Vite** | UI dạng component (form nhập liệu, danh sách chapter, thẻ preview/edit) |
| Progress | NDJSON qua `fetch` (crawl thủ công) + **SSE** `GET /api/stories/:id/live` (crawl truyện) | Crawl truyện chạy ở hậu trường và đẩy tiến trình cho mọi phiên đang mở truyện — reload hay mở tab khác vẫn thấy đúng trạng thái, không cần WebSocket |
| Site whitelist | `supportedSites.ts` | Chỉ cho phép crawl các domain đã duyệt, chặn cứng ở cả frontend lẫn backend |

## 3. Cấu trúc project

```
tool-crawler-/
├── src/                        # Backend (Node.js + TypeScript)
│   ├── server.ts               # Khởi động Express, serve public/ (đã build) + API
│   ├── types.ts                # Kiểu dữ liệu dùng chung (block, chapter, request/response)
│   ├── types/epub-gen.d.ts     # Type declaration cho thư viện epub-gen (không có sẵn types)
│   ├── config/
│   │   └── supportedSites.ts   # Whitelist domain được hỗ trợ crawl
│   ├── routes/
│   │   └── api.ts              # /api/extract (NDJSON), /api/stories/live (SSE chung), /api/stories/:id/{cover,meta}, /api/extract-one, /api/cover-upload, /api/export, /api/supported-sites
│   └── services/
│       ├── renderer.ts         # Playwright: render trang + auto-scroll
│       ├── extractor.ts        # Readability + lọc chrome + duyệt DOM → blocks
│       └── epubBuilder.ts      # Gói chapters + metadata → buffer EPUB
├── frontend/                    # Frontend (React + TypeScript, build bằng Vite)
│   ├── vite.config.ts           # build.outDir = ../public (Express serve thẳng, không cần đổi server.ts)
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx              # State chính: form nhập liệu, progress, danh sách chapter
│       ├── api.ts                # Gọi các endpoint backend (bao gồm đọc NDJSON stream)
│       ├── types.ts, blocksToHtml.ts, isSupportedUrl.ts
│       ├── styles.css
│       └── components/
│           └── ChapterCard.tsx  # Thẻ preview/edit từng chapter (kể cả trạng thái lỗi + nút thử lại)
├── public/                       # Build output của frontend (tự sinh, không sửa tay)
├── data/                         # Thư viện truyện: stories.db (SQLite) + covers/ (không commit)
├── Dockerfile                    # Image multi-stage: build tsc+vite → runtime Node 22 + Chromium
├── docker-compose.yml            # Chạy image từ Docker Hub, mount ./data
├── package.json                  # npm workspaces: root (backend) + frontend
└── tsconfig.json
```

## 4. Flow xử lý: Website → Render → Extract → Clean → EPUB

1. **Người dùng nhập** danh sách URL (mỗi dòng = 1 chapter, theo đúng thứ tự
   muốn xuất hiện trong sách) + metadata (tên sách, tác giả, ngôn ngữ, ảnh bìa).
2. **Kiểm tra whitelist** (`config/supportedSites.ts`): mỗi URL phải thuộc
   một domain trong danh sách được duyệt — chặn cả ở frontend (validate trước
   khi gọi API) lẫn backend (`/api/extract`, `/api/extract-one` trả 400 nếu có
   domain lạ).
3. **Render** (`renderer.ts`): với mỗi URL, mở trang bằng Chromium headless,
   đợi `networkidle`, tự động scroll xuống đáy nhiều lần để kích hoạt nội dung
   lazy-load/infinite-scroll, rồi lấy `page.content()`. Nếu extract thất bại,
   tự động thử lại tối đa 3 lần (một số trang hoàn tất `networkidle` trước khi
   nội dung load AJAX xong).
4. **Trích xuất** (`extractor.ts`):
   - Xoá thẻ `script/style/nav/header/footer/aside` và mọi phần tử có
     class/id khớp danh sách "chrome" (ad, sidebar, banner, comment, share,
     related, popup, ...).
   - Chạy Readability để xác định nội dung chính (content HTML), loại bỏ phần
     còn lại (menu, quảng cáo, related posts...).
   - Duyệt HTML kết quả, map từng phần tử thành `ContentBlock`:
     `heading` (h1–h6), `paragraph` (p/blockquote), `image` (img/figure).
   - Xác định tiêu đề chapter theo thứ tự ưu tiên: heading đầu tiên trong nội
     dung → raw `<title>` tag → tiêu đề Readability đoán (fallback cuối, vì
     heuristic này hay nhầm sang tên truyện thay vì tên chương trên các trang
     dạng chapter-list).
5. **Preview & chỉnh sửa** (React, `frontend/src`): mỗi chapter hiển thị
   thành một `ChapterCard` có số thứ tự, tiêu đề sửa được, checkbox chọn đưa
   vào sách, và vùng `contenteditable`. Chapter lỗi hiển thị card riêng kèm
   nút thử lại; có nút thử lại tất cả chapter lỗi cùng lúc.
6. **Export** (`epubBuilder.ts`): gom các chapter đã tick + metadata, gọi
   `epub-gen` để sinh file EPUB (mimetype, OPF, NCX, nav TOC, chapter XHTML,
   ảnh được tải về và nhúng vào `OEBPS/images/`), trả về client dưới dạng file
   tải xuống.

## 5. UI/UX

- **Bước 1 — Nguồn nội dung**: textarea nhập URL (mỗi dòng 1 chapter) kèm
  ghi chú danh sách domain được hỗ trợ (lấy động từ `/api/supported-sites`),
  form metadata (tên sách, tác giả, ngôn ngữ, upload ảnh bìa), nút "Crawl &
  Trích xuất nội dung".
- **Progress**: thanh progress bar + log dạng danh sách, cập nhật theo từng
  chapter (`[2/10] https://... — Đang trích xuất...`), lỗi từng chapter hiển
  thị riêng (không làm hỏng cả batch).
- **Bước 2 — Preview & chỉnh sửa**:
  - dòng tóm tắt kết quả ngay sau khi crawl xong (`✅ 8/8 thành công` hoặc
    `⚠️ 6/8 thành công, 2 lỗi`),
  - nút "Thử lại tất cả chương lỗi" khi có ít nhất 1 chapter lỗi,
  - mỗi chapter là một `ChapterCard` có: số thứ tự (`#1`, `#2`...) để không bị
    lạc giữa danh sách dài, checkbox include/exclude, input sửa tiêu đề, vùng
    `contenteditable` hiển thị heading/paragraph/image đã trích xuất (sửa trực
    tiếp như trình soạn thảo đơn giản); chapter lỗi hiển thị khung đỏ kèm
    thông báo lỗi + nút "Thử lại" riêng, cùng nút "Nhập nội dung thủ công" để
    tự dán vào nội dung đã xem hợp lệ ở trình duyệt thường (ví dụ chapter bị
    website khóa sau tường chống-chặn-quảng-cáo) — công cụ không tự động vượt
    qua cơ chế khóa đó.
- **Xuất EPUB**: nút cuối trang, tải file `.epub` trực tiếp về máy.

Toàn bộ xử lý nặng (render trình duyệt, trích xuất) chạy ở **backend**, nên
tab trình duyệt của người dùng không bị treo dù crawl nhiều chapter/nội dung dài.

## 6. Quản lý truyện (tab "Truyện của tôi")

Bên cạnh tab "Crawl thủ công" (nhập tay danh sách URL chương), UI có tab
**"Truyện của tôi"** để crawl và theo dõi tiến độ theo từng truyện:

- **Tự động load danh sách chương**: dán URL trang truyện (ví dụ
  `https://truyenfull.live/dau-xuan-tuoi-sang/`) rồi bấm "Tải danh sách
  chương" — backend tự nhận diện site, chạy adapter TOC tương ứng và nạp
  **toàn bộ** danh sách chương vào truyện (trạng thái ban đầu `pending`).
  Hiện hỗ trợ `truyenfull.live`, `truyenfull.vn`, `truyencom.com`
  (server-rendered: fetch HTML trực tiếp và ghép các trang TOC),
  `xtruyen.vn` (gọi API JSON của site) và `wattpad.com` (trang truyện là SPA
  nên dùng API nội bộ `/api/v3/stories/<id>` — API trả toàn bộ parts trong
  một request, không cần phân trang; URL dạng
  `https://www.wattpad.com/story/<id>`). `metruyenchu.com` chưa có adapter
  TOC — nhập URL chương thủ công ở tab "Crawl thủ công".
- **Lưu tiến độ vào `data/stories.db` (SQLite)**: hai bảng `stories` và
  `chapters` (`id = sha1(URL truyện)`); mỗi chương được ghi xuống DB ngay khi
  crawl xong bằng một transaction riêng — không đợi crawl hết mới lưu. Mỗi
  chương có trạng thái `pending | done | error`; chương `done` kèm nội dung
  đã trích xuất, được dùng lại khi export hoặc crawl tiếp. Vì vậy **đóng tab
  giữa chừng không mất tiến độ**: mở lại thấy đúng `done/total`, nút "Crawl
  tiếp (N chương)" chỉ chạy các chương còn chờ/lỗi (kể cả khi client ngắt kết
  nối, vòng lặp phía server vẫn tiếp tục và lưu từng chương khi xong).
- **Chi tiết & export**: mở truyện để xem toàn bộ chương (chương đã crawl
  hiển thị nội dung, chương lỗi có nút "Thử lại", chương còn lại là dòng
  "Chờ crawl"), xem tiến độ `done/total` + số lỗi, và export EPUB với
  metadata prefill từ TOC.
- **Ảnh bìa tự động**: URL bìa lấy từ trang truyện (cả 4 adapter đều có) được
  tải về `data/covers/<id>.<ext>` ngay khi tạo truyện và ở lần crawl kế tiếp
  của các truyện cũ (mỗi truyện tải một lần). Ảnh được nhận diện bằng magic
  bytes nên CDN trả `content-type` chung chung vẫn lưu đúng (gặp thật với
  `img.xtruyen.vn`); không tải được thì giữ URL gốc. Khung chi tiết hiện bìa
  xem trước (`GET /api/stories/:id/cover`), và khi export mà không chọn file
  thì bìa này được dùng làm bìa sách — chọn file vẫn ghi đè cho lần xuất đó.
- **Theo dõi crawl realtime (SSE)**: `POST /api/stories/:id/crawl` trả `202`
  ngay và crawl chạy ở hậu trường; tiến trình đẩy qua kênh chung
  `GET /api/stories/live` (Server-Sent Events, mỗi sự kiện kèm `storyId`) —
  bấm crawl ở tab này thì tab khác (hoặc tab vừa reload) thấy đúng trạng thái
  từng chương, tiến độ và nhật ký, không cần F5. Bảng thư viện cũng đọc kênh
  này nên **mọi dòng đang crawl đều có chip "Đang crawl N/M"** dù chưa chọn
  truyện. Kênh gửi ảnh chụp `{type:"snapshot",crawls:[...]}` khi kết nối và
  `retry: 2000` để tự kết nối lại. (`GET /api/stories/:id/live` vẫn còn cho
  một truyện, tiện debug bằng curl.)
- **Lưu thông tin sách**: khung chi tiết có nút "Lưu thông tin" ghi
  tên sách/tác giả/ngôn ngữ/ảnh bìa vào thư viện
  (`POST /api/stories/:id/meta`, multipart khi kèm ảnh). Thông tin đã lưu thắng
  TOC khi nạp lại danh sách chương; ảnh chọn từ máy được nhận diện bằng magic
  bytes rồi lưu thành bìa truyện (thay bìa cũ).

## 7. Cài đặt và chạy

Yêu cầu: Node.js ≥ 18. Project dùng **npm workspaces** — `frontend/` là một
workspace con, `npm install` ở thư mục gốc cài luôn dependency cho cả hai.

```bash
npm install
npx playwright install chromium   # tải Chromium headless cho Playwright (~200MB)
npm run build                     # tsc (backend) + vite build (frontend -> public/)
npm start
```

Mở trình duyệt tại `http://localhost:3100` (đổi cổng bằng `PORT=xxxx npm start`).

Dev mode:

```bash
npm run dev            # backend: tsc --watch + nodemon, tự restart khi sửa src/
npm run dev:frontend   # frontend: Vite dev server (proxy /api -> localhost:3100), có HMR
```

Lưu ý: `public/` là thư mục **sinh ra** bởi `npm run build` (Vite build vào
thẳng đó) — không sửa tay file trong `public/`, sửa trong `frontend/src/`.

## 8. Chạy bằng Docker

Image đã build sẵn trên Docker Hub: **`vfakhuongdv/web-to-epub`** (multi-arch:
`linux/amd64` + `linux/arm64`). Người dùng chỉ cần Docker, không cần cài
Node/Chromium.

```bash
docker run -d --name web-to-epub -p 3100:3100 -v "$PWD/data:/app/data" \
  vfakhuongdv/web-to-epub:latest
```

Hoặc dùng `docker-compose.yml` có sẵn trong repo:

```bash
docker compose up -d
```

Mở `http://localhost:3100`. Đổi cổng host bằng cách sửa `-p 8080:3100`
(cổng **bên trong** container luôn là 3100 trừ khi đặt thêm `-e PORT=...`).

**Volume `/app/data` là bắt buộc nếu muốn giữ thư viện**: SQLite (`stories.db`)
và ảnh bìa (`covers/`) nằm ở đó; không mount thì xoá container là mất sạch.

Biến môi trường:

| Biến | Mặc định trong image | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `3100` | Cổng HTTP bên trong container |
| `CHROMIUM_NO_SANDBOX` | `1` | Tắt sandbox của Chromium (container không có user namespace). Chạy ngoài Docker thì bỏ biến này để giữ sandbox. |

### Tự build và push image

```bash
docker build -t vfakhuongdv/web-to-epub:latest .          # build 1 kiến trúc, để test local

# build multi-arch rồi push thẳng lên Docker Hub
docker login
docker buildx create --name multiarch --driver docker-container --use   # chỉ cần 1 lần
docker buildx build --platform linux/amd64,linux/arm64 \
  -t vfakhuongdv/web-to-epub:latest -t vfakhuongdv/web-to-epub:1.0.0 --push .
```

Dockerfile dùng multi-stage: stage `builder` chạy `npm run build`
(tsc + vite → `public/`), stage `runtime` chỉ cài dependency production kèm
Chromium của Playwright rồi chạy `node dist/server.js` bằng user `node`
(không phải root).

## 9. Giới hạn hiện tại (MVP)

- Chỉ crawl được domain nằm trong whitelist ở `src/config/supportedSites.ts`
  (hiện tại: xtruyen.vn, truyenfull.vn/.live, metruyenchu.com, truyencom.com,
  wattpad.com — đã loại các site chết: tangthuvien.vn, truyenyy.vn,
  wikidich.com). Đã test thực tế với xtruyen.vn và truyenfull.live; các domain
  còn lại mới chỉ được thêm theo yêu cầu, cần kiểm tra chất lượng trích xuất
  trước khi tin tưởng hoàn toàn. Muốn thêm domain mới thì sửa file này (không
  cần đổi chỗ khác).
- Renderer dùng `waitUntil: "domcontentloaded"` thay vì `"networkidle"` —
  một số trang có traffic nền liên tục (quảng cáo, analytics, chat widget)
  không bao giờ đạt trạng thái network-idle nên sẽ timeout nếu chờ nó. Có độ
  trễ chờ thêm sau đó để nội dung load bằng AJAX kịp render.
- Một số trang (đã thấy rõ với xtruyen.vn) vẫn load nội dung chương hơi trễ,
  khiến việc trích xuất **thất bại không đều** dù đã có cơ chế tự thử lại 3
  lần — dùng nút "Thử lại"/"Thử lại tất cả chương lỗi" trên UI khi gặp trường
  hợp này.
- Một số trang (đã thấy với truyenfull.live) khóa nội dung sau tường
  chống-chặn-quảng-cáo ("Vui lòng tắt/mở lại quảng cáo..."). `extractor.ts`
  phát hiện mẫu câu này và báo lỗi rõ ràng thay vì âm thầm nhét thông báo đó
  vào sách như một "chapter". Công cụ **không** tự động vượt qua cơ chế khóa
  này — đây là quyết định có chủ đích, đúng với yêu cầu ban đầu là không bypass
  cơ chế kiểm soát truy cập của website. Chapter bị khóa có thể được thay thế
  bằng nút "Nhập nội dung thủ công" nếu bạn đã xem hợp lệ nội dung đó ở trình
  duyệt thường.
- Trang cần nhiều bước tương tác để hiện nội dung (ví dụ nút "Load more" thay
  vì infinite scroll thật) chưa được click tự động — hiện chỉ tự scroll để
  kích hoạt lazy-load qua scroll event.
- Nội dung dạng bảng (`<table>`) bị làm phẳng thành các đoạn văn rời rạc thay
  vì giữ nguyên bảng — chấp nhận được cho bài viết/chapter dạng văn bản, nhưng
  không tối ưu cho trang chủ yếu là dữ liệu dạng bảng.
- Không có xác thực/đăng nhập tự động — nếu trang yêu cầu đăng nhập, cần đăng
  nhập thủ công trong một context Playwright riêng (ngoài phạm vi MVP này).
- Kindle hiện đại (firmware mới, "Send to Kindle", Kindle app) đọc EPUB trực
  tiếp; với Kindle đời cũ hơn chỉ đọc MOBI/AZW3, dùng thêm Calibre
  (`ebook-convert book.epub book.azw3`) để chuyển đổi.
- `epub-gen` là thư viện khá cũ (kéo theo vài dependency có cảnh báo audit từ
  npm) — chấp nhận được cho công cụ chạy local/cá nhân; nếu cần dùng lâu dài
  có thể thay bằng một EPUB writer mới hơn.
- Tab "Truyện của tôi" tự động load danh sách chương cho truyenfull.live,
  truyenfull.vn, truyencom.com, xtruyen.vn và wattpad.com. metruyenchu.com
  phải nhập URL chương thủ công ở tab "Crawl thủ công".
- Wattpad: chương được tải bằng HTTP thường (`chapters/wattpad.ts`) thay vì
  mở trình duyệt, vì Wattpad server-render sẵn toàn bộ nội dung chương vào
  HTML — nhanh hơn hẳn khi crawl truyện dài. Chương thuộc chương trình trả phí
  (Wattpad Originals/Paid Stories) bị báo lỗi rõ ràng và **không** được vượt
  qua, đúng nguyên tắc không bypass của công cụ; chương như vậy có thể thay
  bằng "Nhập nội dung thủ công" nếu bạn đã mua/xem hợp lệ. API danh sách
  chương là API nội bộ, không chính thức — site đổi API sẽ làm adapter báo lỗi
  rõ ràng (không tạo record rác).
- Tiến độ crawl lưu ở `data/stories.db` (SQLite, không commit). Chỉnh sửa chương
  và thông tin sách trên UI **không** được lưu — chỉ dùng cho lần export hiện
  tại. Kết quả crawl thô thì được lưu và dùng lại khi crawl tiếp.
- Truyện rất dài (hàng nghìn chương) có thể làm UI nặng khi mở chi tiết vì
  tải toàn bộ nội dung đã crawl.
- Site đổi cấu trúc HTML/API có thể làm hỏng TOC adapter (báo lỗi rõ ràng,
  không tạo record rác).
