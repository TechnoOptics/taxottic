import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { ProGate } from "@/components/ProGate";
import { PlaidConnectButton } from "@/components/PlaidConnectButton";
import { PlaidSyncButton } from "@/components/PlaidSyncButton";
import { PlaidAutoSync } from "@/components/PlaidAutoSync";
import { StripeConnectButton } from "@/components/StripeConnectButton";
import { StripeSyncButton } from "@/components/StripeSyncButton";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { getActiveFeatureGates } from "@/lib/plans/usage";
import { findMasterForExpense } from "@/lib/deductions/matcher";
import { disconnectBank } from "@/app/actions/recycle-bin";

type Params = Promise<{ publicId: string }>;
type SearchParams = Promise<{
  stripe_connected?: string | string[];
  stripe_error?: string | string[];
}>;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  active: "Connected",
  needs_reauth: "Needs sign-in",
  revoked: "Revoked",
  error: "Error",
};

export default async function BanksPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: SearchParams;
}) {
  const { publicId } = await params;
  const sp = (await searchParams) ?? {};
  const stripeConnectedRaw = sp.stripe_connected;
  const stripeErrorRaw = sp.stripe_error;
  const stripeConnectedFlag = Array.isArray(stripeConnectedRaw)
    ? stripeConnectedRaw[0]
    : stripeConnectedRaw;
  const stripeErrorMsg = Array.isArray(stripeErrorRaw)
    ? stripeErrorRaw[0]
    : stripeErrorRaw;
  const { supabase, user, company, isManager } =
    await loadCompanyByPublicId(publicId);

  // Free plan: render the upgrade card instead of the live page.
  const { gates } = await getActiveFeatureGates(supabase, user.id);
  if (!gates.bankConnect) {
    return (
      <main id="main" className="min-h-screen">
        <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
        <section className="max-w-3xl mx-auto px-6 py-10">
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            {company.public_id} <span className="text-gold-500">·</span> Banks
          </div>
          <h1 className="display mt-2 text-3xl text-forest-900">
            {company.name}
          </h1>
          <div aria-hidden="true" className="gold-flourish mt-3">
            <span />
          </div>
          <div className="mt-6">
            <CompanyNav publicId={publicId} active="banks" />
          </div>
          <ProGate
            feature="Bank connections"
            pitch="Connect your business bank in two clicks and Taxottic syncs every transaction monthly, suggests an IRS-aligned deduction category, and feeds the data straight into your forecast. Sales-tax breakdowns flow automatically."
            perks={[
              "Auto-categorize 100+ common merchants (SaaS, ad spend, travel, meals, fuel, utilities, professional fees)",
              "Sales-tax extraction when the bank feed includes it",
              "Monthly transaction review queue, one-tap apply",
              "Plus everything in Pro: Bella AI, team chat, find-a-CPA, multi-company",
            ]}
            reason="bank_connect"
          />
        </section>
      </main>
    );
  }

  // Pull existing connections + accounts + counts of pending review +
  // the most recent applied transactions (to display the master deduction
  // match Bella suggested for each row).
  const [
    { data: connections },
    { data: accounts },
    { count: pendingTxCount },
    { count: appliedTxCount },
    { data: recentTx },
  ] = await Promise.all([
    supabase
      .from("bank_connections")
      .select(
        "id, provider, institution_name, institution_logo_url, status, last_synced_at, last_error",
      )
      .eq("company_id", company.id)
      // Hide disconnected connections (in the recycle bin). They're
      // visible in /settings/recycle-bin where the user can Restore
      // or Permanently delete them.
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("bank_accounts")
      .select(
        "id, name, official_name, account_subtype, mask, current_balance_cents, is_excluded, connection_id",
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("account_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_action", "pending"),
    supabase
      .from("account_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_action", "applied"),
    supabase
      .from("account_transactions")
      .select(
        "id, posted_date, amount_cents, merchant_name, description, personal_finance_category, user_action",
      )
      .order("posted_date", { ascending: false })
      .limit(20),
  ]);

  type ConnRow = {
    id: string;
    provider: string;
    institution_name: string | null;
    institution_logo_url: string | null;
    status: string;
    last_synced_at: string | null;
    last_error: string | null;
  };
  const conns = (connections ?? []) as ConnRow[];

  type AcctRow = {
    id: string;
    connection_id: string;
    name: string | null;
    official_name: string | null;
    account_subtype: string | null;
    mask: string | null;
    current_balance_cents: number | null;
    is_excluded: boolean;
  };
  const accts = (accounts ?? []) as AcctRow[];

  type TxRow = {
    id: string;
    posted_date: string;
    amount_cents: number;
    merchant_name: string | null;
    description: string | null;
    personal_finance_category: string | null;
    user_action: string;
  };
  const txs = (recentTx ?? []) as TxRow[];

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-4xl mx-auto px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-500">·</span> Banks
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          {company.name}
        </h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="banks" />
        </div>

        {/* Hero / connect card */}
        <section className="mt-6 card p-6 sm:p-7">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="max-w-xl">
              <h2 className="display text-xl text-forest-900">
                Pull transactions on autopilot.
              </h2>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                Connect your business bank account and Taxottic syncs
                transactions monthly, suggests an IRS-aligned deduction
                category for each, and feeds the data straight into your
                forecast. Sales-tax breakdowns flow into the{" "}
                <Link
                  href={`/c/${publicId}/sales-tax`}
                  className="underline hover:text-forest-900"
                >
                  Sales tax
                </Link>{" "}
                tab.
              </p>
            </div>
            {isManager ? (
              <div className="flex flex-col gap-2 items-end">
                <PlaidConnectButton
                  companyPublicId={publicId}
                  companyId={company.id}
                  className="btn-primary text-sm"
                />
                <StripeConnectButton
                  companyId={company.id}
                  className="btn-ghost text-xs whitespace-nowrap"
                />
              </div>
            ) : (
              <p className="text-xs text-ink-muted max-w-[14rem]">
                Only the company manager can connect a bank.
              </p>
            )}
          </div>

          {/* Stripe OAuth round-trip success/error toast. The
              oauth-return route lands here with one of these
              query params; we surface a short banner so the user
              knows it took. */}
          {stripeConnectedFlag ? (
            <div
              role="status"
              className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
            >
              Stripe connected. Your balance transactions are syncing — the
              first batch lands in the review queue below within a minute.
            </div>
          ) : null}
          {stripeErrorMsg ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              Stripe connection failed: {stripeErrorMsg}
            </div>
          ) : null}

          <div className="mt-5 grid sm:grid-cols-3 gap-3">
            <Stat
              label="Connections"
              value={conns.length}
              hint={
                conns.length === 0
                  ? "No banks connected yet"
                  : `${conns.filter((c) => c.status === "active").length} active`
              }
            />
            <Stat
              label="Accounts"
              value={accts.length}
              hint={`${accts.filter((a) => !a.is_excluded).length} included`}
            />
            <Stat
              label="Pending review"
              value={pendingTxCount ?? 0}
              tone={(pendingTxCount ?? 0) > 0 ? "accent" : undefined}
              hint={
                appliedTxCount
                  ? `${appliedTxCount} already applied`
                  : "Transactions land here for one-tap categorization"
              }
            />
          </div>
        </section>

        {/* Background sync on mount: any connection more than 15 min
            stale gets a fresh /transactions/sync + auto-apply pass,
            then the page refreshes. Cron picks up off-page updates. */}
        {conns.length > 0 ? (
          <PlaidAutoSync
            connections={conns.map((c) => ({
              id: c.id,
              lastSyncedAt: c.last_synced_at,
            }))}
          />
        ) : null}

        {/* Existing connections */}
        {conns.length > 0 ? (
          <section className="mt-6">
            <h2 className="display text-xl text-forest-900">
              Connected banks
            </h2>
            <ul className="mt-3 grid gap-2">
              {conns.map((c) => {
                const acctsForConn = accts.filter(
                  (a) => a.connection_id === c.id,
                );
                return (
                  <li key={c.id} className="card p-0 overflow-hidden">
                    {/* Native <details>/<summary> = no client JS, no
                        flicker, native chevron rotation via the marker. */}
                    <details className="group">
                      <summary className="list-none cursor-pointer p-5 flex items-center justify-between gap-3 flex-wrap select-none hover:bg-cream/40">
                        <div className="flex items-center gap-3 min-w-0">
                          {c.institution_logo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.institution_logo_url}
                              alt=""
                              className="size-10 rounded-lg border border-forest-100 bg-white object-contain p-1"
                            />
                          ) : (
                            <span className="size-10 rounded-lg bg-cream/70 border border-forest-100 grid place-items-center display text-base text-forest-900">
                              {(c.institution_name ?? "?")
                                .charAt(0)
                                .toUpperCase()}
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="display text-base text-forest-900 truncate">
                              {c.institution_name ?? "Unknown bank"}
                            </div>
                            <div className="text-xs text-ink-muted mt-0.5">
                              {STATUS_LABEL[c.status] ?? c.status}
                              {c.last_synced_at
                                ? ` · last sync ${new Date(c.last_synced_at).toLocaleDateString()}`
                                : ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-ink-muted">
                          {/* Provider-specific sync button. Stripe
                              connections call /api/banks/stripe/sync
                              (balance_transactions cursor), Plaid
                              connections call /api/banks/plaid/sync
                              (transactions/sync). Other providers
                              fall back to the Plaid button since the
                              codebase doesn't have separate sync
                              routes for them yet. */}
                          {c.provider === "stripe" ? (
                            <StripeSyncButton connectionId={c.id} />
                          ) : (
                            <PlaidSyncButton connectionId={c.id} />
                          )}
                          <span>
                            {acctsForConn.length} account
                            {acctsForConn.length === 1 ? "" : "s"}
                          </span>
                          {/* Chevron rotates 180deg when <details> is open. */}
                          <svg
                            className="size-4 text-forest-700 transition-transform group-open:rotate-180"
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 8l4 4 4-4"
                            />
                          </svg>
                        </div>
                      </summary>
                      {/* Disconnect — manager-only. Routes through
                          /app/actions/recycle-bin.ts: soft-deletes the
                          connection, revokes the Plaid access token,
                          and the row goes to /settings/recycle-bin
                          for 30 days before final purge. Confirmation
                          happens via native confirm() in the form's
                          onSubmit, which Next.js progressively enhances
                          for the JS-disabled fallback. */}
                      {isManager ? (
                        <div className="px-5 py-3 border-t border-forest-100 bg-cream/30 flex items-center justify-between gap-3 flex-wrap">
                          <p className="text-[11px] text-ink-muted leading-relaxed max-w-md">
                            Disconnect revokes Plaid&apos;s access token
                            immediately. The bank moves to your{" "}
                            <a
                              href="/settings/recycle-bin"
                              className="underline hover:text-forest-800"
                            >
                              recycle bin
                            </a>{" "}
                            for 30 days; restore in one click, or
                            permanently delete from there.
                          </p>
                          <form action={disconnectBank}>
                            <input
                              type="hidden"
                              name="connection_id"
                              value={c.id}
                            />
                            <button
                              type="submit"
                              className="text-xs text-red-700 hover:text-red-900 underline underline-offset-2"
                            >
                              Disconnect bank
                            </button>
                          </form>
                        </div>
                      ) : null}
                      {acctsForConn.length > 0 ? (
                        <ul className="border-t border-forest-100 divide-y divide-forest-50">
                          {acctsForConn.map((a) => (
                            <li
                              key={a.id}
                              className="px-5 py-3 flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <div className="text-sm text-forest-900 truncate">
                                  {a.official_name ?? a.name ?? "Account"}
                                  {a.mask ? (
                                    <span className="ml-2 text-xs text-ink-muted">
                                      ····{a.mask}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-[11px] text-ink-muted mt-0.5">
                                  {a.account_subtype
                                    ? a.account_subtype.replace(/_/g, " ")
                                    : "account"}
                                  {a.is_excluded ? " · excluded" : ""}
                                </div>
                              </div>
                              <div className="text-sm text-forest-900 tabular-nums">
                                {a.current_balance_cents != null
                                  ? new Intl.NumberFormat("en-US", {
                                      style: "currency",
                                      currency: "USD",
                                    }).format(a.current_balance_cents / 100)
                                  : "-"}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="px-5 pb-4 text-xs text-ink-muted">
                          No accounts found yet. Run a sync to pull
                          accounts and balances.
                        </p>
                      )}
                      {c.last_error ? (
                        <p className="px-5 pb-4 text-xs text-red-700">
                          {c.last_error}
                        </p>
                      ) : null}
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* Recent transactions with Bella's master-deduction match.
            On each row we look up the best-fit IRS deduction for the
            merchant + Plaid category and surface its name + IRS source
            link so users see WHICH specific deduction is being claimed,
            not just the broad Schedule C bucket. */}
        {txs.length > 0 ? (
          <section className="mt-8">
            <div className="flex items-end justify-between flex-wrap gap-3">
              <div>
                <h2 className="display text-xl text-forest-900">
                  Recent transactions
                </h2>
                <p className="text-xs text-ink-muted mt-1">
                  Bella suggests an IRS-aligned deduction for each. Click a
                  source link to verify before tax day.
                </p>
              </div>
              <Link
                href={`/c/${publicId}/deductions`}
                className="text-xs text-forest-700 hover:text-forest-900 underline underline-offset-2"
              >
                Browse all deductions →
              </Link>
            </div>
            <ul className="mt-3 grid gap-2">
              {txs.map((t) => {
                const merchant = t.merchant_name ?? t.description ?? "Transaction";
                const isExpense = t.amount_cents > 0;
                const master = isExpense
                  ? findMasterForExpense(merchant, t.personal_finance_category)
                  : null;
                const amount = new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                }).format(Math.abs(t.amount_cents) / 100);
                const date = new Date(t.posted_date).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric" },
                );
                return (
                  <li
                    key={t.id}
                    className="card p-3 sm:p-4 flex items-start gap-3 sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm sm:text-base text-forest-900 font-medium truncate">
                          {merchant}
                        </span>
                        <span className="text-[11px] text-ink-muted">{date}</span>
                      </div>
                      {master ? (
                        <div className="mt-1 text-[11px] text-forest-700 leading-relaxed">
                          <span className="text-gold-600 mr-1">↳</span>
                          Bella suggested:{" "}
                          <span className="text-forest-900 font-medium">
                            {master.name}
                          </span>{" "}
                          <span className="text-ink-muted">
                            ({master.category})
                          </span>{" "}
                          <a
                            href={master.source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-forest-900"
                          >
                            IRS source ↗
                          </a>
                        </div>
                      ) : isExpense ? (
                        <div className="mt-1 text-[11px] text-ink-muted">
                          No master-deduction match - categorized to the
                          generic Schedule C bucket.
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-ink-muted">
                          Inflow / refund · not categorized as a deduction.
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={
                          "text-sm tabular-nums " +
                          (isExpense
                            ? "text-forest-900"
                            : "text-emerald-700")
                        }
                      >
                        {isExpense ? amount : `+${amount}`}
                      </span>
                      <span
                        className={
                          "text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border " +
                          (t.user_action === "applied"
                            ? "text-emerald-700 bg-emerald-50 border-emerald-100"
                            : t.user_action === "dismissed"
                              ? "text-ink-muted bg-forest-50 border-forest-100"
                              : "text-gold-700 bg-gold-50 border-gold-100")
                        }
                      >
                        {t.user_action}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* What's coming */}
        <section className="mt-8 card p-6 sm:p-7 border-gold-300/60">
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
            Roadmap
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            What lights up when banks are connected
          </h2>
          <ul className="mt-4 grid gap-3">
            <RoadmapStep
              title="Monthly sync (Plaid)"
              body="Connect once. Each month we pull every transaction across every account, dedupe, and queue them for review."
              status="next"
            />
            <RoadmapStep
              title="Auto-categorization"
              body="A pattern library covering 100+ common merchants suggests an IRS-aligned deduction code (Schedule C lines + their above-the-line cousins). Greater than 88% confidence auto-applies; the rest you confirm in one tap."
              status="ready"
            />
            <RoadmapStep
              title="Sales-tax extraction"
              body="When the bank feed includes the tax breakdown, we strip it out automatically. Otherwise enter it once and the rule sticks for that merchant going forward."
              status="ready"
            />
            <RoadmapStep
              title="Income vs. expense report"
              body="Side-by-side monthly ledger you can export to a CPA or print to PDF. Already built; gets richer once live transactions land."
              status="live"
            />
          </ul>
        </section>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "accent";
}) {
  return (
    <div
      className={
        "rounded-xl p-4 " +
        (tone === "accent"
          ? "bg-forest-800 text-cream"
          : "bg-white border border-forest-100")
      }
    >
      <div
        className={
          "text-[10px] uppercase tracking-[0.2em] " +
          (tone === "accent" ? "text-gold-300" : "text-gold-700")
        }
      >
        {label}
      </div>
      <div
        className={
          "display text-2xl mt-1 tabular-nums " +
          (tone === "accent" ? "text-cream" : "text-forest-900")
        }
      >
        {value}
      </div>
      {hint ? (
        <div
          className={
            "text-[11px] mt-1 leading-relaxed " +
            (tone === "accent" ? "text-cream/75" : "text-ink-muted")
          }
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function RoadmapStep({
  title,
  body,
  status,
}: {
  title: string;
  body: string;
  status: "live" | "ready" | "next";
}) {
  const label = {
    live: "Live now",
    ready: "Engine ready",
    next: "Next up",
  }[status];
  const dotClass = {
    live: "bg-emerald-600",
    ready: "bg-gold-500",
    next: "bg-forest-700",
  }[status];
  return (
    <li className="flex items-start gap-3">
      <span className={"mt-1.5 size-2 rounded-full shrink-0 " + dotClass} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-forest-900">{title}</span>
          <span className="text-[10px] uppercase tracking-wide text-gold-700">
            {label}
          </span>
        </div>
        <p className="text-xs text-ink-soft mt-0.5 leading-relaxed">{body}</p>
      </div>
    </li>
  );
}
