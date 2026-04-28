import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import {
  PLAN_LIMITS,
  PLAN_PRICING,
  formatLimit,
} from "@/lib/plans/limits";
import {
  countBellaMessagesThisMonth,
  countCsvImportsThisMonth,
  countCompanies,
  getActivePlan,
} from "@/lib/plans/usage";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ManageBillingButton } from "@/components/ManageBillingButton";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { supabase, user } = await requireUser();
  const { status } = await searchParams;

  const [plan, bellaUsed, importsUsed, companiesUsed, sub] = await Promise.all([
    getActivePlan(supabase, user.id),
    countBellaMessagesThisMonth(supabase, user.id),
    countCsvImportsThisMonth(supabase, user.id),
    countCompanies(supabase, user.id),
    supabase
      .from("subscriptions")
      .select("status, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const limits = PLAN_LIMITS[plan];
  const pricing = PLAN_PRICING;

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Billing
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          {plan === "pro" ? "You're on Pro" : "Choose your plan"}
        </h1>

        {status === "success" ? (
          <p className="mt-3 text-sm text-emerald-800">
            Payment successful. It can take a few seconds for Pro to activate.
          </p>
        ) : null}
        {status === "cancel" ? (
          <p className="mt-3 text-sm text-amber-800">Checkout cancelled.</p>
        ) : null}

        {plan === "pro" ? (
          <div className="card mt-6 p-6">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <div>
                <div className="display text-2xl text-forest-900">Pro</div>
                <div className="text-xs text-ink-muted mt-1">
                  Status:{" "}
                  <span className="text-forest-800">
                    {sub.data?.status ?? "active"}
                  </span>
                  {sub.data?.current_period_end ? (
                    <>
                      {" "}
                      - renews{" "}
                      {new Date(sub.data.current_period_end).toLocaleDateString()}
                    </>
                  ) : null}
                  {sub.data?.cancel_at_period_end ? " (cancels at period end)" : ""}
                </div>
              </div>
              <ManageBillingButton />
            </div>
          </div>
        ) : (
          <div className="mt-6 grid sm:grid-cols-2 gap-4">
            <PlanCard
              title="Pro - Monthly"
              priceLabel={`$${(pricing.pro_monthly.amountCents / 100).toFixed(2)}/mo`}
              priceKey="pro_monthly"
              perks={[
                "Unlimited Bella questions",
                "Unlimited bank imports",
                "Multiple companies",
                "Invite teammates",
              ]}
            />
            <PlanCard
              title="Pro - Yearly"
              priceLabel={`$${(pricing.pro_yearly.amountCents / 100).toFixed(2)}/yr`}
              subLabel="~17% off"
              priceKey="pro_yearly"
              perks={[
                "Everything in Pro Monthly",
                "Two months free",
                "One annual charge",
              ]}
              recommended
            />
          </div>
        )}

        <div className="card mt-8 p-6">
          <h2 className="display text-xl text-forest-900">
            This month&apos;s usage
          </h2>
          <ul className="mt-4 grid gap-3">
            <UsageRow
              label="Bella questions"
              used={bellaUsed}
              limit={limits.bellaMessagesPerMonth}
            />
            <UsageRow
              label="CSV bank imports"
              used={importsUsed}
              limit={limits.csvImportsPerMonth}
            />
            <UsageRow
              label="Companies"
              used={companiesUsed}
              limit={limits.companies}
            />
          </ul>
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-ink-muted">
          You can cancel any time. Cancellation keeps Pro active until the end
          of the billing period.
        </p>
      </section>
    </main>
  );
}

function PlanCard({
  title,
  priceLabel,
  subLabel,
  priceKey,
  perks,
  recommended,
}: {
  title: string;
  priceLabel: string;
  subLabel?: string;
  priceKey: "pro_monthly" | "pro_yearly";
  perks: string[];
  recommended?: boolean;
}) {
  return (
    <div
      className={
        "card p-6 " +
        (recommended ? "border-gold-300 ring-1 ring-gold-200" : "")
      }
    >
      {recommended ? (
        <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
          Recommended
        </div>
      ) : null}
      <h2 className="display text-xl text-forest-900 mt-1">{title}</h2>
      <div className="mt-2">
        <span className="display text-3xl text-forest-900">{priceLabel}</span>
        {subLabel ? (
          <span className="ml-2 text-xs text-gold-700">{subLabel}</span>
        ) : null}
      </div>
      <ul className="mt-4 grid gap-2 text-sm text-ink-soft">
        {perks.map((p) => (
          <li key={p} className="flex gap-2">
            <span className="text-gold-700">✓</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <CheckoutButton priceKey={priceKey} />
      </div>
    </div>
  );
}

function UsageRow({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const isCapped = Number.isFinite(limit);
  const pct = isCapped ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over = isCapped && used >= limit;
  return (
    <li>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-forest-800">{label}</span>
        <span
          className={
            "text-sm " + (over ? "text-red-700 font-medium" : "text-forest-900")
          }
        >
          {used} / {formatLimit(limit)}
        </span>
      </div>
      {isCapped ? (
        <div className="mt-1 h-1.5 rounded-full bg-forest-50 overflow-hidden">
          <div
            className={over ? "h-full bg-red-400" : "h-full bg-gold-400"}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </li>
  );
}
