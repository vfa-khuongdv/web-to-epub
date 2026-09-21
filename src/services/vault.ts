/**
 * The lock on the private library.
 *
 * The user picks a six-digit code; only its scrypt hash is written to disk
 * (`<privateDir>/lock.json`). Unlocking hands back a token that lives in this
 * process's memory and has to accompany every request that wants the private
 * library — the same "one process, one reader" assumption as `runningCrawls` in
 * routes/library.ts.
 *
 * What this does NOT do: encrypt the library. `data/private/stories.db` is a plain
 * SQLite file and anyone with the machine can open it. The code keeps the private
 * library out of the app's own UI, it does not protect the disk.
 *
 * Six digits is a million combinations, so the guard against a script trying them
 * all is scrypt (tens of ms per guess) plus the lockout below, not the code length.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PRIVATE_DIR } from "../config/paths";

export const CODE_RE = /^\d{6}$/;

// The session is dropped after this long without a request, so a machine left alone
// does not stay unlocked forever. Every request pushes the deadline back, so it only
// expires on real inactivity — reading a long story never trips it.
const TOKEN_TTL_MS = 2 * 60 * 60_000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;

interface LockFile {
  salt: string;
  hash: string;
  createdAt: string;
}

export type UnlockFailure =
  | { ok: false; reason: "not-configured" }
  | { ok: false; reason: "already-configured" }
  | { ok: false; reason: "bad-code" }
  | { ok: false; reason: "wrong-code" }
  | { ok: false; reason: "locked-out"; retryAfterMs: number };

export type UnlockResult = { ok: true; token: string } | UnlockFailure;

export interface Vault {
  isConfigured(): boolean;
  // First-time setup. Fails if a code already exists — changing it is a different
  // operation and the app does not offer one.
  setup(code: string): UnlockResult;
  unlock(code: string): UnlockResult;
  // Also extends the session: the token expires after inactivity, not after a fixed
  // wall-clock lifetime.
  isValidToken(token: string | undefined): boolean;
  lock(token: string | undefined): void;
}

function hashCode(code: string, salt: string): string {
  return crypto.scryptSync(code, salt, 64).toString("hex");
}

export function createVault(baseDir: string): Vault {
  const lockPath = path.join(baseDir, "lock.json");
  const tokens = new Map<string, number>();
  let failures = 0;
  let lockedUntil = 0;

  function readLock(): LockFile | undefined {
    try {
      const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LockFile;
      return typeof parsed.salt === "string" && typeof parsed.hash === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  function issueToken(): string {
    failures = 0;
    const token = crypto.randomUUID();
    tokens.set(token, Date.now() + TOKEN_TTL_MS);
    return token;
  }

  return {
    isConfigured(): boolean {
      return readLock() !== undefined;
    },

    setup(code: string): UnlockResult {
      if (!CODE_RE.test(code)) return { ok: false, reason: "bad-code" };
      if (readLock()) return { ok: false, reason: "already-configured" };
      const salt = crypto.randomBytes(16).toString("hex");
      fs.mkdirSync(baseDir, { recursive: true });
      const lock: LockFile = { salt, hash: hashCode(code, salt), createdAt: new Date().toISOString() };
      fs.writeFileSync(lockPath, JSON.stringify(lock), { mode: 0o600 });
      return { ok: true, token: issueToken() };
    },

    unlock(code: string): UnlockResult {
      const now = Date.now();
      if (now < lockedUntil) return { ok: false, reason: "locked-out", retryAfterMs: lockedUntil - now };
      if (!CODE_RE.test(code)) return { ok: false, reason: "bad-code" };
      const lock = readLock();
      if (!lock) return { ok: false, reason: "not-configured" };

      const expected = Buffer.from(lock.hash, "hex");
      const actual = Buffer.from(hashCode(code, lock.salt), "hex");
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        failures++;
        if (failures >= MAX_FAILURES) {
          lockedUntil = now + LOCKOUT_MS;
          failures = 0;
          return { ok: false, reason: "locked-out", retryAfterMs: LOCKOUT_MS };
        }
        return { ok: false, reason: "wrong-code" };
      }
      return { ok: true, token: issueToken() };
    },

    isValidToken(token: string | undefined): boolean {
      if (!token) return false;
      const expiresAt = tokens.get(token);
      if (expiresAt === undefined) return false;
      if (expiresAt < Date.now()) {
        tokens.delete(token);
        return false;
      }
      tokens.set(token, Date.now() + TOKEN_TTL_MS);
      return true;
    },

    lock(token: string | undefined): void {
      if (token) tokens.delete(token);
    },
  };
}

export const vault = createVault(PRIVATE_DIR);
