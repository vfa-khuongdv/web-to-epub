import path from "path";

// Thư mục chứa thư viện (stories.db + covers/). Mặc định là ./data cạnh chỗ
// chạy lệnh; bản đóng gói macOS có cwd là "/" nên phải trỏ DATA_DIR sang thư
// mục dữ liệu của app (xem electron/main.js).
export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
