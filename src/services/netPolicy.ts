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

// An IPv6 address as its 16 bytes. The URL parser normalises a mapped IPv4 literal to hex
// (`::ffff:127.0.0.1` becomes `::ffff:7f00:1`), so the dotted-quad check alone misses it.
function ipv6Bytes(address: string): number[] | undefined {
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return undefined;
  const parseGroups = (part: string): number[] | undefined => {
    if (part === "") return [];
    const groups: number[] = [];
    const pieces = part.split(":");
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (piece.includes(".")) {
        const parts = piece.split(".").map(Number);
        if (i !== pieces.length - 1 || parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined;
        groups.push((parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined;
        groups.push(parseInt(piece, 16));
      }
    }
    return groups;
  };
  const left = parseGroups(halves[0]);
  if (!left) return undefined;
  let right: number[] = [];
  if (halves.length === 2) {
    const parsed = parseGroups(halves[1]);
    if (!parsed || left.length + parsed.length >= 8) return undefined;
    right = parsed;
  }
  const groups = halves.length === 2 ? [...left, ...new Array(8 - left.length - right.length).fill(0), ...right] : left;
  if (groups.length !== 8) return undefined;
  return groups.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]);
}

export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return privateV4(address);
  if (family === 6) {
    const bytes = ipv6Bytes(address);
    if (!bytes) return false;
    // IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible (`::a.b.c.d`, deprecated) addresses
    // embed an IPv4 address: judge it by the IPv4 rules, so `::ffff:7f00:1` is loopback.
    const embedded =
      bytes.slice(0, 10).every((byte) => byte === 0) &&
      ((bytes[10] === 0xff && bytes[11] === 0xff) || (bytes[10] === 0 && bytes[11] === 0));
    if (embedded) return privateV4(bytes.slice(12).join("."));
    return (bytes[0] & 0xfe) === 0xfc || (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80);
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
