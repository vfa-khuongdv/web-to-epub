// A small TypeScript colouriser for the decoy's source file: enough token kinds to look
// like the editor's default theme (keywords, control flow, types, functions, strings,
// numbers, comments, variables). Line based; block comments may span lines.

export type TokenKind = "keyword" | "control" | "type" | "function" | "string" | "number" | "comment" | "variable" | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "class",
  "interface",
  "type",
  "enum",
  "new",
  "private",
  "public",
  "protected",
  "readonly",
  "static",
  "async",
  "extends",
  "implements",
  "this",
  "true",
  "false",
  "null",
  "undefined",
  "function",
  "number",
  "string",
  "boolean",
  "void",
  "in",
  "typeof",
  "as",
]);

const CONTROL = new Set([
  "import",
  "export",
  "from",
  "return",
  "if",
  "else",
  "for",
  "of",
  "while",
  "await",
  "throw",
  "try",
  "catch",
  "default",
  "switch",
  "case",
  "break",
]);

const PATTERN =
  /(\/\/.*$)|(\/\*.*?(?:\*\/|$))|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

export function highlightLine(line: string, inComment = false): { tokens: Token[]; inComment: boolean } {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
  };
  let rest = line;
  if (inComment) {
    const end = rest.indexOf("*/");
    if (end < 0) return { tokens: [{ kind: "comment", text: rest }], inComment: true };
    push("comment", rest.slice(0, end + 2));
    rest = rest.slice(end + 2);
  }
  let open = false;
  let cursor = 0;
  PATTERN.lastIndex = 0;
  for (let match = PATTERN.exec(rest); match; match = PATTERN.exec(rest)) {
    push("plain", rest.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const [text, line, block, str, num, word] = match;
    if (line) push("comment", text);
    else if (block) {
      push("comment", text);
      open = !text.endsWith("*/") || text.length < 4;
    } else if (str) push("string", text);
    else if (num) push("number", text);
    else if (word) {
      const after = rest.slice(cursor);
      if (CONTROL.has(word)) push("control", text);
      else if (KEYWORDS.has(word)) push("keyword", text);
      else if (/^\s*(?:<[^>]*>)?\(/.test(after)) push("function", text);
      else if (/^[A-Z]/.test(word)) push("type", text);
      else push("variable", text);
    }
  }
  push("plain", rest.slice(cursor));
  return { tokens, inComment: open };
}

export function highlight(source: string): Token[][] {
  let inComment = false;
  return source.split("\n").map((line) => {
    const result = highlightLine(line, inComment);
    inComment = result.inComment;
    return result.tokens;
  });
}
