// What the boss key shows in the terminal skin: the same window mid-work on a made-up
// backend service — a git log, a test run with one failure, and a command half typed.
// Static, no story in it, nothing fetched; none of its controls answer to the shell's
// accessible names, since the shell stays mounted underneath. The title bar's size and
// the login banner are live, as the shell's are: a window that changes size or day when
// the boss key is pressed would be a tell.
import { useRef, useState } from "react";
import { lastLogin, morningLogin } from "./format";
import { readFontSize } from "./keys";
import { PromptText, TermTitleBar } from "./TermChrome";
import { useTermSize } from "./useTermSize";

const PATH = "~/projects/budget-service";

type Segment = [string, string?];
type DecoyLine = { prompt: string } | { out: Segment[] };

const GREEN = "text-term-green";
const RED = "text-term-red";
const DIM = "text-term-dim";
const YELLOW = "text-term-yellow";
const CYAN = "text-term-cyan";
const PASS = "bg-term-green font-bold text-term-bg";
const FAIL = "bg-term-red font-bold text-term-bg";

const LINES: DecoyLine[] = [
  { prompt: "git log --oneline -5" },
  { out: [["a41c9e2", YELLOW], [" ("], ["HEAD -> ", CYAN], ["feature/q4-variance", GREEN], [") fix(report): round VND totals before summing"]] },
  { out: [["7d02b1f", YELLOW], [" feat(budget): variance report per department"]] },
  { out: [["e93a5c0", YELLOW], [" test(budget): cover quarter boundaries"]] },
  { out: [["1bb7f44", YELLOW], [" chore(deps): bump typeorm to 0.3.20"]] },
  { out: [["5c2d8a9", YELLOW], [" Merge branch 'hotfix/ledger-sync' into develop"]] },
  { prompt: "npm test -- budget" },
  { out: [[""]] },
  { out: [["> budget-service@2.4.0 test"]] },
  { out: [["> jest --runInBand budget"]] },
  { out: [[""]] },
  { out: [[" PASS ", PASS], [" src/budget/"], ["budget.service.spec.ts", "font-bold"], [" (4.812 s)", DIM]] },
  { out: [["  BudgetService"]] },
  { out: [["    findByQuarter"]] },
  { out: [["      ✓ ", GREEN], ["returns budgets inside the quarter "], ["(38 ms)", DIM]] },
  { out: [["      ✓ ", GREEN], ["orders departments by name "], ["(12 ms)", DIM]] },
  { out: [["    variance"]] },
  { out: [["      ✓ ", GREEN], ["flags lines above the 85% threshold "], ["(9 ms)", DIM]] },
  { out: [["      ✓ ", GREEN], ["rounds currency to whole đồng "], ["(4 ms)", DIM]] },
  { out: [[" PASS ", PASS], [" src/budget/"], ["budget-line.entity.spec.ts", "font-bold"]] },
  { out: [[" FAIL ", FAIL], [" src/report/"], ["variance.controller.spec.ts", "font-bold"]] },
  { out: [["  ● VarianceController › GET /reports/variance › returns 404 for an unknown budget", `${RED} font-bold`]] },
  { out: [[""]] },
  { out: [["    expect("], ["received", RED], [").rejects.toThrow()"]] },
  { out: [[""]] },
  { out: [["    Received promise resolved instead of rejected"]] },
  { out: [["    Resolved to value: "], ['{"id": "b-2026-q4-ops", "lines": []}', RED]] },
  { out: [[""]] },
  { out: [["      41 |", DIM], ['   it("returns 404 for an unknown budget", async () => {']] },
  { out: [["      42 |", DIM], ['     await expect(controller.variance("b-unknown")).rejects.toThrow(']] },
  { out: [["    > ", RED], ["43 |", DIM], ["       NotFoundException,"]] },
  { out: [["         |", DIM], ["       ^", RED]] },
  { out: [["      44 |", DIM], ["     );"]] },
  { out: [[""]] },
  { out: [["Test Suites: ", "font-bold"], ["1 failed", `${RED} font-bold`], [", "], ["2 passed", `${GREEN} font-bold`], [", 3 total"]] },
  { out: [["Tests:       ", "font-bold"], ["1 failed", `${RED} font-bold`], [", "], ["17 passed", `${GREEN} font-bold`], [", 18 total"]] },
  { out: [["Snapshots:   ", "font-bold"], ["0 total"]] },
  { out: [["Time:        ", "font-bold"], ["6.204 s"]] },
  { out: [["Ran all test suites matching ", DIM], ["/budget/i", ""], [".", DIM]] },
];

export default function TermDecoy() {
  const body = useRef<HTMLDivElement>(null);
  // The shell's font size, so both count the same cells in the same window.
  const [fontSize] = useState(readFontSize);
  const size = useTermSize(body, fontSize);
  const [login] = useState(() => lastLogin(morningLogin(new Date())));
  return (
    <div className="flex h-full flex-col overflow-hidden bg-term-bg font-term text-term-fg">
      <TermTitleBar title={`dev@workstation: ${PATH}`} process="zsh" size={`${size.columns}×${size.rows}`} />
      <div
        ref={body}
        className="min-h-0 flex-1 overflow-hidden px-3 py-1.5"
        style={{ fontSize, lineHeight: `${size.lineHeight}px` }}
      >
        <div className="whitespace-pre-wrap break-words">{login}</div>
        {LINES.map((line, index) =>
          "prompt" in line ? (
            <div key={index} className="whitespace-pre-wrap break-all">
              <PromptText path={PATH} />
              {line.prompt}
            </div>
          ) : (
            <div key={index} className="min-h-[1lh] whitespace-pre-wrap break-words">
              {line.out.map(([text, tone], at) => (
                <span key={at} className={tone}>
                  {text}
                </span>
              ))}
            </div>
          )
        )}
        <div className="whitespace-pre-wrap break-all">
          <PromptText path={PATH} />
          vim src/report/variance.con
          <span className="bg-term-caret text-term-bg"> </span>
        </div>
      </div>
    </div>
  );
}
