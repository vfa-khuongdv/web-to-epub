import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Narration engine/voice routes. The runtime is faked (no uv, Python or model); custom
 * voices and settings are real, in a throwaway DATA_DIR.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "tts-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const fake = vi.hoisted(() => ({
  state: "not-installed" as string,
  supported: true,
  installCalls: [] as string[],
  uninstallError: undefined as Error | undefined,
  synthCalls: 0,
}));

vi.mock("../services/tts/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/tts/runtime")>();
  const runtime = {
    status: async () => ({ supported: fake.supported, state: fake.state }),
    diskBytes: async () => 1234,
    install: async (variant: string) => void fake.installCalls.push(variant),
    uninstall: async () => {
      if (fake.uninstallError) throw fake.uninstallError;
      fake.state = "not-installed";
    },
  };
  return {
    ...actual,
    ttsRuntimes: { vieneu: runtime, omnivoice: runtime },
    runtimeFor: () => runtime,
    ttsEngines: {
      withModel: async (_variant: string, fn: (worker: unknown, model: unknown) => Promise<unknown>) =>
        fn(
          {
            synth: async (request: { out: string }) => {
              fake.synthCalls++;
              await fs.writeFile(request.out, "rendered");
            },
          },
          { voices: [{ id: "p1", label: "Preset 1" }] }
        ),
    },
  };
});

const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(20)]);

describe("tts routes", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { ttsRouter } = await import("./tts");
    const app = express();
    app.use(express.json());
    app.use("/api", ttsRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}/api`;
  });

  beforeEach(() => {
    fake.state = "not-installed";
    fake.supported = true;
    fake.installCalls = [];
    fake.uninstallError = undefined;
    fake.synthCalls = 0;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  });

  const post = (url: string, body: unknown = {}) =>
    fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const upload = (query: string, body: Buffer) =>
    fetch(`${base}/tts/voices?${query}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });

  describe("status / install / uninstall", () => {
    it("reports the status of the engine, adding disk size only when asked and installed", async () => {
      expect(await (await fetch(`${base}/tts/status`)).json()).toMatchObject({ state: "not-installed", engine: "vieneu" });
      fake.state = "installed";
      expect((await (await fetch(`${base}/tts/status?engine=omnivoice&disk=1`)).json())).toMatchObject({
        engine: "omnivoice",
        diskBytes: 1234,
      });
      expect((await (await fetch(`${base}/tts/status`)).json()).diskBytes).toBeUndefined();
    });

    it("400s an unknown engine", async () => {
      expect((await fetch(`${base}/tts/status?engine=bogus`)).status).toBe(400);
      expect((await fetch(`${base}/tts?engine=bogus`, { method: "DELETE" })).status).toBe(400);
    });

    it("starts an install with 202, and refuses a bad variant or unsupported platform", async () => {
      const res = await post("/tts/install", { variant: "nano" });
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ engine: "vieneu" });
      expect(fake.installCalls).toEqual(["nano"]);

      expect((await post("/tts/install", { variant: "huge" })).status).toBe(400);

      fake.supported = false;
      const unsupported = await post("/tts/install", {});
      expect(unsupported.status).toBe(400);
      expect((await unsupported.json()).message).toMatch(/not supported/);
    });

    it("uninstalls, and answers 409 when that fails", async () => {
      fake.state = "installed";
      const res = await fetch(`${base}/tts`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ state: "not-installed" });

      fake.uninstallError = new Error("in use");
      const busy = await fetch(`${base}/tts`, { method: "DELETE" });
      expect(busy.status).toBe(409);
      expect((await busy.json()).message).toBe("in use");
    });
  });

  describe("voices", () => {
    it("lists presets and custom voices together, and rejects a bad variant", async () => {
      expect((await fetch(`${base}/tts/voices?variant=bogus`)).status).toBe(400);
      const created = await upload("name=My%20voice", WAV);
      expect(created.status).toBe(201);
      const custom = await created.json();
      expect(custom).toMatchObject({ label: "My voice", custom: true });
      expect(custom.id).toMatch(/^custom:/);

      const res = await fetch(`${base}/tts/voices?variant=omnivoice`);
      expect(res.status).toBe(200);
      const { variant, voices } = await res.json();
      expect(variant).toBe("omnivoice");
      expect(voices).toContainEqual(custom);

      expect((await fetch(`${base}/tts/voices/${custom.id}`, { method: "DELETE" })).status).toBe(204);
      expect((await fetch(`${base}/tts/voices/${custom.id}`, { method: "DELETE" })).status).toBe(404);
    });

    it("rejects a nameless clip and a file that is not audio with 400", async () => {
      expect((await upload("", WAV)).status).toBe(400);
      const bad = await upload("name=x", Buffer.from("not audio at all, just text"));
      expect(bad.status).toBe(400);
      expect((await bad.json()).message).toMatch(/Unsupported audio/);
    });

    it("resets the default voice when that custom voice is deleted", async () => {
      const custom = await (await upload("name=Default%20one", WAV)).json();
      const { settingsStore } = await import("../services/settingsStore");
      settingsStore.update({ ttsVoice: custom.id });
      expect((await fetch(`${base}/tts/voices/${custom.id}`, { method: "DELETE" })).status).toBe(204);
      expect(settingsStore.get().ttsVoice).toBe("");
    });
  });

  describe("preview", () => {
    it("400s a bad variant", async () => {
      expect((await post("/tts/preview", { variant: "huge" })).status).toBe(400);
    });

    it("409s when the sample must be rendered but narration is not installed", async () => {
      const custom = await (await upload("name=Needs%20render", WAV)).json();
      const res = await post("/tts/preview", { variant: "turbo", voice: custom.id });
      expect(res.status).toBe(409);
      expect(fake.synthCalls).toBe(0);
    });

    it("renders once through the engine, then serves the cached sample", async () => {
      fake.state = "installed";
      const custom = await (await upload("name=Renders", WAV)).json();
      const first = await post("/tts/preview", { variant: "turbo", voice: custom.id });
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toBe("audio/mpeg");
      expect(await first.text()).toBe("rendered");
      expect(fake.synthCalls).toBe(1);

      expect(await (await post("/tts/preview", { variant: "turbo", voice: custom.id })).text()).toBe("rendered");
      expect(fake.synthCalls).toBe(1);
    });

    it("500s a voice that no longer exists, and an OmniVoice preset without a clip", async () => {
      const gone = await post("/tts/preview", { variant: "turbo", voice: `custom:${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}` });
      expect(gone.status).toBe(500);
      expect((await gone.json()).message).toMatch(/no longer exists/);
      expect((await post("/tts/preview", { variant: "omnivoice", voice: "some-preset" })).status).toBe(500);
    });
  });
});
