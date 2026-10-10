import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { FacebookApiError, fetchPage, fetchVideoLink, isRateLimit, uploadVideo, usableSchedule } from "./api";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("usableSchedule", () => {
  const now = Date.parse("2026-10-08T00:00:00Z");

  it("accepts a time 10 minutes to 30 days ahead", () => {
    expect(usableSchedule("2026-10-09T00:00:00Z", now)).toBe(Date.parse("2026-10-09T00:00:00Z") / 1000);
  });

  it("refuses a time that is too soon, too far, past or unreadable", () => {
    expect(usableSchedule("2026-10-08T00:05:00Z", now)).toBeUndefined();
    expect(usableSchedule("2026-12-01T00:00:00Z", now)).toBeUndefined();
    expect(usableSchedule("2026-10-01T00:00:00Z", now)).toBeUndefined();
    expect(usableSchedule("soon", now)).toBeUndefined();
    expect(usableSchedule(undefined, now)).toBeUndefined();
  });
});

describe("fetchPage", () => {
  it("returns the page name and explains an expired token", async () => {
    const ok = vi.fn().mockResolvedValue(json({ id: "1", name: "Truyện FM" }));
    await expect(fetchPage("1", "tok", ok)).resolves.toMatchObject({ name: "Truyện FM" });
    const bad = vi.fn().mockResolvedValue(json({ error: { message: "expired", code: 190 } }, 400));
    await expect(fetchPage("1", "tok", bad)).rejects.toThrow(/token/i);
  });
});

describe("isRateLimit", () => {
  it("recognises Graph rate-limit codes only", () => {
    expect(isRateLimit(new FacebookApiError("x", 400, 4))).toBe(true);
    expect(isRateLimit(new FacebookApiError("x", 400, 100))).toBe(false);
    expect(isRateLimit(new Error("x"))).toBe(false);
  });
});

describe("uploadVideo", () => {
  it("starts, transfers the asked ranges and finishes with a schedule", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-"));
    const file = path.join(dir, "v.mp4");
    await fs.writeFile(file, Buffer.alloc(10, 1));
    const phases: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body as FormData;
      const fields = Object.fromEntries([...body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<blob>"]));
      phases.push(fields);
      if (fields.upload_phase === "start") {
        return json({ upload_session_id: "s1", video_id: "v1", start_offset: "0", end_offset: "6" });
      }
      if (fields.upload_phase === "transfer") {
        return fields.start_offset === "0"
          ? json({ start_offset: "6", end_offset: "10" })
          : json({ start_offset: "10", end_offset: "10" });
      }
      return json({ success: true });
    }) as unknown as typeof fetch;

    const result = await uploadVideo(
      "tok",
      { pageId: "1", filePath: file, title: "T", description: "D", scheduledPublishTime: 1_800_000_000 },
      () => {},
      undefined,
      fetchImpl
    );
    expect(result).toEqual({ id: "v1" });
    expect(phases.map((p) => p.upload_phase)).toEqual(["start", "transfer", "transfer", "finish"]);
    expect(phases[3]).toMatchObject({ published: "false", scheduled_publish_time: "1800000000", title: "T" });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("publishes right away only when asked and not scheduled", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-"));
    const file = path.join(dir, "v.mp4");
    await fs.writeFile(file, Buffer.alloc(4, 1));
    const finishes: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const fields = Object.fromEntries([...(init?.body as FormData).entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<blob>"]));
      if (fields.upload_phase === "start") {
        return json({ upload_session_id: "s1", video_id: "v1", start_offset: "0", end_offset: "0" });
      }
      finishes.push(fields);
      return json({ success: true });
    }) as unknown as typeof fetch;
    const base = { pageId: "1", filePath: file, title: "T", description: "D" };

    await uploadVideo("tok", { ...base, publishNow: true }, () => {}, undefined, fetchImpl);
    await uploadVideo("tok", { ...base, publishNow: true, scheduledPublishTime: 1_800_000_000 }, () => {}, undefined, fetchImpl);
    await uploadVideo("tok", base, () => {}, undefined, fetchImpl);

    expect(finishes.map((f) => f.published)).toEqual(["true", "false", "false"]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("fetchVideoLink", () => {
  it("uses the permalink Facebook gives, made absolute", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ permalink_url: "/reel/18/" }));
    await expect(fetchVideoLink("1", "18", "tok", fetchImpl)).resolves.toBe("https://www.facebook.com/reel/18/");
  });

  it("falls back to the Page-scoped link when Graph does not answer", async () => {
    const refused = vi.fn().mockResolvedValue(json({ error: { message: "x" } }, 400));
    await expect(fetchVideoLink("1", "18", "tok", refused)).resolves.toBe("https://www.facebook.com/1/videos/18");
    const broken = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(fetchVideoLink("1", "18", "tok", broken)).resolves.toBe("https://www.facebook.com/1/videos/18");
  });
});
