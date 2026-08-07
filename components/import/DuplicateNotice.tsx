import Link from "next/link";
import { formatCents } from "@/lib/tax/forecast";

/**
 * Marker for a row flagged in `bank_import_duplicates`.
 *
 * Two shapes, not one, because the two kinds describe different rows:
 *
 *   within_file    the row WAS inserted into bank_transactions (it just
 *                   also repeats another row in this file), so it has a
 *                   real txId and can be ignored like any other row.
 *   already_booked the row was DROPPED before insert (see
 *                   splitAlreadyBookedCharges in lib/csv/duplicates.ts):
 *                   there is no bank_transactions row for it, no txId,
 *                   and nothing to ignore. It is purely informational:
 *                   what got suppressed, and a link to the real row it
 *                   matched.
 *
 * Fix round 2: the original version required txId and posted it to
 * ignoreTx for BOTH kinds, but an already_booked row never exists to
 * have an id, so its primary case could not render (a form pointed
 * ignoreTx at a row that does not exist). Splitting into a discriminated
 * union makes that state impossible to construct, not just unlikely:
 * there is no txId prop to omit or forget on the already_booked branch.
 *
 * Deliberately a question, not a decision either way: duplicate status
 * never removes or blocks a row, it only surfaces "this looks identical
 * to something else, here's how to check."
 *
 * Presentational only, no client state, no DB access: the caller (the
 * import review page) fetches from bank_import_duplicates and decides
 * what to render this against.
 */
type Props =
  | {
      kind: "within_file";
      txId: string;
      importId: string;
      ignoreTx: (formData: FormData) => Promise<void>;
    }
  | {
      kind: "already_booked";
      publicId: string;
      description: string;
      postedAt: string;
      amountCents: number;
      existingTransactionId: string;
      existingImportId: string;
    };

function DuplicateIcon() {
  return (
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
  );
}

export function DuplicateNotice(props: Props) {
  if (props.kind === "already_booked") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-gold-900 bg-gold-50 border border-gold-200 rounded px-2.5 py-1.5">
        <DuplicateIcon />
        <span>
          {props.description} · {formatCents(props.amountCents)} ·{" "}
          {props.postedAt}: not added, identical to a row already booked.
        </span>
        <Link
          href={`/c/${props.publicId}/import/${props.existingImportId}?highlight=${props.existingTransactionId}`}
          className="underline underline-offset-2 hover:text-gold-950"
        >
          View it
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gold-900 bg-gold-50 border border-gold-200 rounded px-2.5 py-1.5">
      <DuplicateIcon />
      <span>
        Looks identical to another row in this file: same merchant, same
        date, same amount.
      </span>
      <form action={props.ignoreTx}>
        <input type="hidden" name="id" value={props.txId} />
        <input type="hidden" name="import_id" value={props.importId} />
        <button className="underline underline-offset-2 hover:text-gold-950">
          Ignore this row
        </button>
      </form>
    </div>
  );
}
