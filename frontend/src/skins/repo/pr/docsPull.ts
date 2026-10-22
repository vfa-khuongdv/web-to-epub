// The shell's own pull request: the newest downloaded part of the open repository proposed
// as "docs: add part-0012.md", its Files changed showing that file as added Markdown lines —
// a way to read it that looks like reviewing. Built from the same lines and the same file
// name as the file view (so neutral names hold, and a picture is a placeholder with no
// address); everything else on it is generic.

import { addedHunks } from "./diff";
import { CheckJob, PullRequest } from "./types";

// Above every made-up number, so it is the newest pull request in the list.
export const DOCS_PULL = 490;

function docsChecks(head: string, sha: string, at: number, file: string): CheckJob[] {
  const steps = [
    { name: "Set up job", seconds: 2, log: ["Runner: ci-runner-02 (linux, x64)", "Job: build", "Job is about to start running on the runner"] },
    { name: "Check out code", seconds: 2, log: ["Fetching the repository", `Checking out ${head}`, `HEAD is now at ${sha}`] },
    { name: "Lint Markdown", seconds: 4, log: ["$ npm run lint:docs", "", `Checked 1 changed file: ${file}`, "No problems found."] },
    { name: "Build site", seconds: 21, log: ["$ npm run build:docs", "", "Rendering pages", "Built in 20.4s"] },
    { name: "Complete job", seconds: 0, log: ["Cleaning up orphan processes"] },
  ];
  return [{ id: "docs-build", workflow: "Build docs", name: "build", status: "success", seconds: steps.reduce((sum, step) => sum + step.seconds, 0), at, steps }];
}

export function docsPull({ file, lines, sha, at }: { file: string; lines: string[]; sha: string; at: number }): PullRequest {
  const head = `docs/${file.replace(/\.md$/, "")}`;
  return {
    number: DOCS_PULL,
    title: `docs: add ${file}`,
    author: "team-bot",
    at,
    base: "main",
    head,
    state: "open",
    draft: false,
    body: `Adds \`${file}\`.\n\nOpened by the team's docs workflow. Review the text on **Files changed**.`,
    labels: [{ name: "documentation", tone: "blue" }],
    assignees: [],
    reviewers: [{ login: "dev", state: "requested" }],
    milestone: null,
    project: null,
    closes: [],
    commits: [{ sha, message: `docs: add ${file}`, author: "team-bot", at, status: "success" }],
    checks: docsChecks(head, sha, at, file),
    files: [{ path: file, status: "added", hunks: addedHunks(lines) }],
    timeline: [{ kind: "event", id: "e-docs-1", author: "team-bot", at, event: { type: "review_requested", who: "dev" } }],
    threads: [],
  };
}
