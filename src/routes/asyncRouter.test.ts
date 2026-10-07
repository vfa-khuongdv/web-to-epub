import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRouter } from "./asyncRouter";

/** Express 4 leaves an async handler's rejected promise unhandled (the process dies); the routers
 * built by createRouter hand it to the error middleware, like a thrown error. */
describe("createRouter", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    const router = createRouter();
    router.get("/ok", async (_req, res) => {
      res.json({ ok: true });
    });
    router.get("/boom", async () => {
      throw new Error("boom");
    });
    router.get("/sync-boom", () => {
      throw new Error("sync boom");
    });
    router.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(503).json({ message: err.message });
    });
    app.use(router);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("hands a rejected async handler to the error middleware and keeps answering", async () => {
    expect((await fetch(`${base}/ok`)).status).toBe(200);
    const failed = await fetch(`${base}/boom`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ message: "boom" });
    // The process is still alive and routes still answer after the rejection.
    expect((await fetch(`${base}/ok`)).status).toBe(200);
  });

  it("keeps passing a synchronously thrown error to the error middleware", async () => {
    const failed = await fetch(`${base}/sync-boom`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ message: "sync boom" });
  });
});
