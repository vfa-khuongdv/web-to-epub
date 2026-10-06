// Syntax colours for the fake diffs, one line at a time, the way the site tints a diff:
// keywords, strings, comments, numbers and constants, and the names being declared or
// called. A small tokenizer for the languages the fake repository holds (TypeScript, SQL,
// JSON, YAML, Markdown) — enough to look right, not a parser.

export type TokenKind = "plain" | "keyword" | "string" | "comment" | "constant" | "entity" | "heading";

export interface Token {
  kind: TokenKind;
  text: string;
}

export type Language = "ts" | "sql" | "json" | "yaml" | "md" | "plain";

export function languageOf(path: string): Language {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["ts", "tsx", "js", "mjs", "cjs", "jsx"].includes(extension)) return "ts";
  if (extension === "sql") return "sql";
  if (extension === "json") return "json";
  if (extension === "yml" || extension === "yaml") return "yaml";
  if (extension === "md") return "md";
  return "plain";
}

const TS_KEYWORDS = new Set(
  (
    "abstract as async await break case catch class const continue default delete do else enum export extends finally for from " +
    "function get if implements import in instanceof interface let new of private protected public readonly return set static " +
    "switch throw try type typeof var void while yield"
  ).split(" ")
);
const TS_CONSTANTS = new Set(["true", "false", "null", "undefined", "this", "super", "NaN", "Infinity"]);
// After these, the next name is the one being declared.
const TS_DECLARES = new Set(["class", "interface", "enum", "type", "function", "extends", "implements", "new"]);

const SQL_KEYWORDS = new Set(
  (
    "add alter and as asc begin by cascade check column commit constraint create default delete desc drop exists foreign from " +
    "group having if in index insert into is join key left limit not null on or order primary references rollback select set " +
    "table transaction unique update values where with bigint boolean char date decimal int integer numeric text timestamp " +
    "timestamptz uuid varchar coalesce sum count"
  ).split(" ")
);

const TS_TOKEN = /(\/\/.*$|\/\*.*?(?:\*\/|$))|('(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|`(?:\\.|[^`\\])*`?)|(\b\d[\d_]*(?:\.\d+)?\b)|(@?[A-Za-z_$][\w$]*)/g;
const SQL_TOKEN = /(--.*$)|('(?:''|[^'])*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)/g;
const JSON_TOKEN = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g;
const YAML_TOKEN = /(#.*$)|(^\s*-?\s*[\w.-]+(?=:))|('[^']*'|"[^"]*")|(\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b)/g;

function push(tokens: Token[], kind: TokenKind, text: string) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) last.text += text;
  else tokens.push({ kind, text });
}

function scan(text: string, pattern: RegExp, classify: (match: RegExpExecArray, rest: string) => TokenKind): Token[] {
  const tokens: Token[] = [];
  pattern.lastIndex = 0;
  let at = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match[0] === "") {
      pattern.lastIndex++;
      continue;
    }
    push(tokens, "plain", text.slice(at, match.index));
    push(tokens, classify(match, text.slice(match.index + match[0].length)), match[0]);
    at = match.index + match[0].length;
  }
  push(tokens, "plain", text.slice(at));
  return tokens;
}

function highlightTs(text: string): Token[] {
  // A JSDoc continuation line (" * @param …") is all comment.
  if (/^\s*\*/.test(text) && !/^\s*\*\*/.test(text)) return [{ kind: "comment", text }];
  let previousWord = "";
  return scan(text, TS_TOKEN, (match, rest) => {
    if (match[1]) return "comment";
    if (match[2]) return "string";
    if (match[3]) return "constant";
    const word = match[4];
    const declared = TS_DECLARES.has(previousWord);
    previousWord = word;
    if (word.startsWith("@")) return "entity";
    if (TS_KEYWORDS.has(word)) return "keyword";
    if (TS_CONSTANTS.has(word)) return "constant";
    if (declared || /^\s*(?:<[^>]*>)?\s*\(/.test(rest)) return "entity";
    if (/^[A-Z][A-Z0-9_]+$/.test(word)) return "constant";
    return "plain";
  });
}

function highlightSql(text: string): Token[] {
  return scan(text, SQL_TOKEN, (match) => {
    if (match[1]) return "comment";
    if (match[2]) return "string";
    if (match[3]) return "constant";
    return SQL_KEYWORDS.has(match[4].toLowerCase()) ? "keyword" : "plain";
  });
}

export function highlightLine(text: string, language: Language): Token[] {
  if (!text) return [];
  switch (language) {
    case "ts":
      return highlightTs(text);
    case "sql":
      return highlightSql(text);
    case "json":
      return scan(text, JSON_TOKEN, (match) => (match[1] ? "constant" : match[2] ? "string" : "constant"));
    case "yaml":
      return scan(text, YAML_TOKEN, (match) => (match[1] ? "comment" : match[2] ? "entity" : match[3] ? "string" : "constant"));
    case "md":
      return /^#{1,6}\s/.test(text) ? [{ kind: "heading", text }] : [{ kind: "plain", text }];
    default:
      return [{ kind: "plain", text }];
  }
}
