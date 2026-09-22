import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DATA_DIR must be set before anything is imported: config/paths reads it at import
 * time, so a static import would make these tests read the developer's real sessions.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "site-session-test-"));
process.env.DATA_DIR = DATA_DIR;

describe("siteSession", () => {
  let siteSession: typeof import("./siteSession");

  beforeAll(async () => {
    siteSession = await import("./siteSession");
    mkdirSync(path.join(DATA_DIR, "sessions"), { recursive: true });
  });

  afterAll(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("sessionHostname bỏ www và hạ chữ hoa", () => {
    expect(siteSession.sessionHostname("https://WWW.AsianFanfics.com/story/view/1")).toBe("asianfanfics.com");
    expect(siteSession.sessionHostname("https://m.asianfanfics.com/story/view/1")).toBe("m.asianfanfics.com");
    expect(siteSession.sessionHostname("khong-phai-url")).toBeUndefined();
  });

  it("file phiên nằm trong DATA_DIR/sessions theo hostname", () => {
    expect(siteSession.sessionFilePath("asianfanfics.com")).toBe(
      path.join(DATA_DIR, "sessions", "asianfanfics.com.json")
    );
  });

  it("chưa đăng nhập (không có file) → undefined", () => {
    expect(siteSession.loadSiteSession("https://www.asianfanfics.com/story/view/1143593")).toBeUndefined();
  });

  it("đọc storageState đã lưu", () => {
    const state = { cookies: [{ name: "aff_session", value: "x", domain: ".asianfanfics.com", path: "/" }], origins: [] };
    writeFileSync(path.join(DATA_DIR, "sessions", "asianfanfics.com.json"), JSON.stringify(state));
    expect(siteSession.loadSiteSession("https://www.asianfanfics.com/story/view/1143593")).toEqual(state);
  });

  it("giữ user agent đi kèm phiên (Cloudflare buộc cookie vào UA)", () => {
    const state = {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36",
      cookies: [{ name: "cf_clearance", value: "y", domain: ".asianfanfics.com", path: "/" }],
      origins: [],
    };
    writeFileSync(path.join(DATA_DIR, "sessions", "ua.example.json"), JSON.stringify(state));
    const loaded = siteSession.loadSiteSession("https://ua.example/story/view/1");
    expect(loaded?.userAgent).toContain("Chrome/140");
    expect(loaded?.cookies).toHaveLength(1);
  });

  it("file hỏng → lỗi rõ ràng thay vì âm thầm coi như khách", () => {
    writeFileSync(path.join(DATA_DIR, "sessions", "broken.example.json"), "{not json");
    expect(() => siteSession.loadSiteSession("https://broken.example/x")).toThrow(/unreadable/);
    expect(() => siteSession.loadSiteSession("https://broken.example/x")).toThrow(/broken\.example\.json/);
  });

  it("URL không hợp lệ → undefined", () => {
    expect(siteSession.loadSiteSession("khong-phai-url")).toBeUndefined();
  });

describe("parseSessionCurl", () => {
  const chromeCurl = `curl 'https://www.asianfanfics.com/story/view/1191193' \\
  -H 'accept: text/html' \\
  -H 'cookie: csrf_token=abc123; cf_clearance=clear456; atokun=jwt789' \\
  -H 'user-agent: Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/153.0.0.0 Mobile Safari/537.36' \\
  --compressed`;

  it("đọc cookie và user agent từ cURL của Chrome", () => {
    const parsed = siteSession.parseSessionCurl(chromeCurl, "asianfanfics.com");
    expect(parsed.cookies.map((c) => c.name)).toEqual(["csrf_token", "cf_clearance", "atokun"]);
    expect(parsed.cookies[0]).toMatchObject({ value: "abc123", domain: ".asianfanfics.com", path: "/" });
    expect(parsed.userAgent).toContain("Chrome/153");
  });

  it("nhận dạng cURL ghi cookie bằng -b (Safari/Firefox)", () => {
    const parsed = siteSession.parseSessionCurl(
      "curl 'https://www.asianfanfics.com/' -b 'a=1; b=2' -H 'user-agent: UA'",
      "asianfanfics.com"
    );
    expect(parsed.cookies.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("nhận dạng curl --url và host có www", () => {
    const parsed = siteSession.parseSessionCurl("curl --url 'https://asianfanfics.com/x' -H 'cookie: a=1'", "asianfanfics.com");
    expect(parsed.cookies).toHaveLength(1);
  });

  it("từ chối cURL của site khác", () => {
    expect(() => siteSession.parseSessionCurl("curl 'https://example.com/' -H 'cookie: a=1'", "asianfanfics.com")).toThrow(
      /not for asianfanfics\.com/
    );
  });

  it("từ chối khi thiếu cookie", () => {
    expect(() => siteSession.parseSessionCurl("curl 'https://www.asianfanfics.com/' -H 'accept: text/html'", "asianfanfics.com")).toThrow(
      /No cookies found/
    );
  });

  it("từ chối nội dung rỗng hoặc không có URL", () => {
    expect(() => siteSession.parseSessionCurl("   ", "asianfanfics.com")).toThrow(/Paste the cURL/);
    expect(() => siteSession.parseSessionCurl("khong-phai-curl", "asianfanfics.com")).toThrow(/Could not find a URL/);
  });
});

describe("save / remove / status", () => {
  it("lưu rồi đọc lại, xoá và báo trạng thái", () => {
    const parsed = siteSession.parseSessionCurl(
      "curl 'https://www.asianfanfics.com/' -H 'cookie: atokun=jwt' -H 'user-agent: UA'",
      "asianfanfics.com"
    );
    expect(siteSession.siteSessionStatus("saved.example")).toEqual({ configured: false });
    siteSession.saveSiteSession("saved.example", { userAgent: parsed.userAgent, cookies: parsed.cookies, origins: [] });
    const status = siteSession.siteSessionStatus("saved.example");
    expect(status.configured).toBe(true);
    expect(typeof status.savedAt).toBe("string");
    const loaded = siteSession.loadSiteSession("https://saved.example/x");
    expect(loaded?.cookies?.[0]?.name).toBe("atokun");
    expect(siteSession.removeSiteSession("saved.example")).toBe(true);
    expect(siteSession.removeSiteSession("saved.example")).toBe(false);
    expect(siteSession.siteSessionStatus("saved.example")).toEqual({ configured: false });
  });

  it("báo hạn của token sớm nhất trong các cookie JWT", () => {
    // AFF hands out rtokun (a year) and atokun (an hour); the session ends with the
    // short one, so the earliest expiry is the one that matters.
    const year = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.sig";
    const hour = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjEwMDAwMDAwMDB9.sig";
    expect(
      siteSession.sessionExpiresAt({ cookies: [{ name: "rtokun", value: year }, { name: "atokun", value: hour }] })
    ).toBe(new Date(1_000_000_000 * 1000).toISOString());
  });

  it("đọc tên tài khoản từ claim của cookie JWT", () => {
    const named = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjQxMDI0NDQ4MDAsIm5hbWUiOiJraHVvbmdkdiJ9.sig";
    const noName = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.sig";
    expect(siteSession.sessionAccountName({ cookies: [{ name: "rtokun", value: noName }, { name: "atokun", value: named }] })).toBe(
      "khuongdv"
    );
    expect(siteSession.sessionAccountName({ cookies: [{ name: "csrf_token", value: "abc" }] })).toBeUndefined();
  });

  it("không có cookie JWT → không rõ hạn", () => {
    expect(siteSession.sessionExpiresAt({ cookies: [{ name: "csrf_token", value: "abc" }] })).toBeUndefined();
    expect(siteSession.sessionExpiresAt({ cookies: [] })).toBeUndefined();
  });

  it("status kèm hạn token và savedAt", () => {
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjQxMDI0NDQ4MDAsIm5hbWUiOiJraHVvbmdkdiJ9.sig";
    siteSession.saveSiteSession("expiry.example", {
      cookies: [{ name: "atokun", value: token }],
      origins: [],
    });
    const status = siteSession.siteSessionStatus("expiry.example");
    expect(status.configured).toBe(true);
    expect(status.expiresAt).toBe(new Date(4_102_444_800 * 1000).toISOString());
    expect(status.username).toBe("khuongdv");
    expect(typeof status.savedAt).toBe("string");
  });

  it("file hỏng: trạng thái là chưa cấu hình, không phải lỗi đọc", () => {
    // broken.example.json was written by an earlier test in this file.
    expect(siteSession.siteSessionStatus("broken.example")).toEqual({ configured: false });
  });
});

describe("persistRenderedCookies", () => {
  // The site's own scripts refresh its short-lived access token while a page renders.
  // Those cookies must be written back, or the next crawl starts from the stale snapshot
  // the user pasted and the site serves a guest page again.
  function cookie(name: string, value: string, domain = ".asianfanfics.com") {
    return { name, value, domain, path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const };
  }
  const saved = [cookie("atokun", "old-token"), cookie("cf_clearance", "cf")];

  it("gộp cookie mới vào phiên: cùng tên+domain+path thì bản mới thắng, cookie khác giữ nguyên", () => {
    const merged = siteSession.mergeSessionCookies(saved, [cookie("atokun", "fresh-token"), cookie("verify_age", "1")]);

    expect(merged).toHaveLength(3);
    expect(merged.find((c) => c.name === "atokun")?.value).toBe("fresh-token");
    expect(merged.find((c) => c.name === "cf_clearance")?.value).toBe("cf");
    expect(merged.find((c) => c.name === "verify_age")?.value).toBe("1");
  });

  it("render trả về rỗng không xoá phiên (trang phục vụ như khách)", () => {
    expect(siteSession.mergeSessionCookies(saved, [])).toEqual(saved);
  });

  it("ghi cookie mới vào file phiên, giữ userAgent và savedAt lúc nhập", () => {
    siteSession.saveSiteSession("refresh.example", { userAgent: "UA-A", cookies: saved, origins: [] });
    const importedAt = siteSession.loadSiteSession("https://refresh.example/x")?.savedAt;

    siteSession.persistRenderedCookies("https://refresh.example/story/view/1", [cookie("atokun", "fresh-token")]);

    const reloaded = siteSession.loadSiteSession("https://refresh.example/x");
    expect(reloaded?.cookies?.find((c) => c.name === "atokun")?.value).toBe("fresh-token");
    expect(reloaded?.cookies?.find((c) => c.name === "cf_clearance")?.value).toBe("cf");
    expect(reloaded?.userAgent).toBe("UA-A");
    expect(reloaded?.savedAt).toBe(importedAt);
  });

  it("không có file phiên → không tạo file mới cho khách", () => {
    siteSession.persistRenderedCookies("https://guest.example/story/view/1", [
      cookie("session", "x", ".guest.example"),
    ]);
    expect(siteSession.siteSessionStatus("guest.example")).toEqual({ configured: false });
  });
});
});
