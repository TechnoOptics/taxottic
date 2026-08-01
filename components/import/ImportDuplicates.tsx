import Link from "next/link";
import { formatCents } from "@/lib/tax/forecast";

/**
 * The rows this import held back as duplicates.
 *
 * These used to be filtered out before insert and never mentioned. That is a
 * quiet way to lose a real expense: a statement that genuinely lists two
 * identical $40 charges had one of them deleted, the "rows uploaded" count
 * still included it, and nothing on the screen accounted for the difference.
 *
 * Showing them costs a collapsed panel and removes an entire class of "my
 * numbers do not add up" that the user can never diagnose on their own.
 */

export type DuplicateRecord = {
  id: string;
  posted_at: string | null;
  description: string;
  amount_cents: number;
  kind: "within_file" | "already_booked";
  existing_import_id: string | null;
};

export function ImportDuplicates({
  duplicates,
  publicId,
}: {
  duplicates: DuplicateRecord[];
  publicId: string;
}) {
  if (duplicates.length === 0) return null;

  const booked = duplicates.filter((d) => d.kind === "already_booked");
  const withinFile = duplicates.filter((d) => d.kind === "within_file");

  return (
    <section className="mt-6 card p-5">
      <details>
        <summary className="flex min-h-11 cursor-pointer select-none flex-wrap items-center justify-between gap-3">
          <span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-gold-700">
              Duplicates found and held back
            </span>
            <span className="mt-1 block text-base text-foreground display">
              {duplicates.length}{" "}
              {duplicates.length === 1 ? "row" : "rows"} not imported
            </span>
          </span>
          <span className="text-xs text-muted">Show the list</span>
        </summary>

        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">
          These were left out so they cannot be deducted twice. Nothing has
          been deleted from your books. If one of them is a genuine second
          charge for the same amount on the same day, add it from the Expenses
          tab.
        </p>

        {booked.length > 0 ? (
          <div className="mt-4">
            <h3 className="section-title">
              Already in your books ({booked.length})
            </h3>
            <ul className="mt-2 grid gap-1.5">
              {booked.map((d) => (
                <DuplicateRow key={d.id} d={d} publicId={publicId} />
              ))}
            </ul>
          </div>
        ) : null}

        {withinFile.length > 0 ? (
          <div className="mt-4">
            <h3 className="section-title">
              Listed twice in this file ({withinFile.length})
            </h3>
            <ul className="mt-2 grid gap-1.5">
              {withinFile.map((d) => (
                <DuplicateRow key={d.id} d={d} publicId={publicId} />
              ))}
            </ul>
          </div>
        ) : null}
      </details>
    </section>
  );
}

function DuplicateRow({
  d,
  publicId,
}: {
  d: DuplicateRecord;
  publicId: string;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-edge px-3 py-2 text-sm">
      {/* min-w-0 on the growing child is what stops a long merchant name
          collapsing into a one-character column at 344px. */}
      <span className="min-w-0 flex-1 break-words text-foreground">
        {d.description}
      </span>
      <span className="shrink-0 text-xs text-muted">{d.posted_at ?? "no date"}</span>
      <span className="shrink-0 tabular-nums text-foreground">
        {formatCents(d.amount_cents)}
      </span>
      {d.kind === "already_booked" && d.existing_import_id ? (
        <Link
          href={`/c/${publicId}/import/${d.existing_import_id}`}
          className="shrink-0 text-xs text-gold-800 underline underline-offset-2 hover:text-gold-900"
        >
          See the original
        </Link>
      ) : null}
    </li>
  );
}
