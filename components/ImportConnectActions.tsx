import Link from "next/link";

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * "Bring it in faster" actions for the Income + Expenses pages: import a
 * CSV, or connect a bank account. These used to live ONLY in each page's
 * empty state, so the moment a user logged a single row the fast path to
 * backfill a whole year vanished. Now they sit right under the page
 * header, always available and identical on both screens.
 *
 * The import flow is generic (it categorizes deposits as income and
 * debits as expenses), so both screens point at the same /import + /banks
 * routes — `kind` only tweaks the label so it reads naturally per page.
 */
export function ImportConnectActions({
  publicId,
  kind,
}: {
  publicId: string;
  kind: "income" | "expenses";
}) {
  return (
    <div className="mt-6 surface p-4 flex flex-wrap items-center gap-x-4 gap-y-3">
      <span className="text-[13px] text-ink-soft">
        Have a lot to add? Bring in a whole year at once:
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/c/${publicId}/import`}
          className="btn-ghost text-xs px-3 h-9 inline-flex items-center gap-1.5"
        >
          <Icon d="M4 17v3h16v-3M12 3v12m0 0l-4-4m4 4l4-4" />
          Import {kind} (CSV)
        </Link>
        <Link
          href={`/c/${publicId}/banks`}
          className="btn-ghost text-xs px-3 h-9 inline-flex items-center gap-1.5"
        >
          <Icon d="M4 21h16V8l-8-5-8 5v13zM10 21v-6h4v6" />
          Connect an account
        </Link>
      </div>
    </div>
  );
}
