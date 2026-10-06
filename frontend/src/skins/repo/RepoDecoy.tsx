// What the boss key shows in the code-hosting skin: pull request #482 of a made-up backend
// repository, under review — and it works like one. Its tabs switch, files can be marked
// viewed, lines commented, a review submitted, the pull request merged; all of it in this
// page's memory only (kept while the app stays open, so hiding again finds the review where
// it was). No story in it, nothing fetched, no link that leads anywhere: only the boss key
// brings the app back. Its keys reach it through StealthLayer (keys aimed inside the decoy
// are the decoy's) and stop at the decoy's frame.

import { ChartLine, CircleDot, CirclePlay, Code, GitPullRequest, Hexagon, Settings, Shield, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { GlobalHeader, UnderlineNav } from "./RepoChrome";
import { DECOY_REPO, decoyPull, fakeRepository } from "./pr/fakeData";
import { PullRequestPage } from "./pr/PullRequestPage";
import { LinkedItems } from "./pr/Sidebar";
import { PrState } from "./pr/state";

// The fake work is made once per app session, so its times age like a real page's and
// what was done on it survives the decoy being put away and shown again.
let born: number | null = null;
let saved: PrState | undefined;

function bornAt(): number {
  if (born === null) born = Date.now();
  return born;
}

export default function RepoDecoy() {
  const [now, setNow] = useState(() => Date.now());
  const [pr] = useState(() => decoyPull(bornAt()));
  const [repo] = useState(() => fakeRepository(bornAt()));
  const counts = {
    issues: repo.issues.filter((issue) => issue.state === "open").length,
    pulls: repo.pulls.filter((pull) => pull.state === "open").length,
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const tabs = [
    { id: "code", label: "Code", icon: <Code size={16} /> },
    { id: "issues", label: "Issues", icon: <CircleDot size={16} />, counter: counts.issues },
    { id: "pulls", label: "Pull requests", icon: <GitPullRequest size={16} />, counter: counts.pulls },
    { id: "actions", label: "Actions", icon: <CirclePlay size={16} /> },
    { id: "projects", label: "Projects", icon: <Table2 size={16} /> },
    { id: "security", label: "Security", icon: <Shield size={16} /> },
    { id: "insights", label: "Insights", icon: <ChartLine size={16} /> },
    { id: "settings", label: "Settings", icon: <Settings size={16} /> },
  ];

  return (
    <div data-decoy-focus="" tabIndex={-1} className="h-full overflow-y-auto bg-repo-canvas font-repo text-repo-fg outline-none">
      <GlobalHeader org="team" repo={DECOY_REPO}>
        <UnderlineNav label="Repository" tabs={tabs} current="pulls" />
      </GlobalHeader>
      <PullRequestPage
        pr={pr}
        now={now}
        saved={saved}
        onSave={(state) => {
          saved = state;
        }}
        development={
          <LinkedItems
            intro="Successfully merging this pull request may close these issues."
            items={pr.closes.map((number) => ({ kind: "issue" as const, number, title: repo.issues.find((issue) => issue.number === number)?.title ?? "" }))}
          />
        }
      />
      <footer className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 px-4 pb-10 pt-6 text-[12px] text-repo-muted md:px-6" aria-hidden="true">
        <Hexagon size={22} strokeWidth={1.75} />
        <span>© {new Date(now).getFullYear()} team</span>
        {["Terms", "Privacy", "Security", "Status", "Docs", "Contact"].map((name) => (
          <span key={name}>{name}</span>
        ))}
      </footer>
    </div>
  );
}
