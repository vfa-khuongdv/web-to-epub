import { Translate } from "../../i18n";
import { PaletteCommand } from "../CommandPalette";
import { SheetRef } from "./workbook";

export interface SheetCommandInput {
  kind: SheetRef["kind"];
  page: number;
  pages: number;
  // Where "Back to the list" leads (a sheet name), and the sheet "Close" would close.
  backTo: string;
  activeName: string;
  stepChapter: (direction: 1 | -1) => void;
  backToList: () => void;
  turnPage: (page: number) => void;
  close: () => void;
}

// The spreadsheet skin's own palette commands, shown before the ones every skin has.
export function sheetCommands(input: SheetCommandInput, t: Translate): PaletteCommand[] {
  const { kind, page, pages } = input;
  const list: PaletteCommand[] = [];
  if (kind === "chapter") {
    list.push({ id: "next-chapter", label: t("Next section"), hint: "]", run: () => input.stepChapter(1) });
    list.push({ id: "previous-chapter", label: t("Previous section"), hint: "[", run: () => input.stepChapter(-1) });
  }
  if (kind !== "library") {
    list.push({ id: "back-to-list", label: t("Back to the list"), hint: input.backTo, run: input.backToList });
  }
  if (page < pages - 1) list.push({ id: "next-page", label: t("Next page"), run: () => input.turnPage(page + 1) });
  if (page > 0) list.push({ id: "previous-page", label: t("Previous page"), run: () => input.turnPage(page - 1) });
  if (kind !== "library") {
    list.push({ id: "close-sheet", label: t("Close this sheet"), hint: input.activeName, run: input.close });
  }
  return list;
}
