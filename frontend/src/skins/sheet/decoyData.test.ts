import { describe, expect, it } from "vitest";
import { DECOY_FORMULA, DECOY_HEADER, DECOY_SELECTION, decoyRows } from "./decoyData";
import { cellAddress } from "./sheetModel";

const value = (text: string) => Number(text.replace(/,/g, ""));

describe("decoy budget", () => {
  const rows = decoyRows();
  const data = rows.slice(1, -1);
  const total = rows[rows.length - 1];

  it("has a header, about fifteen departments and a total row", () => {
    expect(rows[0].cells.map((cell) => cell.text)).toEqual(DECOY_HEADER);
    expect(data).toHaveLength(15);
    expect(total.cells[0].text).toBe("Tổng cộng");
  });

  it("adds up across and down", () => {
    for (const row of data) {
      const quarters = row.cells.slice(1, 5).reduce((sum, cell) => sum + value(cell.text), 0);
      expect(value(row.cells[5].text)).toBe(quarters);
    }
    for (let col = 1; col <= 5; col++) {
      expect(value(total.cells[col].text)).toBe(data.reduce((sum, row) => sum + value(row.cells[col].text), 0));
    }
  });

  it("shows negatives in the negative colour", () => {
    const negatives = rows.flatMap((row) => row.cells).filter((cell) => cell.text.startsWith("-"));
    expect(negatives.length).toBeGreaterThan(0);
    for (const cell of negatives) expect(cell.tone).toBe("negative");
  });

  it("selects the grand total, whose formula sums the column above it", () => {
    expect(cellAddress(DECOY_SELECTION.col, rows[DECOY_SELECTION.row].label)).toBe("F17");
    expect(DECOY_FORMULA).toBe("=SUM(F2:F16)");
  });
});
