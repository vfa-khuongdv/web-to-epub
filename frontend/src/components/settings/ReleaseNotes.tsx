import { Fragment, ReactNode } from "react";
import { Inline, parseReleaseNotes } from "../../lib/format/releaseNotes";

function inline(parts: Inline[]): ReactNode {
  return parts.map((part, i) => {
    if (part.kind === "bold") return <strong key={i}>{part.text}</strong>;
    if (part.kind === "code") {
      return (
        <code key={i} className="rounded-sm bg-sunken px-1 font-mono text-[11.5px]">
          {part.text}
        </code>
      );
    }
    if (part.kind === "link") {
      return (
        <a key={i} href={part.href} target="_blank" rel="noreferrer" className="underline">
          {part.text}
        </a>
      );
    }
    return <Fragment key={i}>{part.text}</Fragment>;
  });
}

/**
 * A release's own notes, as the maintainer wrote them on GitHub. Built from React elements, not
 * HTML: the text arrives over the network, and nothing in it is ever treated as markup.
 */
export default function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = parseReleaseNotes(markdown);
  if (blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px] leading-snug text-ink-2">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <h3 key={i} className={`font-semibold text-ink ${i > 0 ? "mt-2" : ""} ${block.level === 1 ? "text-[13px]" : "text-[12px]"}`}>
              {inline(block.inline)}
            </h3>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i} className="ml-4 list-disc space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(block.inline)}</p>;
      })}
    </div>
  );
}
