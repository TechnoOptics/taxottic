// Tiny CSV parser used by the firm client-import flow.
//
// We deliberately don't pull in `papaparse` or `csv-parse`, the
// payloads we accept are bounded (one batch ≤ 200 rows, capped
// server-side) and the spec we honour is the narrow subset most
// accounting CRMs export:
//   - comma-separated
//   - double-quoted fields when they contain commas or newlines
//   - "" inside a quoted field is an escaped quote
//   - first non-empty line is treated as the header
//
// What we do NOT support:
//   - alternative delimiters (tab, semicolon), user can re-export
//   - byte-order marks (we strip a leading BOM and move on)
//   - quoted headers with leading/trailing spaces, header keys
//     are normalized to lower-snake_case so spaces in the source
//     header don't matter

export type CsvRow = Record<string, string>;

export type CsvParseResult = {
  headers: string[];
  rows: CsvRow[];
};

const STRIP_BOM = /^﻿/;

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseCsv(input: string): CsvParseResult {
  const clean = input.replace(STRIP_BOM, "");
  if (clean.trim().length === 0) return { headers: [], rows: [] };

  // State-machine CSV tokenizer. Each cell is a string; rows end
  // when a non-quoted \n is seen.
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = clean.length;

  while (i < len) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          // Escaped quote.
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      current.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // Handle CRLF and lone CR by consuming both.
      if (ch === "\r" && clean[i + 1] === "\n") i += 1;
      current.push(field);
      field = "";
      rows.push(current);
      current = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Last field
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  // Drop empty trailing rows that the textarea pasted in.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  if (rows.length === 0) return { headers: [], rows: [] };

  const rawHeaders = rows[0];
  const headers = rawHeaders.map(normalizeHeader);
  const records: CsvRow[] = rows.slice(1).map((r) => {
    const obj: CsvRow = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });

  return { headers, rows: records };
}

export type FirmInviteRowInput = {
  email: string;
  full_name?: string;
  business_name?: string;
  message?: string;
  /** Optional per-row override; otherwise the batch default applies. */
  kind?: string;
  tax_year?: string;
};

export type FirmInviteRowParsed = {
  email: string;
  full_name: string | null;
  business_name: string | null;
  message: string | null;
  kind: "tax_prep" | "audit_support" | "bookkeeping" | "advisory";
  tax_year: number;
};

export type FirmInviteRowError = {
  rowNumber: number;
  email: string;
  reason: string;
};

const VALID_KINDS = new Set([
  "tax_prep",
  "audit_support",
  "bookkeeping",
  "advisory",
]);

/**
 * Normalize a parsed CSV row into the strict input shape used by
 * the bulk-import action. Returns an error object instead of
 * throwing so the server can collect all the issues and re-render
 * the preview with row-level annotations.
 */
export function validateInviteRow(
  raw: CsvRow,
  rowNumber: number,
  defaults: { kind: string; taxYear: number },
): { ok: true; row: FirmInviteRowParsed } | { ok: false; error: FirmInviteRowError } {
  const email = (raw.email ?? "").toLowerCase();
  if (!email) {
    return {
      ok: false,
      error: { rowNumber, email: "", reason: "Missing email." },
    };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return {
      ok: false,
      error: { rowNumber, email, reason: "Invalid email format." },
    };
  }
  const kindRaw =
    (raw.kind || raw.engagement_kind || defaults.kind || "tax_prep").toLowerCase();
  const kind = VALID_KINDS.has(kindRaw)
    ? (kindRaw as FirmInviteRowParsed["kind"])
    : (defaults.kind as FirmInviteRowParsed["kind"]);

  const yearStr = raw.tax_year || raw.year || `${defaults.taxYear}`;
  const yearNum = parseInt(yearStr, 10);
  const tax_year =
    Number.isFinite(yearNum) && yearNum >= 2020 && yearNum <= 2100
      ? yearNum
      : defaults.taxYear;

  return {
    ok: true,
    row: {
      email,
      full_name: (raw.full_name || raw.name || raw.contact_name || "").trim() || null,
      business_name:
        (raw.business_name || raw.company || raw.business || "").trim() || null,
      message: (raw.message || raw.note || "").trim() || null,
      kind,
      tax_year,
    },
  };
}
