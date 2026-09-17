// Bọc server Express sẵn có thành app macOS: main process chạy thẳng
// dist/server.js rồi mở cửa sổ trỏ vào localhost.
const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");
const net = require("net");
const http = require("http");

const isPackaged = app.isPackaged;

// cwd của app đã đóng gói là "/", nên thư viện (stories.db + covers/) phải nằm
// trong thư mục dữ liệu riêng của app thay vì ./data.
process.env.DATA_DIR = path.join(app.getPath("userData"), "data");

// Chromium của Playwright được nhét vào Resources/ms-playwright (xem
// extraResources trong package.json). Phải set trước khi require server vì
// playwright đọc biến này lúc nạp module.
if (isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, "ms-playwright");
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("Server không khởi động kịp"));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

async function start() {
  const port = await findFreePort();
  process.env.PORT = String(port);
  require(path.join(__dirname, "..", "dist", "server.js"));
  await waitForServer(port);

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    title: "Web to EPUB",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  // Link ra ngoài (trang nguồn của truyện) mở bằng trình duyệt mặc định,
  // không nuốt vào trong cửa sổ app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(() =>
  start().catch((err) => {
    dialog.showErrorBox("Không khởi động được Web to EPUB", String(err && err.stack ? err.stack : err));
    app.exit(1);
  })
);

app.on("window-all-closed", () => app.quit());

// Đóng Chromium của Playwright trước khi thoát; app đóng gói không nhận
// SIGINT/SIGTERM nên handler trong server.ts không chạy.
let closing = false;
app.on("before-quit", (event) => {
  if (closing) return;
  const { closeBrowser } = require(path.join(__dirname, "..", "dist", "services", "renderer.js"));
  closing = true;
  event.preventDefault();
  closeBrowser().catch(() => {}).then(() => app.quit());
});
