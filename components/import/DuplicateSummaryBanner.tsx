import { DuplicateNotice } from "./DuplicateNotice";

/**
 * One suppressed row: parsed from the CSV, matched against something
 * already booked, and never inserted into bank_transactions. Mirrors
 * the already_booked rows this component reads from
 * bank_import_duplicates.
 */
export type SuppressedRow = {
  id: string;
  description: string;
  postedAt: string;
  amountCents: number;
  existingTransactionId: string;
  existingImportId: string;
};

/**
 * Sits above the candidate list when this import dropped rows because
 * they matched something already booked. This is the headline case the
 * feature exists for: a user re-uploads the same sheet, the exact-charge
 * dedupe correctly drops every row again, and without this banner the
 * review page just shows an empty list under a header that does not
 * explain why. `duplicates` being non-empty is itself the caller's
 * signal to render; this component does not gate on a threshold.
 *
 * Purely presentational: no DB access. The caller (the import review
 * page) queries bank_import_duplicates and passes the rows straight
 * through.
 */
export function DuplicateSummaryBanner({
  publicId,
  totalRowsInFile,
  addedCount,
  duplicates,
}: {
  publicId: string;
  totalRowsInFile: number;
  addedCount: number;
  duplicates: SuppressedRow[];
}) {
  if (duplicates.length === 0) return null;

  return (
    <section className="mt-6 card p-5 border-gold-300/60">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
        Nothing new here
      </div>
      <p className="display text-base text-forest-900 mt-1">
        {totalRowsInFile} rows in the file, {addedCount} added,{" "}
        {duplicates.length} already imported
      </p>
      <p className="mt-1 text-xs text-ink-muted max-w-2xl leading-relaxed">
        {duplicates.length === totalRowsInFile
          ? "Every row in this upload matched a transaction already in your books, so nothing new was added."
          : `${duplicates.length} of ${totalRowsInFile} rows matched a transaction already in your books and were not added again.`}{" "}
        Nothing was deleted, these rows were simply never duplicated.
        Review the list below, or delete this import if it was uploaded
        in error.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer select-none text-xs text-forest-700 hover:text-forest-900">
          Show the {duplicates.length} suppressed row
          {duplicates.length === 1 ? "" : "s"}
        </summary>
        <ul className="mt-3 grid gap-2">
          {duplicates.map((d) => (
            <li key={d.id}>
              <DuplicateNotice
                kind="already_booked"
                publicId={publicId}
                description={d.description}
                postedAt={d.postedAt}
                amountCents={d.amountCents}
                existingTransactionId={d.existingTransactionId}
                existingImportId={d.existingImportId}
              />
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
