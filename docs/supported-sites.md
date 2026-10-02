# Các trang đã kiểm thử

Cập nhật: 2026-10-02. Chỉ liệt kê site đã thử và chạy được; không liệt kê site chuyên nội dung 18+. Danh sách sẽ được bổ sung dần.

- Site ở mục 1–2 có hỗ trợ riêng trong app.
- Site ở mục 3 chạy qua **AI crawler** (Settings → AI crawler, mặc định tắt). Kết quả phụ thuộc nhà cung cấp AI và có thể thay đổi khi site đổi giao diện.
- Site không có trong danh sách vẫn có thể thử qua AI crawler, nhưng không được đảm bảo. Nếu lỗi, [tạo issue](https://github.com/vfa-khuongdv/web-to-epub/issues/new) kèm URL truyện, URL chương lỗi và thông báo lỗi.

## 1. Site có hỗ trợ riêng (không cần AI)

| Site | Loại | Lưu ý |
|---|---|---|
| TruyenFull (`truyenfull.vn`, `truyenfull.live`) | Truyện chữ (VI) | Cần nhập phiên trình duyệt (Settings → Site sessions) để qua Cloudflare, phiên kéo dài ~30 phút |
| Truyện Hoàn (`truyenhoan.com`) | Truyện chữ (VI) | |
| Đọc Truyện (`truyencom.com`) | Truyện chữ (VI) | |
| XTruyện (`xtruyen.vn`) | Truyện chữ (VI) | |
| Viet Messenger (`vietmessenger.com`) | Ebook phạm vi công cộng (VI) | Sách dành riêng cho thành viên bị từ chối |
| Wattpad (`wattpad.com`) | Truyện chữ (EN) | Không hỗ trợ chương trả phí |
| Asianfanfics (`asianfanfics.com`) | Fanfic (EN) | Truyện rated-M / chỉ dành cho subscriber cần nhập phiên đăng nhập (token ~1 giờ) |
| FanFiction.net (`fanfiction.net`) | Fanfic (EN) | |
| Scribd (`scribd.com`) | Tài liệu | Tài liệu tài khoản không xem đầy đủ sẽ bị từ chối |

## 2. Nhập sách từ file hoặc link (không crawl chương)

| Nguồn | Lưu ý |
|---|---|
| File EPUB | Tối đa 100 MB, EPUB có DRM bị từ chối |
| File PDF | PDF có mật khẩu hoặc cấm sao chép bị từ chối; không OCR |
| DTV Ebook (`dtv-ebook.com.vn`) | Chỉ sách có EPUB |
| Heyzine (`heyzine.com`) | Flipbook có mật khẩu hoặc đã xóa bị từ chối |
| Internet Archive (`archive.org`) | Sách giới hạn mượn cần nhập phiên đăng nhập |

## 3. Site đã chạy được qua AI crawler

| Site | Loại | Lưu ý |
|---|---|---|
| `truyenfull.fit` | Truyện chữ (VI) | Danh sách chương phân trang được đọc đủ (hơn 4000 chương) |
| `webnovel.vn` | Truyện chữ (VI) | |
| `truyennhaong.vn` | Truyện chữ (VI) | |
| `metruyenhotvn.com` | Truyện chữ (VI) | |
| `truyenfullmoi.net` | Truyện chữ (VI) | |
| `metruyenhd.net` | Truyện chữ (VI) | Có lúc trả về 403 với trình tải thông thường; thử lại nếu gặp lỗi |
| `royalroad.com` | Truyện chữ (EN) | Có thể bỏ sót vài chương không đánh số (như "Afterword") |
| `readwn.com` | Truyện chữ (EN) | |
| `wuxiaworld.site` | Truyện chữ (EN) | |
| `czbooks.net` | Truyện chữ (中文) | |
| `ixdzs.tw` | Truyện chữ (中文) | |
| `ncode.syosetu.com` | Truyện chữ (日本語) | |
| `mangatooncom.vn` | Truyện tranh | |
| `truyenqq.com.vn` | Truyện tranh | Site tổng hợp, có thể loại "Adult" trong menu |
| `cotruyenday1.com` | Truyện tranh | Chương có dấu cách trong địa chỉ ảnh đã sửa lỗi và thử lại thành công với 1 chương (60 ảnh) |
| `manhuaplus.com` | Truyện tranh | |

## Cách danh sách này được lập

- Mục 1–2 dựa trên code trong `src/sites/` và các route import, kèm test tự động.
- Mục 3: site có ít nhất một chương tải thành công trong thư viện của người phát triển, hoặc vượt một lần thử trực tiếp (danh sách chương cùng chương đầu và chương giữa) ngày 2026-10-02.
- Một lần thử không phải là bảo đảm: site đổi giao diện hoặc chặn bot thì kết quả đổi theo.
