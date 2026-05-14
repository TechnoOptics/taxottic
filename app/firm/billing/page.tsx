import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";

// Tier 2 #1: Firm billing UI. Shows the firm's subscription state
// for the Taxottic-to-firm relationship (separate from the Phase 7
// firm-to-client invoicing). Reads from the existing
// `firm_subscriptions` table, links out to Stripe Customer Portal
// for plan changes / cancellations.
//
// What this surface shows in v1:
//   - Current tier + status + next billing date
//   - Customer portal link (Stripe-hosted self-service)
//
// What's NOT here yet:
//   - In-app plan switcher (we route to Stripe Customer Portal
//     instead, which handles upgrade/downgrade + proration cleanly)
//   - Usage-based metering (firm fee scales with client seats);
//     wires when we ship the metered-billing flow

export const dynamic = "force-dynamic";

const TIER_FEATURES: Record<string, string[]> = {
  starter: [
    "Up to 10 active client engagements",
    "5 preparer seats",
    "All Phase 1-11 firm-portal features",
    "Documenso e-signature (50 envelopes/month)",
  ],
  growth: [
    "Up to 50 active client engagements",
    "15 preparer seats",
    "Documenso e-signature (250 envelopes/month)",
    "Priority email support",
  ],
  firm: [
    "Up to 200 active client engagements",
    "Unlimited preparer seats",
    "Documenso e-signature (unlimited)",
    "Phone + email support",
    "Quarterly health check with the Taxottic team",
  ],
  enterprise: [
    "Unlimited client engagements + preparers",
    "DocuSign e-signature option",
    "BYO custom domain (firm.smithcpa-secure.com)",
    "Dedicated CSM + 4-hour SLA",
    "MeF e-filing assistance",
    "Custom legal review + compliance pack",
  ],
};

export default async function FirmBillingPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  const { data: sub } = await admin
    .from("firm_subscriptions")
    .select(
      "stripe_customer_id, stripe_subscription_id, status, tier, current_period_end, cancel_at_period_end",
    )
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();

  const features = TIER_FEATURES[ctx.firm.tier] ?? [];

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Billing
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Your Taxottic plan.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          This page covers your firm&apos;s Taxottic subscription —
          the relationship between {ctx.firm.name} and Taxottic.
          To invoice your clients, head to{" "}
          <Link
            href="/firm/settings/payments"
            className="underline hover:text-forest-800"
          >
            Stripe Connect settings
          </Link>
          .
        </p>

        <div className="card p-5 sm:p-6 mt-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                Current plan
              </div>
              <h2 className="display text-2xl text-forest-900 mt-1 capitalize">
                {ctx.firm.tier}
              </h2>
              <div className="text-xs text-ink-muted mt-1">
                {sub?.status === "active"
                  ? sub.cancel_at_period_end
                    ? `Cancels on ${new Date(sub.current_period_end ?? "").toLocaleDateString()}`
                    : `Renews on ${new Date(sub.current_period_end ?? "").toLocaleDateString()}`
                  : sub?.status
                    ? `Subscription status: ${sub.status}`
                    : "No active subscription"}
              </div>
            </div>
            <span
              className={
                "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                (sub?.status === "active"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-800 border-amber-200")
              }
            >
              {sub?.status ?? "Pilot tier"}
            </span>
          </div>

          {features.length > 0 ? (
            <ul className="mt-5 grid gap-2 text-sm text-ink-soft">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span aria-hidden="true" className="text-gold-700">
                    ✓
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            {sub?.stripe_customer_id ? (
              <Link
                href={`/api/firm/billing/portal`}
                className="btn-primary text-sm"
              >
                Manage billing →
              </Link>
            ) : (
              <a
                href="mailto:contact@taxottic.com?subject=Activate firm subscription"
                className="btn-primary text-sm"
              >
                Talk to us about pricing
              </a>
            )}
            <Link
              href="/firm/settings"
              className="btn-ghost text-sm"
            >
              ← Settings
            </Link>
          </div>
        </div>

        <p className="mt-6 text-[11px] text-ink-muted leading-relaxed">
          Customer-Portal session links open Stripe&apos;s secure
          self-service flow where you can upgrade, downgrade, change
          billing details, or cancel. The link is single-use and
          expires after 24 hours.
        </p>
      </section>
    </main>
  );
}
