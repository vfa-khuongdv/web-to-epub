// The code skin's own palette entries (put in front of the shared ones), and the file list
// quick open (Ctrl/Cmd+P) searches.
import type { Translate } from "../../i18n";
import { PaletteCommand } from "../CommandPalette";
import { shortcut } from "./keys";

export interface CodeActions {
  nextFile: () => void;
  previousFile: () => void;
  togglePanel: () => void;
  toggleSidebar: () => void;
  quickOpen: () => void;
  closeEditor: () => void;
}

export function codeCommands(
  t: Translate,
  actions: CodeActions,
  state: { hasFile: boolean; hasNext: boolean; hasPrevious: boolean },
  mac?: boolean
): PaletteCommand[] {
  const list: PaletteCommand[] = [];
  if (state.hasNext) list.push({ id: "code-next", label: t("Next file"), hint: "]", run: actions.nextFile });
  if (state.hasPrevious) list.push({ id: "code-previous", label: t("Previous file"), hint: "[", run: actions.previousFile });
  list.push({ id: "code-quick-open", label: t("Go to file…"), hint: shortcut("Mod+P", mac), run: actions.quickOpen });
  list.push({ id: "code-panel", label: t("Toggle panel"), hint: shortcut("Mod+J", mac), run: actions.togglePanel });
  list.push({ id: "code-sidebar", label: t("Toggle sidebar"), hint: shortcut("Mod+B", mac), run: actions.toggleSidebar });
  if (state.hasFile) list.push({ id: "code-close", label: t("Close editor"), hint: shortcut("Mod+W", mac), run: actions.closeEditor });
  return list;
}

export interface QuickOpenFolder {
  storyId: string;
  folder: string;
  files: { order: number; name: string }[];
}

// Folders first (they open where the reader left off), then their files, the open
// folder's first. Capped: the palette draws every entry the query keeps.
export function fileCommands(
  folders: QuickOpenFolder[],
  open: { folder: (storyId: string) => void; file: (storyId: string, order: number) => void },
  limit = 1000
): PaletteCommand[] {
  const list: PaletteCommand[] = folders.map((entry) => ({
    id: `folder-${entry.storyId}`,
    label: `${entry.folder}/`,
    hint: "workspace",
    run: () => open.folder(entry.storyId),
  }));
  for (const entry of folders) {
    for (const file of entry.files) {
      if (list.length >= limit) return list;
      list.push({
        id: `file-${entry.storyId}-${file.order}`,
        label: file.name,
        hint: entry.folder,
        run: () => open.file(entry.storyId, file.order),
      });
    }
  }
  return list;
}
