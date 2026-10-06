import { Check } from "lucide-react";
import { BTN } from "./RepoChrome";
import { BRANCH } from "./repoModel";

// The Settings tab, drawn as a quiet repository would show it. Nothing here is a control:
// the name field is read-only and the buttons are pictures of buttons.

const SETTINGS_NAV = ["General", "Collaborators", "Branches", "Tags", "Rules", "Actions", "Webhooks", "Environments", "Pages"];

export function SettingsTab({ repo }: { repo: string }) {
  const danger = [
    { title: "Change repository visibility", text: "This repository is currently private.", action: "Change visibility" },
    { title: "Transfer ownership", text: "Move the repository to another owner.", action: "Transfer" },
    { title: "Archive this repository", text: "Make the repository read-only and hide it from active lists.", action: "Archive" },
    { title: "Delete this repository", text: "Removes the repository and its history permanently.", action: "Delete" },
  ];
  return (
    <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-hidden="true" className="hidden text-[14px] md:block">
        <ul className="space-y-0.5">
          {SETTINGS_NAV.map((name, index) => (
            <li
              key={name}
              className={`relative rounded-md px-2 py-1.5 ${
                index === 0 ? "bg-repo-btn-hover font-semibold before:absolute before:inset-y-1.5 before:-left-2 before:w-1 before:rounded-full before:bg-repo-accent" : ""
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 max-w-[760px] text-[14px]">
        <h2 className="mb-4 border-b border-repo-border pb-2 text-[24px] font-normal">General</h2>
        <label className="mb-1 block font-semibold" htmlFor="repo-settings-name">
          Repository name
        </label>
        <div className="mb-6 flex gap-2">
          <input
            id="repo-settings-name"
            readOnly
            value={repo}
            className="h-8 w-[280px] max-w-full rounded-md border border-repo-border bg-repo-input px-3 text-repo-fg outline-none"
          />
          <span className={BTN} aria-hidden="true">
            Rename
          </span>
        </div>
        <h3 className="mb-2 border-b border-repo-border pb-2 text-[20px] font-normal">Default branch</h3>
        <p className="mb-6 flex flex-wrap items-center gap-2 text-repo-muted">
          New pull requests and commits target this branch unless another one is chosen.
          <span className="rounded-md bg-repo-accent-soft px-1.5 font-repo-mono text-[12px] text-repo-accent">{BRANCH}</span>
        </p>
        <h3 className="mb-2 border-b border-repo-border pb-2 text-[20px] font-normal">Features</h3>
        <ul className="mb-8 space-y-3" aria-hidden="true">
          {[
            ["Wikis", false],
            ["Issues", true],
            ["Discussions", false],
            ["Projects", true],
          ].map(([name, on]) => (
            <li key={String(name)} className="flex items-center gap-2">
              <span
                className={`grid size-4 place-items-center rounded-[3px] border ${
                  on ? "border-repo-accent bg-repo-accent text-white" : "border-repo-border bg-repo-input"
                }`}
              >
                {on && <Check size={12} strokeWidth={3} />}
              </span>
              <b>{name}</b>
            </li>
          ))}
        </ul>
        <h3 className="mb-2 text-[20px] font-normal">Danger Zone</h3>
        <ul className="rounded-md border border-repo-danger" aria-hidden="true">
          {danger.map((row) => (
            <li key={row.title} className="flex items-center gap-4 border-t border-repo-border-muted px-4 py-3 first:border-t-0">
              <span className="min-w-0 flex-1">
                <b className="block">{row.title}</b>
                <span className="text-repo-muted">{row.text}</span>
              </span>
              <span className={`${BTN} text-repo-danger`}>{row.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
