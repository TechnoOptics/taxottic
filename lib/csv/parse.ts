/**
 * Minimal RFC-4180 CSV parser. Handles:
 *  - \n or \r\n row separators
 *  - comma field separator
 *  - double-quoted fields with embedded commas, newlines, and "" escapes
 *  - blank lines (skipped)
 *
 * No external dependency. Bank exports usually conform.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      // commit field + row
      row.push(field);
      field = "";
      // skip \r\n pair
      if (c === "\r" && i + 1 < n && text[i + 1] === "\n") i += 2;
      else i++;
      // skip empty rows
      if (row.length === 1 && row[0] === "") {
        row = [];
        continue;
      }
      rows.push(row);
      row = [];
      continue;
    }
    field += c;
    i++;
  }

  // tail
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }

  return rows;
}

/**
 * Best-effort header sniff: returns the column index for each canonical field.
 * Returns -1 if not found.
 */
export type ColumnMap = {
  date: number;
  description: number;
  amount: number;
  category: number;
};

export function sniffColumns(headers: string[]): ColumnMap {
  const norm = headers.map((h) => h.toLowerCase().trim());
  const find = (...needles: string[]) =>
    norm.findIndex((h) => needles.some((n) => h.includes(n)));
  return {
    date: find("posted date", "transaction date", "date"),
    description: find("description", "memo", "name", "payee", "transaction"),
    amount: find("amount", "debit", "credit"),
    category: find("category", "type"),
  };
}

/**
 * Parses an amount string like "$-12.34" / "(12.34)" / "1,234.56" into cents.
 * Returns null if not parseable.
 */
export function parseAmountCents(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const negative =
    cleaned.startsWith("(") || cleaned.startsWith("-");
  const stripped = cleaned.replace(/^[-(]/, "").replace(/\)$/, "");
  const n = Number.parseFloat(stripped);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return negative ? -cents : cents;
}
