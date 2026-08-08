// Duplicate detection for CSV bank imports.
// See docs/superpowers/specs/2026-08-06-import-duplicate-detection-design.md
//
// Fix round 1 (2026-08-06) corrected the original premise. Re-importing
// the same CSV does NOT double a user's expenses: runCsvImport already
// drops exact-charge matches (chargeFingerprint, in
// lib/banking/subscription-dedupe.ts) before insert. The actual bug is
// that the drop is SILENT: a re-import produces an empty-looking review
// page that still says "62 rows uploaded", with nothing explaining why
// none of them are there. `bank_import_duplicates` was always meant to
// record what the dedupe dropped (see the table comment in
// supabase/migrations/20260801224316_csv_import_review.sql), not a
// second, independent opinion about which rows look like duplicates.
//
// So this file now builds on that dedupe instead of routing around it.
// splitAlreadyBookedCharges below IS the drop decision (it uses
// chargeFingerprint, the exact same identity runCsvImport already
// filters `toInsert` with) and produces the already_booked findings in
// the same pass that decides which rows to insert. That is the only
// way to guarantee the flagged set equals the suppressed set: one
// decision, not two that can drift apart.
//
// findWithinFileDuplicates is unrelated to that drop and still uses its
// own normalizeMerchant-based fingerprint (see fingerprintRow), because
// within-file repeats DO get inserted today (the exact-charge dedupe
// only looks at prior imports, not sibling rows in this one) and an
// inline notice helps there. Duplicates are flagged, never removed:
// nothing in this file deletes or blocks a row.
//
// Purity: fingerprintRow, findWithinFileDuplicates,
// splitAlreadyBookedCharges and dedupeFindings touch no database and
// are exhaustively tested in duplicates.test.ts. detectDuplicates is
// the only impure piece: it writes the findings the caller already
// computed. Keeping the matching logic pure is not stylistic here - on
// 2026-08-06 five defects shipped in this exact file area, and every
// one lived in caller code wrapping otherwise-correct pure functions.

import { normalizeMerchant } from "./net-refunds";
import { chargeFingerprint } from "@/lib/banking/subscription-dedupe";

export type DuplicateKind = "within_file" | "already_booked";

export type DuplicateFinding = {
  // Position of the source row in the caller's original parsed-row
  // array. Bookkeeping only, used by dedupeFindings to recognize two
  // findings that describe the same physical row; never written to
  // bank_import_duplicates.
  rowIndex: number;
  companyId: string;
  postedAt: string;
  description: string;
  amountCents: number;
  fingerprint: string;
  kind: DuplicateKind;
  existingTransactionId: string | null;
  existingImportId: string | null;
};

// ---------------------------------------------------------------------
// Within-file matching (normalizeMerchant-based)
// ---------------------------------------------------------------------

export type ImportRow = {
  index: number;
  companyId: string;
  description: string;
  postedAt: string | null; // "YYYY-MM-DD", or null if unparsed
  amountCents: number | null; // null if unparsed
};

/**
 * normalizeMerchant(description) | posted_at | amount_cents
 *
 * Used ONLY by findWithinFileDuplicates, for rows within one file.
 * Already-booked matching does NOT use this function: it is derived
 * directly from the exact-charge dedupe's own decision (see
 * splitAlreadyBookedCharges below), which fingerprints with
 * chargeFingerprint / normalizeDesc (lib/banking/subscription-dedupe.ts),
 * a different normalizer. The two disagree on punctuation: normalizeDesc
 * turns non-alphanumeric runs into spaces and truncates at 40 chars,
 * normalizeMerchant only splits on whitespace and keeps three tokens, so
 * "SAM'S CLUB 6311 SHAKOPEE" and "SAM S CLUB 6311 SHAKOPEE" fingerprint
 * identically under one and differently under the other. Do not assume
 * they ever agree, and do not try to reconcile them here: this
 * function's only job is within-file matching.
 *
 * All three parts of the key are load-bearing: merchant alone collapses
 * a month of Sam's Club runs, date alone collapses a busy day, amount
 * alone collapses every $20 subscription.
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
 * Intended to run over the rows that actually survive the exact-charge
 * dedupe (`toInsert` in runCsvImport), not the full parsed set: a row
 * already dropped as already_booked never reaches bank_transactions, so
 * flagging it as a within-file repeat too would be describing a row
 * that was never inserted.
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
      rowIndex: row.index,
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

// ---------------------------------------------------------------------
// Already-booked matching (chargeFingerprint-based: the exact-charge
// dedupe's own decision, not a second opinion on it)
// ---------------------------------------------------------------------

export type ChargeCandidate = {
  index: number;
  description: string | null;
  postedAt: string | null;
  amountCents: number;
};

export type ExistingChargeRow = {
  id: string; // bank_transactions.id
  importId: string; // bank_transactions.import_id
  postedAt: string | null;
  amountCents: number;
  description: string | null;
};

/**
 * The exact-charge dedupe's decision, expressed as data instead of a
 * side effect. Uses chargeFingerprint (day-precision posted date +
 * exact cents + normalized description), the SAME function runCsvImport
 * has always used to decide which rows to drop before insert. A row
 * with no posted_at is always kept, matching that dedupe's existing
 * behavior (it has never treated a dateless row as a duplicate
 * candidate).
 *
 * Returns both halves of the same decision:
 *   keptIndexes  row indexes (matching ChargeCandidate.index) that
 *                should still be inserted.
 *   duplicates   a DuplicateFinding per dropped row, carrying the real
 *                existing_transaction_id / existing_import_id of the
 *                prior row it matched.
 *
 * This is the only place that decides "already booked". Computing it
 * once and reading both outputs off it is what guarantees the flagged
 * set and the suppressed set can never diverge; the previous version of
 * this file computed them separately and they did.
 *
 * Cross-tenant scoping is the CALLER's responsibility, not this
 * function's: ExistingChargeRow carries no companyId, so there is
 * nothing here to compare `companyId` against. The single existing
 * caller (runCsvImport in app/c/[publicId]/import/actions.ts) queries
 * `existing` with `.eq("company_id", companyId)` before this runs, so
 * there is no leak today. If a second caller is ever added, it must
 * scope its own query the same way; this function will not catch a
 * caller that forgets to.
 *
 * Pure: takes the existing rows, does not query.
 */
export function splitAlreadyBookedCharges(
  companyId: string,
  rows: ChargeCandidate[],
  existing: ExistingChargeRow[],
): { keptIndexes: Set<number>; duplicates: DuplicateFinding[] } {
  // A queue per fingerprint, not a single winner. One prior charge is
  // evidence that ONE charge was already booked; it cannot vouch for a
  // second identical one. Two $6.50 charges at the same garage on the
  // same day are an ordinary day, and matching both against one prior
  // row dropped a real deduction with no way to get it back: the row is
  // suppressed from bank_transactions, so no amount of re-uploading the
  // file recovers it. Mirrors the consumed-coverage rule in
  // findCoveringRecurringRow, and for the same reason.
  const byFingerprint = new Map<string, ExistingChargeRow[]>();
  for (const ex of existing) {
    if (!ex.postedAt) continue;
    const fingerprint = chargeFingerprint(ex.postedAt, ex.amountCents, ex.description);
    const queue = byFingerprint.get(fingerprint);
    if (queue) queue.push(ex);
    else byFingerprint.set(fingerprint, [ex]);
  }

  const keptIndexes = new Set<number>();
  const duplicates: DuplicateFinding[] = [];

  for (const row of rows) {
    if (!row.postedAt) {
      keptIndexes.add(row.index);
      continue;
    }
    const fingerprint = chargeFingerprint(row.postedAt, row.amountCents, row.description);
    const match = byFingerprint.get(fingerprint)?.shift();
    if (!match) {
      keptIndexes.add(row.index);
      continue;
    }
    duplicates.push({
      rowIndex: row.index,
      companyId,
      postedAt: row.postedAt,
      description: row.description ?? "",
      amountCents: row.amountCents,
      fingerprint,
      kind: "already_booked",
      existingTransactionId: match.id,
      existingImportId: match.importId,
    });
  }

  return { keptIndexes, duplicates };
}

// ---------------------------------------------------------------------
// Combine, dedupe, write
// ---------------------------------------------------------------------

/**
 * Collapse findings that describe the same physical row (by rowIndex)
 * down to one record. In the current wiring this never actually
 * triggers: a row dropped by splitAlreadyBookedCharges never reaches
 * `toInsert`, so it can never also be seen by findWithinFileDuplicates,
 * meaning the two finding sets are disjoint by construction. This still
 * runs before every write as a defensive guarantee rather than a
 * proof-dependent one: a row flagged twice would make a count-based
 * summary ("N of M rows look like duplicates") read higher than the
 * import's own row count, and that invariant should not rest on nobody
 * ever changing what feeds findWithinFileDuplicates.
 *
 * already_booked wins over within_file on a collision: it carries a
 * real existing_transaction_id the review page can link to, which
 * within_file never has.
 *
 * Pure.
 */
export function dedupeFindings(findings: DuplicateFinding[]): DuplicateFinding[] {
  const byRow = new Map<number, DuplicateFinding>();
  for (const finding of findings) {
    const prior = byRow.get(finding.rowIndex);
    if (!prior || (prior.kind === "within_file" && finding.kind === "already_booked")) {
      byRow.set(finding.rowIndex, finding);
    }
  }
  return [...byRow.values()];
}

/**
 * The only impure piece: writes already-computed findings to
 * public.bank_import_duplicates. Both matchers above are pure by
 * design, so the caller (runCsvImport in
 * app/c/[publicId]/import/actions.ts) computes the already-booked
 * findings at the exact-charge dedupe site (where the priorRows query
 * already exists) and the within-file findings from `toInsert`, then
 * passes both here to be deduped and written.
 *
 * Detection failing must never fail an upload. The caller wraps this
 * call in its own try/catch so a thrown error here degrades to "no
 * duplicates found" rather than blocking the import - the rows are
 * already parsed and stored by the time this runs, so a missing
 * duplicate flag is a degraded upload, not a broken one.
 *
 * Writes in batches of 500, mirroring the adjacent bank_transactions
 * insert in runCsvImport, for the same reason: priorRows caps at
 * 10,000, so a large re-import can produce thousands of already_booked
 * findings, and one oversized or rejected insert would lose every
 * record of what was suppressed while the rows themselves stayed
 * suppressed, the exact silence this feature exists to end.
 */
export async function detectDuplicates(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  importId: string,
  findings: DuplicateFinding[],
): Promise<void> {
  const deduped = dedupeFindings(findings);
  if (deduped.length === 0) return;

  const records = deduped.map((f) => ({
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

  const BATCH = 500;
  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH);
    const { error } = await admin.from("bank_import_duplicates").insert(slice);
    if (error) throw error;
  }
}
