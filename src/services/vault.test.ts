import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

  it("never writes the code itself to disk", () => {
    vault.setup("135790");
    const saved = readFileSync(path.join(dir, "lock.json"), "utf8");
    expect(saved).not.toContain("135790");
    const lock = JSON.parse(saved) as { salt: string; hash: string };
    expect(lock.hash).toMatch(/^[0-9a-f]{128}$/);
    expect(lock.salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it.skipIf(process.platform === "win32")("restricts lock.json to the owner", () => {
    vault.setup("123456");
    expect(statSync(path.join(dir, "lock.json")).mode & 0o777).toBe(0o600);
  });

  it("rejects codes that are not six digits", () => {
    expect(vault.setup("12345")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.setup("abcdef")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.setup("1234567")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.setup("")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.setup(" 123456")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.setup("123456 ")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.setup("123456\n")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.setup("１２３４５６")).toEqual({ ok: false, reason: "bad-code" });
    expect(vault.isConfigured()).toBe(false);
  });

  it("accepts 000000 as a real code", () => {
    const result = vault.setup("000000");
    expect(result.ok).toBe(true);
    expect(vault.unlock("000000").ok).toBe(true);
  });

  it("refuses to overwrite an existing code", () => {
    vault.setup("123456");
    expect(vault.setup("654321")).toEqual({ ok: false, reason: "already-configured" });
    // The original code still works.
    expect(vault.unlock("123456").ok).toBe(true);
  });

  it("treats a malformed or partial lock.json as not configured, and setup overwrites it", () => {
    const malformed = ["{ not json", JSON.stringify({ salt: 123, hash: "x" }), JSON.stringify({ salt: "abc" })];
    for (const contents of malformed) {
      writeFileSync(path.join(dir, "lock.json"), contents);
      expect(vault.isConfigured()).toBe(false);
      expect(vault.unlock("123456")).toEqual({ ok: false, reason: "not-configured" });
      expect(vault.setup("123456").ok).toBe(true);
    }
    expect(vault.isConfigured()).toBe(true);
    expect(vault.unlock("123456").ok).toBe(true);
  });

  it("cannot be unlocked before a code is set", () => {
    expect(vault.unlock("123456")).toEqual({ ok: false, reason: "not-configured" });
    // A malformed code is rejected by the format check before the vault is even read.
    expect(vault.unlock("abcdef")).toEqual({ ok: false, reason: "bad-code" });
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

      expect(vault.unlock("000000")).toEqual({ ok: false, reason: "locked-out", retryAfterMs: 60_000 });
      // The right code is refused too while locked out — otherwise the lockout would
      // only slow down a guesser unlucky enough to keep guessing wrong. A malformed
      // code is answered with the lockout as well, not bad-code.
      vi.advanceTimersByTime(10_000);
      expect(vault.unlock("abcdef")).toEqual({ ok: false, reason: "locked-out", retryAfterMs: 50_000 });
      expect(vault.unlock("123456")).toEqual({ ok: false, reason: "locked-out", retryAfterMs: 50_000 });

      vi.advanceTimersByTime(50_000);
      expect(vault.unlock("123456").ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the failure count after a successful unlock", () => {
    vault.setup("123456");
    for (let i = 0; i < 4; i++) expect(vault.unlock("000000")).toEqual({ ok: false, reason: "wrong-code" });
    expect(vault.unlock("123456").ok).toBe(true);
    for (let i = 0; i < 4; i++) expect(vault.unlock("000000")).toEqual({ ok: false, reason: "wrong-code" });
  });

  it("starts a fresh failure count once the lockout window passes", () => {
    vi.useFakeTimers();
    try {
      vault.setup("123456");
      for (let i = 0; i < 4; i++) expect(vault.unlock("000000")).toEqual({ ok: false, reason: "wrong-code" });
      expect(vault.unlock("000000")).toEqual({ ok: false, reason: "locked-out", retryAfterMs: 60_000 });

      vi.advanceTimersByTime(60_000);
      expect(vault.unlock("000000")).toEqual({ ok: false, reason: "wrong-code" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires a session left idle, and pushes the deadline back while it is used", () => {
    vi.useFakeTimers();
    try {
      const result = vault.setup("123456");
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("setup did not return a token");
      const token = result.token;

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

  it("keeps a token valid at exactly the idle deadline, but not one millisecond later", () => {
    vi.useFakeTimers();
    try {
      const result = vault.setup("123456");
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("setup did not return a token");
      const token = result.token;

      vi.advanceTimersByTime(2 * 60 * 60_000);
      expect(vault.isValidToken(token)).toBe(true);

      // The check above slid the deadline forward: at exactly another full window the
      // token is still valid, one millisecond past it is not.
      vi.advanceTimersByTime(2 * 60 * 60_000);
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

  it("ignores lock without a token, and revokes only the token it is given", () => {
    const first = vault.setup("123456");
    const second = vault.unlock("123456");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected both calls to return a token");
    const tokenA = first.token;
    const tokenB = second.token;

    vault.lock(undefined);
    vault.lock("");
    expect(vault.isValidToken(tokenA)).toBe(true);
    expect(vault.isValidToken(tokenB)).toBe(true);

    vault.lock(tokenA);
    expect(vault.isValidToken(tokenA)).toBe(false);
    expect(vault.isValidToken(tokenB)).toBe(true);
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

  describe("changeCode", () => {
    it("replaces the code, and the old one stops working", () => {
      vault.setup("123456");
      expect(vault.changeCode("123456", "654321")).toEqual({ ok: true });
      expect(vault.unlock("123456")).toEqual({ ok: false, reason: "wrong-code" });
      expect(vault.unlock("654321").ok).toBe(true);
    });

    it("re-salts, so the same code twice does not produce the same file", () => {
      vault.setup("123456");
      const before = readFileSync(path.join(dir, "lock.json"), "utf8");
      expect(vault.changeCode("123456", "123456")).toEqual({ ok: true });
      const after = readFileSync(path.join(dir, "lock.json"), "utf8");
      expect(after).not.toBe(before);
      expect(after).not.toContain("123456");
      // The vault was started once; typing a new code over it is not a new start.
      expect(JSON.parse(after).createdAt).toBe(JSON.parse(before).createdAt);
      expect(vault.unlock("123456").ok).toBe(true);
    });

    it("refuses without the current code, leaving the old one in place", () => {
      vault.setup("123456");
      expect(vault.changeCode("000000", "654321")).toEqual({ ok: false, reason: "wrong-code" });
      expect(vault.unlock("123456").ok).toBe(true);
      expect(vault.unlock("654321")).toEqual({ ok: false, reason: "wrong-code" });
    });

    it("rejects a new code that is not six digits before touching anything", () => {
      vault.setup("123456");
      expect(vault.changeCode("123456", "12345")).toEqual({ ok: false, reason: "bad-code" });
      expect(vault.changeCode("123456", "abcdef")).toEqual({ ok: false, reason: "bad-code" });
      expect(vault.unlock("123456").ok).toBe(true);
    });

    it("cannot set the first code — that is setup's job", () => {
      expect(vault.changeCode("123456", "654321")).toEqual({ ok: false, reason: "not-configured" });
      expect(vault.isConfigured()).toBe(false);
    });

    // Guessing the current code through changeCode has to cost the same as guessing it
    // through unlock, or the lockout has a door beside it.
    it("counts wrong current codes towards the same lockout", () => {
      vi.useFakeTimers();
      try {
        vault.setup("123456");
        for (let i = 0; i < 4; i++) {
          expect(vault.changeCode("000000", "654321")).toEqual({ ok: false, reason: "wrong-code" });
        }
        expect(vault.unlock("000000")).toEqual({ ok: false, reason: "locked-out", retryAfterMs: 60_000 });
        // Locked out of changing it too, and the right code is still the old one after.
        expect(vault.changeCode("123456", "654321")).toEqual({
          ok: false,
          reason: "locked-out",
          retryAfterMs: 60_000,
        });
        vi.advanceTimersByTime(60_000);
        expect(vault.unlock("123456").ok).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("leaves open sessions alone", () => {
      const opened = vault.setup("123456");
      const token = opened.ok ? opened.token : "";
      expect(vault.changeCode("123456", "654321")).toEqual({ ok: true });
      expect(vault.isValidToken(token)).toBe(true);
    });
  });
});
