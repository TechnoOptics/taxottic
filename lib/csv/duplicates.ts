/**
 * Row-level duplicate partitioning for a CSV import.
 *
 * Two things were wrong with the shipped behaviour, and this module fixes
 * both without inventing a second identity scheme:
 *
 *  1. Duplicates were dropped SILENTLY. `runCsvImport` filtered them out of
 *     the insert list and nobody ever heard about them. That is precisely how
 *     a real expense disappears and is never claimed: the row is gone, the
 *     count of "rows uploaded" still includes it, and nothing reconciles.
 *     This returns the duplicates so the caller can record and show them.
 *
 *  2. Duplicates WITHIN one file were not detected at all. The old check only
 *     compared incoming rows against rows already in the database, so a CSV
 *     that listed the same charge twice imported it twice.
 *
 * Identity is `chargeFingerprint` from lib/banking/subscription-dedupe, the
 * same key the Stripe and Plaid ingest paths lean on for exact-charge
 * matching: posted day, exact signed cents, and a normalized description
 * slug. It is reused rather than reimplemented so the CSV path and the bank
 * feeds can never drift into disagreeing about what "the same charge" means.
 */

import { chargeFingerprint } from "@/lib/banking/subscription-dedupe";

/** The minimum shape needed to compute a charge identity. */
export type DupeCandidate = {
  posted_at: string | null;
  amount_cents: number;
  description: string;
};

export type BookDuplicate<T> = {
  row: T;
  index: number;
  fingerprint: string;
};

export type FileDuplicate<T> = {
  row: T;
  index: number;
  /** Index of the earlier row in this same file that this one repeats. */
  firstIndex: number;
  fingerprint: string;
};

export type Partition<T> = {
  /** Rows to actually insert. */
  fresh: T[];
  /** Rows this file repeats from itself. */
  withinFile: FileDuplicate<T>[];
  /** Rows already present in the company's books from an earlier import. */
  againstBooks: BookDuplicate<T>[];
};

/**
 * Split incoming rows three ways.
 *
 * `priorFingerprints` is the set of `chargeFingerprint` values already in the
 * company's `bank_transactions` over the incoming date range; the caller
 * builds it, because that is a database read.
 *
 * Rows with no parsed `posted_at` are ALWAYS treated as fresh. Without a date
 * the fingerprint collapses to amount plus description, which two genuinely
 * separate charges routinely share (two $5.00 coffees). Guessing there would
 * silently delete a real deduction, so the undated rows pass through and the
 * review screen flags them as needing a date instead.
 */
export function partitionRows<T extends DupeCandidate>(
  rows: T[],
  priorFingerprints: ReadonlySet<string>,
): Partition<T> {
  const fresh: T[] = [];
  const withinFile: FileDuplicate<T>[] = [];
  const againstBooks: BookDuplicate<T>[] = [];

  // First occurrence of each fingerprint in THIS file, so a repeat can point
  // back at the row it duplicates.
  const firstSeenAt = new Map<string, number>();

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];

    if (!row.posted_at) {
      fresh.push(row);
      continue;
    }

    const fingerprint = chargeFingerprint(
      row.posted_at,
      row.amount_cents,
      row.description,
    );

    // Already-booked wins over repeated-in-file: "you already have this" is
    // the more actionable message, and reporting the row under both headings
    // would double-count it in the summary.
    if (priorFingerprints.has(fingerprint)) {
      againstBooks.push({ row, index, fingerprint });
      continue;
    }

    const firstIndex = firstSeenAt.get(fingerprint);
    if (firstIndex !== undefined) {
      withinFile.push({ row, index, firstIndex, fingerprint });
      continue;
    }

    firstSeenAt.set(fingerprint, index);
    fresh.push(row);
  }

  return { fresh, withinFile, againstBooks };
}
