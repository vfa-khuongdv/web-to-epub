import { describe, expect, it, vi } from "vitest";
import { fetchText, fetchWithRetry, retryDelayMs } from "./http";

function jsonResponse(status: number, body = "{}", headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

// undici wraps a dropped connection as "fetch failed" with the real code on the
// cause — that is what a network blocking a host looks like from Node.
function connectionReset(): Error {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
  });
}

describe("retryDelayMs", () => {
  it("ưu tiên Retry-After (giây)", () => {
    expect(retryDelayMs(1, "2")).toBe(2000);
    expect(retryDelayMs(3, "5")).toBe(5000);
  });

  it("cap Retry-After ở 30s", () => {
    expect(retryDelayMs(1, "600")).toBe(30_000);
  });

  it("backoff luỹ thừa + jitter khi không có Retry-After", () => {
    expect(retryDelayMs(1, null)).toBeGreaterThanOrEqual(1000);
    expect(retryDelayMs(1, null)).toBeLessThan(1250);
    expect(retryDelayMs(3, null)).toBeGreaterThanOrEqual(4000);
    expect(retryDelayMs(3, null)).toBeLessThan(4250);
  });
});

describe("fetchWithRetry", () => {
  it("trả về ngay khi thành công, không retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const res = await fetchWithRetry("https://example.com/", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("retry khi 429 rồi thành công", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(429)).mockResolvedValueOnce(jsonResponse(200));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const res = await fetchWithRetry("https://example.com/", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl, maxAttempts: 3 });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
  });

  it("tôn trọng Retry-After khi 429", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, "{}", { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse(200));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await fetchWithRetry("https://example.com/", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl, maxAttempts: 3 });

    expect(sleepImpl).toHaveBeenCalledWith(2000);
  });

  it("retry khi 5xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(503)).mockResolvedValueOnce(jsonResponse(200));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const res = await fetchWithRetry("https://example.com/", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl, maxAttempts: 3 });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("không retry với lỗi không retriable (404)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const res = await fetchWithRetry("https://example.com/", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl });

    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("trả response cuối cùng sau khi hết maxAttempts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const res = await fetchWithRetry("https://example.com/", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl, maxAttempts: 3 });

    expect(res.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });
});

describe("fetchWithRetry với lỗi kết nối", () => {
  it("thử lại một lần khi kết nối bị reset rồi thành công", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(connectionReset()).mockResolvedValueOnce(jsonResponse(200));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const res = await fetchWithRetry("https://example.com/", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("bỏ cuộc sau 2 lần khi kết nối luôn bị reset (không retry 5 lần như 429)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(connectionReset());
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchWithRetry("https://example.com/", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl })
    ).rejects.toThrow("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("không retry lỗi không phải lỗi kết nối", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("bug trong code"));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchWithRetry("https://example.com/", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl })
    ).rejects.toThrow("bug trong code");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("fetchText", () => {
  it("ném lỗi kèm gợi ý rate-limit khi 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchText("https://example.com/x", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl, maxAttempts: 2 })
    ).rejects.toThrow(/429.*giới hạn tần suất/);
  });

  it("trả text khi thành công", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, "hello"));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    expect(await fetchText("https://example.com/x", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl })).toBe("hello");
  });

  it("báo rõ host bị chặn khi không kết nối được (thay vì 'fetch failed')", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(connectionReset());
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchText("https://www.wattpad.com/api/v3/stories/117637356?fields=id,title", {}, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl,
      })
    ).rejects.toThrow(/www\.wattpad\.com.*ECONNRESET.*VPN/s);
  });
});
