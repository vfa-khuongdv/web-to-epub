import { ContentBlock } from "./types";

// Giữ đồng bộ với mediaTag trong src/services/chapterHtml.ts.
function mediaTag(type: "audio" | "video", src: string): string {
  const label = type === "audio" ? "Tệp âm thanh" : "Tệp video";
  return `<${type} controls src="${src}">${label}</${type}>`;
}

export function blocksToHtml(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "heading") return `<h${b.level || 2}>${b.text}</h${b.level || 2}>`;
      if (b.type === "image") return `<img src="${b.src}" alt="${b.alt || ""}" />`;
      if (b.type === "audio" || b.type === "video") return mediaTag(b.type, b.src || "");
      return `<p>${b.text}</p>`;
    })
    .join("\n");
}
