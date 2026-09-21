import http from "http";

const PORT = Number(process.env.PORT ?? 4311);

// 1x1 transparent PNG — real magic bytes so cover sniffing and EPUB image handling work.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
// Frame-sync header + padding: enough for the EPUB media patch (extension decides the
// mime type); it is not decodable audio and is not meant to be.
const MP3_STUB = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(1024)]);

const hits = new Map();

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

// A body with no child elements is what renderer.ts treats as "blanked": it fails fast
// (BlankedPageError) instead of waiting out the 6s settle loop, which keeps the flaky
// retry path quick.
const BLANK_PAGE =
  "<!doctype html><html><head><meta charset='utf-8'><title>x</title></head><body></body></html>";

function paragraph(slug, n, i) {
  return `Đoạn ${i + 1} chương ${n}: ${"nội dung thử nghiệm cho bài kiểm tra đầu-cuối ".repeat(12)}Mốc E2E-${slug}-${n}-${i}.`;
}

function chapterPage(slug, n, locked) {
  const title = `Chương ${n}: Kiểm thử ${slug}`;
  const body = locked
    ? `<p>Nội dung chương đang bị khóa, vui lòng tắt quảng cáo để đọc tiếp.</p>`
    : `<p><img src="/media/pixel.png" alt="minh họa"></p>
${Array.from({ length: 5 }, (_, i) => `<p>${paragraph(slug, n, i)}</p>`).join("\n")}`;
  return `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<header><a href="/">Trang chủ</a></header>
<nav><a href="/truyen/${slug}/">Mục lục</a></nav>
<main><article><h1>${title}</h1>${body}</article></main>
<footer>Trang kiểm thử</footer>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/healthz") return send(res, 200, "ok", "text/plain");

  const chapter = url.pathname.match(/^\/truyen\/([a-z0-9-]+)\/chuong-(\d+)$/);
  if (chapter) {
    const slug = chapter[1];
    const n = Number(chapter[2]);
    const mode = url.searchParams.get("mode");
    if (mode === "flaky") {
      const fails = Number(url.searchParams.get("fails") ?? "1");
      const key = `${url.pathname}?${url.searchParams.toString()}`;
      const seen = (hits.get(key) ?? 0) + 1;
      hits.set(key, seen);
      if (seen <= fails) return send(res, 200, BLANK_PAGE, "text/html; charset=utf-8");
    }
    return send(res, 200, chapterPage(slug, n, mode === "locked"), "text/html; charset=utf-8");
  }

  if (/^\/cover\/[a-z0-9-]+\.png$/.test(url.pathname)) return send(res, 200, PNG_1X1, "image/png");
  if (url.pathname === "/media/pixel.png") return send(res, 200, PNG_1X1, "image/png");
  if (url.pathname === "/media/tone.mp3") return send(res, 200, MP3_STUB, "audio/mpeg");

  send(res, 404, "not found", "text/plain");
});

server.listen(PORT, "127.0.0.1", () => console.log(`fixture site on http://127.0.0.1:${PORT}`));
