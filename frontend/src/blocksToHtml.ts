import { ContentBlock } from "./types";

export function blocksToHtml(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "heading") return `<h${b.level || 2}>${b.text}</h${b.level || 2}>`;
      if (b.type === "image") return `<img src="${b.src}" alt="${b.alt || ""}" />`;
      return `<p>${b.text}</p>`;
    })
    .join("\n");
}
