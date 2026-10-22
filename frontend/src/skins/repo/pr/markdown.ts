// The comment Markdown of a code-hosting site, small: headings, paragraphs (a single
// newline is a line break, as in the site's comments), bullet, numbered and task lists,
// quotes, fenced code, rules, and inline code, bold, italic, links, #123 and @name.
// Parsed into plain data that the page turns into React elements — never into HTML, so
// whatever is typed in a comment box stays text.

export type Inline =
  | { kind: "text" | "code" | "bold" | "italic" | "mention"; text: string }
  | { kind: "ref"; text: string; number: number }
  | { kind: "link"; text: string };

export interface ListItem {
  // null for a plain item; checked or not for a task.
  task: boolean | null;
  inline: Inline[];
}

export type MdBlock =
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "quote"; blocks: MdBlock[] }
  | { kind: "rule" };

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)|(\[[^\]]+\]\([^)\s]+\))|(#\d+\b)|(@[A-Za-z0-9][\w-]*)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += value;
    else out.push({ kind: "text", text: value });
  };
  INLINE.lastIndex = 0;
  let at = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE.exec(text))) {
    pushText(text.slice(at, match.index));
    const [whole, code, bold, italic, link, ref, mention] = match;
    if (code) out.push({ kind: "code", text: code.slice(1, -1) });
    else if (bold) out.push({ kind: "bold", text: bold.slice(2, -2) });
    else if (italic) out.push({ kind: "italic", text: italic.slice(1, -1) });
    else if (link) out.push({ kind: "link", text: link.slice(1, link.indexOf("](")) });
    else if (ref) out.push({ kind: "ref", text: ref, number: Number(ref.slice(1)) });
    else if (mention) out.push({ kind: "mention", text: mention });
    at = match.index + whole.length;
  }
  pushText(text.slice(at));
  return out;
}

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    if (!line.trim()) {
      at++;
      continue;
    }
    const fence = /^\s*```(\w*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      at++;
      while (at < lines.length && !/^\s*```/.test(lines[at])) code.push(lines[at++]);
      at++;
      blocks.push({ kind: "code", lang: fence[1], lines: code });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, inline: parseInline(heading[2].trim()) });
      at++;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      at++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (at < lines.length && /^\s*>/.test(lines[at])) quoted.push(lines[at++].replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", blocks: parseMarkdown(quoted.join("\n")) });
      continue;
    }
    const first = LIST_ITEM.exec(line);
    if (first) {
      const ordered = !first[1];
      const items: ListItem[] = [];
      let item: RegExpExecArray | null;
      while (at < lines.length && (item = LIST_ITEM.exec(lines[at])) && !item[1] === ordered) {
        const task = TASK.exec(item[3]);
        items.push(task ? { task: task[1] !== " ", inline: parseInline(task[2]) } : { task: null, inline: parseInline(item[3]) });
        at++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph: Inline[][] = [];
    while (
      at < lines.length &&
      lines[at].trim() &&
      !/^(#{1,6})\s/.test(lines[at]) &&
      !/^\s*```/.test(lines[at]) &&
      !/^\s*>/.test(lines[at]) &&
      !LIST_ITEM.exec(lines[at])
    ) {
      paragraph.push(parseInline(lines[at].trim()));
      at++;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

// The text a list of blocks would read as, for the counts and checks of a form.
export function plainText(blocks: MdBlock[]): string {
  const inline = (parts: Inline[]) => parts.map((part) => part.text).join("");
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "heading":
          return inline(block.inline);
        case "paragraph":
          return block.lines.map(inline).join("\n");
        case "list":
          return block.items.map((item) => inline(item.inline)).join("\n");
        case "code":
          return block.lines.join("\n");
        case "quote":
          return plainText(block.blocks);
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

// "Tasks 2 of 3" in a list's header and the issue list: the boxes ticked and the total.
export function taskCount(source: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const match of source.matchAll(/^\s*[-*+]\s+\[([ xX])\]/gm)) {
    total++;
    if (match[1] !== " ") done++;
  }
  return { done, total };
}
