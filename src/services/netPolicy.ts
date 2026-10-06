import dns from "dns";
import net from "net";

// Fetches of addresses that a crawled page or the client chose (images, audio, covers)
// must not reach the machine's own network: loopback, private ranges, link-local (cloud
// metadata lives at 169.254.169.254) and unique-local IPv6.
// ALLOW_PRIVATE_NETWORK=1 lifts it (the e2e suite crawls a fixture site on loopback).

function privateV4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return privateV4(address);
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return privateV4(mapped[1]);
    return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return false;
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (process.env.ALLOW_PRIVATE_NETWORK === "1") return;
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) addresses may be fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || isPrivateAddress(host)) {
    throw new Error("Refusing to fetch a private network address");
  }
  if (net.isIP(host)) return;
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    return; // unresolvable: the fetch itself fails
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Refusing to fetch a private network address");
  }
}
