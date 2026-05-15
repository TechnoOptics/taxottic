"use client";

import { useMemo, useState } from "react";

// Tier 3 #3: Client-side CSV import preview.
//
// The bulk-import textarea now has a "Preview" toggle that parses
// the same CSV the server will see and shows the firm exactly what
// will happen row-by-row before they hit submit. Catches the
// classic "I forgot the email column" mistake without burning a
// round-trip + a re-paste.
//
// We re-use the tokenizer from lib/firm/csv.ts but inline a tiny
// copy here so the bundle doesn't pull in the server-only module.

type CsvRow = Record<string, string>;

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsv(input: string): { headers: string[]; rows: CsvRow[] } {
  const clean = input.replace(/^﻿/, "");
  if (clean.trim().length === 0) return { headers: [], rows: [] };
  const cells: string[][] = [];
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
      if (ch === "\r" && clean[i + 1] === "\n") i += 1;
      current.push(field);
      field = "";
      cells.push(current);
      current = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || current.length) {
    current.push(field);
    cells.push(current);
  }
  const nonEmpty = cells.filter(
    (r) => r.length > 1 || r.some((c) => c.trim().length > 0),
  );
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map(normalizeHeader);
  const rows: CsvRow[] = [];
  for (let r = 1; r < nonEmpty.length; r++) {
    const row: CsvRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (nonEmpty[r][c] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

const VALID_KINDS = new Set([
  "tax_prep",
  "bookkeeping",
  "advisory",
  "audit_support",
]);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Diag = {
  row: number;
  email: string;
  business: string;
  kind: string;
  status: "ok" | "warn" | "error";
  notes: string[];
};

function diagnose(rows: CsvRow[], defaultKind: string): Diag[] {
  const seen = new Set<string>();
  return rows.map((r, idx) => {
    const notes: string[] = [];
    let status: Diag["status"] = "ok";
    const email = (r.email ?? "").toLowerCase();
    if (!email) {
      notes.push("missing email");
      status = "error";
    } else if (!EMAIL_RE.test(email)) {
      notes.push("invalid email format");
      status = "error";
    } else if (seen.has(email)) {
      notes.push("duplicate within batch (last row wins)");
      status = "warn";
    } else {
      seen.add(email);
    }
    const kind = r.kind || defaultKind;
    if (kind && !VALID_KINDS.has(kind)) {
      notes.push(`unknown kind: ${kind}`);
      status = status === "ok" ? "warn" : status;
    }
    return {
      row: idx + 2, // +2 = header row + 1-based
      email,
      business: r.business_name ?? r.business ?? "",
      kind,
      status,
      notes,
    };
  });
}

export function CsvImportPreview({
  defaultKind,
}: {
  defaultKind: string;
}) {
  const [csv, setCsv] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const parsed = useMemo(() => parseCsv(csv), [csv]);
  const diags = useMemo(
    () => diagnose(parsed.rows, defaultKind),
    [parsed.rows, defaultKind],
  );

  const errCount = diags.filter((d) => d.status === "error").length;
  const warnCount = diags.filter((d) => d.status === "warn").length;
  const okCount = diags.filter((d) => d.status === "ok").length;

  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">
          Paste CSV
        </span>
        <textarea
          name="csv"
          required
          rows={14}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          className="input font-mono text-[12px] leading-snug"
          placeholder={
            "email,full_name,business_name,kind\nfounder@maplelane.com,Riley Chen,Maple Lane Design Co.,tax_prep\nowner@ridgelinephoto.com,Jordan Park,Ridgeline Photography,bookkeeping"
          }
        />
      </label>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="btn-ghost text-xs px-3 h-8"
          disabled={parsed.rows.length === 0}
        >
          {showPreview ? "Hide" : "Show"} preview ({parsed.rows.length}{" "}
          rows)
        </button>
        {parsed.rows.length > 0 ? (
          <div className="text-xs text-ink-muted">
            <span className="text-emerald-700">{okCount} ok</span>
            {" · "}
            <span className={warnCount > 0 ? "text-amber-700" : ""}>
              {warnCount} warn
            </span>
            {" · "}
            <span className={errCount > 0 ? "text-red-700" : ""}>
              {errCount} error
            </span>
          </div>
        ) : null}
      </div>

      {showPreview && parsed.rows.length > 0 ? (
        <div className="card p-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-[0.15em] text-ink-muted text-left">
              <tr>
                <th className="py-1 pr-3">Row</th>
                <th className="py-1 pr-3">Email</th>
                <th className="py-1 pr-3">Business</th>
                <th className="py-1 pr-3">Kind</th>
                <th className="py-1 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {diags.slice(0, 200).map((d) => (
                <tr key={d.row} className="border-t border-forest-100 align-top">
                  <td className="py-1 pr-3 text-ink-muted tabular-nums">
                    {d.row}
                  </td>
                  <td className="py-1 pr-3 font-mono text-[11px]">
                    {d.email || <span className="text-red-700">—</span>}
                  </td>
                  <td className="py-1 pr-3 text-ink-soft truncate max-w-[14rem]">
                    {d.business}
                  </td>
                  <td className="py-1 pr-3 text-ink-soft">{d.kind}</td>
                  <td className="py-1 pr-3">
                    {d.status === "ok" ? (
                      <span className="text-emerald-700">ok</span>
                    ) : d.status === "warn" ? (
                      <span className="text-amber-700">
                        warn: {d.notes.join(", ")}
                      </span>
                    ) : (
                      <span className="text-red-700">
                        error: {d.notes.join(", ")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {errCount > 0 ? (
        <p className="text-xs text-red-700">
          {errCount} row{errCount === 1 ? "" : "s"} will be skipped
          server-side. Fix them above or proceed knowing they
          won&apos;t be invited.
        </p>
      ) : null}
    </div>
  );
}
