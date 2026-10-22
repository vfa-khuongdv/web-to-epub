import { describe, expect, it } from "vitest";
import { logText, stripUrls } from "./crawlLog";

describe("log rewriting", () => {
  const files: Record<string, string> = { "https://truyen.example/tro-ve/chuong-12": "ch-0012-gap-lai.md" };
  const fileFor = (url: string) => files[url] ?? null;

  it("replaces the chapter address with its file name", () => {
    expect(logText("[12/150] https://truyen.example/tro-ve/chuong-12 — Loading & extracting…", fileFor)).toBe(
      "[12/150] ch-0012-gap-lai.md — Loading & extracting…"
    );
  });

  it("drops an unknown address", () => {
    expect(logText("[3/9] https://other.example/x — HTTP 500", fileFor)).toBe("[3/9] HTTP 500");
  });

  it("drops a missing address", () => {
    expect(logText("[3/9] undefined — Crawl stopped by user", fileFor)).toBe("[3/9] Crawl stopped by user");
  });

  it("strips addresses inside messages and other lines", () => {
    expect(logText("[1/2] https://truyen.example/tro-ve/chuong-12 — 404 at https://cdn.example/a.jpg", fileFor)).toBe(
      "[1/2] ch-0012-gap-lai.md — 404 at …"
    );
    expect(stripUrls("see http://a.b/c?d=e, then go")).toBe("see …, then go");
  });
});
