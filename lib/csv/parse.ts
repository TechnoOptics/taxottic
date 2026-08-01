/**
 * Minimal RFC-4180 CSV parser. Handles:
 *  - \n or \r\n row separators
 *  - comma field separator
 *  - double-quoted fields with embedded commas, newlines, and "" escapes
 *  - a leading UTF-8 BOM (Excel writes one on "Save as CSV")
 *  - blank lines (skipped)
 *
 * No external dependency. Bank exports usually conform.
 *
 * Known limitation, deliberately not handled: European exports that use ";"
 * as the separator and "," as the decimal mark. US bank exports are the
 * target and guessing the locale from the data risks reading 1.234,56 as
 * 1.23. Such a file fails the header sniff and surfaces an error rather than
 * importing wrong numbers.
 */
export function parseCsv(input: string): string[][] {
  // A BOM left in place becomes part of the first header's name, which is how
  // a "Date" column silently stops being found by sniffColumns.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  // A quote only opens a quoted field at the START of a field. Without this,
  // a merchant line like `6" PIPE` opened a quote mid-field and swallowed the
  // rest of the row, amount column included.
  let atFieldStart = true;
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

    if (c === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      atFieldStart = true;
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      // commit field + row
      row.push(field);
      field = "";
      atFieldStart = true;
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
    atFieldStart = false;
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
  const norm = headers.map((h) =>
    h.replace(/^﻿/, "").toLowerCase().trim(),
  );
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
 * Parses an amount string into integer cents. Returns null if not parseable.
 *
 * Accepted shapes, all seen in real exports:
 *   12.34        1234
 *   -12.34       -1234      leading minus
 *   12.34-       -1234      trailing minus (Quicken, several credit unions)
 *   (12.34)      -1234      accounting parentheses
 *   $1,234.56    123456     currency symbol + thousands separators
 *   12.34 DR     -1234      debit suffix (money out)
 *   12.34 CR      1234      credit suffix (money in)
 *
 * Cents are assembled from the digit strings rather than by multiplying a
 * float by 100. `Math.round(x * 100)` is off by a cent on values whose binary
 * representation lands just under the halfway point, and a cent that moves in
 * the wrong direction on a deduction is a wrong number on a tax return.
 *
 * Returning null (rather than 0) for unparseable input matters: the caller
 * must be able to tell "this row had no readable amount" apart from "this row
 * was genuinely zero", so an unreadable row is surfaced instead of quietly
 * importing as $0.00.
 */
export function parseAmountCents(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  let negative = false;

  // CR / DR suffix, before whitespace is stripped.
  const crdr = s.match(/(CR|DR)\.?$/i);
  if (crdr) {
    if (crdr[1].toUpperCase() === "DR") negative = true;
    s = s.slice(0, crdr.index).trim();
  }

  // Currency symbols, thousands separators and internal spaces. Done before
  // the sign checks so both "$-12.34" and "-$12.34" work.
  s = s.replace(/[$£€¥\s,]/g, "");

  // Accounting parentheses.
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }

  // A minus on either end means negative. Two of them do NOT cancel: a
  // malformed "-12.34-" is still money out.
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("+")) s = s.slice(1);

  const m = s.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m) return null;
  const intPart = m[1] ?? "";
  const fracPart = m[2] ?? "";
  if (intPart === "" && fracPart === "") return null;

  const whole = intPart === "" ? 0 : Number(intPart);
  if (!Number.isSafeInteger(whole)) return null;

  let cents = whole * 100;
  if (fracPart.length > 0) {
    cents += Number(fracPart.slice(0, 2).padEnd(2, "0"));
    // Round at the third decimal. Sub-cent values only show up on FX lines.
    if (fracPart.length > 2 && Number(fracPart[2]) >= 5) cents += 1;
  }
  if (!Number.isSafeInteger(cents)) return null;

  return negative ? -cents : cents;
}
