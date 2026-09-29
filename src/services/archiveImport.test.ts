import { describe, expect, it, vi } from "vitest";
import {
  archiveItemId,
  ArchiveNotBookError,
  ArchiveNotFoundError,
  ArchiveRestrictedError,
  fetchItem,
} from "./archiveImport";

type FakeFile = { name: string; format: string; source?: string; private?: string | boolean; size?: string };

interface ArchiveFetchOptions {
  metadata?: Record<string, unknown> | null;
  files?: FakeFile[];
  bodies?: Record<string, Buffer | string | number>;
  cover?: Buffer | number;
}

// One mock for every archive.org call an import can make: the metadata API, a file
// download, and the item image. A `null` metadata means the endpoint answers 404.
export function archiveFetch(options: ArchiveFetchOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const metadataMatch = /^https:\/\/archive\.org\/metadata\/(.+)$/.exec(url);
    if (metadataMatch) {
      if (options.metadata === null) return new Response("", { status: 404 });
      const metadata = { identifier: decodeURIComponent(metadataMatch[1]), ...options.metadata };
      return new Response(JSON.stringify({ metadata, files: options.files ?? [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const downloadMatch = /^https:\/\/archive\.org\/download\/[^/]+\/(.+)$/.exec(url);
    if (downloadMatch) {
      const body = options.bodies?.[decodeURIComponent(downloadMatch[1])];
      if (body === undefined) return new Response("", { status: 404 });
      if (typeof body === "number") return new Response("", { status: body });
      return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body) : body));
    }
    if (url.startsWith("https://archive.org/services/img/")) {
      const cover = options.cover;
      if (typeof cover === "number") return new Response("", { status: cover });
      if (cover) return new Response(new Uint8Array(cover));
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("archiveItemId", () => {
  it("reads the id from the accepted URL shapes", () => {
    expect(archiveItemId("https://archive.org/details/storekeeper0000pear")).toBe("storekeeper0000pear");
    expect(archiveItemId("https://archive.org/details/namiya0000higa/page/n5/mode/2up")).toBe("namiya0000higa");
    expect(archiveItemId("https://archive.org/metadata/proceedings1922mcle")).toBe("proceedings1922mcle");
    expect(archiveItemId("https://www.archive.org/download/alice/alice.pdf")).toBe("alice");
  });

  it("rejects other hosts and paths", () => {
    expect(archiveItemId("https://example.com/details/x")).toBeUndefined();
    expect(archiveItemId("https://archive.org/search?query=alice")).toBeUndefined();
    expect(archiveItemId("https://archive.org/details/")).toBeUndefined();
    expect(archiveItemId("not a url")).toBeUndefined();
  });
});

describe("fetchItem", () => {
  it("returns the catalog fields and public files", async () => {
    const fetchImpl = archiveFetch({
      metadata: { title: "The Storekeeper", creator: "Pearson, Tracey Campbell", language: "eng", mediatype: "texts" },
      files: [{ name: "book_djvu.txt", format: "DjVuTXT" }],
    });
    const item = await fetchItem(fetchImpl, "storekeeper0000pear");
    expect(item).toMatchObject({
      id: "storekeeper0000pear",
      title: "The Storekeeper",
      author: "Pearson, Tracey Campbell",
      language: "eng",
      pdfDegraded: false,
    });
    expect(item.files).toHaveLength(1);
  });

  it("refuses a lending item before looking at files", async () => {
    const fetchImpl = archiveFetch({
      metadata: { "access-restricted-item": "true" },
      files: [{ name: "x_djvu.txt", format: "DjVuTXT" }],
    });
    await expect(fetchItem(fetchImpl, "x")).rejects.toBeInstanceOf(ArchiveRestrictedError);
  });

  it("answers not-found for an unknown item", async () => {
    await expect(fetchItem(archiveFetch({ metadata: null }), "missing")).rejects.toBeInstanceOf(ArchiveNotFoundError);
    const empty = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(fetchItem(empty as unknown as typeof fetch, "missing")).rejects.toBeInstanceOf(ArchiveNotFoundError);
  });

  it("refuses a non-text mediatype", async () => {
    const fetchImpl = archiveFetch({ metadata: { mediatype: "audio" } });
    await expect(fetchItem(fetchImpl, "song")).rejects.toBeInstanceOf(ArchiveNotBookError);
  });
});