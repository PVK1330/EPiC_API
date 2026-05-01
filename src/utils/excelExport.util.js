import XLSX from "xlsx";

/**
 * Sends an XLSX buffer as a file download — use across admin export endpoints for consistent headers.
 *
 * @param {import('express').Response} res Express response object
 * @param {Buffer} buffer XLSX file buffer from rowsToXlsxBuffer
 * @param {string} filename Suggested filename (e.g. "escalations_2026-05-01.xlsx")
 */
export function sendXlsxDownload(res, buffer, filename) {
  const safe =
    typeof filename === "string" && filename.trim()
      ? filename.replace(/[^\w.-]+/g, "_")
      : "export.xlsx";
  const name = /\.xlsx$/i.test(safe) ? safe : `${safe}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(buffer);
}

export function rowsToXlsxBuffer(rows, columns) {
  const headerRow = columns.map((c) => c.header);
  const dataRows = rows.map((row) =>
    columns.map((col) => {
      const v = row[col.key];
      if (v === null || v === undefined) return "";
      if (typeof v === "object") {
        try {
          return JSON.stringify(v);
        } catch {
          return "";
        }
      }
      return v;
    }),
  );
  const aoa = [headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/**
 * Build a workbook with multiple sheets — same column contract as rowsToXlsxBuffer.
 * @param {{ name: string, columns: { key: string, header: string }[], rows: Record<string, unknown>[] }[]} sheets
 */
export function multiSheetXlsxBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  const used = new Set();

  const cellValue = (v) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") {
      try {
        return JSON.stringify(v);
      } catch {
        return "";
      }
    }
    return v;
  };

  const sanitizeSheetName = (raw) => {
    let base = String(raw || "Sheet")
      .slice(0, 31)
      .replace(/[:\\/[\]*?']/g, "_");
    if (!base.trim()) base = "Sheet";
    let name = base;
    let n = 1;
    while (used.has(name)) {
      name = `${base.slice(0, Math.max(1, 28 - String(n).length))}_${n++}`;
    }
    used.add(name);
    return name;
  };

  const list = Array.isArray(sheets) ? sheets : [];
  if (list.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([["No report data returned"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Info");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  }

  for (const sheet of list) {
    const columns = sheet.columns || [];
    const rows = sheet.rows || [];
    const headerRow = columns.map((c) => c.header);
    const dataRows = rows.map((row) =>
      columns.map((col) => cellValue(row[col.key])),
    );
    const aoa = [headerRow, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheet.name));
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

export function xlsxBufferToRows(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], dataRows: [] };
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return { headers: [], dataRows: [] };
  const headers = rows[0].map((h) => String(h).trim());
  const dataRows = rows
    .slice(1)
    .filter((r) =>
      Array.isArray(r) ? r.some((c) => String(c).trim() !== "") : false,
    );
  return { headers, dataRows };
}
