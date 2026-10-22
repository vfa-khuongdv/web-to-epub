// The terminal's own palette commands, shown before the ones every skin has.
import { Translate } from "../../i18n";
import { PaletteCommand } from "../CommandPalette";

export interface TermCommandInput {
  pagerOpen: boolean;
  stepFile: (direction: 1 | -1) => void;
  quitPager: () => void;
  goToFile: () => void;
  clear: () => void;
  zoom: (step: 1 | -1) => void;
  mod: string;
}

export function termCommands(input: TermCommandInput, t: Translate): PaletteCommand[] {
  const list: PaletteCommand[] = [];
  if (input.pagerOpen) {
    list.push({ id: "next-file", label: t("Next file"), hint: ":n  ]", run: () => input.stepFile(1) });
    list.push({ id: "previous-file", label: t("Previous file"), hint: ":p  [", run: () => input.stepFile(-1) });
    list.push({ id: "quit-pager", label: t("Back to the list"), hint: "q", run: input.quitPager });
  }
  list.push({ id: "go-to-file", label: t("Go to file…"), run: input.goToFile });
  if (!input.pagerOpen) list.push({ id: "clear", label: t("Clear the terminal"), hint: "Ctrl+L", run: input.clear });
  list.push({ id: "zoom-in", label: t("Zoom in"), hint: `${input.mod}+=`, run: () => input.zoom(1) });
  list.push({ id: "zoom-out", label: t("Zoom out"), hint: `${input.mod}+-`, run: () => input.zoom(-1) });
  return list;
}
