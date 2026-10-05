import { lazy } from "react";
import { SkinId, faviconDataUri } from "../lib/ui/skin";
import CodeDecoy from "./code/CodeDecoy";
import DocDecoy from "./default/DocDecoy";
import SheetDecoy from "./sheet/SheetDecoy";
import { SkinDefinition } from "./types";

// Shells load on first use, so the default app does not carry them. Decoys load with the
// app: the boss key must swap the screen at once, never wait on a download.
const CodeShell = lazy(() => import("./code/CodeShell"));
const SheetShell = lazy(() => import("./sheet/SheetShell"));

// Generic glyphs on plain colours — never another product's logo or name.
export const CODE_ICON = faviconDataUri("{ }", "#0e639c");
export const SHEET_ICON = faviconDataUri("Σ", "#217346");
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
};
