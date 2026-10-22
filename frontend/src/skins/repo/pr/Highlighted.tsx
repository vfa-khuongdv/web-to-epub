// One line of code in the fake diffs, tinted by pr/highlight.ts.

import { memo } from "react";
import { Language, TokenKind, highlightLine } from "./highlight";

const TONE: Record<TokenKind, string> = {
  plain: "",
  keyword: "text-repo-syn-keyword",
  string: "text-repo-syn-string",
  comment: "text-repo-syn-comment",
  constant: "text-repo-syn-constant",
  entity: "text-repo-syn-entity",
  heading: "font-semibold text-repo-syn-constant",
};

export const CodeText = memo(function CodeText({ text, language }: { text: string; language: Language }) {
  const tokens = highlightLine(text, language);
  if (tokens.length === 0) return <span>{"​"}</span>;
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === "plain" ? (
          <span key={index}>{token.text}</span>
        ) : (
          <span key={index} className={TONE[token.kind]}>
            {token.text}
          </span>
        )
      )}
    </>
  );
});
