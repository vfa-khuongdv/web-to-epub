// Bọc server Express sẵn có thành app macOS: main process chạy thẳng
// dist/server.js rồi mở cửa sổ trỏ vào localhost.
const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const net = require("net");
const http = require("http");
const fs = require("fs");
const os = require("os");
const fsp = require("fs/promises");
const { spawn } = require("child_process");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { UPDATE_REPO } = require(path.join(__dirname, "..", "dist", "config", "update.js"));
const {
  cleanupUpdateLeftovers,
  installAppImage,
  installUpdateFromZip,
  resolveAppBundlePath,
  updateKind,
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

// AppImage/deb on Linux: the setuid sandbox helper is not installed and Ubuntu 24.04
// blocks user namespaces, so Electron exits at startup. This window only shows the
// app's own localhost UI (chapter HTML is rendered in a sandboxed iframe).
if (process.platform === "linux") app.commandLine.appendSwitch("no-sandbox");

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

// UI phải được mở ở cùng một origin giữa các lần chạy: localStorage (vị trí đang nghe/đọc,
// theme, ngôn ngữ, vị trí phát) gắn với origin http://127.0.0.1:<port>, nên một cổng ngẫu
// nhiên mỗi lần mở làm mọi thứ đã lưu coi như mất — nút "Continue listening" vì thế không
// bao giờ xuất hiện. Cổng cố định chỉ dùng khi còn trống; bận thì quay lại cổng ngẫu nhiên.
const PREFERRED_PORT = 45813;

function portAvailable(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function uiPort() {
  return (await portAvailable(PREFERRED_PORT)) ? PREFERRED_PORT : findFreePort();
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
// Only folders the person picked in the dialog above may be written to: page script (a
// crawled chapter that got through) cannot name any other place on disk.
const pickedFolders = new Set();
function pickedFolder(folderPath) {
  const resolved = typeof folderPath === "string" ? path.resolve(folderPath) : "";
  if (!pickedFolders.has(resolved)) throw new Error("Folder was not chosen in the dialog");
  return resolved;
}

ipcMain.handle("export:pick-folder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  pickedFolders.add(path.resolve(result.filePaths[0]));
  return result.filePaths[0];
});

ipcMain.handle("export:write-file", async (_event, folderPath, fileName, data) => {
  // path.basename strips any directory components a caller might sneak into fileName —
  // it should already be a plain name (epubFileName() sanitizes it server-side), this is
  // just the last line of defense before writing to disk.
  const filePath = path.join(pickedFolder(folderPath), path.basename(fileName));
  await fsp.writeFile(filePath, Buffer.from(data));
});

// Narration zips run to gigabytes, too big to pass through the renderer as an ArrayBuffer
// like an EPUB: the main process streams them from the app's own server straight to the
// chosen folder. Only this server's audio-export URLs are accepted, so the bridge cannot
// be used to fetch anything else onto disk.
ipcMain.handle("export:save-url", async (_event, folderPath, fileName, url) => {
  const allowed = `http://127.0.0.1:${process.env.PORT}/api/exports/audio/`;
  if (typeof url !== "string" || !url.startsWith(allowed)) throw new Error("URL not allowed");
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const filePath = path.join(pickedFolder(folderPath), path.basename(fileName));
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(filePath));
});

// ---- App update (see src/services/appInstaller.ts) ---------------------------

// Only assets from our own releases may be downloaded and installed.
let updateInstalling = false;

async function downloadUpdate(url, extension, onProgress) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const filePath = path.join(os.tmpdir(), `web-to-epub-update-${Date.now()}${extension}`);
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

const currentUpdateKind = () => updateKind(process.platform, process.env, process.execPath);

// The preload asks before exposing the bridge, so a .deb or a portable zip only gets the
// link to the release page.
ipcMain.on("update:can-install", (event) => {
  event.returnValue = app.isPackaged && currentUpdateKind() !== null;
});

const UPDATE_EXTENSION = { mac: ".zip", win: ".exe", appimage: ".AppImage" };

ipcMain.handle("update:install", async (event, assetUrl) => {
  if (!app.isPackaged) throw new Error("Updates only run in the packaged app");
  const kind = currentUpdateKind();
  if (!kind) throw new Error("This install cannot update itself — download the new version from the release page");
  if (updateInstalling) throw new Error("An update is already being installed");
  // Only a release asset of this very repository (GitHub then redirects to its CDN).
  const parsed = new URL(assetUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    !parsed.pathname.startsWith(`/${UPDATE_REPO}/releases/download/`)
  ) {
    throw new Error(`Refusing to download from ${parsed.hostname}`);
  }

  updateInstalling = true;
  let filePath = null;
  let keepFile = false;
  try {
    filePath = await downloadUpdate(assetUrl, UPDATE_EXTENSION[kind], (progress) =>
      event.sender.send("update:progress", progress)
    );
    event.sender.send("update:progress", { installing: true });
    if (kind === "mac") {
      await installUpdateFromZip({ zipPath: filePath, appBundlePath: resolveAppBundlePath(process.execPath) });
      // The bundle at process.execPath is the new one now, so the relaunched instance
      // runs it. The before-quit handler below closes Chromium first.
      app.relaunch();
    } else if (kind === "win") {
      // The NSIS installer (same flags as electron-updater): silent, reuses the install
      // folder, waits for this process to exit, and starts the new version. It runs from
      // the temp file, so that file has to outlive this handler.
      keepFile = true;
      spawn(filePath, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore" }).unref();
    } else {
      const appImage = process.env.APPIMAGE;
      installAppImage({ downloadPath: filePath, appImagePath: appImage });
      // Give this instance a moment to release the database before the new one opens it.
      spawn("sh", ["-c", 'sleep 2; exec "$0"', appImage], { detached: true, stdio: "ignore" }).unref();
    }
    app.quit();
  } finally {
    updateInstalling = false;
    if (filePath && !keepFile) await fsp.rm(filePath, { force: true }).catch(() => {});
  }
});

async function start() {
  const port = await uiPort();
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

// Một bản chạy tại một thời điểm: hai cửa sổ dùng chung stories.db là không an toàn, và
// bản thứ hai mở ở cổng ngẫu nhiên (cổng cố định đã bị bản đầu giữ) nên vị trí lưu lại
// rơi vào một origin khác. Lần mở sau chỉ đưa cửa sổ đang có lên trước.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // A previous update can leave "<app>.old" or a work dir behind; clear them before
    // anything else. Best-effort (see services/appInstaller.ts).
    if (isPackaged && currentUpdateKind() === "mac") cleanupUpdateLeftovers(resolveAppBundlePath(process.execPath));
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
    // The narration worker is a child Python process holding the model in RAM; it must
    // not outlive the app. ttsEngines, not a single runtime: there is one per engine
    // (VieNeu and OmniVoice) since 044ec73, and this used to name a `ttsRuntime` that no
    // longer exists, so closing the app threw here and left both workers running.
    require(path.join(__dirname, "..", "dist", "services", "tts", "runtime.js")).ttsEngines.shutdown();
    closing = true;
    event.preventDefault();
    closeBrowser().catch(() => {}).then(() => app.quit());
  });
}
