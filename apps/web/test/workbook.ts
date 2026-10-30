import * as XLSX from "xlsx";

/** An .xlsx file in memory, one sheet per entry, rows as arrays of cells. */
export function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
