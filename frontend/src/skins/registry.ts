import { lazy } from "react";
import { SkinId, faviconDataUri } from "../lib/ui/skin";
import ChatDecoy from "./chat/ChatDecoy";
import CodeDecoy from "./code/CodeDecoy";
import DocDecoy from "./default/DocDecoy";
import RepoDecoy from "./repo/RepoDecoy";
import SheetDecoy from "./sheet/SheetDecoy";
import TermDecoy from "./term/TermDecoy";
import { SkinDefinition } from "./types";

// Shells load on first use, so the default app does not carry them. Decoys load with the
// app: the boss key must swap the screen at once, never wait on a download.
const CodeShell = lazy(() => import("./code/CodeShell"));
const SheetShell = lazy(() => import("./sheet/SheetShell"));
const ChatShell = lazy(() => import("./chat/ChatShell"));
const TermShell = lazy(() => import("./term/TermShell"));
const RepoShell = lazy(() => import("./repo/RepoShell"));

// Generic glyphs on plain colours — never another product's logo or name.
export const CODE_ICON = faviconDataUri("{ }", "#0e639c");
export const SHEET_ICON = faviconDataUri("Σ", "#217346");
export const CHAT_ICON = faviconDataUri("@", "#4c55c7");
export const TERM_ICON = faviconDataUri(">_", "#2b2b2b");
export const REPO_ICON = faviconDataUri("◇", "#24292f");
const DOC_ICON = faviconDataUri("≡", "#2b579a");

export const SKINS: Record<SkinId, SkinDefinition> = {
  default: {
    id: "default",
    label: "Normal",
    head: { title: "Web → EPUB cho Kindle", favicon: "/favicon.svg" },
    decoy: { head: { title: "Biên bản họp giao ban – Tuần 40", favicon: DOC_ICON }, Component: DocDecoy },
  },
  code: {
    id: "code",
    label: "Code editor",
    head: { title: "Welcome — workspace", favicon: CODE_ICON },
    decoy: { head: { title: "budget.service.ts — workspace", favicon: CODE_ICON }, Component: CodeDecoy },
    Shell: CodeShell,
  },
  sheet: {
    id: "sheet",
    label: "Spreadsheet",
    head: { title: "Bao_cao_tong_hop.xlsx", favicon: SHEET_ICON },
    decoy: { head: { title: "Ngan_sach_Q4.xlsx", favicon: SHEET_ICON }, Component: SheetDecoy },
    Shell: SheetShell,
  },
  chat: {
    id: "chat",
    label: "Team chat",
    head: { title: "Chat", favicon: CHAT_ICON },
    decoy: { head: { title: "Chat – Dự án Cổng thanh toán", favicon: CHAT_ICON }, Component: ChatDecoy },
    Shell: ChatShell,
  },
  term: {
    id: "term",
    label: "Terminal",
    head: { title: "dev@workstation: ~/projects", favicon: TERM_ICON },
    decoy: { head: { title: "dev@workstation: ~/projects/budget-service", favicon: TERM_ICON }, Component: TermDecoy },
    Shell: TermShell,
  },
  repo: {
    id: "repo",
    label: "Code repository",
    head: { title: "Repositories", favicon: REPO_ICON },
    decoy: {
      head: { title: "feat(budget): báo cáo chênh lệch ngân sách theo quý by hoang-nm · Pull Request #482 · team/budget-service", favicon: REPO_ICON },
      Component: RepoDecoy,
    },
    Shell: RepoShell,
  },
};
