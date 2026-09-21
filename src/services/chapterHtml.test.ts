import { describe, expect, it } from "vitest";
import { blocksToHtml, htmlToBlocks, mediaTag } from "./chapterHtml";

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

  it("reads heading levels at both ends of the range", () => {
    expect(htmlToBlocks("<h1>Một</h1><h6>Sáu</h6>")).toEqual([
      { type: "heading", level: 1, text: "Một" },
      { type: "heading", level: 6, text: "Sáu" },
    ]);
  });

  it("drops empty and whitespace-only headings", () => {
    expect(htmlToBlocks("<h2></h2><h2>   </h2><h2>&nbsp;</h2><h3>Giữ</h3>")).toEqual([
      { type: "heading", level: 3, text: "Giữ" },
    ]);
  });

  it("reads images with their original src, no base URL appended", () => {
    expect(htmlToBlocks('<img src="https://cdn.example.com/a.jpg" alt="Bìa" />')).toEqual([
      { type: "image", src: "https://cdn.example.com/a.jpg", alt: "Bìa" },
    ]);
  });

  it("drops images without src", () => {
    expect(htmlToBlocks('<p>Trước</p><img alt="không nguồn">')).toEqual([{ type: "paragraph", text: "Trước" }]);
  });

  it("splits <br> into multiple paragraphs", () => {
    expect(htmlToBlocks("<p>Dòng một<br>Dòng hai<br/>Dòng ba</p>")).toEqual([
      { type: "paragraph", text: "Dòng một" },
      { type: "paragraph", text: "Dòng hai" },
      { type: "paragraph", text: "Dòng ba" },
    ]);
  });

  it("splits the <br /> spacing variant too", () => {
    expect(htmlToBlocks("<p>Dòng một<br />Dòng hai</p>")).toEqual([
      { type: "paragraph", text: "Dòng một" },
      { type: "paragraph", text: "Dòng hai" },
    ]);
  });

  it("splits root-level bare text around <br>", () => {
    expect(htmlToBlocks("A<br>B")).toEqual([
      { type: "paragraph", text: "A" },
      { type: "paragraph", text: "B" },
    ]);
  });

  it("drops empty paragraphs and paragraphs with only &nbsp;", () => {
    expect(htmlToBlocks("<p>Có chữ</p><p></p><p>&nbsp;</p><p>   </p>")).toEqual([
      { type: "paragraph", text: "Có chữ" },
    ]);
  });

  it("drops paragraphs holding only a numeric NBSP or empty markup", () => {
    expect(htmlToBlocks("<p>&#160;</p><p><b></b></p><p>Giữ</p>")).toEqual([
      { type: "paragraph", text: "Giữ" },
    ]);
  });

  it("removes script/style that users accidentally paste in", () => {
    expect(htmlToBlocks("<p>Chữ</p><script>alert(1)</script><style>p{color:red}</style>")).toEqual([
      { type: "paragraph", text: "Chữ" },
    ]);
  });

  it.each(["noscript", "iframe", "object", "embed", "link", "meta"])(
    "removes <%s> that users accidentally paste in",
    (tag) => {
      expect(htmlToBlocks(`<p>Chữ</p><${tag}></${tag}><p>Khác</p>`)).toEqual([
        { type: "paragraph", text: "Chữ" },
        { type: "paragraph", text: "Khác" },
      ]);
    }
  );

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

  it("trims whitespace around a media src", () => {
    expect(htmlToBlocks('<audio controls src="  https://a.example/1.mp3  ">x</audio>')).toEqual([
      { type: "audio", src: "https://a.example/1.mp3" },
    ]);
  });

  it("takes the first source when several are offered", () => {
    expect(
      htmlToBlocks(
        '<video controls><source src="https://a.example/1.webm" type="video/webm">' +
          '<source src="https://a.example/1.mp4" type="video/mp4"></video>'
      )
    ).toEqual([{ type: "video", src: "https://a.example/1.webm" }]);
  });

  it("a first source without src shadows later ones (pins chapterHtml.ts:42)", () => {
    expect(
      htmlToBlocks('<video controls><source type="video/webm"><source src="https://a.example/1.mp4"></video>')
    ).toEqual([]);
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

  it("defaults a heading to level 2 when level is missing", () => {
    expect(blocksToHtml([{ type: "heading", text: "Chương" }])).toBe("<h2>Chương</h2>");
  });

  it("returns an empty string when there are no blocks", () => {
    expect(blocksToHtml([])).toBe("");
  });

  it("renders media without src as an empty src attribute", () => {
    expect(blocksToHtml([{ type: "audio" }])).toBe('<audio controls src="">Audio file</audio>');
  });

  // chapterHtml.ts:141 interpolates block.src directly, so a missing src becomes the
  // literal "undefined" — unlike media, which falls back to "". Pins current behavior.
  it('renders an image without src as src="undefined"', () => {
    expect(blocksToHtml([{ type: "image" }])).toBe('<img src="undefined" alt="" />');
  });

  // chapterHtml.ts:129 interpolates the src into the attribute unescaped. Pins current behavior.
  it("does not escape quotes in a media src", () => {
    expect(mediaTag("audio", 'https://a.example/1.mp3" onplay="alert(1)')).toBe(
      '<audio controls src="https://a.example/1.mp3" onplay="alert(1)">Audio file</audio>'
    );
  });

  it("round-trips through htmlToBlocks produce the same blocks", () => {
    const blocks = [
      { type: "paragraph" as const, text: "Một" },
      { type: "paragraph" as const, text: "Hai" },
    ];
    expect(htmlToBlocks(blocksToHtml(blocks))).toEqual(blocks);
  });

  // blocksToHtml embeds text verbatim, but htmlToBlocks splits on <br> — so a paragraph
  // whose text contains <br> comes back as two paragraphs (chapterHtml.ts:31,143). Pins current behavior.
  it("a paragraph whose text contains <br> does not round-trip", () => {
    const html = blocksToHtml([{ type: "paragraph", text: "A<br>B" }]);

    expect(html).toBe("<p>A<br>B</p>");
    expect(htmlToBlocks(html)).toEqual([
      { type: "paragraph", text: "A" },
      { type: "paragraph", text: "B" },
    ]);
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
