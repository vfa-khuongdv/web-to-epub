import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVault, type Vault } from "./vault";

describe("vault", () => {
  let dir: string;
  let vault: Vault;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "vault-test-"));
    vault = createVault(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts unconfigured and creates lock.json on setup", () => {
    expect(vault.isConfigured()).toBe(false);
    const result = vault.setup("123456");
    expect(result.ok).toBe(true);
    expect(vault.isConfigured()).toBe(true);
    expect(existsSync(path.join(dir, "lock.json"))).toBe(true);
  });

  it("never writes the code itself to disk", async () => {
    vault.setup("135790");
    const saved = await import("node:fs").then((fs) => fs.readFileSync(path.join(dir, "lock.json"), "utf8"));
    expect(saved).not.toContain("135790");
  });

  it("rejects codes that are not six digits", () => {
    expect(vault.setup("12345")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.setup("abcdef")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.setup("1234567")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.isConfigured()).toBe(false);
  });

  it("refuses to overwrite an existing code", () => {
    vault.setup("123456");
    expect(vault.setup("654321")).toEqual({ ok: false, reason: "already-configured" });
    // The original code still works.
    expect(vault.unlock("123456").ok).toBe(true);
  });

  it("cannot be unlocked before a code is set", () => {
    expect(vault.unlock("123456")).toEqual({ ok: false, reason: "not-configured" });
  });

  it("unlocks with the right code and rejects the wrong one", () => {
    vault.setup("123456");
    expect(vault.unlock("123457")).toEqual({ ok: false, reason: "wrong-code" });
    const result = vault.unlock("123456");
    expect(result.ok).toBe(true);
  });

  it("sees the code set by an earlier run of the process", () => {
    vault.setup("123456");
    expect(createVault(dir).unlock("123456").ok).toBe(true);
  });

  it("locks out after five wrong codes, then accepts the right one once it passes", () => {
    vi.useFakeTimers();
    try {
      vault.setup("123456");
      for (let i = 0; i < 4; i++) expect(vault.unlock("000000")).toEqual({ ok: false, reason: "wrong-code" });

      expect(vault.unlock("000000")).toMatchObject({ ok: false, reason: "locked-out" });
      // The right code is refused too while locked out — otherwise the lockout would
      // only slow down a guesser unlucky enough to keep guessing wrong.
      expect(vault.unlock("123456")).toMatchObject({ ok: false, reason: "locked-out" });

      vi.advanceTimersByTime(60_000);
      expect(vault.unlock("123456").ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires a session left idle, and pushes the deadline back while it is used", () => {
    vi.useFakeTimers();
    try {
      const result = vault.setup("123456");
      const token = result.ok ? result.token : "";

      // Used just before the deadline: stays valid for another full window.
      vi.advanceTimersByTime(110 * 60_000);
      expect(vault.isValidToken(token)).toBe(true);
      vi.advanceTimersByTime(110 * 60_000);
      expect(vault.isValidToken(token)).toBe(true);

      vi.advanceTimersByTime(2 * 60 * 60_000 + 1);
      expect(vault.isValidToken(token)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("only accepts tokens it issued, and forgets them on lock", () => {
    const result = vault.setup("123456");
    const token = result.ok ? result.token : "";

    expect(vault.isValidToken(token)).toBe(true);
    expect(vault.isValidToken(undefined)).toBe(false);
    expect(vault.isValidToken("not-a-token")).toBe(false);
    // A token from one unlock is not accepted by another process's vault: sessions
    // live in memory only.
    expect(createVault(dir).isValidToken(token)).toBe(false);

    vault.lock(token);
    expect(vault.isValidToken(token)).toBe(false);
  });

  it("keeps earlier sessions valid when unlocked again", () => {
    const first = vault.setup("123456");
    const second = vault.unlock("123456");
    const firstToken = first.ok ? first.token : "";
    const secondToken = second.ok ? second.token : "";

    expect(firstToken).not.toBe(secondToken);
    expect(vault.isValidToken(firstToken)).toBe(true);
    expect(vault.isValidToken(secondToken)).toBe(true);
  });
});
