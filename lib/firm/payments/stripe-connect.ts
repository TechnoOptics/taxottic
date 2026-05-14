import Stripe from "stripe";

// Stripe Connect helpers used by the firm-payments flow.
//
// We use Stripe Connect Express:
//   - Firm signs up via an Account Link (Stripe-hosted onboarding).
//   - Once charges_enabled flips true (webhook), the firm can mint
//     invoices.
//   - We create Checkout Sessions on behalf of the firm via the
//     `Stripe-Account` header (Connected Account auth), and set
//     `payment_intent_data.application_fee_amount` so Taxottic
//     earns a platform fee out of every transaction.
//
// The application uses STRIPE_SECRET_KEY (existing consumer Stripe
// key) — the same key can manage Connected Accounts on Connect.

const PLATFORM_FEE_BPS_DEFAULT = 300; // 3.00%

let cachedClient: Stripe | null = null;

function getStripe(): Stripe | null {
  if (cachedClient) return cachedClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  cachedClient = new Stripe(key, {
    // Pin the same apiVersion as the existing consumer Stripe
    // client in lib/stripe/server.ts so a future Stripe-side
    // breaking change is migrated for both Connect + consumer at
    // the same time.
    apiVersion: "2026-04-22.dahlia",
  });
  return cachedClient;
}

export type PlatformFeeOptions = {
  /** Override the default 3% fee (in basis points). */
  basisPoints?: number;
  /** Total in cents to fee against. */
  totalCents: number;
};

export function platformFeeCents(opts: PlatformFeeOptions): number {
  const bps = opts.basisPoints ?? PLATFORM_FEE_BPS_DEFAULT;
  return Math.floor((opts.totalCents * bps) / 10_000);
}

export type CreateConnectAccountInput = {
  firmId: string;
  firmName: string;
  email: string;
  country?: string;
};

/**
 * Create a new Express Connect account for a firm. Returns the
 * account ID; caller persists it on firm_stripe_accounts and
 * follows up with createAccountOnboardingLink().
 */
export async function createConnectAccount(
  input: CreateConnectAccountInput,
): Promise<{ ok: true; accountId: string } | { ok: false; reason: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "Stripe not configured" };
  try {
    const account = await stripe.accounts.create({
      type: "express",
      email: input.email,
      country: input.country ?? "US",
      business_profile: {
        name: input.firmName,
        // Mark as a non-merchant-of-record so payouts go to the firm
        // and they handle their own state-tax registration.
        url: `https://taxottic.com/firm/${input.firmId}`,
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        firm_id: input.firmId,
      },
    });
    return { ok: true, accountId: account.id };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}

/**
 * Returns a single-use Stripe-hosted onboarding URL the firm
 * opens in a new tab. Account links expire after the firm
 * completes / abandons.
 */
export async function createAccountOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "Stripe not configured" };
  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return { ok: true, url: link.url };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}

/** Read live account status (for refresh from the settings page). */
export async function fetchConnectAccountStatus(accountId: string): Promise<{
  ok: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  country?: string | null;
  default_currency?: string | null;
  reason?: string;
}> {
  const stripe = getStripe();
  if (!stripe) {
    return {
      ok: false,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      reason: "Stripe not configured",
    };
  }
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return {
      ok: true,
      charges_enabled: account.charges_enabled ?? false,
      payouts_enabled: account.payouts_enabled ?? false,
      details_submitted: account.details_submitted ?? false,
      country: account.country,
      default_currency: account.default_currency,
    };
  } catch (err) {
    return {
      ok: false,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}

export type CreateInvoiceCheckoutInput = {
  stripeAccountId: string;
  invoiceId: string;
  invoiceNumber: string;
  recipientEmail: string;
  recipientName?: string | null;
  lineItems: Array<{
    description: string;
    quantity: number;
    unit_amount_cents: number;
  }>;
  currency: string;
  platformFeeCents: number;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Mint a Stripe Checkout Session for an invoice. Sessions run on
 * the Connected Account (firm's), with `application_fee_amount`
 * routing the platform fee back to Taxottic's main account.
 */
export async function createInvoiceCheckoutSession(
  input: CreateInvoiceCheckoutInput,
): Promise<
  | { ok: true; sessionId: string; checkoutUrl: string }
  | { ok: false; reason: string }
> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "Stripe not configured" };
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: input.recipientEmail,
        line_items: input.lineItems.map((li) => ({
          quantity: li.quantity,
          price_data: {
            currency: input.currency,
            unit_amount: li.unit_amount_cents,
            product_data: { name: li.description },
          },
        })),
        payment_intent_data: {
          application_fee_amount: input.platformFeeCents,
          metadata: {
            firm_invoice_id: input.invoiceId,
            invoice_number: input.invoiceNumber,
          },
        },
        metadata: {
          firm_invoice_id: input.invoiceId,
          invoice_number: input.invoiceNumber,
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { stripeAccount: input.stripeAccountId },
    );
    if (!session.url) return { ok: false, reason: "no checkout url" };
    return { ok: true, sessionId: session.id, checkoutUrl: session.url };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}

export function getStripeForWebhook(): Stripe | null {
  return getStripe();
}
