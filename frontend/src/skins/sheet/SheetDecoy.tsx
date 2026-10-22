import { FormulaBar, RibbonTabs, TitleBar } from "./SheetChrome";
import { SheetGrid } from "./SheetGrid";
import { HomeRibbon } from "./SheetRibbon";
import { SheetStatusBar } from "./SheetStatusBar";
import { SheetTabs } from "./SheetTabs";
import { DECOY_COLUMNS, DECOY_FORMULA, DECOY_SELECTION, decoyRows } from "./decoyData";
import { cellAddress, selectionSummary } from "./sheetModel";

// What the boss key shows in the spreadsheet skin: a Q4 budget workbook in the same
// program frame. Static, no story in it, nothing fetched; none of its controls answer to
// the shell's accessible names, since the shell stays mounted underneath.

const ROWS = decoyRows();
const TABS = ["Tong_hop", "Chi_tiet", "Du_toan"].map((name) => ({ key: name, name, closable: false }));
const SELECTED = ROWS[DECOY_SELECTION.row];
const RESTORE = { top: 0, left: 0 };

export default function SheetDecoy() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-sheet-cell font-sheet text-sheet-fg">
      <TitleBar fileName="Ngan_sach_Q4.xlsx" />
      <RibbonTabs />
      <HomeRibbon />
      <FormulaBar address={cellAddress(DECOY_SELECTION.col, SELECTED.label)} formula={DECOY_FORMULA} labelled={false} />
      <SheetGrid
        columns={DECOY_COLUMNS}
        rows={ROWS}
        selection={DECOY_SELECTION}
        revealToken={0}
        fillerRows={34}
        zoom={100}
        freeze
        interactive={false}
        restore={RESTORE}
      />
      <SheetTabs tabs={TABS} active="Tong_hop" />
      <SheetStatusBar
        left={<span>Ready</span>}
        summary={selectionSummary(SELECTED.cells[DECOY_SELECTION.col].text, false)}
        zoom={100}
        labelled={false}
      />
    </div>
  );
}
