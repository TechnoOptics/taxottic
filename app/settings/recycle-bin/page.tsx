import Link from "next/link";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import {
  restoreBank,
  restoreCompany,
  purgeBank,
  purgeCompany,
  purgeExpiredRecycleBin,
} from "@/app/actions/recycle-bin";

export const metadata = {
  title: "Recycle bin - Taxottic",
  description:
    "Companies and bank connections you've moved to the recycle bin. Restore in one click, or permanently delete now. Items are auto-deleted after 30 days.",
  robots: { index: false, follow: false },
};

// /settings/recycle-bin
//
// Surfaces every soft-deleted company and bank connection the
// signed-in user owns, with a 30-day countdown until permanent
// deletion. The action buttons:
//
//   Restore       — clears deleted_at; the item is active again
//                   (banks come back in `needs_reauth` because the
//                   Plaid token was revoked on disconnect).
//
//   Delete now    — bypasses the 30-day wait and hard-deletes
//                   immediately. Cascades to every dependent row.
//                   Two-step: the action throws if the item isn't
//                   already soft-deleted, and the button label makes
//                   the irreversibility clear.
//
// We also call the purge sweep lazily on every page render so the
// list stays accurate even if the cron isn't wired yet — anything
// past 30 days hard-deletes BEFORE we read the recycle_bin view.
//
// The view is defined in migration 20260513000001_recycle_bin.sql.

type RecycleRow = {
  kind: "company" | "bank_connection";
  id: string;
  public_id: string;
  title: string;
  owner_user_id: string;
  deleted_at: string;
  purge_at: string;
};

export default async function RecycleBinPage() {
  const { admin, user } = await requireUserWithAdmin();

  // Lazy purge: hard-delete anything past 30 days BEFORE we read the
  // view, so the list doesn't show items that should already be gone.
  // The SQL function enforces the 30-day cutoff regardless of caller.
  try {
    await purgeExpiredRecycleBin();
  } catch {
    // Non-fatal: page still renders; cron is the backstop.
  }

  // Scope to this user's recycle bin. The view's WHERE clause already
  // joins through company_members.manager, so we just filter by
  // owner_user_id = current user.
  const { data: rows } = await admin
    .from("recycle_bin")
    .select("kind, id, public_id, title, owner_user_id, deleted_at, purge_at")
    .eq("owner_user_id", user.id)
    .order("deleted_at", { ascending: false });

  const items = (rows ?? []) as RecycleRow[];
  const companies = items.filter((r) => r.kind === "company");
  const banks = items.filter((r) => r.kind === "bank_connection");

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Profile
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Recycle bin</h1>
        <p className="mt-2 text-sm text-ink-soft max-w-2xl leading-relaxed">
          Companies and bank connections you&apos;ve removed live here for
          30 days. Restore in one click, or delete permanently now.
          After 30 days they&apos;re purged automatically and cannot be
          recovered.
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          Want a copy of everything first?{" "}
          <Link
            href="/settings/data"
            className="underline hover:text-forest-900"
          >
            Download my data
          </Link>
          .
        </p>

        {items.length === 0 ? (
          <section className="mt-8 card p-6 sm:p-10 text-center">
            <h2 className="display text-xl text-forest-900">
              Nothing here.
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              When you close a company or disconnect a bank, it lands
              here first. Clean.
            </p>
          </section>
        ) : null}

        {companies.length > 0 ? (
          <section className="mt-8">
            <h2 className="display text-xl text-forest-900">Companies</h2>
            <ul className="mt-3 grid gap-3">
              {companies.map((c) => (
                <RecycleRowCard
                  key={c.id}
                  row={c}
                  restoreAction={restoreCompany}
                  purgeAction={purgeCompany}
                  inputName="company_id"
                />
              ))}
            </ul>
          </section>
        ) : null}

        {banks.length > 0 ? (
          <section className="mt-8">
            <h2 className="display text-xl text-forest-900">
              Bank connections
            </h2>
            <ul className="mt-3 grid gap-3">
              {banks.map((b) => (
                <RecycleRowCard
                  key={b.id}
                  row={b}
                  restoreAction={restoreBank}
                  purgeAction={purgeBank}
                  inputName="connection_id"
                />
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-10 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
          Permanent deletion cascades: a company purge removes its bank
          connections, accounts, transactions, monthly income and
          expense entries, business profile, and team-membership rows.
          A bank-connection purge removes its accounts and historical
          transactions but keeps the company itself.
        </p>
      </section>
    </main>
  );
}

function RecycleRowCard({
  row,
  restoreAction,
  purgeAction,
  inputName,
}: {
  row: RecycleRow;
  restoreAction: (formData: FormData) => Promise<void>;
  purgeAction: (formData: FormData) => Promise<void>;
  inputName: "company_id" | "connection_id";
}) {
  const deletedAt = new Date(row.deleted_at);
  const purgeAt = new Date(row.purge_at);
  const now = Date.now();
  const daysLeft = Math.max(
    0,
    Math.ceil((purgeAt.getTime() - now) / 86_400_000),
  );
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <li className="card p-5 grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-base text-forest-900">{row.title}</h3>
        <span
          className={
            "text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full border " +
            (daysLeft <= 3
              ? "text-red-700 bg-red-50 border-red-100"
              : daysLeft <= 7
                ? "text-amber-800 bg-amber-50 border-amber-100"
                : "text-gold-700 bg-gold-50 border-gold-100")
          }
        >
          {daysLeft} day{daysLeft === 1 ? "" : "s"} left
        </span>
      </div>
      <div className="text-xs text-ink-muted flex flex-wrap gap-x-3 gap-y-0.5">
        <span>
          Closed{" "}
          <span className="text-forest-800 font-medium">
            {fmt.format(deletedAt)}
          </span>
        </span>
        <span>
          Auto-deletes{" "}
          <span className="text-forest-800 font-medium">
            {fmt.format(purgeAt)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <form action={restoreAction}>
          <input type="hidden" name={inputName} value={row.id} />
          <button
            type="submit"
            className="inline-flex items-center justify-center h-9 px-3 rounded-[0.625rem] border border-forest-200 bg-white text-sm text-forest-800 hover:bg-cream transition-colors"
          >
            Restore
          </button>
        </form>
        <form action={purgeAction}>
          <input type="hidden" name={inputName} value={row.id} />
          <button
            type="submit"
            className="inline-flex items-center justify-center h-9 px-3 rounded-[0.625rem] border border-red-200 bg-white text-sm text-red-700 hover:bg-red-50 transition-colors"
          >
            Delete permanently now
          </button>
        </form>
      </div>
    </li>
  );
}
