/**
 * The release notes a maintainer writes on GitHub are markdown, in a small dialect: `##` headings,
 * `-` bullets, `**bold**`, `` `code` `` and the odd link. This reads that much and nothing else —
 * no raw HTML, no images — into plain data the dialog renders as React elements, so text from a
 * network response never reaches `innerHTML`.
 */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type NoteBlock =
  | { kind: "heading"; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "list"; items: Inline[][] };

// `[text](https://…)` only for http(s): a `javascript:` link in a release body must stay text.
const INLINE_RE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE_RE)) {
    if (match.index > last) out.push({ kind: "text", text: source.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ kind: "bold", text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: "code", text: match[2] });
    else out.push({ kind: "link", text: match[3], href: match[4] });
    last = match.index + match[0].length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  return out;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

export function parseReleaseNotes(markdown: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let list: Inline[][] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "list", items: list });
    list = [];
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const heading = HEADING_RE.exec(line);
    const bullet = BULLET_RE.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      // A release note has no use for six heading sizes: the deepest three share the smallest.
      blocks.push({ kind: "heading", level: Math.min(heading[1].length, 3) as 1 | 2 | 3, inline: parseInline(heading[2]) });
    } else if (bullet) {
      flushParagraph();
      list.push(parseInline(bullet[1]));
    } else if (list.length && /^\s+\S/.test(raw)) {
      // A bullet that wraps onto an indented line belongs to that bullet.
      const items = list;
      items[items.length - 1] = [...items[items.length - 1], { kind: "text", text: ` ${line.trim()}` }];
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
