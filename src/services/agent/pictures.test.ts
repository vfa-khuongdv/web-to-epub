import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../toc/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../toc/http")>();
  return { ...actual, fetchWithRetry: vi.fn() };
});

import type { ContentBlock } from "../../types";
import type { ChapterFetchContext } from "../chapters/types";
import { fetchWithRetry } from "../toc/http";
import { forgetPictureHosts, PictureDownloadError, savePictures } from "./pictures";

const mockedFetch = vi.mocked(fetchWithRetry);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const REFERER = "https://comic.test/chapter-1";

const image = (src: string): ContentBlock => ({ type: "image", src });
const saved: Buffer[] = [];
const context: ChapterFetchContext = {
  storyId: "s1",
  media: {
    save: (_id: string, bytes: Buffer, ext: string) => {
      saved.push(bytes);
      return `epub-media/s1/${saved.length}.${ext}`;
    },
    find: () => undefined,
    remove: async () => {},
  },
};

/** Requests without a referrer (the probe) get `probe`; requests with one get `withReferer`. */
function answer(probe: () => Response, withReferer: () => Response) {
  mockedFetch.mockImplementation(async (_url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers.referer ? withReferer() : probe();
  });
}
const png = () => new Response(PNG);

describe("savePictures", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    forgetPictureHosts();
    saved.length = 0;
  });

  it("keeps a picture as its link when the host serves it without a referrer", async () => {
    answer(png, png);
    const blocks = [image("https://cdn.test/1.png"), { type: "paragraph", text: "x" } as ContentBlock];
    expect(await savePictures(blocks, REFERER, context)).toEqual(blocks);
    expect(saved).toHaveLength(0);
  });

  it("probes a host once and remembers the answer", async () => {
    answer(png, png);
    await savePictures([image("https://cdn.test/1.png")], REFERER, context);
    await savePictures([image("https://cdn.test/2.png")], REFERER, context);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("saves pictures of a host that refuses a bare request, with the chapter as referrer", async () => {
    answer(() => new Response("no hotlinking", { status: 403 }), png);
    const out = await savePictures([image("https://cdn.test/1.png"), image("https://cdn.test/2.png")], REFERER, context);
    expect(out.map((b) => b.src)).toEqual(["epub-media/s1/1.png", "epub-media/s1/2.png"]);
    const withReferer = mockedFetch.mock.calls.filter(([, init]) => (init?.headers as Record<string, string>).referer);
    expect(withReferer.every(([, init]) => (init!.headers as Record<string, string>).referer === REFERER)).toBe(true);
  });

  it("treats an HTML 'not allowed' page with status 200 as a closed host", async () => {
    answer(() => new Response("<html>not allowed</html>"), png);
    const out = await savePictures([image("https://cdn.test/1.png")], REFERER, context);
    expect(out[0].src).toBe("epub-media/s1/1.png");
  });

  it("downloads a repeated address once and rewrites every block that used it", async () => {
    answer(() => new Response("", { status: 403 }), png);
    const out = await savePictures([image("https://cdn.test/1.png"), image("https://cdn.test/1.png")], REFERER, context);
    expect(saved).toHaveLength(1);
    expect(out[0].src).toBe(out[1].src);
  });

  it("ignores pictures that are not http(s) links", async () => {
    const blocks = [image("epub-media/s1/a.png"), image("data:image/png;base64,AAAA")];
    expect(await savePictures(blocks, REFERER, context)).toEqual(blocks);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("fails the whole chapter when one picture cannot be had", async () => {
    answer(
      () => new Response("", { status: 403 }),
      () => new Response("", { status: 404 })
    );
    await expect(savePictures([image("https://cdn.test/1.png")], REFERER, context)).rejects.toThrow(
      PictureDownloadError
    );
    expect(saved).toHaveLength(0);
  });

  it("refuses bytes that are not a picture", async () => {
    answer(() => new Response("", { status: 403 }), () => new Response("plain text, not an image"));
    await expect(savePictures([image("https://cdn.test/1.png")], REFERER, context)).rejects.toThrow(
      /Could not download a page picture/
    );
  });
});
