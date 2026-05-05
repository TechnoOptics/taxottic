import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import {
  BELLA_MODEL_BY_PLAN,
  CREDIT_PACKS,
  CREDIT_ROLLOVER_MULTIPLIER,
  PLAN_LIMITS,
  PLAN_PRICING,
  TOPUP_CAP_MULTIPLIER,
  formatLimit,
  planLabel,
  type Plan,
  type SubscriptionPriceKey,
} from "@/lib/plans/limits";
import { getActivePlan } from "@/lib/plans/usage";
import { getBalance, topUpRemaining } from "@/lib/plans/credits";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ManageBillingButton } from "@/components/ManageBillingButton";
import { setAutoTopUpAction } from "./actions";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const { status } = await searchParams;

  const [plan, balance, sub] = await Promise.all([
    getActivePlan(supabase, user.id),
    getBalance(admin, user.id),
    admin
      .from("subscriptions")
      .select(
        "status, current_period_end, cancel_at_period_end, auto_topup_pack, auto_topup_threshold_credits, last_credit_grant_at",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const limits = PLAN_LIMITS[plan];
  const grantCap = Number.isFinite(limits.monthlyCreditGrant)
    ? limits.monthlyCreditGrant * CREDIT_ROLLOVER_MULTIPLIER
    : Number.POSITIVE_INFINITY;
  const remainingTopup = await topUpRemaining(admin, user.id, plan);

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl mx-auto px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Billing
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          {plan === "free" ? "Choose your plan" : `You're on ${planLabel(plan)}`}
        </h1>

        {status === "success" ? (
          <p className="mt-3 text-sm text-emerald-800">
            Payment successful. It can take a few seconds for changes to land.
          </p>
        ) : null}
        {status === "cancel" ? (
          <p className="mt-3 text-sm text-amber-800">Checkout cancelled.</p>
        ) : null}

        {/* Credit balance card — visible to everyone, even free users
            (so they see what they're missing). */}
        {plan !== "free" ? (
          <div className="card mt-6 p-6">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
                  Credits
                </div>
                <div className="display text-3xl text-forest-900 mt-1 tabular-nums">
                  {balance.toLocaleString()}
                </div>
                <div className="text-xs text-ink-muted mt-1">
                  {planLabel(plan)} grants {limits.monthlyCreditGrant} credits per
                  billing period · rollover capped at {grantCap.toLocaleString()}
                </div>
              </div>
              <ManageBillingButton />
            </div>
            <div className="mt-4 h-2 rounded-full bg-forest-50 overflow-hidden">
              <div
                className="h-full bg-gold-400 transition-[width] duration-500"
                style={{
                  width: `${Math.min(100, Number.isFinite(grantCap) ? (balance / grantCap) * 100 : 100)}%`,
                }}
              />
            </div>
            <p className="mt-3 text-[11px] text-ink-muted leading-relaxed">
              Bella runs on{" "}
              <span className="text-forest-800 font-medium">
                {BELLA_MODEL_BY_PLAN[plan]?.toUpperCase() ?? "—"}
              </span>{" "}
              at this tier. Each question costs{" "}
              {plan === "filer"
                ? "1 credit"
                : plan === "scale" || plan === "practice"
                  ? "12 credits"
                  : "4 credits"}
              . Receipts cost 2, prior-year docs cost 5.
            </p>
          </div>
        ) : null}

        {/* Subscription tier ladder — collapsed when on a paid plan. */}
        {plan === "free" ? (
          <PlanLadder />
        ) : (
          <details className="card mt-4 p-4">
            <summary className="cursor-pointer text-sm text-forest-800">
              Change tier
            </summary>
            <div className="mt-4">
              <PlanLadder current={plan} />
            </div>
          </details>
        )}

        {/* Top-up packs — paid plans only. */}
        {plan !== "free" ? (
          <section className="mt-8">
            <div className="flex items-end justify-between flex-wrap gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
                  Buy more credits
                </div>
                <h2 className="display mt-1 text-xl text-forest-900">
                  Top up without changing plan
                </h2>
              </div>
              <div className="text-[11px] text-ink-muted">
                Cap this period:{" "}
                {Number.isFinite(remainingTopup)
                  ? `${remainingTopup.toLocaleString()} credits left to buy (3× monthly grant)`
                  : "no cap"}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                Object.entries(CREDIT_PACKS) as Array<
                  [keyof typeof CREDIT_PACKS, (typeof CREDIT_PACKS)[keyof typeof CREDIT_PACKS]]
                >
              ).map(([key, pack]) => {
                const blocked = pack.credits > remainingTopup;
                const perCredit = pack.amountCents / pack.credits / 100;
                return (
                  <div
                    key={key}
                    className={
                      "card p-5 " +
                      (blocked ? "opacity-50 pointer-events-none" : "")
                    }
                  >
                    <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                      {pack.label}
                    </div>
                    <div className="display text-2xl text-forest-900 mt-1">
                      {pack.credits.toLocaleString()}
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      ${(pack.amountCents / 100).toFixed(2)} · ${perCredit.toFixed(3)}/credit
                    </div>
                    <p className="mt-2 text-[11px] text-ink-muted">
                      {pack.pitch}
                    </p>
                    <div className="mt-4">
                      <CheckoutButton priceKey={key} label="Buy" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Auto top-up settings */}
            <div className="card mt-6 p-6">
              <h2 className="display text-base text-forest-900">
                Auto top-up
              </h2>
              <p className="text-xs text-ink-muted mt-1">
                When your balance drops below the threshold, we&apos;ll buy a
                pack for you on file. Off by default — opt in below.
              </p>
              <form action={setAutoTopUpAction} className="mt-4 grid sm:grid-cols-3 gap-3">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-forest-800">
                    Pack
                  </span>
                  <select
                    name="pack"
                    className="input"
                    defaultValue={sub.data?.auto_topup_pack ?? ""}
                  >
                    <option value="">Off</option>
                    {(
                      Object.entries(CREDIT_PACKS) as Array<
                        [string, (typeof CREDIT_PACKS)[keyof typeof CREDIT_PACKS]]
                      >
                    ).map(([key, p]) => (
                      <option key={key} value={key}>
                        {p.label} · {p.credits} credits / ${(p.amountCents / 100).toFixed(0)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-forest-800">
                    Threshold (credits)
                  </span>
                  <input
                    name="threshold"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={
                      sub.data?.auto_topup_threshold_credits ?? 50
                    }
                    className="input"
                  />
                </label>
                <div className="flex items-end">
                  <button className="btn-ghost w-full">Save</button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {plan !== "free" ? (
          <p className="mt-8 text-[11px] leading-relaxed text-ink-muted">
            Status: {sub.data?.status ?? "active"}
            {sub.data?.current_period_end ? (
              <>
                {" "}
                · renews{" "}
                {new Date(sub.data.current_period_end).toLocaleDateString()}
              </>
            ) : null}
            {sub.data?.cancel_at_period_end
              ? " (cancels at period end)"
              : ""}{" "}
            · top-up cap is {TOPUP_CAP_MULTIPLIER}× monthly grant per period
          </p>
        ) : null}

        <div className="card mt-8 p-6">
          <h2 className="display text-xl text-forest-900">This month at a glance</h2>
          <ul className="mt-4 grid gap-3">
            <UsageRow label="Companies" used={limits.companies} />
            <UsageRow label="Bank institutions" used={limits.bankInstitutions} />
            <UsageRow label="Receipts (cap)" used={limits.receiptsPerMonth} />
            <UsageRow label="CSV imports (cap)" used={limits.csvImportsPerMonth} />
          </ul>
        </div>
      </section>
    </main>
  );
}

const TIER_PERKS: Record<Exclude<Plan, "free">, string[]> = {
  filer: [
    "Personal forecast (no business)",
    "30 credits / month",
    "Bella on Haiku",
    "10 receipts / month",
  ],
  solo: [
    "1 company + Schedule C",
    "400 credits / month",
    "Bella on Sonnet",
    "1 bank institution synced",
  ],
  studio: [
    "3 companies, 5 seats",
    "1,500 credits / month",
    "Team chat + multi-state",
    "Bulk CSV import",
  ],
  scale: [
    "10 companies, 25 seats",
    "5,000 credits / month",
    "Bella on Opus, unlimited",
    "Audit support + priority + API",
  ],
  practice: [
    "Unlimited companies / seats",
    "15,000 credits / month",
    "Preparer center + client portal",
    "White-label + 1M-context review",
  ],
};

function PlanLadder({ current }: { current?: Plan } = {}) {
  const tiers: Array<Exclude<Plan, "free">> = [
    "filer",
    "solo",
    "studio",
    "scale",
    "practice",
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-2">
      {tiers.map((t) => {
        const monthly = PLAN_PRICING[`${t}_monthly` as SubscriptionPriceKey];
        const yearly = PLAN_PRICING[`${t}_yearly` as SubscriptionPriceKey];
        const isCurrent = current === t;
        return (
          <div
            key={t}
            className={
              "card p-5 flex flex-col gap-3 " +
              (isCurrent ? "border-gold-300 ring-1 ring-gold-200" : "")
            }
          >
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                {planLabel(t)}
              </div>
              <div className="display text-2xl text-forest-900 mt-1">
                ${(monthly.amountCents / 100).toFixed(2)}
                <span className="text-xs text-ink-muted ml-1">/mo</span>
              </div>
              <div className="text-[11px] text-ink-muted mt-1">
                or ${(yearly.amountCents / 100).toFixed(0)}/yr (save ~17%)
              </div>
            </div>
            <ul className="grid gap-1.5 text-xs text-ink-soft">
              {TIER_PERKS[t].map((p) => (
                <li key={p} className="flex gap-1.5">
                  <span className="text-gold-700">✓</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-2 mt-auto">
              {isCurrent ? (
                <span className="text-center text-xs text-forest-700 font-medium">
                  Current plan
                </span>
              ) : (
                <>
                  <CheckoutButton
                    priceKey={`${t}_monthly`}
                    label={`Choose ${planLabel(t)}`}
                  />
                  <CheckoutButton
                    priceKey={`${t}_yearly`}
                    label="Pay yearly"
                    variant="ghost"
                  />
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UsageRow({ label, used }: { label: string; used: number }) {
  return (
    <li className="flex items-baseline justify-between text-sm">
      <span className="text-forest-800">{label}</span>
      <span className="text-forest-900">{formatLimit(used)}</span>
    </li>
  );
}
