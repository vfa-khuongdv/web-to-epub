import { describe, expect, it } from "vitest";
import { htmlToBlocks } from "./chapterHtml";

describe("htmlToBlocks", () => {
  it("giữ nguyên đoạn văn và định dạng inline bên trong", () => {
    expect(htmlToBlocks("<p>Đoạn <b>đậm</b> và <i>nghiêng</i></p>")).toEqual([
      { type: "paragraph", text: "Đoạn <b>đậm</b> và <i>nghiêng</i>" },
    ]);
  });

  it("đọc heading kèm cấp", () => {
    expect(htmlToBlocks("<h3>Chương 1</h3><p>Nội dung</p>")).toEqual([
      { type: "heading", level: 3, text: "Chương 1" },
      { type: "paragraph", text: "Nội dung" },
    ]);
  });

  it("đọc ảnh theo đúng src gốc, không nối base URL", () => {
    expect(htmlToBlocks('<img src="https://cdn.example.com/a.jpg" alt="Bìa" />')).toEqual([
      { type: "image", src: "https://cdn.example.com/a.jpg", alt: "Bìa" },
    ]);
  });

  it("tách <br> thành nhiều đoạn", () => {
    expect(htmlToBlocks("<p>Dòng một<br>Dòng hai<br/>Dòng ba</p>")).toEqual([
      { type: "paragraph", text: "Dòng một" },
      { type: "paragraph", text: "Dòng hai" },
      { type: "paragraph", text: "Dòng ba" },
    ]);
  });

  it("bỏ đoạn rỗng và đoạn chỉ có &nbsp;", () => {
    expect(htmlToBlocks("<p>Có chữ</p><p></p><p>&nbsp;</p><p>   </p>")).toEqual([
      { type: "paragraph", text: "Có chữ" },
    ]);
  });

  it("bỏ script/style người dùng lỡ dán vào", () => {
    expect(htmlToBlocks("<p>Chữ</p><script>alert(1)</script><style>p{color:red}</style>")).toEqual([
      { type: "paragraph", text: "Chữ" },
    ]);
  });

  it("đi vào trong div lồng nhau thay vì gộp thành một đoạn", () => {
    expect(htmlToBlocks("<div><div><p>Một</p><p>Hai</p></div></div>")).toEqual([
      { type: "paragraph", text: "Một" },
      { type: "paragraph", text: "Hai" },
    ]);
  });

  // Trình duyệt hay để lại chữ trần ngay cạnh một khối khi người dùng gõ Enter;
  // chữ đó phải thành đoạn riêng chứ không được biến mất.
  it("không nuốt chữ nằm ngay trước một khối", () => {
    expect(htmlToBlocks("<div>Chữ trần<p>Trong khối</p></div>")).toEqual([
      { type: "paragraph", text: "Chữ trần" },
      { type: "paragraph", text: "Trong khối" },
    ]);
  });

  it("nhận chữ trần ở ngoài cùng (contentEditable rỗng rồi gõ thẳng)", () => {
    expect(htmlToBlocks("Chữ gõ thẳng")).toEqual([{ type: "paragraph", text: "Chữ gõ thẳng" }]);
  });

  it("escape ký tự đặc biệt trong chữ trần", () => {
    expect(htmlToBlocks("5 < 6 & 7 > 6")).toEqual([{ type: "paragraph", text: "5 &lt; 6 &amp; 7 &gt; 6" }]);
  });

  it("tách ảnh nằm chung đoạn với chữ", () => {
    expect(htmlToBlocks('<p>Trước<img src="a.jpg">Sau</p>')).toEqual([
      { type: "paragraph", text: "Trước" },
      { type: "image", src: "a.jpg", alt: "" },
      { type: "paragraph", text: "Sau" },
    ]);
  });

  it("figure thành ảnh kèm chú thích", () => {
    expect(htmlToBlocks('<figure><img src="a.jpg" alt="A"><figcaption>Chú thích</figcaption></figure>')).toEqual([
      { type: "image", src: "a.jpg", alt: "A" },
      { type: "paragraph", text: "Chú thích" },
    ]);
  });

  it("trả mảng rỗng khi nội dung trống", () => {
    expect(htmlToBlocks("")).toEqual([]);
    expect(htmlToBlocks("<p><br></p>")).toEqual([]);
  });
});
