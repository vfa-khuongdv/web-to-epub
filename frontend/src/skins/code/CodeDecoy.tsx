// The code skin's decoy: the same editor showing a TypeScript service of a made-up
// project, a test run in the terminal. Static, no story in it, nothing fetched.
import { Bell, ChevronDown, ChevronRight, CircleX, Ellipsis, GitBranch, RefreshCw, TriangleAlert, X } from "lucide-react";
import { ActivityBar } from "./ActivityBar";
import { Token, TokenKind, highlight } from "./highlight";
import { TitleBar } from "./TitleBar";

const SOURCE = `import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { Budget } from "./entities/budget.entity";
import { BudgetLine } from "./entities/budget-line.entity";
import { CreateBudgetDto } from "./dto/create-budget.dto";
import { roundCurrency } from "../common/money";

/**
 * Quarterly budget planning: allocations per department,
 * actual spend from the ledger, and variance reporting.
 */
@Injectable()
export class BudgetService {
  private static readonly WARNING_THRESHOLD = 0.85;

  constructor(
    @InjectRepository(Budget)
    private readonly budgets: Repository<Budget>,
    @InjectRepository(BudgetLine)
    private readonly lines: Repository<BudgetLine>,
  ) {}

  async findByQuarter(year: number, quarter: number): Promise<Budget[]> {
    const start = new Date(year, (quarter - 1) * 3, 1);
    const end = new Date(year, quarter * 3, 0);
    return this.budgets.find({
      where: { period: Between(start, end) },
      relations: ["lines", "department"],
      order: { department: { name: "ASC" } },
    });
  }

  async findOne(id: string): Promise<Budget> {
    const budget = await this.budgets.findOne({ where: { id }, relations: ["lines"] });
    if (!budget) {
      throw new NotFoundException(\`Budget \${id} not found\`);
    }
    return budget;
  }

  async create(dto: CreateBudgetDto): Promise<Budget> {
    const budget = this.budgets.create({
      departmentId: dto.departmentId,
      period: dto.period,
      currency: dto.currency ?? "VND",
      allocated: roundCurrency(dto.allocated),
    });
    return this.budgets.save(budget);
  }

  async variance(id: string): Promise<VarianceReport> {
    const budget = await this.findOne(id);
    const spent = budget.lines.reduce((sum, line) => sum + line.amount, 0);
    const remaining = budget.allocated - spent;
    const usage = budget.allocated > 0 ? spent / budget.allocated : 0;

    // Flag departments close to their limit so finance can review early.
    const status =
      usage >= 1 ? "over" : usage >= BudgetService.WARNING_THRESHOLD ? "warning" : "ok";

    return {
      budgetId: budget.id,
      allocated: budget.allocated,
      spent: roundCurrency(spent),
      remaining: roundCurrency(remaining),
      usage: Math.round(usage * 1000) / 10,
      status,
    };
  }

  async topSpenders(year: number, quarter: number, limit = 5): Promise<VarianceReport[]> {
    const budgets = await this.findByQuarter(year, quarter);
    const reports = await Promise.all(budgets.map((budget) => this.variance(budget.id)));
    return reports.sort((a, b) => b.usage - a.usage).slice(0, limit);
  }
}

export interface VarianceReport {
  budgetId: string;
  allocated: number;
  spent: number;
  remaining: number;
  usage: number;
  status: "ok" | "warning" | "over";
}`;

const LINES = highlight(SOURCE);
const CURRENT_LINE = 26;

const TEXT: Record<TokenKind, string> = {
  keyword: "text-code-keyword",
  control: "text-code-control",
  type: "text-code-type",
  function: "text-code-function",
  string: "text-code-string",
  number: "text-code-number",
  comment: "text-code-comment",
  variable: "text-code-variable",
  plain: "text-code-text",
};

const MINIMAP: Record<TokenKind, string> = {
  keyword: "bg-code-keyword",
  control: "bg-code-control",
  type: "bg-code-type",
  function: "bg-code-function",
  string: "bg-code-string",
  number: "bg-code-number",
  comment: "bg-code-comment",
  variable: "bg-code-variable",
  plain: "bg-code-text",
};

type Entry = { name: string; depth: number; folder?: boolean; open?: boolean; glyph?: "ts" | "json" | "md" | "git"; git?: "M" | "U"; active?: boolean };

const PROJECT: Entry[] = [
  { name: "src", depth: 0, folder: true, open: true },
  { name: "budget", depth: 1, folder: true, open: true },
  { name: "dto", depth: 2, folder: true },
  { name: "entities", depth: 2, folder: true },
  { name: "budget.controller.ts", depth: 2, glyph: "ts" },
  { name: "budget.module.ts", depth: 2, glyph: "ts" },
  { name: "budget.service.spec.ts", depth: 2, glyph: "ts", git: "U" },
  { name: "budget.service.ts", depth: 2, glyph: "ts", git: "M", active: true },
  { name: "common", depth: 1, folder: true },
  { name: "users", depth: 1, folder: true },
  { name: "app.module.ts", depth: 1, glyph: "ts" },
  { name: "main.ts", depth: 1, glyph: "ts" },
  { name: "test", depth: 0, folder: true },
  { name: ".gitignore", depth: 0, glyph: "git" },
  { name: "nest-cli.json", depth: 0, glyph: "json" },
  { name: "package.json", depth: 0, glyph: "json" },
  { name: "README.md", depth: 0, glyph: "md" },
  { name: "tsconfig.json", depth: 0, glyph: "json" },
];

const TERMINAL = [
  "> budget-api@1.4.2 test",
  "> jest budget.service",
  "",
  " PASS  src/budget/budget.service.spec.ts",
  "  BudgetService",
  "    ✓ returns the budgets of a quarter (12 ms)",
  "    ✓ throws when a budget does not exist (3 ms)",
  "    ✓ flags usage above the warning threshold (2 ms)",
  "",
  "Tests:       3 passed, 3 total",
  "Time:        1.84 s, estimated 2 s",
];

function Glyph({ kind }: { kind?: Entry["glyph"] }) {
  if (kind === "ts") return <span className="w-4 flex-none text-center text-[9px] font-extrabold text-code-keyword">TS</span>;
  if (kind === "json") return <span className="w-4 flex-none text-center text-[11px] font-bold text-code-warning">{"{}"}</span>;
  if (kind === "md") return <span className="w-4 flex-none text-center text-[9px] font-extrabold text-code-type">M↓</span>;
  return <span className="w-4 flex-none text-center text-[11px] font-bold text-code-error">◆</span>;
}

function CodeLine({ tokens }: { tokens: Token[] }) {
  if (tokens.length === 0) return <> </>;
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={TEXT[token.kind]}>
          {token.text}
        </span>
      ))}
    </>
  );
}

export default function CodeDecoy() {
  const gutter = `${String(LINES.length).length + 4}ch`;
  return (
    <div className="flex h-full flex-col overflow-hidden bg-code-editor font-ui text-code-fg">
      <div aria-hidden="true">
        <TitleBar />
      </div>
      <div className="flex min-h-0 flex-1">
        <div aria-hidden="true" className="flex">
          <ActivityBar view="explorer" sidebarOpen />
        </div>
        <aside className="flex w-[260px] flex-none flex-col border-r border-code-border bg-code-side" aria-hidden="true">
          <div className="flex h-[35px] flex-none items-center justify-between pl-5 pr-2 text-[11px] uppercase tracking-[0.02em]">
            <span>Explorer</span>
            <Ellipsis size={16} />
          </div>
          <div className="flex h-[22px] items-center gap-0.5 pl-0.5 text-[11px] font-bold uppercase">
            <ChevronDown size={16} />
            budget-api
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {PROJECT.map((entry) => (
              <div
                key={entry.name}
                className={`flex h-[22px] items-center pr-3 text-[13px] ${entry.active ? "bg-code-active text-code-text" : ""}`}
                style={{ paddingLeft: 8 + entry.depth * 8 + (entry.folder ? 0 : 16) }}
              >
                {entry.folder ? (
                  entry.open ? (
                    <ChevronDown size={16} className="flex-none" />
                  ) : (
                    <ChevronRight size={16} className="flex-none" />
                  )
                ) : (
                  <Glyph kind={entry.glyph} />
                )}
                <span
                  className={`ml-1.5 min-w-0 flex-1 truncate ${
                    entry.git === "M" ? "text-code-warning" : entry.git === "U" ? "text-code-added" : ""
                  }`}
                >
                  {entry.name}
                </span>
                {entry.git && (
                  <span className={`text-[11px] ${entry.git === "M" ? "text-code-warning" : "text-code-added"}`}>{entry.git}</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex h-[22px] items-center border-t border-code-border text-[11px] font-bold uppercase">
            <ChevronRight size={16} className="ml-0.5" />
            Outline
          </div>
          <div className="flex h-[22px] items-center border-t border-code-border text-[11px] font-bold uppercase">
            <ChevronRight size={16} className="ml-0.5" />
            Timeline
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[35px] flex-none bg-code-tab text-[13px]" aria-hidden="true">
            {[
              { name: "budget.controller.ts", active: false },
              { name: "budget.service.ts", active: true },
              { name: "budget.entity.ts", active: false },
            ].map((tab) => (
              <div
                key={tab.name}
                className={`flex items-center gap-1.5 border-r border-code-border pl-2.5 pr-2 ${
                  tab.active ? "bg-code-tab-active text-code-text" : "text-code-dim"
                }`}
              >
                <Glyph kind="ts" />
                <span className={tab.active ? "text-code-warning" : ""}>{tab.name}</span>
                <span className="grid size-5 place-items-center">{tab.active ? <span className="text-[10px]">●</span> : null}</span>
              </div>
            ))}
          </div>
          <div className="flex h-[22px] flex-none items-center gap-0.5 px-4 text-[13px] text-code-dim" aria-hidden="true">
            src <ChevronRight size={14} /> budget <ChevronRight size={14} /> <Glyph kind="ts" /> budget.service.ts{" "}
            <ChevronRight size={14} /> <span className="text-code-type">BudgetService</span>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-hidden pt-1 font-mono text-[14px] leading-[19px]">
              {LINES.map((tokens, index) => {
                const current = index + 1 === CURRENT_LINE;
                return (
                  <div key={index} className={`flex ${current ? "bg-code-line" : ""}`}>
                    <span
                      className={`flex-none select-none pr-[3ch] text-right ${current ? "text-code-gutter-active" : "text-code-gutter"}`}
                      style={{ width: gutter }}
                    >
                      {index + 1}
                    </span>
                    <code className="whitespace-pre">
                      <CodeLine tokens={tokens} />
                    </code>
                  </div>
                );
              })}
            </div>
            <div className="w-[70px] flex-none overflow-hidden pt-1 opacity-60" aria-hidden="true">
              {LINES.map((tokens, index) => (
                <div key={index} className="flex h-[3px] items-center">
                  {tokens.map((token, at) => (
                    <span
                      key={at}
                      className={`h-[2px] flex-none ${/^\s+$/.test(token.text) ? "" : MINIMAP[token.kind]}`}
                      style={{ width: token.text.length * 0.7 }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <section className="flex h-[180px] flex-none flex-col border-t border-code-border bg-code-panel" aria-hidden="true">
            <div className="flex h-[35px] flex-none items-center justify-between px-2 text-[11px] uppercase tracking-[0.02em]">
              <div className="flex h-full items-center">
                {["Problems", "Output", "Debug Console", "Terminal", "Ports"].map((label) => (
                  <span
                    key={label}
                    className={`flex h-full items-center border-b px-2.5 ${
                      label === "Terminal" ? "border-code-fg text-code-text" : "border-transparent text-code-dim"
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <span className="flex items-center gap-2 normal-case">
                <span className="text-[12px]">zsh</span>
                <X size={16} />
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden whitespace-pre px-5 font-mono text-[13px] leading-[19px] text-code-text">
              <div>
                <span className="text-code-added">➜</span> <span className="font-bold text-code-type">budget-api</span>{" "}
                <span className="text-code-keyword">git:(</span>
                <span className="text-code-error">feature/q4-variance</span>
                <span className="text-code-keyword">)</span> <span className="text-code-warning">✗</span> npm run test -- budget.service
              </div>
              <div> </div>
              {TERMINAL.map((line, index) => (
                <div key={index} className={line.startsWith(" PASS") ? "text-code-added" : line.includes("✓") ? "text-code-dim" : ""}>
                  {line || " "}
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
      <div
        className="flex h-[22px] flex-none items-center justify-between whitespace-nowrap bg-code-status px-2 text-[12px] text-code-status-fg"
        aria-hidden="true"
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <GitBranch size={13} /> feature/q4-variance*
          </span>
          <RefreshCw size={12} />
          <span className="flex items-center gap-1">
            <CircleX size={13} /> 0 <TriangleAlert size={13} className="ml-1" /> 0
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>Ln {CURRENT_LINE}, Col 18</span>
          <span className="max-[720px]:hidden">Spaces: 2</span>
          <span className="max-[560px]:hidden">UTF-8</span>
          <span className="max-[560px]:hidden">LF</span>
          <span>{"{ }"} TypeScript</span>
          <Bell size={13} />
        </div>
      </div>
    </div>
  );
}
