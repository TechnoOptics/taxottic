// Duplicate detection for CSV bank imports.
// See docs/superpowers/specs/2026-08-06-import-duplicate-detection-design.md
//
// Re-importing the same CSV silently doubles a user's expenses. Nothing
// detected that before this file existed. This module flags candidates
// for the review page; it never removes or blocks anything. A row that
// turns out to be two genuinely separate charges (two Delta tickets
// bought on the same day, at the same price) is common, not an error,
// so the output here is always a question for the user, never a
// decision made on their behalf.
//
// `bank_import_duplicates` already exists in production with exactly
// the right schema (see supabase/migrations/20260801224316_csv_import_review.sql).
// This file is what finally writes to it.
//
// Purity: fingerprintRow, findWithinFileDuplicates and
// findAlreadyBookedDuplicates touch no database and are exhaustively
// tested in duplicates.test.ts. detectDuplicates is the only impure
// piece: it queries, delegates to the pure matchers above, then
// writes. Keeping the matching logic pure is not stylistic here - on
// 2026-08-06 five defects shipped in this exact file area, and every
// one lived in caller code wrapping otherwise-correct pure functions.

import { normalizeMerchant } from "./net-refunds";

export type ImportRow = {
  companyId: string;
  description: string;
  postedAt: string | null; // "YYYY-MM-DD", or null if unparsed
  amountCents: number | null; // null if unparsed
};

export type ExistingBookedRow = {
  id: string; // bank_transactions.id
  importId: string; // bank_transactions.import_id (the import that booked it)
  companyId: string;
  description: string;
  postedAt: string | null;
  amountCents: number;
  appliedExpenseId: string | null;
  appliedIncomeId: string | null;
};

export type DuplicateKind = "within_file" | "already_booked";

export type DuplicateFinding = {
  companyId: string;
  postedAt: string;
  description: string;
  amountCents: number;
  fingerprint: string;
  kind: DuplicateKind;
  existingTransactionId: string | null;
  existingImportId: string | null;
};

/**
 * normalizeMerchant(description) | posted_at | amount_cents
 *
 * All three parts are load-bearing: merchant alone collapses a month
 * of Sam's Club runs, date alone collapses a busy day, amount alone
 * collapses every $20 subscription.
 *
 * A row with no posted_at or an unparseable amount is never
 * fingerprinted and never flagged - silence is correct there, a
 * fabricated match is not.
 */
export function fingerprintRow(row: {
  description: string | null;
  postedAt: string | null;
  amountCents: number | null;
}): string | null {
  if (!row.postedAt) return null;
  if (typeof row.amountCents !== "number" || !Number.isFinite(row.amountCents)) {
    return null;
  }
  const merchant = normalizeMerchant(row.description);
  return `${merchant}|${row.postedAt}|${row.amountCents}`;
}

/**
 * Group parsed rows by fingerprint; any group larger than one produces
 * a finding for every row beyond the first. A pair of rows produces
 * one finding (the second row), a trio produces two (the second and
 * third), and so on - the first occurrence of any fingerprint is never
 * itself flagged, only the repeats after it.
 *
 * Pure, no DB I/O.
 */
export function findWithinFileDuplicates(rows: ImportRow[]): DuplicateFinding[] {
  const seenCount = new Map<string, number>();
  const findings: DuplicateFinding[] = [];

  for (const row of rows) {
    const fingerprint = fingerprintRow(row);
    if (!fingerprint) continue;
    const count = (seenCount.get(fingerprint) ?? 0) + 1;
    seenCount.set(fingerprint, count);
    if (count === 1) continue;
    findings.push({
      companyId: row.companyId,
      postedAt: row.postedAt as string,
      description: row.description,
      amountCents: row.amountCents as number,
      fingerprint,
      kind: "within_file",
      existingTransactionId: null,
      existingImportId: null,
    });
  }

  return findings;
}

/**
 * Match parsed rows against the company's already-booked transactions
 * (applied_expense_id or applied_income_id set). Rows still under
 * review (neither field set) never count as "existing" - matching
 * against an import the user hasn't acted on yet would flag rows they
 * may still ignore.
 *
 * companyId is checked on both sides even though the caller's query is
 * expected to already scope `existing` to one company: a duplicate is
 * a duplicate within one company's books, and this is the second,
 * defense-in-depth place that guarantees cross-tenant rows can never
 * match, independent of whether the caller's query is correct.
 *
 * Pure: takes the existing rows, does not query.
 */
export function findAlreadyBookedDuplicates(
  rows: ImportRow[],
  existing: ExistingBookedRow[],
): DuplicateFinding[] {
  const booked = existing.filter((r) => r.appliedExpenseId || r.appliedIncomeId);

  const byKey = new Map<string, ExistingBookedRow>();
  for (const ex of booked) {
    const fingerprint = fingerprintRow(ex);
    if (!fingerprint) continue;
    const key = `${ex.companyId}|${fingerprint}`;
    if (!byKey.has(key)) byKey.set(key, ex);
  }

  const findings: DuplicateFinding[] = [];
  for (const row of rows) {
    const fingerprint = fingerprintRow(row);
    if (!fingerprint) continue;
    const key = `${row.companyId}|${fingerprint}`;
    const match = byKey.get(key);
    if (!match) continue;
    findings.push({
      companyId: row.companyId,
      postedAt: row.postedAt as string,
      description: row.description,
      amountCents: row.amountCents as number,
      fingerprint,
      kind: "already_booked",
      existingTransactionId: match.id,
      existingImportId: match.importId,
    });
  }

  return findings;
}

/**
 * The only impure piece: queries the company's already-booked
 * transactions in this row set's date range, delegates to the two
 * pure matchers above, then writes findings to
 * public.bank_import_duplicates.
 *
 * Detection failing must never fail an upload. The caller
 * (runCsvImport in app/c/[publicId]/import/actions.ts) wraps this call
 * in its own try/catch so a thrown error here degrades to "no
 * duplicates found" rather than blocking the import - the rows are
 * already parsed and stored by the time this runs, so a missing
 * duplicate flag is a degraded upload, not a broken one.
 */
export async function detectDuplicates(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  importId: string,
  rows: ImportRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const companyId = rows[0].companyId;

  const dates = rows
    .map((r) => r.postedAt)
    .filter((d): d is string => !!d)
    .sort();

  let existing: ExistingBookedRow[] = [];
  if (dates.length > 0) {
    const { data, error } = await admin
      .from("bank_transactions")
      .select(
        "id, import_id, company_id, description, posted_at, amount_cents, applied_expense_id, applied_income_id",
      )
      .eq("company_id", companyId)
      .neq("import_id", importId)
      .gte("posted_at", dates[0])
      .lte("posted_at", dates[dates.length - 1])
      .or("applied_expense_id.not.is.null,applied_income_id.not.is.null")
      .limit(10_000);
    if (error) throw error;
    existing = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      importId: String(r.import_id),
      companyId: String(r.company_id),
      description: (r.description as string | null) ?? "",
      postedAt: (r.posted_at as string | null) ?? null,
      amountCents: Number(r.amount_cents),
      appliedExpenseId: (r.applied_expense_id as string | null) ?? null,
      appliedIncomeId: (r.applied_income_id as string | null) ?? null,
    }));
  }

  const findings = [
    ...findWithinFileDuplicates(rows),
    ...findAlreadyBookedDuplicates(rows, existing),
  ];
  if (findings.length === 0) return;

  const records = findings.map((f) => ({
    import_id: importId,
    company_id: f.companyId,
    posted_at: f.postedAt,
    description: f.description,
    amount_cents: f.amountCents,
    fingerprint: f.fingerprint,
    kind: f.kind,
    existing_transaction_id: f.existingTransactionId,
    existing_import_id: f.existingImportId,
  }));

  const { error: insertError } = await admin.from("bank_import_duplicates").insert(records);
  if (insertError) throw insertError;
}
