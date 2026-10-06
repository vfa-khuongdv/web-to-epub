// The made-up team repository behind the pull request and issue pages: a small accounting
// backend ("budget-service") with a few pull requests and issues in a Vietnamese office's
// voice. Written from scratch — the code in the diffs is invented, nothing is copied from
// a real project — and fixed, so every visit draws the same work. Times are worked out
// from `now`, so "3 hours ago" stays three hours ago.

import { HunkSpec, hunksFrom } from "./diff";
import {
  ChangedFile,
  CheckJob,
  Commit,
  FileStatus,
  Issue,
  IssueLabel,
  LineRef,
  PullRequest,
  ReviewThread,
  TimelineItem,
} from "./types";

export const DECOY_REPO = "budget-service";
export const DECOY_PULL = 482;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LABELS = {
  bug: { name: "bug", tone: "red" },
  enhancement: { name: "enhancement", tone: "cyan" },
  backend: { name: "backend", tone: "purple" },
  database: { name: "database", tone: "yellow" },
  techDebt: { name: "tech-debt", tone: "orange" },
  performance: { name: "performance", tone: "green" },
  docs: { name: "documentation", tone: "blue" },
  deps: { name: "dependencies", tone: "blue" },
  qa: { name: "needs-qa", tone: "gray" },
} satisfies Record<string, IssueLabel>;

export const ALL_LABELS: IssueLabel[] = Object.values(LABELS);

const Q4 = { title: "Q4/2026 – Chốt ngân sách", progress: 0.68 };
const SPRINT = "Sprint 41 · Kế toán";

// ---- Helpers ---------------------------------------------------------------------------

const lines = (text: string) => text.replace(/^\n/, "").replace(/\n$/, "").split("\n");

function changed(path: string, status: FileStatus, specs: HunkSpec[]): ChangedFile {
  return { path, status, hunks: hunksFrom(specs) };
}

function addedFile(path: string, text: string): ChangedFile {
  return changed(path, "added", [{ at: 0, lines: lines(text).map((line) => `+${line}`) }]);
}

// Where a line ends up in the new file, so a review comment can hang on it by its text.
export function lineOf(file: ChangedFile, text: string): LineRef {
  for (const hunk of file.hunks)
    for (const line of hunk.lines) if (line.kind !== "del" && line.text.includes(text)) return { path: file.path, side: "R", line: line.new ?? 1 };
  throw new Error(`No line "${text}" in ${file.path}`);
}

function ci(head: string, sha: string, at: number, failing: string | null = null): CheckJob[] {
  const setup = (name: string) => [
    { name: "Set up job", seconds: 2, log: ["Runner: ci-runner-04 (linux, x64)", "Image: node20-build:2026.09", `Job: ${name}`, "Prepare workflow directory", "Job is about to start running on the runner"] },
    { name: "Check out code", seconds: 3, log: ["Fetching the repository", `Checking out ${head}`, `HEAD is now at ${sha}`, "Cleaning the working tree"] },
    { name: "Set up Node 20", seconds: 4, log: ["Found in cache: node 20.17.0 x64", "Adding to the path", "node --version", "v20.17.0"] },
    { name: "Install dependencies", seconds: 19, log: ["$ npm ci --no-audit --prefer-offline", "", "added 612 packages in 18s", "", "94 packages are looking for funding"] },
  ];
  const teardown = [
    { name: "Post Check out code", seconds: 1, log: ["Removing credentials from the working tree", "Cleaning up orphan processes"] },
    { name: "Complete job", seconds: 0, log: ["Cleaning up orphan processes"] },
  ];
  const testLog =
    failing === "test"
      ? [
          "$ npm test -- --ci",
          "",
          " PASS  src/budget/budget.service.spec.ts",
          " PASS  src/invoice/invoice-period.spec.ts",
          " FAIL  src/report/quarterly-report.spec.ts",
          "  ● quarterly report › xuất đúng kỳ cho hoá đơn đầu tháng",
          "",
          "    expect(received).toMatchSnapshot()",
          "",
          "    Snapshot name: `quarterly report xuất đúng kỳ cho hoá đơn đầu tháng 1`",
          "",
          "    - Snapshot  - 1",
          "    + Received  + 1",
          "",
          '    -   "period": "2026-09",',
          '    +   "period": "2026-10",',
          "",
          "Tests:       1 failed, 127 passed, 128 total",
          "Snapshots:   1 failed, 14 passed, 15 total",
          "Time:        43.87 s",
          "Error: Process completed with exit code 1.",
        ]
      : [
          "$ npm test -- --ci",
          "",
          " PASS  src/budget/budget.service.spec.ts",
          " PASS  src/invoice/invoice-period.spec.ts",
          " PASS  src/report/quarterly-report.spec.ts",
          " PASS  src/common/money.spec.ts",
          "",
          "Test Suites: 31 passed, 31 total",
          "Tests:       132 passed, 132 total",
          "Snapshots:   15 passed, 15 total",
          "Time:        41.2 s",
        ];
  const job = (id: string, name: string, step: { name: string; seconds: number; log: string[] }, failed: boolean): CheckJob => {
    const steps = [...setup(name), step, ...teardown];
    return { id, workflow: "CI", name, status: failed ? "failure" : "success", seconds: steps.reduce((sum, item) => sum + item.seconds, 0), at, steps };
  };
  return [
    job("lint", "lint", { name: "Lint", seconds: 9, log: ["$ npm run lint", "", "> budget-service@1.14.0 lint", "> lint src test --max-warnings 0", "", "Checked 214 files in 8.6s. No problems found."] }, false),
    job("test", "test (20.x)", { name: "Run tests", seconds: failing === "test" ? 44 : 108, log: testLog }, failing === "test"),
    job("build", "build", { name: "Build", seconds: 38, log: ["$ npm run build", "", "> budget-service@1.14.0 build", "> tsc -p tsconfig.build.json", "", "Emitted 186 files to dist/", "Build finished in 37.4s"] }, false),
  ];
}

const commit = (sha: string, message: string, author: string, at: number, status: Commit["status"] = "success"): Commit => ({ sha, message, author, at, status });

// ---- #482: the variance report (the decoy's pull request) --------------------------------

function variancePull(now: number): PullRequest {
  const at = now - 26 * HOUR;
  const head = "feat/variance-report";
  const service = changed("src/budget/budget.service.ts", "modified", [
    {
      at: 1,
      lines: lines(`
 import { BudgetRepository } from './budget.repository';
 import { Budget, BudgetLine } from './budget.entity';
+import { VarianceReport, VarianceRow } from './dto/variance-report.dto';
+import { roundCurrency } from '../common/money';
 import { NotFoundError } from '../common/errors';

 export class BudgetService {
+  static readonly WARNING_THRESHOLD = 0.85;
+
   constructor(private readonly budgets: BudgetRepository) {}

   async findOne(id: string): Promise<Budget> {`),
    },
    {
      at: 12,
      section: "export class BudgetService {",
      lines: lines(`
   }

-  async variance(id: string) {
+  async variance(id: string): Promise<VarianceReport> {
     const budget = await this.findOne(id);
-    const spent = budget.lines.reduce((sum, line) => sum + line.actual, 0);
-    return { id, spent, ratio: spent / budget.allocated };
+    if (budget.lines.length === 0) {
+      return { id, quarter: budget.quarter, rows: [], spent: 0, ratio: null, warning: false };
+    }
+
+    const rows: VarianceRow[] = budget.lines.map((line) => this.toRow(line));
+    const spent = roundCurrency(rows.reduce((sum, row) => sum + row.actual, 0));
+    const ratio = budget.allocated > 0 ? spent / budget.allocated : null;
+    return {
+      id,
+      quarter: budget.quarter,
+      rows,
+      spent,
+      ratio,
+      warning: ratio !== null && ratio >= BudgetService.WARNING_THRESHOLD,
+    };
+  }
+
+  private toRow(line: BudgetLine): VarianceRow {
+    const actual = roundCurrency(line.actual);
+    return {
+      code: line.code,
+      name: line.name,
+      allocated: line.allocated,
+      actual,
+      variance: roundCurrency(line.allocated - actual),
+    };
   }
 }`),
    },
  ]);
  const routes = changed("src/budget/budget.routes.ts", "modified", [
    {
      at: 1,
      lines: lines(`
 import { Router } from '../http/router';
 import { BudgetService } from './budget.service';
+import { requireRole } from '../auth/require-role';

 export function budgetRoutes(router: Router, service: BudgetService) {
   router.get('/budgets', async (req) => service.list(req.query));`),
    },
    {
      at: 9,
      section: "export function budgetRoutes(router: Router, service: BudgetService) {",
      lines: lines(`
   router.patch('/budgets/:id', async (req) => service.update(req.params.id, req.body));
   router.delete('/budgets/:id', async (req) => service.remove(req.params.id));
+
+  router.get('/budgets/:id/variance', requireRole('accountant', 'manager'), async (req) => {
+    const report = await service.variance(req.params.id);
+    return { data: report };
+  });
 }`),
    },
  ]);
  const dto = addedFile(
    "src/budget/dto/variance-report.dto.ts",
    `
export interface VarianceRow {
  /** Mã dòng ngân sách, ví dụ: 6421-VPP */
  code: string;
  name: string;
  allocated: number;
  actual: number;
  /** Dương: còn dư; âm: đã chi vượt. */
  variance: number;
}

export interface VarianceReport {
  id: string;
  quarter: string;
  rows: VarianceRow[];
  spent: number;
  /**
   * Tỉ lệ đã chi trên tổng phân bổ.
   * null khi ngân sách chưa được phân bổ (allocated = 0) — báo cáo Excel hiển thị "–".
   */
  ratio: number | null;
  warning: boolean;
}`
  );
  const money = changed("src/common/money.ts", "modified", [
    {
      at: 1,
      lines: lines(`
-export function formatVnd(amount: number): string {
-  const rounded = Math.round(amount);
-  return rounded.toLocaleString('vi-VN') + ' ₫';
-}
+export type Currency = 'VND' | 'USD';
+
+/**
+ * Làm tròn số tiền theo đơn vị nhỏ nhất của tiền tệ.
+ * VND không có số lẻ nên làm tròn tới đồng; USD làm tròn tới cent.
+ */
+export function roundCurrency(amount: number, currency: Currency = 'VND'): number {
+  const factor = currency === 'VND' ? 1 : 100;
+  return Math.round((amount + Number.EPSILON) * factor) / factor;
+}
+
+export function formatVnd(amount: number): string {
+  return roundCurrency(amount).toLocaleString('vi-VN') + ' ₫';
+}

 export function sumAmounts(amounts: number[]): number {
-  return Math.round(amounts.reduce((total, value) => total + value, 0));
+  return roundCurrency(amounts.reduce((total, value) => total + value, 0));
 }`),
    },
  ]);
  const spec = changed("src/budget/budget.service.spec.ts", "modified", [
    {
      at: 41,
      section: "describe('BudgetService', () => {",
      lines: lines(`
     await expect(service.findOne('missing')).rejects.toThrow(NotFoundError);
   });

+  describe('variance', () => {
+    it('tính chênh lệch từng dòng và tổng đã chi', async () => {
+      repo.findById.mockResolvedValue(
+        budgetOf({ allocated: 100_000_000, lines: [line('6421-VPP', 30_000_000, 27_450_500.4)] }),
+      );
+
+      const report = await service.variance('b-1');
+
+      expect(report.rows[0]).toMatchObject({ actual: 27_450_500, variance: 2_549_500 });
+      expect(report.spent).toBe(27_450_500);
+      expect(report.warning).toBe(false);
+    });
+
+    it('cảnh báo khi đã chi từ 85% phân bổ', async () => {
+      repo.findById.mockResolvedValue(budgetOf({ allocated: 10_000_000, lines: [line('6427-DV', 10_000_000, 8_600_000)] }));
+
+      expect((await service.variance('b-2')).warning).toBe(true);
+    });
+
+    it('trả ratio null khi chưa phân bổ', async () => {
+      repo.findById.mockResolvedValue(budgetOf({ allocated: 0, lines: [line('6423-CT', 0, 1_200_000)] }));
+
+      expect((await service.variance('b-3')).ratio).toBeNull();
+    });
+
+    it('trả về rỗng khi ngân sách chưa có dòng nào', async () => {
+      repo.findById.mockResolvedValue(budgetOf({ allocated: 50_000_000, lines: [] }));
+
+      const report = await service.variance('b-4');
+
+      expect(report.rows).toEqual([]);
+      expect(report.ratio).toBeNull();
+    });
+  });
+
   describe('update', () => {
     it('không cho sửa ngân sách đã chốt', async () => {`),
    },
  ]);
  const migration = addedFile(
    "migrations/20261002_add_budget_line_code.sql",
    `
-- Mã dòng ngân sách để đối chiếu với sổ của phòng kế toán
ALTER TABLE budget_line ADD COLUMN code varchar(20);

UPDATE budget_line
SET code = account_no || '-' || upper(left(category, 3))
WHERE code IS NULL;

ALTER TABLE budget_line ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX budget_line_budget_id_code_idx ON budget_line (budget_id, code);`
  );

  const commits = [
    commit("a1c9e3f", "feat(budget): thêm endpoint báo cáo chênh lệch", "hoang-nm", at),
    commit("c4f81aa", "refactor(money): tách hàm làm tròn tiền tệ", "hoang-nm", at + 40 * MINUTE),
    commit("7b20d4e", "test(budget): bổ sung test cho variance", "hoang-nm", now - 3 * HOUR - 20 * MINUTE),
    commit("09de6b2", "fix(budget): ngân sách chưa có dòng chi thì trả về rỗng", "hoang-nm", now - 3 * HOUR),
    commit("5e7a1d0", "docs(budget): ghi chú ratio null cho báo cáo Excel", "hoang-nm", now - 35 * MINUTE),
  ];
  const threads: ReviewThread[] = [
    {
      id: "t-482-ratio",
      ref: lineOf(service, "const ratio = budget.allocated > 0"),
      resolved: false,
      comments: [
        {
          id: "c-482-1",
          author: "lan-pt",
          at: now - 2 * HOUR,
          pending: false,
          body: "Chỗ này `allocated = 0` thì trả `null`, nhưng file Excel bên kế toán đang đọc `ratio` như số. Anh ghi chú vào `VarianceReport` giúp em để bên đó biết hiển thị \"–\" nhé?",
        },
        { id: "c-482-2", author: "hoang-nm", at: now - 1 * HOUR, pending: false, body: "Hợp lý, để anh thêm JSDoc ở DTO và báo anh Tuấn bên báo cáo." },
        { id: "c-482-3", author: "lan-pt", at: now - 48 * MINUTE, pending: false, body: "Ok anh, sửa xong em approve nhé." },
      ],
    },
    {
      id: "t-482-index",
      ref: lineOf(migration, "CREATE UNIQUE INDEX"),
      resolved: true,
      comments: [
        {
          id: "c-482-4",
          author: "tuan-vd",
          at: now - 50 * MINUTE,
          pending: false,
          body: "Index unique theo `(budget_id, code)` ổn, nhưng dữ liệu cũ có mã trùng không anh? Đã chạy thử trên bản sao prod chưa?",
        },
        { id: "c-482-5", author: "hoang-nm", at: now - 40 * MINUTE, pending: false, body: "Chạy trên bản sao hôm thứ Sáu rồi, không có bản ghi trùng." },
      ],
    },
  ];
  const timeline: TimelineItem[] = [
    { kind: "event", id: "e-482-1", author: "hoang-nm", at: at + 2 * MINUTE, event: { type: "review_requested", who: "lan-pt" } },
    { kind: "event", id: "e-482-2", author: "hoang-nm", at: at + 2 * MINUTE, event: { type: "labeled", labels: ["enhancement", "backend"] } },
    { kind: "event", id: "e-482-3", author: "hoang-nm", at: at + 3 * MINUTE, event: { type: "milestoned", milestone: Q4.title } },
    { kind: "commits", id: "k-482-1", author: "hoang-nm", at: now - 3 * HOUR, shas: ["7b20d4e", "09de6b2"] },
    { kind: "review", id: "r-482-1", author: "lan-pt", at: now - 2 * HOUR, state: "commented", body: "", threadIds: ["t-482-ratio"] },
    { kind: "event", id: "e-482-4", author: "hoang-nm", at: now - 55 * MINUTE, event: { type: "review_requested", who: "tuan-vd" } },
    { kind: "commits", id: "k-482-2", author: "hoang-nm", at: now - 35 * MINUTE, shas: ["5e7a1d0"] },
    {
      kind: "review",
      id: "r-482-2",
      author: "tuan-vd",
      at: now - 20 * MINUTE,
      state: "approved",
      body: "Đã đối chiếu số Q3 với file của chị Lan bên kế toán, khớp hết. LGTM.",
      threadIds: ["t-482-index"],
    },
    { kind: "comment", id: "m-482-1", author: "lan-pt", at: now - 9 * MINUTE, body: "@hoang-nm em chạy lại trên staging xong sẽ approve, chắc trước 5h chiều nay." },
  ];
  return {
    number: DECOY_PULL,
    title: "feat(budget): báo cáo chênh lệch ngân sách theo quý",
    author: "hoang-nm",
    at,
    base: "main",
    head,
    state: "open",
    draft: false,
    body: [
      "## Mô tả",
      "Thêm API báo cáo chênh lệch giữa ngân sách phân bổ và chi thực tế cho từng phòng ban, gom theo quý. Phòng kế toán cần số này trước kỳ chốt sổ ngày 15.",
      "",
      "- `GET /budgets/:id/variance` trả chênh lệch theo từng dòng ngân sách",
      "- Cảnh báo khi chi vượt 85% phân bổ (`WARNING_THRESHOLD`)",
      "- Làm tròn tiền qua `roundCurrency` — VND không có số lẻ",
      "- Migration thêm cột `code` cho `budget_line`",
      "",
      "## Kiểm thử",
      "- [x] Unit test cho `BudgetService.variance`",
      "- [x] Chạy lại migration trên bản sao staging",
      "- [ ] Đối chiếu số liệu Q3 với file của kế toán",
      "",
      "Closes #471",
    ].join("\n"),
    labels: [LABELS.enhancement, LABELS.backend],
    assignees: ["hoang-nm"],
    reviewers: [
      { login: "lan-pt", state: "commented" },
      { login: "tuan-vd", state: "approved" },
    ],
    milestone: Q4,
    project: SPRINT,
    closes: [471],
    commits,
    checks: ci(head, "5e7a1d0", now - 30 * MINUTE),
    files: [service, routes, dto, money, spec, migration],
    timeline,
    threads,
  };
}

// ---- The other pull requests --------------------------------------------------------------

function invoicePull(now: number): PullRequest {
  const at = now - 5 * HOUR;
  const head = "fix/invoice-period-timezone";
  const period = changed("src/invoice/invoice-period.ts", "modified", [
    {
      at: 1,
      lines: lines(`
-export function periodOf(date: Date): { from: Date; to: Date } {
-  const from = new Date(date.getFullYear(), date.getMonth(), 1);
-  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
-  return { from, to };
-}
+const VN_OFFSET_MINUTES = 7 * 60;
+
+/**
+ * Kỳ hoá đơn tính theo giờ Việt Nam (UTC+7), không theo múi giờ của máy chủ.
+ * Máy chủ chạy UTC nên hoá đơn lúc 0h–7h ngày 1 từng bị tính sang tháng trước.
+ */
+export function periodOf(date: Date): { from: Date; to: Date } {
+  const local = new Date(date.getTime() + VN_OFFSET_MINUTES * 60_000);
+  const year = local.getUTCFullYear();
+  const month = local.getUTCMonth();
+  const from = Date.UTC(year, month, 1) - VN_OFFSET_MINUTES * 60_000;
+  const to = Date.UTC(year, month + 1, 1) - VN_OFFSET_MINUTES * 60_000 - 1;
+  return { from: new Date(from), to: new Date(to) };
+}`),
    },
  ]);
  const periodSpec = changed("src/invoice/invoice-period.spec.ts", "modified", [
    {
      at: 1,
      lines: lines(`
 import { periodOf } from './invoice-period';

 describe('periodOf', () => {
-  it('trả về tháng của ngày truyền vào', () => {
-    const { from } = periodOf(new Date(2026, 8, 15));
-    expect(from.getDate()).toBe(1);
+  it('hoá đơn 0h30 ngày 1/10 giờ VN thuộc kỳ tháng 10', () => {
+    const { from, to } = periodOf(new Date('2026-09-30T17:30:00Z'));
+
+    expect(from.toISOString()).toBe('2026-09-30T17:00:00.000Z');
+    expect(to.toISOString()).toBe('2026-10-31T16:59:59.999Z');
   });
 });`),
    },
  ]);
  return {
    number: 481,
    title: "fix(invoice): sai kỳ hoá đơn xuất lúc nửa đêm cuối tháng",
    author: "minh-dq",
    at,
    base: "main",
    head,
    state: "open",
    draft: false,
    body: "Hoá đơn xuất từ 0h đến 7h sáng ngày 1 bị tính vào kỳ tháng trước vì máy chủ chạy giờ UTC.\n\n- Tính kỳ theo UTC+7\n- Sửa test cũ phụ thuộc giờ máy\n\nFixes #480",
    labels: [LABELS.bug, LABELS.backend],
    assignees: ["minh-dq"],
    reviewers: [{ login: "hoang-nm", state: "changes_requested" }],
    milestone: Q4,
    project: SPRINT,
    closes: [480],
    commits: [
      commit("e81b0c2", "fix(invoice): tính kỳ hoá đơn theo giờ Việt Nam", "minh-dq", at),
      commit("3fa9d71", "test(invoice): bỏ test phụ thuộc múi giờ máy", "minh-dq", at + 25 * MINUTE, "failure"),
    ],
    checks: ci(head, "3fa9d71", at + 30 * MINUTE, "test"),
    files: [period, periodSpec],
    timeline: [
      { kind: "event", id: "e-481-1", author: "minh-dq", at: at + MINUTE, event: { type: "review_requested", who: "hoang-nm" } },
      { kind: "event", id: "e-481-2", author: "minh-dq", at: at + MINUTE, event: { type: "labeled", labels: ["bug", "backend"] } },
      {
        kind: "review",
        id: "r-481-1",
        author: "hoang-nm",
        at: now - 4 * HOUR,
        state: "changes_requested",
        body: "Logic ổn, nhưng `test (20.x)` đang đỏ vì snapshot báo cáo quý cũ vẫn dùng giờ máy. Em cập nhật snapshot rồi push lại nhé.",
        threadIds: [],
      },
      { kind: "comment", id: "m-481-1", author: "minh-dq", at: now - 3 * HOUR, body: "Dạ em sửa trong chiều nay ạ." },
    ],
    threads: [],
  };
}

function depsPull(now: number): PullRequest {
  const at = now - 3 * DAY;
  const head = "deps/money-format-1.6.0";
  return {
    number: 479,
    title: "chore(deps): bump money-format from 1.4.2 to 1.6.0",
    author: "team-bot",
    at,
    base: "main",
    head,
    state: "merged",
    draft: false,
    body: "Bumps money-format from 1.4.2 to 1.6.0.\n\n- Thêm làm tròn theo đơn vị tiền tệ\n- Sửa lỗi định dạng số âm\n\nThis pull request was opened by the team's dependency bot.",
    labels: [LABELS.deps],
    assignees: [],
    reviewers: [{ login: "tuan-vd", state: "approved" }],
    milestone: null,
    project: null,
    closes: [],
    commits: [commit("b7d204e", "chore(deps): bump money-format from 1.4.2 to 1.6.0", "team-bot", at)],
    checks: ci(head, "b7d204e", at + 5 * MINUTE),
    files: [
      changed("package.json", "modified", [
        {
          at: 21,
          lines: lines(`
   "dependencies": {
     "csv-stream": "^0.9.1",
     "date-kit": "^3.2.0",
-    "money-format": "^1.4.2",
+    "money-format": "^1.6.0",
     "sql-runner": "^4.11.0",
     "xlsx-writer": "^2.3.1"
   },`),
        },
      ]),
    ],
    timeline: [
      { kind: "event", id: "e-479-1", author: "team-bot", at: at + MINUTE, event: { type: "labeled", labels: ["dependencies"] } },
      { kind: "review", id: "r-479-1", author: "tuan-vd", at: at + 2 * HOUR, state: "approved", body: "", threadIds: [] },
      { kind: "event", id: "e-479-2", author: "tuan-vd", at: at + 2 * HOUR + MINUTE, event: { type: "merged", sha: "c02f6a9", base: "main" } },
      { kind: "event", id: "e-479-3", author: "tuan-vd", at: at + 2 * HOUR + 2 * MINUTE, event: { type: "branch_deleted", branch: head } },
    ],
    threads: [],
  };
}

function approvalPull(now: number): PullRequest {
  const at = now - 2 * DAY;
  const head = "feat/multi-level-approval";
  return {
    number: 476,
    title: "feat(approval): luồng duyệt chi nhiều cấp",
    author: "thu-ha",
    at,
    base: "main",
    head,
    state: "open",
    draft: true,
    body: "Bản nháp luồng duyệt chi theo hạn mức:\n\n1. Dưới 20 triệu: trưởng phòng duyệt\n2. Từ 20 đến 100 triệu: thêm kế toán trưởng\n3. Trên 100 triệu: thêm giám đốc\n\nCòn thiếu: gửi thông báo, giao diện duyệt.",
    labels: [LABELS.enhancement],
    assignees: ["thu-ha"],
    reviewers: [],
    milestone: Q4,
    project: SPRINT,
    closes: [],
    commits: [commit("6c1e8b3", "feat(approval): mô hình bước duyệt theo hạn mức", "thu-ha", at)],
    checks: ci(head, "6c1e8b3", at + 6 * MINUTE),
    files: [
      addedFile(
        "src/approval/approval-flow.ts",
        `
export type Approver = 'department_head' | 'chief_accountant' | 'director';

const LIMITS: { upTo: number; approvers: Approver[] }[] = [
  { upTo: 20_000_000, approvers: ['department_head'] },
  { upTo: 100_000_000, approvers: ['department_head', 'chief_accountant'] },
  { upTo: Infinity, approvers: ['department_head', 'chief_accountant', 'director'] },
];

/** Những người phải duyệt một khoản chi, theo thứ tự. */
export function approversFor(amount: number): Approver[] {
  const rule = LIMITS.find((limit) => amount <= limit.upTo);
  return rule ? rule.approvers : LIMITS[LIMITS.length - 1].approvers;
}

export function nextApprover(amount: number, approved: Approver[]): Approver | null {
  return approversFor(amount).find((approver) => !approved.includes(approver)) ?? null;
}`
      ),
      addedFile(
        "migrations/20261004_create_approval_step.sql",
        `
CREATE TABLE approval_step (
  id uuid PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES expense (id) ON DELETE CASCADE,
  approver varchar(32) NOT NULL,
  approved_at timestamptz,
  note text
);

CREATE INDEX approval_step_expense_id_idx ON approval_step (expense_id);`
      ),
    ],
    timeline: [{ kind: "event", id: "e-476-1", author: "thu-ha", at: at + MINUTE, event: { type: "labeled", labels: ["enhancement"] } }],
    threads: [],
  };
}

function reportPull(now: number): PullRequest {
  const at = now - 5 * DAY;
  const head = "refactor/department-report-query";
  return {
    number: 474,
    title: "refactor(report): bỏ query N+1 ở báo cáo phòng ban",
    author: "tuan-vd",
    at,
    base: "main",
    head,
    state: "merged",
    draft: false,
    body: "Báo cáo phòng ban đang gọi một query cho mỗi phòng (42 phòng = 43 query). Gộp lại thành một query có `GROUP BY`.\n\nThời gian trả về trên staging: 2,8 s → 180 ms.",
    labels: [LABELS.performance, LABELS.database],
    assignees: ["tuan-vd"],
    reviewers: [{ login: "hoang-nm", state: "approved" }],
    milestone: null,
    project: null,
    closes: [475],
    commits: [
      commit("91aa3c0", "refactor(report): gộp query tổng chi theo phòng ban", "tuan-vd", at),
      commit("d4e7f12", "test(report): thêm test cho phòng chưa có khoản chi", "tuan-vd", at + 3 * HOUR),
    ],
    checks: ci(head, "d4e7f12", at + 3 * HOUR + 5 * MINUTE),
    files: [
      changed("src/report/department-report.ts", "modified", [
        {
          at: 8,
          section: "export async function departmentReport(db: Db, year: number) {",
          lines: lines(`
   const departments = await db.query<Department>('SELECT id, name FROM department ORDER BY name');
-  const rows = [];
-  for (const department of departments) {
-    const [total] = await db.query<{ spent: number }>(
-      'SELECT sum(amount) AS spent FROM expense WHERE department_id = $1 AND fiscal_year = $2',
-      [department.id, year],
-    );
-    rows.push({ ...department, spent: total?.spent ?? 0 });
-  }
-  return rows;
+  const totals = await db.query<{ department_id: string; spent: number }>(
+    'SELECT department_id, sum(amount) AS spent FROM expense WHERE fiscal_year = $1 GROUP BY department_id',
+    [year],
+  );
+  const spentBy = new Map(totals.map((total) => [total.department_id, Number(total.spent)]));
+  return departments.map((department) => ({ ...department, spent: spentBy.get(department.id) ?? 0 }));
 }`),
        },
      ]),
    ],
    timeline: [
      { kind: "event", id: "e-474-1", author: "tuan-vd", at: at + MINUTE, event: { type: "labeled", labels: ["performance", "database"] } },
      { kind: "review", id: "r-474-1", author: "hoang-nm", at: at + 5 * HOUR, state: "approved", body: "Gọn hơn nhiều. Nhớ `Number()` vì driver trả `sum` dạng chuỗi — đã có rồi, ok.", threadIds: [] },
      { kind: "event", id: "e-474-2", author: "tuan-vd", at: at + 6 * HOUR, event: { type: "merged", sha: "7e3b9d4", base: "main" } },
    ],
    threads: [],
  };
}

function readmePull(now: number): PullRequest {
  const at = now - 8 * DAY;
  const head = "docs/local-setup";
  return {
    number: 470,
    title: "docs: cập nhật hướng dẫn chạy local",
    author: "lan-pt",
    at,
    base: "main",
    head,
    state: "closed",
    draft: false,
    body: "Bổ sung bước tạo database mẫu và biến môi trường cần thiết.",
    labels: [LABELS.docs],
    assignees: [],
    reviewers: [{ login: "hoang-nm", state: "commented" }],
    milestone: null,
    project: null,
    closes: [],
    commits: [commit("2b5c8e1", "docs: hướng dẫn tạo database mẫu", "lan-pt", at)],
    checks: ci(head, "2b5c8e1", at + 4 * MINUTE),
    files: [
      changed("README.md", "modified", [
        {
          at: 12,
          section: "## Chạy ở máy cá nhân",
          lines: lines(`
 ## Chạy ở máy cá nhân

-1. Cài dependencies và chạy \`npm run dev\`.
+1. Cài dependencies: \`npm ci\`
+2. Tạo database mẫu: \`npm run db:seed\` (cần biến \`DATABASE_URL\`, xem \`.env.example\`)
+3. Chạy \`npm run dev\` rồi mở http://localhost:3000/health

 ## Kiểm thử`),
        },
      ]),
    ],
    timeline: [
      { kind: "review", id: "r-470-1", author: "hoang-nm", at: at + 4 * HOUR, state: "commented", body: "Phần này đã có trong wiki nội bộ rồi em, mình để một chỗ thôi cho khỏi lệch nhé.", threadIds: [] },
      { kind: "comment", id: "m-470-1", author: "lan-pt", at: at + 5 * HOUR, body: "Dạ vâng, em đóng PR này." },
      { kind: "event", id: "e-470-1", author: "lan-pt", at: at + 5 * HOUR + MINUTE, event: { type: "closed" } },
    ],
    threads: [],
  };
}

// ---- Issues ---------------------------------------------------------------------------

function issue(fields: Omit<Issue, "milestone" | "project" | "timeline"> & Partial<Pick<Issue, "milestone" | "project" | "timeline">>): Issue {
  return { milestone: null, project: null, timeline: [], ...fields };
}

function issues(now: number): Issue[] {
  return [
    issue({
      number: 483,
      title: "Báo cáo chênh lệch hiển thị sai khi phòng ban chưa có ngân sách",
      author: "lan-pt",
      at: now - 70 * MINUTE,
      state: "open",
      body: "Phòng Hành chính chưa được phân bổ Q4 nhưng báo cáo hiện tỉ lệ đã chi **0%**, bên kế toán tưởng là chưa chi đồng nào.\n\n**Mong muốn:** hiện \"–\" khi chưa phân bổ.",
      labels: [LABELS.bug],
      assignees: ["hoang-nm"],
      milestone: Q4,
      timeline: [
        { kind: "event", id: "e-483-1", author: "lan-pt", at: now - 69 * MINUTE, event: { type: "assigned", who: "hoang-nm" } },
        { kind: "event", id: "e-483-2", author: "hoang-nm", at: now - 30 * MINUTE, event: { type: "referenced", number: 482, title: "feat(budget): báo cáo chênh lệch ngân sách theo quý" } },
      ],
    }),
    issue({
      number: 480,
      title: "Hoá đơn xuất lúc nửa đêm ngày 1 bị tính vào kỳ tháng trước",
      author: "minh-dq",
      at: now - DAY - 3 * HOUR,
      state: "open",
      body: "Các bước tái hiện:\n1. Xuất hoá đơn lúc 0h30 ngày 1/10\n2. Mở báo cáo kỳ tháng 10\n\nHoá đơn nằm trong kỳ tháng 9.",
      labels: [LABELS.bug, LABELS.backend],
      assignees: ["minh-dq"],
      milestone: Q4,
      project: SPRINT,
      timeline: [
        { kind: "comment", id: "m-480-1", author: "hoang-nm", at: now - DAY, body: "Máy chủ chạy UTC nên `new Date(y, m, 1)` lệch 7 tiếng. Em xử lý giúp anh nhé @minh-dq." },
        { kind: "comment", id: "m-480-2", author: "minh-dq", at: now - 23 * HOUR, body: "Dạ, em nhận." },
        { kind: "event", id: "e-480-1", author: "minh-dq", at: now - 5 * HOUR, event: { type: "referenced", number: 481, title: "fix(invoice): sai kỳ hoá đơn xuất lúc nửa đêm cuối tháng" } },
      ],
    }),
    issue({
      number: 478,
      title: "Gửi email cảnh báo khi chi vượt 85% ngân sách",
      author: "tuan-vd",
      at: now - 2 * DAY - 6 * HOUR,
      state: "open",
      body: "Trưởng phòng muốn nhận email khi phòng mình chi quá 85% ngân sách quý.\n\n- [ ] Ngưỡng cấu hình được\n- [ ] Mỗi quý chỉ gửi một lần cho mỗi ngưỡng\n- [ ] Mẫu email tiếng Việt",
      labels: [LABELS.enhancement],
      assignees: [],
      milestone: Q4,
      timeline: [
        { kind: "comment", id: "m-478-1", author: "lan-pt", at: now - 2 * DAY, body: "Bên kế toán cũng cần nhận bản sao ạ." },
        { kind: "comment", id: "m-478-2", author: "tuan-vd", at: now - 2 * DAY + 2 * HOUR, body: "Ok, thêm danh sách CC theo phòng ban." },
        { kind: "comment", id: "m-478-3", author: "hoang-nm", at: now - DAY - 2 * HOUR, body: "Chờ #482 merge rồi dùng lại `WARNING_THRESHOLD`." },
      ],
    }),
    issue({
      number: 477,
      title: "Chuẩn hoá làm tròn tiền VND toàn hệ thống",
      author: "hoang-nm",
      at: now - 3 * DAY,
      state: "open",
      body: "Đang có ít nhất ba kiểu làm tròn khác nhau (`Math.round`, `toFixed(0)`, cắt phần lẻ). Gom về một hàm `roundCurrency`.",
      labels: [LABELS.techDebt],
      assignees: ["hoang-nm"],
      timeline: [
        { kind: "event", id: "e-477-1", author: "hoang-nm", at: now - 26 * HOUR, event: { type: "referenced", number: 482, title: "feat(budget): báo cáo chênh lệch ngân sách theo quý" } },
      ],
    }),
    issue({
      number: 475,
      title: "API /budgets chậm khi lọc theo năm tài chính",
      author: "thu-ha",
      at: now - 6 * DAY,
      state: "closed",
      body: "`GET /budgets?fiscalYear=2026` mất khoảng 3 giây trên staging.",
      labels: [LABELS.performance, LABELS.database],
      assignees: ["tuan-vd"],
      timeline: [
        { kind: "comment", id: "m-475-1", author: "tuan-vd", at: now - 6 * DAY + 3 * HOUR, body: "Nguyên nhân là báo cáo phòng ban gọi query trong vòng lặp, để em gộp lại." },
        { kind: "event", id: "e-475-1", author: "tuan-vd", at: now - 5 * DAY + 6 * HOUR, event: { type: "closed", reason: "completed" } },
      ],
    }),
    issue({
      number: 471,
      title: "Báo cáo chênh lệch ngân sách theo quý cho phòng kế toán",
      author: "lan-pt",
      at: now - 7 * DAY,
      state: "open",
      body: "Phòng kế toán cần báo cáo chênh lệch giữa phân bổ và thực chi theo từng dòng ngân sách, gom theo quý, để chốt sổ ngày 15 hằng tháng.\n\nCột cần có: mã dòng, tên dòng, phân bổ, thực chi, chênh lệch.",
      labels: [LABELS.enhancement, LABELS.qa],
      assignees: ["hoang-nm"],
      milestone: Q4,
      project: SPRINT,
      timeline: [
        { kind: "event", id: "e-471-1", author: "hoang-nm", at: now - 7 * DAY + HOUR, event: { type: "assigned", who: "hoang-nm" } },
        { kind: "comment", id: "m-471-1", author: "hoang-nm", at: now - 6 * DAY, body: "Anh làm trong sprint này, cần thêm cột `code` cho `budget_line` trước." },
        { kind: "event", id: "e-471-2", author: "hoang-nm", at: now - 26 * HOUR, event: { type: "referenced", number: 482, title: "feat(budget): báo cáo chênh lệch ngân sách theo quý" } },
      ],
    }),
    issue({
      number: 468,
      title: "Lỗi 500 khi xoá dòng ngân sách đã có chứng từ",
      author: "minh-dq",
      at: now - 10 * DAY,
      state: "closed",
      body: "Xoá dòng ngân sách đã gắn chứng từ thì API trả 500 thay vì báo lỗi rõ ràng.",
      labels: [LABELS.bug],
      assignees: ["minh-dq"],
      timeline: [
        { kind: "comment", id: "m-468-1", author: "minh-dq", at: now - 9 * DAY, body: "Đã trả 409 kèm thông báo \"Dòng ngân sách đã có chứng từ, không thể xoá\"." },
        { kind: "event", id: "e-468-1", author: "minh-dq", at: now - 9 * DAY + MINUTE, event: { type: "closed", reason: "completed" } },
      ],
    }),
    issue({
      number: 465,
      title: "Tài liệu API cho nhóm tích hợp ERP",
      author: "tuan-vd",
      at: now - 13 * DAY,
      state: "closed",
      body: "Nhóm ERP cần danh sách endpoint và ví dụ request/response.",
      labels: [LABELS.docs],
      assignees: [],
      timeline: [
        { kind: "comment", id: "m-465-1", author: "hoang-nm", at: now - 12 * DAY, body: "Bên ERP chuyển sang đọc file xuất hằng đêm rồi, không cần API nữa." },
        { kind: "event", id: "e-465-1", author: "tuan-vd", at: now - 12 * DAY + HOUR, event: { type: "closed", reason: "not_planned" } },
      ],
    }),
  ];
}

export interface FakeRepository {
  pulls: PullRequest[];
  issues: Issue[];
}

export function fakeRepository(now: number): FakeRepository {
  return {
    pulls: [variancePull(now), invoicePull(now), depsPull(now), approvalPull(now), reportPull(now), readmePull(now)],
    issues: issues(now),
  };
}

export function decoyPull(now: number): PullRequest {
  return variancePull(now);
}
