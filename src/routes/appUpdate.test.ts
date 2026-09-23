import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../services/appUpdate", () => ({
  appUpdateChecker: {
    check: vi.fn(async (current: string) => ({
      current,
      latest: "1.6.0",
      hasUpdate: true,
      releaseUrl: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.6.0",
      zipUrl:
        "https://github.com/vfa-khuongdv/web-to-epub/releases/download/v1.6.0/Web.to.EPUB-1.6.0-arm64-mac.zip",
    })),
  },
}));

describe("app update route", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { appUpdateRouter } = await import("./appUpdate");
    const app = express();
    app.use("/api", appUpdateRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("answers the update status for this build", async () => {
    const res = await fetch(`${base}/api/app-update`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      current: expect.any(String),
      latest: "1.6.0",
      hasUpdate: true,
      releaseUrl: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.6.0",
      zipUrl:
        "https://github.com/vfa-khuongdv/web-to-epub/releases/download/v1.6.0/Web.to.EPUB-1.6.0-arm64-mac.zip",
    });
  });
});
