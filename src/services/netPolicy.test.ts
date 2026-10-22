import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress } from "./netPolicy";

describe("netPolicy", () => {
  it("flags loopback, private, link-local and ULA addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });

  it("flags IPv4-mapped and IPv4-compatible IPv6 forms the URL parser normalises to hex", () => {
    for (const a of ["::ffff:7f00:1", "::ffff:a00:1", "::ffff:ac10:1", "0:0:0:0:0:ffff:a9fe:a9fe", "::7f00:1", "::a00:1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["::ffff:808:808", "::808:808", "::ffff:ac20:1"]) expect(isPrivateAddress(a), a).toBe(false);
  });

  it("rejects private literals and localhost, accepts public literals", async () => {
    await expect(assertPublicUrl(new URL("http://127.0.0.1:3100/api"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("http://localhost/x"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("http://[::1]/x"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("http://[::ffff:127.0.0.1]/x"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("http://[::ffff:169.254.169.254]/latest/meta-data"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("file:///etc/passwd"))).rejects.toThrow();
    await expect(assertPublicUrl(new URL("https://8.8.8.8/x.png"))).resolves.toBeUndefined();
    await expect(assertPublicUrl(new URL("http://[::ffff:8.8.8.8]/x.png"))).resolves.toBeUndefined();
  });
});
