import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { formatCents } from "@/lib/tax/forecast";
import { TransactionsBulkDeleter } from "@/components/banking/TransactionsBulkDeleter";
import { deleteAccountTransactionsForEngagement } from "./actions";

// Tier 2 #5: Firm-side Plaid bank-feed viewer.
//
// Until now the firm could only see banking activity by hopping into
// the consumer surface at `/c/{publicId}/banks`. That works, but it
// flips the chrome, the preparer briefly identifies as the client.
// This page renders the same data inside the firm cockpit chrome so
// the preparer never breaks context.
//
// Scope:
//   - Read-only, connecting a bank is a consumer-side action that
//     legally must be the company owner (Plaid Link's flow records
//     consent against the user, not the firm).
//   - Shows connections, accounts under each connection, and the
//     last 50 transactions across all accounts on the engagement.
//   - Calls out which transactions are still pending triage so the
//     preparer knows what's left for them to categorize.

export const dynamic = "force-dynamic";

type Params = Promise<{ engagementId: string }>;

const CONN_STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  needs_reauth: "bg-amber-50 text-amber-800 border-amber-200",
  pending: "bg-cream-200 text-forest-800 border-forest-200",
  revoked: "bg-red-50 text-red-700 border-red-200",
  error: "bg-red-50 text-red-700 border-red-200",
};

const TX_ACTION_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  applied: "bg-emerald-50 text-emerald-700 border-emerald-200",
  dismissed: "bg-cream-100 text-ink-muted border-forest-100",
  split: "bg-cream-200 text-forest-800 border-forest-200",
};

export default async function FirmBanksPage({
  params,
}: {
  params: Params;
}) {
  const { engagementId } = await params;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, firm_id, tax_year, company:companies!inner(id, public_id, name)")
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) notFound();
  const engagement = eng as unknown as {
    id: string;
    firm_id: string;
    tax_year: number;
    company: { id: string; public_id: string; name: string };
  };

  // Connections + accounts in one round-trip with a nested select.
  const { data: connectionsRaw } = await admin
    .from("bank_connections")
    .select(
      "id, provider, institution_name, institution_logo_url, status, last_synced_at, last_error, created_at, accounts:bank_accounts(id, name, official_name, account_type, account_subtype, mask, current_balance_cents, iso_currency_code, is_excluded)",
    )
    .eq("company_id", engagement.company.id)
    // Mirror the consumer banks page (/c/[publicId]/banks): a
    // disconnected connection lives in the recycle bin and must not
    // count as a live link from the firm view either. Without this
    // filter a "1 connection / 1 account" line lingered on the firm
    // page after the owner had already disconnected the bank on the
    // consumer side.
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  type ConnRow = {
    id: string;
    provider: string;
    institution_name: string | null;
    institution_logo_url: string | null;
    status: string;
    last_synced_at: string | null;
    last_error: string | null;
    created_at: string;
    accounts: Array<{
      id: string;
      name: string | null;
      official_name: string | null;
      account_type: string | null;
      account_subtype: string | null;
      mask: string | null;
      current_balance_cents: number | null;
      iso_currency_code: string | null;
      is_excluded: boolean;
    }>;
  };
  const connections = (connectionsRaw ?? []) as unknown as ConnRow[];
  const accountIds = connections.flatMap((c) => c.accounts.map((a) => a.id));

  // Last 50 transactions across all accounts.
  const { data: txRows } = accountIds.length
    ? await admin
        .from("account_transactions")
        .select(
          "id, account_id, posted_date, amount_cents, iso_currency_code, merchant_name, description, user_action, is_pending, category_path",
        )
        .in("account_id", accountIds)
        .order("posted_date", { ascending: false })
        .limit(50)
    : { data: [] as Array<{
        id: string;
        account_id: string;
        posted_date: string;
        amount_cents: number;
        iso_currency_code: string | null;
        merchant_name: string | null;
        description: string | null;
        user_action: string;
        is_pending: boolean;
        category_path: string[] | null;
      }> };
  const transactions = txRows ?? [];

  // Pending count is the most useful "what do you owe me" metric.
  const { count: pendingCount } = accountIds.length
    ? await admin
        .from("account_transactions")
        .select("id", { count: "exact", head: true })
        .in("account_id", accountIds)
        .eq("user_action", "pending")
    : { count: 0 };

  const accountLabel = new Map<string, string>();
  for (const c of connections) {
    for (const a of c.accounts) {
      const inst = c.institution_name ?? "Bank";
      const tail = a.mask ? `··${a.mask}` : "";
      accountLabel.set(
        a.id,
        `${inst} ${a.name ?? a.official_name ?? a.account_type ?? "Account"} ${tail}`.trim(),
      );
    }
  }

  const totalBalance = connections.reduce(
    (sum, c) =>
      sum +
      c.accounts.reduce(
        (s, a) => s + (a.is_excluded ? 0 : a.current_balance_cents ?? 0),
        0,
      ),
    0,
  );

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href={`/firm/clients/${engagement.id}`}
            className="underline decoration-dotted hover:text-forest-900"
          >
            {engagement.company.name}
          </Link>{" "}
          · Bank feeds
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Live bank activity.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-2xl">
          Read-only view of the client&apos;s connected bank
          accounts. Connections are managed by the client at{" "}
          <Link
            href={`/c/${engagement.company.public_id}/banks`}
            className="underline hover:text-forest-800"
          >
            their bank dashboard
          </Link>
          ; we surface them here so you don&apos;t have to leave the
          firm cockpit to confirm what&apos;s synced.
        </p>

        <div className="mt-6 grid sm:grid-cols-3 gap-3">
          <Stat label="Connections" value={connections.length} />
          <Stat label="Tracked balance" value={formatCents(totalBalance)} />
          <Stat
            label="Pending triage"
            value={pendingCount ?? 0}
            tone={pendingCount && pendingCount > 0 ? "warn" : "good"}
          />
        </div>

        {connections.length === 0 ? (
          <div className="mt-6 card p-6 text-center">
            <h2 className="display text-xl text-forest-900">
              No banks connected yet.
            </h2>
            <p className="mt-2 text-sm text-ink-soft max-w-md mx-auto">
              Once {engagement.company.name} links a checking or
              business credit card via Plaid, the connection will
              appear here within a few minutes.
            </p>
          </div>
        ) : (
          <section className="mt-6 grid gap-4">
            {connections.map((c) => (
              <article key={c.id} className="card p-5">
                <header className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="display text-xl text-forest-900">
                      {c.institution_name ?? "Bank connection"}
                    </h2>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {c.provider} ·{" "}
                      {c.last_synced_at
                        ? `Synced ${new Date(c.last_synced_at).toLocaleString()}`
                        : "Never synced"}
                    </div>
                  </div>
                  <span
                    className={
                      "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                      (CONN_STATUS_TONE[c.status] ??
                        "bg-cream-100 text-ink-muted border-forest-100")
                    }
                  >
                    {c.status}
                  </span>
                </header>
                {c.last_error ? (
                  <p className="mt-2 text-xs text-red-700">
                    Last error: {c.last_error}
                  </p>
                ) : null}
                <ul className="mt-3 grid gap-2">
                  {c.accounts.map((a) => (
                    <li
                      key={a.id}
                      className="grid grid-cols-[1fr_auto] gap-2 items-center border-t border-forest-100 pt-2 first:border-t-0 first:pt-0"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-forest-900">
                          {a.name ?? a.official_name ?? "Account"}{" "}
                          {a.mask ? (
                            <span className="text-ink-muted">··{a.mask}</span>
                          ) : null}
                          {a.is_excluded ? (
                            <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                              · excluded
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-ink-muted">
                          {a.account_type ?? "-"}
                          {a.account_subtype ? ` · ${a.account_subtype}` : ""}
                        </div>
                      </div>
                      <div className="text-sm text-forest-900 tabular-nums">
                        {formatCents(a.current_balance_cents ?? 0)}
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        )}

        {transactions.length > 0 ? (
          <section className="mt-8">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <h2 className="display text-xl text-forest-900">
                Recent transactions
              </h2>
              <div className="flex items-center gap-4">
                <TransactionsBulkDeleter
                  action={deleteAccountTransactionsForEngagement}
                  hiddenFields={{ engagement_id: engagementId }}
                  transactions={transactions.map((t) => ({
                    id: t.id,
                    merchant:
                      t.merchant_name ?? t.description ?? "Transaction",
                    date: t.posted_date,
                    amountCents: t.amount_cents,
                  }))}
                />
                <span className="text-xs text-ink-muted">Last 50</span>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-[0.15em] text-ink-muted text-left">
                  <tr>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Merchant</th>
                    <th className="py-2 pr-3">Account</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr
                      key={t.id}
                      className="border-t border-forest-100 align-top"
                    >
                      <td className="py-2 pr-3 text-ink-soft whitespace-nowrap tabular-nums">
                        {t.posted_date}
                      </td>
                      <td className="py-2 pr-3 text-forest-900">
                        {t.merchant_name ?? t.description ?? "-"}
                        {t.is_pending ? (
                          <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-amber-700">
                            pending
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-ink-soft">
                        {accountLabel.get(t.account_id) ??
                          t.account_id.slice(0, 8)}
                      </td>
                      <td className="py-2 pr-3 text-forest-900 tabular-nums text-right">
                        {formatCents(t.amount_cents)}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                            (TX_ACTION_TONE[t.user_action] ??
                              "bg-cream-100 text-ink-muted border-forest-100")
                          }
                        >
                          {t.user_action}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "warn" | "good";
}) {
  const dot =
    tone === "warn"
      ? "bg-amber-400"
      : tone === "good"
        ? "bg-emerald-500"
        : "bg-gold-400";
  return (
    <article className="card p-4 flex items-center gap-3">
      <span aria-hidden="true" className={"size-2.5 rounded-full " + dot} />
      <div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
          {label}
        </div>
        <div className="display text-2xl text-forest-900 tabular-nums mt-0.5">
          {value}
        </div>
      </div>
    </article>
  );
}
