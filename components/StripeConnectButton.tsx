"use client";

import { useState } from "react";

type Props = {
  companyId: string;
  className?: string;
};

/**
 * Kick off the Stripe Connect OAuth flow. Unlike Plaid Link (which
 * opens a modal we host ourselves), Stripe Connect navigates the
 * user fully off-site to Stripe's hosted consent screen and bounces
 * back to /api/banks/stripe/oauth-return when they accept.
 *
 * Steps on click:
 *   1. POST /api/banks/stripe/connect-link to get an authorize URL
 *      (and have the server set the CSRF state cookie).
 *   2. window.location.href = url to navigate to Stripe.
 *   3. Stripe redirects back to /api/banks/stripe/oauth-return which
 *      finishes the handshake and lands the user on the banks page.
 */
export function StripeConnectButton({ companyId, className }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/banks/stripe/connect-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setError(data?.error ?? "Couldn't open Stripe Connect.");
        setBusy(false);
        return;
      }
      // Hard navigate. Stripe's consent screen requires a top-level
      // page load (no iframes); we never come back to THIS component
      //, the OAuth-return route handles the round-trip server-side
      // and 302s the user to /c/[publicId]/banks?stripe_connected=1.
      window.location.href = data.url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={className ?? "btn-primary"}
      >
        {busy ? "Redirecting…" : "Connect Stripe"}
      </button>
      {/* Stripe caches its own browser session across tabs. When that
          happens its OAuth consent page auto-binds to whatever Stripe
          account you're signed in as and offers only "Use this one"
          or "Open new account", no way to pick a different existing
          Stripe. The only reliable workaround is to sign out of
          Stripe first; this link opens Stripe's logout in a new tab
          so the next "Connect Stripe" click starts from a clean
          session. */}
      <a
        href="https://dashboard.stripe.com/logout"
        target="_blank"
        rel="noopener noreferrer"
        className="block mt-1.5 text-[11px] text-ink-muted hover:text-forest-900 underline-offset-2 hover:underline"
      >
        Want a different Stripe account? Sign out of Stripe first ↗
      </a>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
