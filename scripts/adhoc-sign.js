// Ký ad-hoc (chữ ký "-") toàn bộ bundle sau khi đóng gói.
// Không có tài khoản Apple Developer nên không ký Developer ID được, nhưng
// trên Apple Silicon một bundle KHÔNG có chữ ký hợp lệ sẽ bị macOS từ chối
// chạy thẳng; ad-hoc là mức tối thiểu để app mở được (người nhận vẫn phải gỡ
// cờ quarantine — xem README).
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath], {
    stdio: "inherit",
  });
  console.log(`  • ad-hoc signed  ${appPath}`);
};
