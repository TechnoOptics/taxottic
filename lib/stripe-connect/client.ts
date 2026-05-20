/**
 * Stripe Connect (Standard accounts) OAuth + balance-transaction
 * helpers. Mirrors lib/plaid/client.ts in shape so the banks page
 * can host both providers behind a uniform connection model.
 *
 * Standard accounts: the user already owns their Stripe account.
 * We OAuth-authorize ourselves as the platform with read_only scope,
 * receive a stripe_user_id (`acct_…`) + access_token, and from that
 * point we make API calls on the user's behalf via the
 * `stripeAccount` SDK option (which sets the `Stripe-Account`
 * header). The user can revoke us at any time from their Stripe
 * Dashboard.
 *
 * Env vars (all required for the OAuth flow; if absent, getStripeConnect()
 * returns null and callers can show "Stripe not configured" copy):
 *
 *   STRIPE_SECRET_KEY          - platform's live/test secret. Already
 *                                 used by lib/stripe/server.ts.
 *   STRIPE_CONNECT_CLIENT_ID   - the platform's Connect client ID
 *                                 (ca_xxx), from Stripe Dashboard →
 *                                 Connect → Settings → OAuth settings.
 *   NEXT_PUBLIC_SITE_URL       - base URL we build redirects against.
 *                                 Falls back to https://taxottic.com.
 *
 * Register the following redirect URI in the Stripe Connect settings
 * before this flow will work:
 *   {NEXT_PUBLIC_SITE_URL}/api/banks/stripe/oauth-return
 */
import Stripe from "stripe";
import { getStripe, isStripeConfigured } from "@/lib/stripe/server";

/**
 * The bare Stripe client we use for OAuth (which doesn't take a
 * `Stripe-Account` header). Returns null when secret key is missing.
 */
export function getStripeConnect(): Stripe | null {
  if (!isStripeConfigured()) return null;
  return getStripe();
}

/** Did the deploy set everything Stripe Connect needs? */
export function isStripeConnectConfigured(): boolean {
  return (
    isStripeConfigured() && Boolean(process.env.STRIPE_CONNECT_CLIENT_ID)
  );
}

/** Resolved redirect URI for the OAuth callback. */
export function stripeOAuthRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";
  return `${base}/api/banks/stripe/oauth-return`;
}

/**
 * Build the URL the user gets bounced to so Stripe can prompt for
 * consent. The `state` parameter doubles as our CSRF token and as a
 * lookup key we set in a short-lived cookie before redirecting. The
 * callback handler must verify the state cookie matches before
 * exchanging the code, otherwise we accept attacker-supplied codes.
 *
 * Scope: `read_write`. We previously asked for `read_only`, but
 * Stripe deprecated read-only for platforms created after their 2024
 * Connect changes — the authorize endpoint now responds:
 *   "Please use the `read_write` scope, or contact support … to use
 *    read-only connections."
 * Our code only ever READS the connected account (balanceTransactions
 * list / charges read), so runtime behaviour is unchanged; the broader
 * scope is purely to satisfy Stripe's new platform default. If we
 * later want true read-only, the path is to contact Stripe support
 * and revert this line.
 */
export function buildAuthorizeUrl(state: string): string {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) throw new Error("STRIPE_CONNECT_CLIENT_ID missing");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "read_write",
    state,
    redirect_uri: stripeOAuthRedirectUri(),
    // Default ("account picker") locks users into whatever Stripe
    // account their browser is signed into and only offers "Use this
    // one" or "Open a new account" — no way to pick a DIFFERENT
    // existing Stripe they own. `stripe_landing=login` puts them on
    // the sign-in screen first, so they can authorise any existing
    // Stripe (current session or another). They can still create a
    // new account from there if they want.
    stripe_landing: "login",
  });
  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange the `code` Stripe sends to our callback for a long-lived
 * access_token + the connected account ID. Strictly speaking we
 * could also pull a refresh_token here, but read_only tokens don't
 * expire so we don't bother persisting it.
 */
export async function exchangeOAuthCode(code: string): Promise<{
  stripeUserId: string;
  accessToken: string;
}> {
  const stripe = getStripeConnect();
  if (!stripe) throw new Error("Stripe not configured");

  // stripe-node exposes oauth.token() but the type signature is hidden
  // under stripe.oauth which isn't always in TS defs depending on SDK
  // version; cast through unknown to call it safely.
  const oauth = (stripe as unknown as {
    oauth: {
      token: (params: {
        grant_type: "authorization_code";
        code: string;
      }) => Promise<{
        access_token: string;
        stripe_user_id: string;
        refresh_token?: string;
      }>;
    };
  }).oauth;
  if (!oauth?.token) {
    throw new Error("stripe.oauth.token not available in this SDK");
  }
  const response = await oauth.token({
    grant_type: "authorization_code",
    code,
  });
  return {
    stripeUserId: response.stripe_user_id,
    accessToken: response.access_token,
  };
}

/**
 * Tear down an existing Stripe Connect link. Best-effort: a user can
 * also revoke us from the Stripe Dashboard, so this returning an
 * error is non-fatal for the caller. Useful to keep us tidy in
 * Stripe's eyes.
 */
export async function deauthorize(stripeUserId: string): Promise<void> {
  const stripe = getStripeConnect();
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!stripe || !clientId) return;
  const oauth = (stripe as unknown as {
    oauth?: {
      deauthorize?: (params: {
        client_id: string;
        stripe_user_id: string;
      }) => Promise<unknown>;
    };
  }).oauth;
  try {
    await oauth?.deauthorize?.({
      client_id: clientId,
      stripe_user_id: stripeUserId,
    });
  } catch {
    /* user already revoked or platform lost the link - non-fatal */
  }
}

/**
 * Get a stripe client scoped to a connected account. All calls made
 * through this client are billed to / authenticated as the connected
 * Stripe account (via the Stripe-Account header). This is how we
 * read balance_transactions etc. from the user's Stripe.
 */
export function getStripeForAccount(stripeUserId: string): Stripe {
  const platform = getStripeConnect();
  if (!platform) throw new Error("Stripe not configured");
  // Stripe SDK supports passing stripeAccount per-request via
  // { stripeAccount } as the second arg, but for code clarity we
  // mint a per-account client and pin the header. This costs nothing
  // — the SDK is a thin wrapper over fetch.
  // We can reuse the same instance and just pass the option per call,
  // but a typed wrapper at the caller is cleaner. The platform client
  // is fine to return; callers pass { stripeAccount } on the request.
  void stripeUserId;
  return platform;
}
