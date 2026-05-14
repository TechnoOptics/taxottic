import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { startStripeConnect, refreshStripeStatus } from "./actions";

// Force dynamic so a return-from-Stripe-onboarding ?return=1 flag
// triggers the fresh status read instead of serving a cached
// "still onboarding" panel.
export const dynamic = "force-dynamic";

export default async function PaymentsSettingsPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: account } = await admin
    .from("firm_stripe_accounts")
    .select(
      "stripe_account_id, charges_enabled, payouts_enabled, details_submitted, country, default_currency, created_at",
    )
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();

  const connected = Boolean(account);
  const liveCharges = account?.charges_enabled ?? false;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Payments
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Get paid through Taxottic.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          Connect a Stripe account and clients can pay invoices
          directly inside the engagement. Payouts go to your bank;
          Taxottic takes a transparent 3% platform fee per
          transaction.
        </p>

        <div className="card p-5 sm:p-6 mt-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="display text-lg text-forest-900">
                Stripe Connect
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {connected
                  ? `Account ${account?.stripe_account_id ?? ""}`
                  : "Not connected"}
              </div>
            </div>
            <span
              className={
                "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                (liveCharges
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : connected
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : "bg-cream-100 text-ink-muted border-forest-100")
              }
            >
              {liveCharges
                ? "Live"
                : connected
                  ? "Onboarding"
                  : "Not connected"}
            </span>
          </div>

          {connected && !liveCharges ? (
            <p className="mt-4 text-sm text-ink-soft leading-relaxed">
              Your Stripe Connect account exists but charges
              aren&apos;t enabled yet. Open Stripe&apos;s
              onboarding flow to finish identity verification and
              add your payout bank.
            </p>
          ) : null}
          {liveCharges ? (
            <p className="mt-4 text-sm text-ink-soft leading-relaxed">
              You can now send invoices from any engagement.
              Clients pay via Stripe Checkout; funds settle to
              your connected bank account.
            </p>
          ) : null}
          {!connected ? (
            <p className="mt-4 text-sm text-ink-soft leading-relaxed">
              When you click Connect, Stripe takes you through
              their hosted onboarding: legal name, EIN, payout
              bank. We never see your bank credentials.
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <form action={startStripeConnect}>
              <button className="btn-primary text-sm">
                {connected ? "Continue onboarding" : "Connect Stripe"}
              </button>
            </form>
            {connected ? (
              <form action={refreshStripeStatus}>
                <button className="btn-ghost text-sm">
                  Refresh status
                </button>
              </form>
            ) : null}
          </div>
        </div>

        <details className="mt-6 card p-4 text-sm">
          <summary className="cursor-pointer text-forest-900 font-medium">
            How the platform fee works
          </summary>
          <div className="mt-3 text-xs text-ink-soft leading-relaxed grid gap-2">
            <p>
              Every paid invoice has a <strong>3% platform fee</strong>{" "}
              added on top of Stripe&apos;s standard processing rate.
              The fee covers Taxottic&apos;s share of the
              infrastructure (hosted portal, e-signature, document
              storage, audit log).
            </p>
            <p>
              Example: a $1,000 invoice paid by a US card ends up
              ~$1,029 to the client (Stripe&apos;s 2.9% + $0.30
              passed through). You receive $970; Taxottic receives
              $30.
            </p>
            <p>
              We&apos;ll publish a per-invoice fee summary on your
              dashboard alongside the standard Stripe payout schedule
              once invoices start flowing.
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}
