/**
 * Sits above the candidate list when a meaningful share of this
 * import's rows have already been flagged in `bank_import_duplicates`.
 *
 * The case this exists for: a user who uploads the same statement
 * twice should meet one clear sentence, not one warning per row.
 * Purely presentational, takes pre-computed counts so it has no DB
 * access and no opinion on the threshold that makes it worth showing;
 * the caller decides when to render it.
 */
export function DuplicateSummaryBanner({
  duplicateCount,
  totalCount,
  originalImportDate,
}: {
  duplicateCount: number;
  totalCount: number;
  /** When the matching prior import was created, already formatted for display. */
  originalImportDate?: string | null;
}) {
  if (duplicateCount === 0) return null;

  return (
    <div className="card p-4 border-gold-300/60 text-sm text-forest-900">
      <strong>
        {duplicateCount} of {totalCount} rows
      </strong>{" "}
      look like duplicates
      {originalImportDate ? ` of an import from ${originalImportDate}` : ""}.
      Review before applying, or delete this import.
    </div>
  );
}
