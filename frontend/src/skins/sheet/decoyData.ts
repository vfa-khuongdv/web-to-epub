// The decoy's workbook: a Q4 budget by department, in thousand dong. Fixed numbers, so
// the screen is the same every time; the totals are computed, so they always add up.

import { formatNumber } from "./sheetModel";
import { SheetCell, SheetRow } from "./sheetRows";

// Department, quarters 1–4, plan for the year.
const DEPARTMENTS: [string, number, number, number, number, number][] = [
  ["Kinh doanh", 1245300, 1318750, 1402100, 1520640, 5300000],
  ["Marketing", 612400, 588900, 640250, 702300, 2450000],
  ["Kỹ thuật", 980150, 1012400, 995800, 1048600, 4200000],
  ["Sản xuất", 2140500, 2206300, 2198750, 2310900, 8400000],
  ["Nhân sự", 312800, 298450, 305600, 330200, 1300000],
  ["Tài chính – Kế toán", 268900, 274100, 281350, 290700, 1100000],
  ["Hành chính", 185600, 179300, 192450, 201800, 820000],
  ["Chăm sóc khách hàng", 402750, 415900, 428300, 446100, 1650000],
  ["Pháp chế", 96400, 88250, 102600, 94300, 400000],
  ["Mua hàng", 154300, 161800, 158950, 170400, 630000],
  ["Kho vận", 520600, 548200, 561900, 604350, 2150000],
  ["Nghiên cứu & Phát triển", 730500, 765200, 812400, 850100, 3400000],
  ["Công nghệ thông tin", 455800, 470350, 462900, 498600, 1900000],
  ["Đào tạo", 120400, 98600, 135200, 142750, 480000],
  ["Dự án đặc biệt", 250000, 310500, -48200, 185300, 750000],
];

export const DECOY_HEADER = ["Phòng ban", "Quý 1", "Quý 2", "Quý 3", "Quý 4", "Tổng", "% so với KH"];
export const DECOY_COLUMNS = ["220px", "112px", "112px", "112px", "112px", "128px", "112px", ...Array(14).fill("72px")];

const amount = (value: number, bold = false): SheetCell => ({
  text: formatNumber(value),
  align: "right",
  bold,
  tone: value < 0 ? "negative" : undefined,
});

const share = (actual: number, plan: number, bold = false): SheetCell => {
  const ratio = actual / plan - 1;
  return { text: `${(ratio * 100).toFixed(1)}%`, align: "right", bold, tone: ratio < 0 ? "negative" : undefined };
};

export function decoyRows(): SheetRow[] {
  const rows: SheetRow[] = [
    { key: "header", label: 1, header: true, cells: DECOY_HEADER.map((text) => ({ text, bold: true })) },
  ];
  const sums = [0, 0, 0, 0, 0];
  let plans = 0;
  DEPARTMENTS.forEach(([name, ...numbers], index) => {
    const quarters = numbers.slice(0, 4);
    const plan = numbers[4];
    const total = quarters.reduce((sum, value) => sum + value, 0);
    quarters.forEach((value, quarter) => (sums[quarter] += value));
    sums[4] += total;
    plans += plan;
    rows.push({
      key: name,
      label: index + 2,
      cells: [{ text: name }, ...quarters.map((value) => amount(value)), amount(total), share(total, plan)],
    });
  });
  rows.push({
    key: "total",
    label: DEPARTMENTS.length + 2,
    cells: [{ text: "Tổng cộng", bold: true }, ...sums.map((value) => amount(value, true)), share(sums[4], plans, true)],
  });
  return rows;
}

// The selected cell: the grand total (F17) and the formula behind it.
export const DECOY_SELECTION = { row: DEPARTMENTS.length + 1, col: 5 };
export const DECOY_FORMULA = `=SUM(F2:F${DEPARTMENTS.length + 1})`;
