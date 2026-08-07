import Link from "next/link";
import type { DuplicateKind } from "@/lib/csv/duplicates";

/**
 * Inline marker for a row flagged in `bank_import_duplicates`.
 *
 * Deliberately a question, not a decision: duplicate status never
 * removes or blocks a row, it only surfaces "this looks identical to
 * something else, here's how to check." The caller (the import review
 * page) is what fetches the flag from bank_import_duplicates and
 * decides which row to attach this to; this component has no DB
 * access and takes only the data it needs to render.
 *
 * Presentational only, no client state, so it composes cleanly with
 * either a server-rendered row (TxRow) or a static preview.
 */
export function DuplicateNotice({
  kind,
  existingPostedAt,
  existingTransactionId,
  existingImportId,
  publicId,
  txId,
  importId,
  ignoreTx,
}: {
  kind: DuplicateKind;
  /** Only set for kind "already_booked": when the matching row was posted. */
  existingPostedAt?: string | null;
  existingTransactionId?: string | null;
  existingImportId?: string | null;
  publicId: string;
  txId: string;
  importId: string;
  ignoreTx: (formData: FormData) => Promise<void>;
}) {
  const sentence =
    kind === "already_booked"
      ? `Looks identical to a row you booked${existingPostedAt ? ` on ${existingPostedAt}` : ""}: same merchant, same date, same amount.`
      : "Looks identical to another row in this file: same merchant, same date, same amount.";
  const canViewOriginal =
    kind === "already_booked" && !!existingImportId && !!existingTransactionId;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gold-900 bg-gold-50 border border-gold-200 rounded px-2.5 py-1.5">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      >
        <rect x="7" y="7" width="12" height="12" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </svg>
      <span>{sentence}</span>
      {canViewOriginal ? (
        <Link
          href={`/c/${publicId}/import/${existingImportId}?highlight=${existingTransactionId}`}
          className="underline underline-offset-2 hover:text-gold-950"
        >
          View it
        </Link>
      ) : null}
      <form action={ignoreTx}>
        <input type="hidden" name="id" value={txId} />
        <input type="hidden" name="import_id" value={importId} />
        <button className="underline underline-offset-2 hover:text-gold-950">
          Ignore this row
        </button>
      </form>
    </div>
  );
}
