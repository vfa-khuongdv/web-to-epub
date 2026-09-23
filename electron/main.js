// Bọc server Express sẵn có thành app macOS: main process chạy thẳng
// dist/server.js rồi mở cửa sổ trỏ vào localhost.
const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const net = require("net");
const http = require("http");
const fs = require("fs");
const os = require("os");
const fsp = require("fs/promises");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const {
  cleanupUpdateLeftovers,
  installUpdateFromZip,
  resolveAppBundlePath,
} = require(path.join(__dirname, "..", "dist", "services", "appInstaller.js"));

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

// EPUB export folder picker (see preload.js for why this isn't the web
// File System Access API): shown attached to whichever window asked, so it doesn't
// appear detached from the app.
ipcMain.handle("export:pick-folder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("export:write-file", async (_event, folderPath, fileName, data) => {
  // path.basename strips any directory components a caller might sneak into fileName —
  // it should already be a plain name (epubFileName() sanitizes it server-side), this is
  // just the last line of defense before writing to disk.
  const filePath = path.join(folderPath, path.basename(fileName));
  await fsp.writeFile(filePath, Buffer.from(data));
});

// ---- App update (see src/services/appInstaller.ts) ---------------------------

// Only assets from our own releases may be downloaded and installed.
const UPDATE_HOSTS = new Set(["github.com", "objects.githubusercontent.com"]);
let updateInstalling = false;

async function downloadUpdate(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const filePath = path.join(os.tmpdir(), `web-to-epub-update-${Date.now()}.zip`);
  let received = 0;
  await pipeline(
    Readable.fromWeb(res.body),
    new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        onProgress({ received, total });
        callback(null, chunk);
      },
    }),
    fs.createWriteStream(filePath)
  );
  return filePath;
}

ipcMain.handle("update:install", async (event, zipUrl) => {
  if (!app.isPackaged) throw new Error("Updates only run in the packaged app");
  if (updateInstalling) throw new Error("An update is already being installed");
  const host = new URL(zipUrl).hostname;
  if (!UPDATE_HOSTS.has(host)) throw new Error(`Refusing to download from ${host}`);

  updateInstalling = true;
  let zipPath = null;
  try {
    zipPath = await downloadUpdate(zipUrl, (progress) => event.sender.send("update:progress", progress));
    event.sender.send("update:progress", { installing: true });
    await installUpdateFromZip({ zipPath, appBundlePath: resolveAppBundlePath(process.execPath) });
    // The bundle at process.execPath is the new one now, so the relaunched instance
    // runs it. The before-quit handler below closes Chromium first.
    app.relaunch();
    app.quit();
  } finally {
    updateInstalling = false;
    if (zipPath) await fsp.rm(zipPath, { force: true }).catch(() => {});
  }
});

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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Link ra ngoài (trang nguồn của truyện) mở bằng trình duyệt mặc định,
  // không nuốt vào trong cửa sổ app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(() => {
  // A previous update can leave "<app>.old" or a work dir behind; clear them before
  // anything else. Best-effort (see services/appInstaller.ts).
  if (isPackaged) cleanupUpdateLeftovers(resolveAppBundlePath(process.execPath));
  return start().catch((err) => {
    dialog.showErrorBox("Không khởi động được Web to EPUB", String(err && err.stack ? err.stack : err));
    app.exit(1);
  });
});

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
