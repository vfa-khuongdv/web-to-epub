import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentVaultToken, noteVaultExpired, onVaultExpired, setVaultToken, vaultQuery } from "./token";

beforeEach(() => {
  setVaultToken(null);
  onVaultExpired(null);
});

describe("vault token", () => {
  it("starts empty and holds a set token", () => {
    expect(currentVaultToken()).toBeNull();
    setVaultToken("abc");
    expect(currentVaultToken()).toBe("abc");
  });

  it("vaultQuery is empty without a token and encoded with one", () => {
    expect(vaultQuery()).toBe("");
    setVaultToken("a b&c");
    expect(vaultQuery()).toBe("&vault=a%20b%26c");
  });

  it("noteVaultExpired clears the token and calls the handler", () => {
    const handler = vi.fn();
    onVaultExpired(handler);
    setVaultToken("abc");
    noteVaultExpired();
    expect(currentVaultToken()).toBeNull();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("noteVaultExpired works without a handler", () => {
    setVaultToken("abc");
    expect(() => noteVaultExpired()).not.toThrow();
    expect(currentVaultToken()).toBeNull();
  });
});
