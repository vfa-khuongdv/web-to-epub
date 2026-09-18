import { describe, expect, it } from "vitest";
import { blocksToHtml, htmlToBlocks } from "./chapterHtml";

describe("htmlToBlocks", () => {
  it("preserves paragraphs and inline formatting", () => {
    expect(htmlToBlocks("<p>Đoạn <b>đậm</b> và <i>nghiêng</i></p>")).toEqual([
      { type: "paragraph", text: "Đoạn <b>đậm</b> và <i>nghiêng</i>" },
    ]);
  });

  it("reads headings with their level", () => {
    expect(htmlToBlocks("<h3>Chương 1</h3><p>Nội dung</p>")).toEqual([
      { type: "heading", level: 3, text: "Chương 1" },
      { type: "paragraph", text: "Nội dung" },
    ]);
  });

  it("reads images with their original src, no base URL appended", () => {
    expect(htmlToBlocks('<img src="https://cdn.example.com/a.jpg" alt="Bìa" />')).toEqual([
      { type: "image", src: "https://cdn.example.com/a.jpg", alt: "Bìa" },
    ]);
  });

  it("splits <br> into multiple paragraphs", () => {
    expect(htmlToBlocks("<p>Dòng một<br>Dòng hai<br/>Dòng ba</p>")).toEqual([
      { type: "paragraph", text: "Dòng một" },
      { type: "paragraph", text: "Dòng hai" },
      { type: "paragraph", text: "Dòng ba" },
    ]);
  });

  it("drops empty paragraphs and paragraphs with only &nbsp;", () => {
    expect(htmlToBlocks("<p>Có chữ</p><p></p><p>&nbsp;</p><p>   </p>")).toEqual([
      { type: "paragraph", text: "Có chữ" },
    ]);
  });

  it("removes script/style that users accidentally paste in", () => {
    expect(htmlToBlocks("<p>Chữ</p><script>alert(1)</script><style>p{color:red}</style>")).toEqual([
      { type: "paragraph", text: "Chữ" },
    ]);
  });

  it("recurses into nested divs instead of merging them into one paragraph", () => {
    expect(htmlToBlocks("<div><div><p>Một</p><p>Hai</p></div></div>")).toEqual([
      { type: "paragraph", text: "Một" },
      { type: "paragraph", text: "Hai" },
    ]);
  });

  // Browsers often leave bare text next to a block when users press Enter;
  // that text must become its own paragraph, not disappear.
  it("doesn't swallow text immediately before a block", () => {
    expect(htmlToBlocks("<div>Chữ trần<p>Trong khối</p></div>")).toEqual([
      { type: "paragraph", text: "Chữ trần" },
      { type: "paragraph", text: "Trong khối" },
    ]);
  });

  it("accepts bare text at the root (contentEditable empty then typed)", () => {
    expect(htmlToBlocks("Chữ gõ thẳng")).toEqual([{ type: "paragraph", text: "Chữ gõ thẳng" }]);
  });

  it("escapes special characters in bare text", () => {
    expect(htmlToBlocks("5 < 6 & 7 > 6")).toEqual([{ type: "paragraph", text: "5 &lt; 6 &amp; 7 &gt; 6" }]);
  });

  it("extracts images that share a paragraph with text", () => {
    expect(htmlToBlocks('<p>Trước<img src="a.jpg">Sau</p>')).toEqual([
      { type: "paragraph", text: "Trước" },
      { type: "image", src: "a.jpg", alt: "" },
      { type: "paragraph", text: "Sau" },
    ]);
  });

  it("figure becomes an image with caption", () => {
    expect(htmlToBlocks('<figure><img src="a.jpg" alt="A"><figcaption>Chú thích</figcaption></figure>')).toEqual([
      { type: "image", src: "a.jpg", alt: "A" },
      { type: "paragraph", text: "Chú thích" },
    ]);
  });

  it("returns empty array when content is empty", () => {
    expect(htmlToBlocks("")).toEqual([]);
    expect(htmlToBlocks("<p><br></p>")).toEqual([]);
  });
});

describe("htmlToBlocks — audio/video", () => {
  it("recognizes audio and video tags as separate blocks", () => {
    expect(
      htmlToBlocks(
        '<p>Nghe:</p><audio controls src="https://a.example/1.mp3">Audio file</audio>' +
          '<video controls src="https://a.example/1.mp4">Video file</video>'
      )
    ).toEqual([
      { type: "paragraph", text: "Nghe:" },
      { type: "audio", src: "https://a.example/1.mp3" },
      { type: "video", src: "https://a.example/1.mp4" },
    ]);
  });

  it("takes src from the child source tag when the media tag has no src", () => {
    expect(
      htmlToBlocks('<video controls><source src="https://a.example/1.webm" type="video/webm"></video>')
    ).toEqual([{ type: "video", src: "https://a.example/1.webm" }]);
  });

  it("removes media tags with no source", () => {
    expect(htmlToBlocks("<audio controls></audio>")).toEqual([]);
  });
});

describe("blocksToHtml", () => {
  it("rebuilds paragraphs, headings, and images", () => {
    expect(
      blocksToHtml([
        { type: "heading", level: 3, text: "Chương 1" },
        { type: "paragraph", text: "Đoạn <b>đậm</b>" },
        { type: "image", src: "https://img.example/1.jpg", alt: "Ảnh" },
      ])
    ).toBe('<h3>Chương 1</h3>\n<p>Đoạn <b>đậm</b></p>\n<img src="https://img.example/1.jpg" alt="Ảnh" />');
  });

  it("round-trips through htmlToBlocks produce the same blocks", () => {
    const blocks = [
      { type: "paragraph" as const, text: "Một" },
      { type: "paragraph" as const, text: "Hai" },
    ];
    expect(htmlToBlocks(blocksToHtml(blocks))).toEqual(blocks);
  });

  it("builds media tags with controls so readers show a play button", () => {
    expect(blocksToHtml([{ type: "audio", src: "https://a.example/1.mp3" }])).toBe(
      '<audio controls src="https://a.example/1.mp3">Audio file</audio>'
    );
  });

  it("audio/video blocks round-trip through htmlToBlocks unchanged", () => {
    const blocks = [
      { type: "audio" as const, src: "https://a.example/1.mp3" },
      { type: "video" as const, src: "https://a.example/1.mp4" },
    ];
    expect(htmlToBlocks(blocksToHtml(blocks))).toEqual(blocks);
  });
});
