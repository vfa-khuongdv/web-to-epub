import { ReactNode, memo } from "react";
import { useLang } from "../../i18n";
import { ChapterLine } from "../../lib/skins/chapterLines";
import { editorLine, editorLineCount } from "./lines";

// Text column: a comfortable reading measure, wrapped softly like the editor's word wrap.
const TEXT = "min-w-0 max-w-[100ch] flex-1 whitespace-pre-wrap break-words pr-8";

export function gutterWidth(lineCount: number): string {
  return `${Math.max(3, String(lineCount).length) + 4}ch`;
}

const Row = memo(function Row({
  number,
  paragraph,
  current,
  gutter,
  onCursor,
  line,
}: {
  number: number;
  paragraph?: number;
  current: boolean;
  gutter: string;
  onCursor: (line: number) => void;
  line?: ChapterLine;
}) {
  return (
    <div data-line={paragraph} className={`flex ${current ? "bg-code-line" : ""}`} onClick={() => onCursor(number)}>
      <span
        aria-hidden="true"
        className={`flex-none select-none pr-[3ch] text-right ${current ? "text-code-gutter-active" : "text-code-gutter"}`}
        style={{ width: gutter }}
      >
        {number}
      </span>
      <span className={TEXT}>{line ? <LineText line={line} /> : " "}</span>
    </div>
  );
});

function LineText({ line }: { line: ChapterLine }) {
  if (line.kind === "heading") {
    return (
      <span className="font-bold text-code-heading">
        <span>{"# "}</span>
        <span>{line.text}</span>
      </span>
    );
  }
  if (line.kind === "media") return <span className="text-code-comment">{`<!-- ${line.text} -->`}</span>;
  return <span className="text-code-text">{line.text}</span>;
}

/**
 * A chapter as a Markdown file: one editor line per paragraph with an empty line between
 * them, line numbers in their own column that is never selected or read out, headings
 * as `# …`, pictures as comments (never loaded). Clicking a line puts the cursor there.
 * After the last line, the way on to the next file.
 */
export function FileLines({
  lines,
  cursor,
  onCursor,
  next,
  onNext,
}: {
  lines: ChapterLine[];
  cursor: number;
  onCursor: (line: number) => void;
  next: string | null;
  onNext: () => void;
}) {
  const { t } = useLang();
  const gutter = gutterWidth(editorLineCount(lines.length));
  const rows: ReactNode[] = [];
  lines.forEach((line, index) => {
    const number = editorLine(index);
    rows.push(
      <Row
        key={number}
        number={number}
        paragraph={index}
        current={cursor === number}
        gutter={gutter}
        onCursor={onCursor}
        line={line}
      />
    );
    if (index < lines.length - 1) {
      rows.push(<Row key={number + 1} number={number + 1} current={cursor === number + 1} gutter={gutter} onCursor={onCursor} />);
    }
  });
  if (lines.length === 0) {
    rows.push(
      <Row
        key={1}
        number={1}
        current={cursor === 1}
        gutter={gutter}
        onCursor={onCursor}
        line={{ kind: "media", text: t("This file is empty.") }}
      />
    );
  }

  return (
    <div className="pb-[30vh] pt-1 font-mono text-[14px] leading-[22px]">
      {rows}
      <div className="mt-6 flex">
        <span className="flex-none" style={{ width: gutter }} />
        {next ? (
          <button
            type="button"
            className="rounded-[2px] text-[13px] text-code-dim underline-offset-4 outline-none hover:text-code-focus hover:underline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-code-focus"
            aria-label={`${t("Next file")}: ${next}`}
            onClick={onNext}
          >
            {`→ ${next}`}
          </button>
        ) : (
          <span className="text-[13px] text-code-dim">{`<!-- ${t("End of folder.")} -->`}</span>
        )}
      </div>
    </div>
  );
}
