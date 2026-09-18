// Dựng build/icon.icns từ build/icon.svg.
// Dùng Chromium của Playwright để render SVG (macOS không có công cụ SVG -> PNG
// sẵn), rồi sips + iconutil để ra .icns.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const svg = path.join(root, "build", "icon.svg");
const iconset = path.join(root, "build", "icon.iconset");
const master = path.join(root, "build", "icon-1024.png");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.goto("file://" + svg);
  await page.screenshot({ path: master, omitBackground: true });
  await browser.close();

  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    for (const scale of [1, 2]) {
      const px = size * scale;
      if (px > 1024) continue;
      const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
      execFileSync("sips", ["-z", String(px), String(px), master, "--out", path.join(iconset, name)], {
        stdio: "ignore",
      });
    }
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(root, "build", "icon.icns")], {
    stdio: "inherit",
  });
  console.log("build/icon.icns đã tạo xong");
})();
