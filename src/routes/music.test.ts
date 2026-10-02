import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Background-music routes over a real Express server; tracks go to a throwaway DATA_DIR/music. */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "music-route-test-"));
process.env.DATA_DIR = DATA_DIR;

// "ID3" tag plus padding: enough for the format sniffing.
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(40, 1)]);

describe("music routes", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { musicRouter } = await import("./music");
    const app = express();
    app.use("/api", musicRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  });

  const upload = (name: string | undefined, body: Buffer) =>
    fetch(`${base}/music${name === undefined ? "" : `?name=${encodeURIComponent(name)}`}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });

  it("lists nothing at first, with no default track", async () => {
    expect(await (await fetch(`${base}/music`)).json()).toEqual({ tracks: [], defaultId: null });
  });

  it("uploads, lists, streams and deletes a track", async () => {
    const created = await upload("Rain", MP3);
    expect(created.status).toBe(201);
    const track = await created.json();
    expect(track).toEqual({ id: expect.any(String), name: "Rain" });

    expect((await (await fetch(`${base}/music`)).json()).tracks).toEqual([track]);

    const audio = await fetch(`${base}/music/${track.id}/audio`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await audio.arrayBuffer()).equals(MP3)).toBe(true);

    expect((await fetch(`${base}/music/${track.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${base}/music/${track.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await fetch(`${base}/music/${track.id}/audio`)).status).toBe(404);
  });

  it("rejects a missing name and a file that is not audio with 400", async () => {
    const noName = await upload(undefined, MP3);
    expect(noName.status).toBe(400);
    expect((await noName.json()).message).toMatch(/name/);

    const bad = await upload("Notes", Buffer.from("this is plain text, not audio"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toMatch(/Unsupported audio/);

    expect((await upload("Empty", Buffer.alloc(0))).status).toBe(400);
  });

  it("404s an unknown or malformed track id", async () => {
    expect((await fetch(`${base}/music/not-an-id/audio`)).status).toBe(404);
    expect((await fetch(`${base}/music/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/audio`)).status).toBe(404);
  });
});
