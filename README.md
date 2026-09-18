# Web → EPUB

[![Docker Image](https://img.shields.io/docker/v/vfakhuongdv/web-to-epub?label=docker%20hub&sort=semver)](https://hub.docker.com/r/vfakhuongdv/web-to-epub)
[![Release](https://img.shields.io/github/v/release/vfa-khuongdv/web-to-epub)](https://github.com/vfa-khuongdv/web-to-epub/releases)

Crawl truyện từ web rồi đóng gói thành file **EPUB** đọc trên Kindle. Trích xuất
nội dung **đang thực sự hiển thị** trên trang, kể cả khi trang dùng CSS/JS để
chặn bôi đen, copy hay chuột phải.

> Công cụ chỉ xử lý nội dung bạn đã có quyền truy cập. Nó **không** bypass đăng
> nhập, paywall hay DRM — chương bị khóa sẽ báo lỗi rõ ràng thay vì tìm cách
> vượt qua.

![Giao diện Web to EPUB](docs/screenshots/giao-dien.png)

Giao diện tối (bấm icon trên thanh tiêu đề để đổi, hoặc để "tự động" theo hệ điều hành):

![Giao diện tối](docs/screenshots/giao-dien-toi.png)

## Mục lục

- [Tính năng](#tính-năng)
- [Trang được hỗ trợ](#trang-được-hỗ-trợ)
- [Cài đặt](#cài-đặt)
- [Sử dụng](#sử-dụng)
- [Cấu hình](#cấu-hình)
- [API](#api)
- [Cấu trúc project](#cấu-trúc-project)
- [Phát triển](#phát-triển)
- [Đóng gói & phát hành](#đóng-gói--phát-hành)
- [Cách hoạt động](#cách-hoạt-động)
- [Giới hạn đã biết](#giới-hạn-đã-biết)

## Tính năng

- **Tự động load danh sách chương** — dán URL trang truyện, công cụ nạp toàn bộ
  mục lục rồi crawl tuần tự.
- **Không mất tiến độ** — mỗi chương được ghi xuống SQLite ngay khi crawl xong.
  Đóng tab giữa chừng, mở lại vẫn thấy đúng `done/total` và crawl tiếp được.
- **Theo dõi realtime** — crawl chạy ở hậu trường, tiến độ đẩy qua SSE nên mọi
  tab đang mở đều thấy trạng thái giống nhau, không cần F5.
- **Ảnh bìa tự động** — lấy bìa từ trang truyện, nhận dạng bằng magic bytes để
  CDN trả `content-type` chung chung vẫn lưu đúng định dạng.
- **Sửa lại chương rồi lưu** — nội dung crawl về thường lẫn lời web, quảng cáo
  hay tên chương lặp lại; sửa tiêu đề và nội dung ngay trong bảng chương rồi
  bấm **Lưu chương** là ghi thẳng vào thư viện, mở lại vẫn còn.
- **Quản lý thư viện** — cột trạng thái cho biết truyện nào đã crawl xong hay
  còn bao nhiêu chương, tìm theo tên (gõ không dấu vẫn ra), bấm tiêu đề cột để
  sắp xếp — giữ Shift để thêm tiêu chí phụ — phân trang, và chọn nhiều truyện
  để xoá một lượt.
- **Mở nhanh cả truyện nghìn chương** — danh sách chương không kèm nội dung,
  mở chương nào mới tải chương đó; bảng chương phân trang 100 chương/trang.
- **Xử lý chương lỗi** — thử lại riêng từng chương, hoặc tự dán nội dung cho
  chương crawl không được.
- **Giao diện sáng/tối** — một nút trên thanh tiêu đề, xoay vòng tự động → sáng
  → tối; để tự động thì bám theo cài đặt hệ điều hành.
- **EPUB chuẩn** — TOC (NCX + nav), metadata, ảnh bìa, ảnh trong chương được
  tải về và nhúng thẳng vào file.
- **Audio/video trong chương** — thẻ `<audio>`/`<video>` của trang nguồn được
  tải về và nhúng vào EPUB, phát ngay trong máy đọc sách hỗ trợ (Apple Books,
  Thorium, Calibre). Kindle không phát được nên ở đó hiện link về nguồn.
- **Chạy được ở 3 dạng** — server Node, container Docker, hoặc app macOS.

## Trang được hỗ trợ

Danh sách whitelist nằm ở [`src/config/supportedSites.ts`](src/config/supportedSites.ts);
thêm domain mới chỉ cần sửa file này.

| Trang | Tự động load mục lục | Ghi chú |
|---|---|---|
| `xtruyen.vn` | ✅ (API JSON của site) | Đã test kỹ nhất |
| `truyenfull.live` / `truyenfull.vn` | ✅ (ghép các trang TOC) | Đã test thực tế |
| `truyencom.com` | ✅ (ghép các trang TOC) | |
| `wattpad.com` | ✅ (API nội bộ `/api/v3/stories/<id>`) | Chương trả phí không hỗ trợ |
| `metruyenchu.com` | ❌ | Nhập URL từng chương ở tab "Crawl thủ công" |

## Cài đặt

### Docker (khuyến nghị)

Image multi-arch (`linux/amd64` + `linux/arm64`), không cần cài Node hay Chromium:

```bash
docker run -d -p 3100:3100 -v "$PWD/data:/app/data" vfakhuongdv/web-to-epub:latest
```

Hoặc dùng [`docker-compose.yml`](docker-compose.yml) có sẵn:

```bash
docker compose up -d
```

Mở `http://localhost:3100`.

### App macOS

Tải `.dmg` từ [Releases](https://github.com/vfa-khuongdv/web-to-epub/releases),
kéo app vào `/Applications`, rồi chạy **một lần** trong Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Web to EPUB.app"
```

Bước này bắt buộc vì app chỉ được ký ad-hoc (không có tài khoản Apple
Developer). Bỏ qua thì macOS báo *"Apple could not verify..."*.

Bản phát hành **chỉ chạy trên Apple Silicon**. Máy Intel cần tự build
(xem [Đóng gói & phát hành](#đóng-gói--phát-hành)).

### Từ source

Yêu cầu **Node.js ≥ 22** (dùng `node:sqlite` built-in, có từ Node 22.5).
Project dùng npm workspaces nên `npm install` ở thư mục gốc cài luôn cho
`frontend/`.

```bash
npm install
npx playwright install chromium   # Chromium headless cho Playwright (~200MB)
npm run build                     # tsc (backend) + vite build (frontend -> public/)
npm start
```

Các lệnh này đều có trong `Makefile` — gõ `make` để xem danh sách.

## Sử dụng

UI có hai tab:

**Truyện của tôi** — cách dùng chính:

1. Dán URL trang truyện (ví dụ `https://truyenfull.live/dau-xuan-tuoi-sang/`)
   rồi bấm "Tải danh sách chương".
2. Bấm "Crawl" — tiến độ hiện realtime, đóng tab không mất tiến độ.
3. Mở chi tiết truyện để sửa tên sách / tác giả / ảnh bìa, sửa lại tên và nội
   dung từng chương nếu cần.
4. Bấm "Xuất EPUB" — sách gồm mọi chương đã có nội dung.

**Crawl thủ công** — dán trực tiếp danh sách URL từng chương (mỗi dòng một
URL), dùng cho trang chưa có adapter mục lục như `metruyenchu.com`.

Chương lỗi hiển thị khung đỏ kèm nút "Thử lại" riêng và nút "Nhập nội dung thủ
công" để tự dán nội dung vào.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3100` | Cổng HTTP |
| `DATA_DIR` | `./data` | Nơi lưu `stories.db` và `covers/`. Bản app macOS trỏ vào `~/Library/Application Support/web-to-epub/data` |
| `CHROMIUM_NO_SANDBOX` | — | Đặt `1` để tắt sandbox của Chromium. Image Docker bật sẵn vì container không có user namespace; chạy ngoài Docker nên để trống |

Dữ liệu nằm hết trong `DATA_DIR` — sao lưu thư mục đó là sao lưu toàn bộ thư
viện. Chạy Docker thì **phải** mount volume vào `/app/data`, không thì xoá
container là mất sạch.

## API

Backend phục vụ cả frontend đã build lẫn REST API dưới `/api`.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/api/supported-sites` | Danh sách domain được phép crawl |
| `GET` | `/api/stories` | Danh sách truyện trong thư viện |
| `POST` | `/api/stories` | `{ url }` — nạp mục lục từ trang truyện, tải bìa, lưu vào thư viện |
| `GET` | `/api/stories/:id` | Chi tiết truyện + danh sách chương (**không** kèm nội dung, để truyện nghìn chương vẫn mở nhanh) |
| `GET` | `/api/stories/:id/chapters/:order` | Nội dung một chương, tải khi người dùng mở chương ra |
| `POST` | `/api/stories/:id/crawl` | `{ orders? }` — crawl ở hậu trường, trả `202` ngay |
| `POST` | `/api/stories/:id/meta` | Lưu tên sách / tác giả / ngôn ngữ / ảnh bìa (multipart khi kèm ảnh) |
| `PATCH` | `/api/stories/:id/chapters/:order` | `{ title, contentHtml }` — lưu tên & nội dung người dùng đã sửa cho một chương |
| `GET` | `/api/stories/:id/cover` | Ảnh bìa đã lưu |
| `GET` | `/api/stories/live` | **SSE** — tiến độ mọi truyện đang crawl (kèm `storyId`) |
| `GET` | `/api/stories/:id/live` | **SSE** — tiến độ một truyện |
| `POST` | `/api/extract` | `{ urls }` — crawl danh sách URL, trả **NDJSON** mỗi dòng một sự kiện |
| `POST` | `/api/extract-one` | `{ url }` — crawl lại một chương |
| `POST` | `/api/cover-upload` | Upload ảnh bìa tạm (multipart) |
| `POST` | `/api/stories/:id/export` | `{ metadata, chapters }` — dựng EPUB từ nội dung trong DB, client chỉ gửi chương đang sửa dở |
| `POST` | `/api/export` | `{ metadata, chapters }` — trả file `.epub` (dùng cho tab Crawl thủ công) |

## Cấu trúc project

```
.
├── src/                          # Backend (Node + TypeScript + Express)
│   ├── server.ts                 # Khởi động Express, serve public/ + API
│   ├── config/
│   │   ├── paths.ts              # DATA_DIR
│   │   └── supportedSites.ts     # Whitelist domain
│   ├── routes/api.ts             # Toàn bộ endpoint /api
│   └── services/
│       ├── renderer.ts           # Playwright: render trang + auto-scroll
│       ├── extractor.ts          # Readability + lọc chrome + DOM -> blocks
│       ├── crawl.ts              # Vòng lặp crawl + tự thử lại
│       ├── epubBuilder.ts        # Chapters + metadata -> buffer EPUB
│       ├── storyStore.ts         # SQLite: bảng stories + chapters
│       ├── coverStore.ts         # Tải & lưu ảnh bìa
│       ├── toc/                  # Adapter mục lục theo từng site
│       └── chapters/             # Fetcher chương riêng cho Wattpad
├── frontend/                     # React + TypeScript, build bằng Vite
│   └── src/components/           # LibraryView, StoryDetail, ChapterCard...
├── electron/main.js              # Main process cho bản app macOS
├── scripts/                      # Tạo icon, ký ad-hoc bundle
├── public/                       # Build output của frontend (tự sinh)
├── data/                         # Thư viện: stories.db + covers/ (không commit)
├── Dockerfile                    # Image multi-stage
└── Makefile                      # make help để xem toàn bộ lệnh
```

## Phát triển

```bash
make dev            # backend: tsc --watch + nodemon
make dev-frontend   # frontend: Vite dev server (HMR, proxy /api -> :3100)
make test           # vitest
```

`public/` là thư mục **sinh ra** bởi `npm run build` — sửa trong `frontend/src/`
chứ đừng sửa trực tiếp.

## Đóng gói & phát hành

```bash
make docker-build   # image cho máy hiện tại
make docker-push    # multi-arch amd64 + arm64 lên Docker Hub
make app            # app macOS -> release/*.dmg
make release-mac    # build app rồi thay file .dmg trên GitHub release
```

**Docker**: multi-stage — stage builder chạy `npm run build`, stage runtime chỉ
cài dependency production kèm Chromium của Playwright và chạy bằng user `node`.

**App macOS**: Electron chạy thẳng server Express rồi mở cửa sổ trỏ vào
localhost (cổng ngẫu nhiên nên không đụng cổng đang dùng). Chromium của
Playwright (bản `--only-shell`, 195MB) nằm trong `Contents/Resources/` nên máy
nhận không cần cài gì. File `.dmg` khoảng 217MB, app giải nén ~520MB. Máy Intel
cần `electron-builder --mac --x64` và bản Chromium x64 — chạy build trên chính
máy Intel là chắc ăn nhất.

## Cách hoạt động

```
URL ──▶ Renderer ──▶ Extractor ──▶ Blocks ──▶ Preview/Edit ──▶ EPUB Builder ──▶ .epub
       Playwright   Readability   (SQLite)      (React)          epub-gen
```

1. **Render** (`renderer.ts`) — Playwright mở trang như trình duyệt thật, chạy
   đủ JS/CSS, tự scroll để kích hoạt lazy-load, rồi đọc `page.content()`.
2. **Extract** (`extractor.ts`) — Readability lấy phần nội dung chính, bộ lọc
   tự viết loại nốt menu/quảng cáo/related posts, rồi map DOM thành
   `ContentBlock` có kiểu (`heading` / `paragraph` / `image`).
3. **Lưu** (`storyStore.ts`) — mỗi chương ghi xuống SQLite bằng transaction
   riêng ngay khi xong.
4. **Export** (`epubBuilder.ts`) — gom chương đã tick + metadata, gọi `epub-gen`.

**Vì sao vượt qua được chặn copy?** Renderer không mô phỏng thao tác bôi
đen/copy của người dùng — nó đọc thẳng cây DOM đã render từ phía server.
`user-select: none`, `oncopy`, `oncontextmenu` hay JS chặn phím tắt chỉ chặn
**hành vi trong trình duyệt của người dùng**, không ảnh hưởng tới việc đọc DOM
bằng code.

**Ảnh trong chương** được tải về **trước** khi đưa cho `epub-gen`, và đuôi file
lấy từ magic bytes chứ không đoán từ URL. Lý do: `epub-gen` đoán bằng
`mime.getType(url)` nên URL không có đuôi (rất phổ biến với CDN ảnh) cho ra file
`<id>.null` kèm `media-type=""` — máy đọc sách không hiện được ảnh và file EPUB
sai chuẩn. Ảnh tải hỏng thì bỏ hẳn thẻ `<img>` thay vì để lại tham chiếu gãy.

**Audio/video** đi xa hơn một bước: `epub-gen` không biết gì về chúng — nó chỉ
đóng gói thẻ `<img>`, còn `controls` (thứ duy nhất làm hiện nút play) thì bị bộ
lọc thuộc tính của nó xoá. Nên file media được tải về trước, `src` trỏ vào
`media/<n>.<ext>` trong sách, rồi sau khi `epub-gen` đóng gói xong thì file EPUB
được mở ra vá lại: thêm file media, khai `<item>` trong manifest và trả
`controls` về chỗ cũ. File quá 50MB hoặc tải hỏng (link streaming, host chặn)
thành một đoạn chứa link về nguồn, thay vì mất hẳn.

## Giới hạn đã biết

- **Chỉ crawl domain trong whitelist.** Trong đó mới `xtruyen.vn` và
  `truyenfull.live` được test thực tế; các domain còn lại thêm theo yêu cầu,
  nên kiểm tra chất lượng trích xuất trước khi tin tưởng.
- **Trích xuất thất bại không đều** ở vài trang (rõ nhất với `xtruyen.vn`) do
  nội dung load trễ, dù đã tự thử lại 3 lần — dùng nút "Thử lại" trên UI.
- **Tường chống-chặn-quảng-cáo** (gặp ở `truyenfull.live`) làm chương báo lỗi.
  Công cụ cố ý **không** vượt qua; dùng "Nhập nội dung thủ công" nếu bạn đã xem
  hợp lệ nội dung đó ở trình duyệt thường.
- **Wattpad**: chương tải bằng HTTP thường (nhanh hơn mở trình duyệt) vì site
  server-render sẵn nội dung. Chương trả phí (Paid Stories) báo lỗi, không
  bypass. API mục lục là API nội bộ, không chính thức — site đổi API thì adapter
  báo lỗi rõ ràng.
- **Nút "Load more"** chưa được click tự động; hiện chỉ tự scroll để kích hoạt
  lazy-load qua scroll event.
- **Bảng (`<table>`)** bị làm phẳng thành các đoạn văn rời rạc.
- **Không có đăng nhập tự động** — trang yêu cầu đăng nhập thì nằm ngoài phạm vi.
- **Tên chương phụ thuộc mục lục của site.** Mục lục `xtruyen.vn` chỉ trả phần
  số ("Quyển 1 Chương 2"); phụ đề ("… : Mở cửa") nằm trên trang từng chương nên
  chỉ hiện sau khi crawl chương đó. Chương đã crawl từ các bản cũ vẫn giữ tên
  cũ — crawl lại để cập nhật.
- **Kindle đời cũ** chỉ đọc MOBI/AZW3 — dùng Calibre để chuyển:
  `ebook-convert book.epub book.azw3`. Kindle firmware mới, "Send to Kindle" và
  Kindle app đọc EPUB trực tiếp.
- **`epub-gen` là thư viện cũ**, kéo theo vài dependency có cảnh báo audit.
  Chấp nhận được cho công cụ chạy local; dùng lâu dài có thể thay bằng EPUB
  writer mới hơn.
