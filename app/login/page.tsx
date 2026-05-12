"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/Wordmark";
import { PasskeySignInButton } from "@/components/PasskeySignInButton";

type Provider = "google" | "azure";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  // Surface server-side OAuth errors that came back as ?error=... on the
  // /login redirect from /api/auth/<provider>/callback.
  useEffect(() => {
    const url = new URL(window.location.href);
    const oauthErr = url.searchParams.get("error");
    if (oauthErr) {
      const friendly: Record<string, string> = {
        oauth_state_missing: "Sign-in expired. Please try again.",
        oauth_state_mismatch: "Sign-in session was invalid. Please try again.",
        oauth_token_exchange:
          "We couldn't complete sign-in with your provider. Please try again.",
        oauth_missing_id_token: "Provider didn't return an ID token.",
        oauth_not_configured: "This sign-in provider isn't set up yet.",
        access_denied: "You cancelled the sign-in.",
      };
      setError(friendly[oauthErr] ?? oauthErr);
    }
  }, []);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  // Use Supabase's hosted OAuth flow. Earlier we shipped an "OAuth on
  // our own domain" path via /api/auth/<provider>/start that needed
  // GOOGLE_OAUTH_CLIENT_ID + AZURE_OAUTH_CLIENT_ID env vars set on
  // Vercel. Those env vars were never configured, so the routes were
  // returning 500 and breaking sign-in. Reverting to Supabase's
  // signInWithOAuth keeps OAuth working immediately - the credentials
  // already live in the Supabase Auth dashboard. Trade-off: the
  // consent screen reads "to continue to <project-ref>.supabase.co"
  // instead of taxottic.com. Acceptable for now; we can re-enable
  // the on-our-domain path once the OAuth client configs are in place.
  async function oauth(provider: Provider) {
    setError(null);
    const url = new URL(window.location.href);
    const next = url.searchParams.get("next") ?? "/dashboard";
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        scopes: provider === "azure" ? "email openid profile" : undefined,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Wordmark size="lg" />
          <p className="mt-3 text-sm text-ink-soft">
            Sign in to forecast your taxes.
          </p>
        </div>

        <div className="card p-7">
          <div className="grid gap-2">
            <button
              onClick={() => oauth("google")}
              className="btn-ghost w-full"
            >
              Continue with Google
            </button>
            {/* Microsoft (Azure) is gated on NEXT_PUBLIC_ENABLE_AZURE_LOGIN
                until the provider is fully wired in the Supabase project.
                Previously clicking it landed on
                ?error=invalid_request&error_code=bad_oauth_state because the
                Azure provider returned a malformed state - better to hide the
                button entirely than offer a broken handshake. Flip the env
                var to "true" in Vercel once Azure OAuth is configured and the
                redirect URI is registered in Supabase. */}
            {process.env.NEXT_PUBLIC_ENABLE_AZURE_LOGIN === "true" ? (
              <button
                onClick={() => oauth("azure")}
                className="btn-ghost w-full"
              >
                Continue with Microsoft
              </button>
            ) : null}
            {/* Apple SSO requires an Apple Developer membership and is not
                yet enabled on this Supabase project. Hidden until configured. */}
          </div>

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
            <div className="h-px flex-1 bg-forest-200/60" />
            <span>or passkey</span>
            <div className="h-px flex-1 bg-forest-200/60" />
          </div>

          <PasskeySignInButton emailHint={email || undefined} />

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
            <div className="h-px flex-1 bg-forest-200/60" />
            <span>or email</span>
            <div className="h-px flex-1 bg-forest-200/60" />
          </div>

          <form
            onSubmit={sendMagicLink}
            className="grid gap-3"
            noValidate
          >
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status === "error") {
                  setStatus("idle");
                  setError(null);
                }
              }}
              aria-invalid={status === "error" ? true : undefined}
              aria-describedby={
                status === "error" ? "magic-link-error" : undefined
              }
              className={
                "input " +
                (status === "error"
                  ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                  : "")
              }
            />
            {/* Error rendered immediately after the field so the visual
                association is obvious - red border on the input plus a
                role="alert" message that screen readers announce. Earlier
                we rendered the error as a generic paragraph far below the
                button, which usability testing flagged as missable. */}
            {status === "error" && error ? (
              <p
                id="magic-link-error"
                role="alert"
                className="text-xs text-red-700 -mt-1"
              >
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={status === "sending"}
              className="btn-primary w-full"
            >
              {status === "sending" ? "Sending..." : "Send magic link"}
            </button>
          </form>

          {status === "sent" && (
            <p className="mt-4 text-sm text-forest-700">
              Check your inbox for the sign-in link.
            </p>
          )}
          {/* OAuth-callback errors still surface here (separate from the
              inline magic-link error above) since they're not tied to a
              single field. */}
          {status !== "error" && error ? (
            <p className="mt-4 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-ink-muted text-center max-w-sm mx-auto">
          Taxottic provides tax forecasting and educational guidance. It is not
          a substitute for advice from a licensed CPA or tax attorney.
        </p>
      </div>
    </main>
  );
}
