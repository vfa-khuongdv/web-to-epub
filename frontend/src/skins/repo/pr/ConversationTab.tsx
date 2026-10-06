// A pull request's Conversation tab: the description, the timeline, the merge box (reviews,
// checks, conflicts, the merge button with its confirm step, then "Delete branch") and the
// comment box with "Close pull request" — beside the sidebar.

import { Check, ChevronDown, CircleAlert, GitMerge, GitPullRequestClosed, GitPullRequestDraft, X } from "lucide-react";
import { ReactNode, useRef, useState } from "react";
import { hashString } from "../../../lib/skins/hash";
import { Avatar, BTN, BTN_PRIMARY, FOCUS, INPUT, StatusIcon } from "../RepoChrome";
import { CommentForm } from "./CommentForm";
import { Sidebar } from "./Sidebar";
import { MergeMethod, PrAction, PrState, pendingCount, reviewDecision } from "./state";
import { TIMELINE, Timeline, TimelineComment } from "./Timeline";
import { ME, PullRequest } from "./types";
import { BranchName, Markdown, POPOVER, escapeCloses, useOutsideClick } from "./ui";

const METHODS: { id: MergeMethod; menu: string; button: string; confirm: string; text: string }[] = [
  {
    id: "merge",
    menu: "Create a merge commit",
    button: "Merge pull request",
    confirm: "Confirm merge",
    text: "All commits from this branch will be added to the base branch via a merge commit.",
  },
  {
    id: "squash",
    menu: "Squash and merge",
    button: "Squash and merge",
    confirm: "Confirm squash and merge",
    text: "The commits from this branch will be combined into one commit in the base branch.",
  },
  {
    id: "rebase",
    menu: "Rebase and merge",
    button: "Rebase and merge",
    confirm: "Confirm rebase and merge",
    text: "The commits from this branch will be rebased and added to the base branch.",
  },
];

function seconds(value: number): string {
  return value >= 60 ? `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, "0")}s` : `${value}s`;
}

function MergeRow({ icon, title, text, children }: { icon: ReactNode; title: string; text: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-t border-repo-border px-4 py-3 text-[14px] first:border-t-0">
      <span className="mt-0.5 flex-none">{icon}</span>
      <div className="min-w-0 flex-1">
        <b className="block">{title}</b>
        <span className="text-[12px] text-repo-muted">{text}</span>
      </div>
      {children}
    </div>
  );
}

const circle = (tone: string, icon: ReactNode) => <span className={`grid size-8 place-items-center rounded-full text-white ${tone}`}>{icon}</span>;

function MergeBox({
  pr,
  state,
  dispatch,
  onDetails,
}: {
  pr: PullRequest;
  state: PrState;
  dispatch: (action: PrAction) => void;
  onDetails: (jobId: string) => void;
}) {
  const [method, setMethod] = useState<MergeMethod>("squash");
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [cli, setCli] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useOutsideClick(menuBox, menu, () => setMenu(false));
  const chosen = METHODS.find((candidate) => candidate.id === method)!;
  const failing = pr.checks.filter((check) => check.status === "failure").length;
  const decision = reviewDecision(state.reviewers);
  const blocked = failing > 0 || decision === "changes_requested";
  const [title, setTitle] = useState(() =>
    method === "merge" ? `Merge pull request #${pr.number} from team/${pr.head}` : `${pr.title} (#${pr.number})`
  );
  const [body, setBody] = useState(() => pr.commits.map((commit) => `* ${commit.message}`).join("\n"));

  if (state.status === "merged") {
    return (
      <Shell tone="done" icon={<GitMerge size={22} />}>
        <MergeRow
          icon={circle("bg-repo-done-emphasis", <GitMerge size={16} />)}
          title="Pull request successfully merged and closed"
          text={
            state.branchDeleted ? (
              <>
                The <BranchName>{pr.head}</BranchName> branch has been deleted.
              </>
            ) : (
              <>
                You're all set — the <BranchName>{pr.head}</BranchName> branch can be safely deleted.
              </>
            )
          }
        >
          <button
            type="button"
            className={BTN}
            onClick={() => dispatch({ type: state.branchDeleted ? "restore-branch" : "delete-branch", branch: pr.head, at: Date.now() })}
          >
            {state.branchDeleted ? "Restore branch" : "Delete branch"}
          </button>
        </MergeRow>
      </Shell>
    );
  }
  if (state.status === "closed") {
    return (
      <Shell tone="danger" icon={<GitPullRequestClosed size={22} />}>
        <MergeRow
          icon={circle("bg-repo-danger-emphasis", <GitPullRequestClosed size={16} />)}
          title="Closed with unmerged commits"
          text={
            <>
              This pull request is closed, but the <BranchName>{pr.head}</BranchName> branch has unmerged commits.
            </>
          }
        />
      </Shell>
    );
  }

  const successful = pr.checks.length - failing;
  const merge = () => {
    dispatch({ type: "merge", sha: hashString(`${pr.number}:${title}:${body}`).toString(16).padStart(8, "0").slice(0, 7), at: Date.now() });
    setConfirming(false);
  };

  return (
    <Shell tone={state.draft || blocked ? "neutral" : "success"} icon={state.draft ? <GitPullRequestDraft size={22} /> : <GitMerge size={22} />}>
      {state.draft ? (
        <MergeRow
          icon={circle("bg-repo-neutral-emphasis", <GitPullRequestDraft size={16} />)}
          title="This pull request is still a work in progress"
          text="Draft pull requests cannot be merged."
        >
          <button type="button" className={BTN} onClick={() => dispatch({ type: "ready", at: Date.now() })}>
            Ready for review
          </button>
        </MergeRow>
      ) : (
        <MergeRow
          icon={
            decision === "approved"
              ? circle("bg-repo-success-btn", <Check size={16} strokeWidth={3} />)
              : decision === "changes_requested"
                ? circle("bg-repo-danger-emphasis", <X size={16} strokeWidth={3} />)
                : circle("bg-repo-attention-dot", <CircleAlert size={16} />)
          }
          title={decision === "approved" ? "Changes approved" : decision === "changes_requested" ? "Changes requested" : "Review required"}
          text={
            decision === "approved"
              ? `${state.reviewers.filter((reviewer) => reviewer.state === "approved").length} approving review by reviewers with write access.`
              : decision === "changes_requested"
                ? "A reviewer requested changes before this can be merged."
                : "At least 1 approving review is required by reviewers with write access."
          }
        />
      )}
      <MergeRow
        icon={failing ? circle("bg-repo-danger-emphasis", <X size={16} strokeWidth={3} />) : circle("bg-repo-success-btn", <Check size={16} strokeWidth={3} />)}
        title={failing ? "Some checks were not successful" : "All checks have passed"}
        text={failing ? `${failing} failing and ${successful} successful checks` : `${successful} successful checks`}
      >
        <button type="button" className={`text-[12px] text-repo-accent hover:underline ${FOCUS}`} aria-expanded={checksOpen} onClick={() => setChecksOpen(!checksOpen)}>
          {checksOpen ? "Hide all checks" : "Show all checks"}
        </button>
      </MergeRow>
      {checksOpen && (
        <ul className="border-t border-repo-border bg-repo-subtle text-[12px]">
          {pr.checks.map((check) => (
            <li key={check.id} className="flex items-center gap-2 border-t border-repo-border-muted px-4 py-2 first:border-t-0">
              <StatusIcon status={check.status} size={14} />
              <b className="min-w-0 truncate">
                {check.workflow} / {check.name} (pull_request)
              </b>
              <span className="truncate text-repo-muted">
                {check.status === "success" ? "Successful" : "Failing"} in {seconds(check.seconds)}
              </span>
              <button type="button" className={`ml-auto flex-none text-repo-accent hover:underline ${FOCUS}`} onClick={() => onDetails(check.id)}>
                Details
              </button>
            </li>
          ))}
        </ul>
      )}
      <MergeRow
        icon={circle("bg-repo-success-btn", <Check size={16} strokeWidth={3} />)}
        title="This branch has no conflicts with the base branch"
        text="Merging can be performed automatically."
      />
      <div className="border-t border-repo-border px-4 py-3">
        {confirming ? (
          <div className="space-y-2">
            <input aria-label="Commit message" className={`${INPUT} w-full font-semibold`} value={title} onChange={(event) => setTitle(event.target.value)} />
            <textarea
              aria-label="Extended description"
              className={`${INPUT} h-auto min-h-[100px] w-full py-2 font-repo-mono text-[12px]`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <p className="text-[12px] text-repo-muted">This commit will be authored by {ME}.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} onClick={merge}>
                {chosen.confirm}
              </button>
              <button type="button" className={BTN} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div ref={menuBox} className="relative" onKeyDown={menu ? escapeCloses(() => setMenu(false), menuButton) : undefined}>
              <span className="inline-flex">
                <button
                  type="button"
                  disabled={state.draft}
                  className={`${blocked ? BTN : BTN_PRIMARY} rounded-r-none`}
                  onClick={() => {
                    setTitle(method === "merge" ? `Merge pull request #${pr.number} from team/${pr.head}` : `${pr.title} (#${pr.number})`);
                    setConfirming(true);
                  }}
                >
                  {chosen.button}
                </button>
                <button
                  ref={menuButton}
                  type="button"
                  disabled={state.draft}
                  aria-label="Select merge method"
                  aria-expanded={menu}
                  aria-haspopup="menu"
                  className={`${blocked ? BTN : BTN_PRIMARY} rounded-l-none border-l-0 px-2`}
                  onClick={() => setMenu(!menu)}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              </span>
              {menu && (
                <ul role="menu" aria-label="Merge method" className={`${POPOVER} left-0 top-10 w-[340px] py-1`}>
                  {METHODS.map((candidate) => (
                    <li key={candidate.id} role="none">
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={candidate.id === method}
                        className={`flex w-full gap-2 px-3 py-2 text-left hover:bg-repo-btn-hover ${FOCUS}`}
                        onClick={() => {
                          setMethod(candidate.id);
                          setMenu(false);
                        }}
                      >
                        <span className="w-4 flex-none pt-0.5">{candidate.id === method && <Check size={16} aria-hidden="true" />}</span>
                        <span>
                          <b className="block text-[14px]">{candidate.menu}</b>
                          <span className="text-[12px] text-repo-muted">{candidate.text}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-[12px] text-repo-muted">
              You can also merge this with the command line.{" "}
              <button type="button" className={`text-repo-accent hover:underline ${FOCUS}`} aria-expanded={cli} onClick={() => setCli(!cli)}>
                {cli ? "Hide command line instructions." : "View command line instructions."}
              </button>
            </p>
          </div>
        )}
        {cli && !confirming && (
          <div className="mt-3 rounded-md border border-repo-border bg-repo-subtle p-3 text-[12px]">
            <p className="mb-1 font-semibold">Step 1: From your project repository, check out a new branch and test the changes.</p>
            <pre className="mb-3 overflow-x-auto font-repo-mono">{`git checkout -b ${pr.head} ${pr.base}\ngit pull origin ${pr.head}`}</pre>
            <p className="mb-1 font-semibold">Step 2: Merge the changes and update on the server.</p>
            <pre className="overflow-x-auto font-repo-mono">{`git checkout ${pr.base}\ngit merge --no-ff ${pr.head}\ngit push origin ${pr.base}`}</pre>
          </div>
        )}
      </div>
    </Shell>
  );
}

const SHELL_TONE = {
  success: { icon: "bg-repo-success-btn", rule: "border-repo-success-btn" },
  done: { icon: "bg-repo-done-emphasis", rule: "border-repo-done-emphasis" },
  danger: { icon: "bg-repo-danger-emphasis", rule: "border-repo-danger-emphasis" },
  neutral: { icon: "bg-repo-neutral-emphasis", rule: "border-repo-border" },
};

// The merge box's frame: the big icon on the left, a coloured border, the caret.
function Shell({ tone, icon, children }: { tone: keyof typeof SHELL_TONE; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="relative mb-4 mt-2 sm:pl-14" aria-label="Merge" role="region">
      <span className={`absolute left-0 top-0 hidden size-10 place-items-center rounded-md text-white sm:grid ${SHELL_TONE[tone].icon}`} aria-hidden="true">
        {icon}
      </span>
      <div className={`relative rounded-md border bg-repo-canvas ${SHELL_TONE[tone].rule}`}>
        <span aria-hidden="true" className={`absolute left-[-6px] top-[14px] hidden size-[11px] rotate-45 border-b border-l bg-repo-canvas sm:block ${SHELL_TONE[tone].rule}`} />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

export function ConversationTab({
  pr,
  state,
  dispatch,
  now,
  onDetails,
  development,
}: {
  pr: PullRequest;
  state: PrState;
  dispatch: (action: PrAction) => void;
  now: number;
  onDetails: (jobId: string) => void;
  development: ReactNode;
}) {
  const participants = [...new Set([pr.author, ...state.reviewers.map((reviewer) => reviewer.login), ...state.timeline.map((item) => item.author)])];
  const open = state.status === "open";
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_256px] lg:gap-8">
      <div className="min-w-0">
        <div className={TIMELINE}>
          <TimelineComment author={pr.author} at={pr.at} now={now} role="Author">
            <Markdown source={pr.body} />
          </TimelineComment>
          <Timeline
            items={state.timeline}
            kind="pr"
            author={pr.author}
            now={now}
            threads={state.threads}
            files={pr.files}
            commits={pr.commits}
            reviewing={pendingCount(state) > 0}
            dispatch={dispatch}
          />
        </div>
        <MergeBox pr={pr} state={state} dispatch={dispatch} onDetails={onDetails} />
        <div className="relative mt-6 border-t-2 border-repo-border pt-6 sm:pl-14">
          <span className="absolute left-0 top-6 hidden sm:block">
            <Avatar seed={ME} size={40} />
          </span>
          <h2 className="mb-2 text-[16px] font-semibold">Add a comment</h2>
          <CommentForm
            label="Add a comment"
            placeholder="Use Markdown to format your comment"
            onSubmit={({ text, reset }) => {
              dispatch({ type: "comment", body: text, at: Date.now() });
              reset();
            }}
            actions={({ text, reset }) => (
              <>
                {open && (
                  <button
                    type="button"
                    className={BTN}
                    onClick={() => {
                      dispatch({ type: "comment", body: text, at: Date.now(), close: true });
                      reset();
                    }}
                  >
                    <GitPullRequestClosed size={16} className="text-repo-danger" aria-hidden="true" />
                    {text.trim() ? "Close with comment" : "Close pull request"}
                  </button>
                )}
                {state.status === "closed" && (
                  <button
                    type="button"
                    className={BTN}
                    onClick={() => {
                      if (text.trim()) dispatch({ type: "comment", body: text, at: Date.now() });
                      dispatch({ type: "reopen", at: Date.now() });
                      reset();
                    }}
                  >
                    Reopen pull request
                  </button>
                )}
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={!text.trim()}
                  onClick={() => {
                    dispatch({ type: "comment", body: text, at: Date.now() });
                    reset();
                  }}
                >
                  Comment
                </button>
              </>
            )}
          />
        </div>
      </div>
      <Sidebar
        kind="pr"
        reviewers={state.reviewers}
        assignees={pr.assignees}
        labels={pr.labels}
        project={pr.project}
        milestone={pr.milestone}
        development={development}
        participants={participants}
        subscribed={state.subscribed}
        onSubscribe={(subscribed) => dispatch({ type: "subscribe", subscribed })}
      />
    </div>
  );
}
