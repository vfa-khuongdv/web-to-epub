# Các trang đã kiểm thử

Cập nhật: 2026-10-06. Chỉ liệt kê site đã thử và chạy được; không liệt kê site chuyên nội dung 18+. Danh sách sẽ được bổ sung dần.

- Site ở mục 1–2 có hỗ trợ riêng trong app.
- Site ở mục 3 chạy qua **Agent crawler** (Settings → Agent crawler, mặc định tắt). Kết quả phụ thuộc agent đang dùng (đã thử với opencode) và có thể thay đổi khi site đổi giao diện.
- Site không có trong danh sách vẫn có thể thử qua Agent crawler, nhưng không được đảm bảo. Nếu lỗi, [tạo issue](https://github.com/vfa-khuongdv/web-to-epub/issues/new) kèm URL truyện, URL chương lỗi và thông báo lỗi.

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

## 3. Site đã chạy được qua Agent crawler

- https://truyenfullmoi.net
- https://sangchanhteam.com
- https://truyenqq.com.vn
- https://truyenfull.fit
- https://webnovel.vn
- https://ixdzs.tw
- https://truyennhaong.vn
- https://metruyenhd.net
- https://royalroad.com
- https://czbooks.net
- https://ncode.syosetu.com
- https://mangatooncom.vn
- https://manhuaplus.com
