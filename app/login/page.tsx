"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/Wordmark";
import { PasskeySignInButton } from "@/components/PasskeySignInButton";

// Identity providers we render on the login page. Each one needs its
// OAuth credentials registered in the Supabase dashboard
// (Authentication → Providers) before the click actually works — see
// SETUP.md "SSO providers" for the per-provider setup steps. Until a
// provider is enabled in Supabase, clicking its button surfaces a
// friendly "this provider isn't set up yet" message instead of a raw
// "provider not enabled" error, so we can ship the buttons before
// every provider is wired without leaving prospects with a hostile UX.
type Provider = "google" | "azure" | "apple";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  // True when the user arrived from "Switch accounts" in the profile menu
  // (via /auth/signout?next=/login?force_picker=1). When set we (a) show a
  // "Choose an account" header so the user knows the picker will appear,
  // and (b) pass prompt=select_account to Google/Microsoft so they don't
  // silently auto-resume the last session.
  const [forcePicker, setForcePicker] = useState(false);
  // True when this login page is being served at hq.taxottic.com OR
  // enterprise.taxottic.com — the two operator hosts. The May 2026
  // audit flagged P3: both the consumer and HQ login pages showed
  // the same "Sign in to forecast your taxes." subtitle, which
  // doesn't tell a super-admin landing on an admin host that they're
  // in the operator cockpit. Detected client-side from the host
  // header. Originally named `isHq`; renamed to `isAdminHost` when
  // enterprise.taxottic.com went live so the cockpit subhead fires
  // for both admin subdomains.
  const [isAdminHost, setIsAdminHost] = useState(false);
  const supabase = createClient();

  // Surface server-side OAuth errors that came back as ?error=... on the
  // /login redirect from /api/auth/<provider>/callback.
  useEffect(() => {
    const url = new URL(window.location.href);
    const oauthErr = url.searchParams.get("error");
    if (oauthErr) {
      // Server-side errors that came back as ?error=... on the
      // /login redirect from /auth/callback (or the upstream
      // provider). The description, when present, has the actual
      // Supabase/provider message — we surface it as a second line
      // so users (and we, on support) can see what concretely
      // failed without round-tripping through logs.
      const oauthDesc = url.searchParams.get("error_description") ?? "";
      const friendly: Record<string, string> = {
        oauth_state_missing: "Sign-in expired. Please try again.",
        oauth_state_mismatch: "Sign-in session was invalid. Please try again.",
        oauth_token_exchange:
          "We couldn't complete sign-in with your provider. Please try again.",
        oauth_missing_id_token: "Provider didn't return an ID token.",
        oauth_not_configured:
          "That sign-in provider isn't set up yet. Try Google, passkey, or magic link instead.",
        access_denied: "You cancelled the sign-in.",
        no_code:
          "Sign-in came back without an authorization code. Usually means the OAuth handshake was interrupted; try again.",
        exchange_failed:
          "Sign-in came back from your provider OK, but we couldn't complete the session. This is often a cookie / PKCE issue — clear cookies for taxottic.com and try again.",
        // Legacy code path. Kept so old in-flight redirects don't
        // surface as raw "auth" text.
        auth: "Sign-in failed at the final step. Try again or use a different method below.",
        // Upstream provider error codes we may see on the URL
        // before we even reach /auth/callback.
        invalid_request: "Provider rejected the sign-in request.",
        unauthorized_client: "Provider rejected the app's credentials.",
        unsupported_response_type:
          "Provider doesn't support this OAuth flow.",
        server_error: "The sign-in provider is having a bad moment. Try again.",
        temporarily_unavailable:
          "The sign-in provider is temporarily down. Try again in a minute.",
      };
      const friendlyMain = friendly[oauthErr] ?? oauthErr;
      setError(
        oauthDesc
          ? `${friendlyMain} (provider said: ${oauthDesc})`
          : friendlyMain,
      );
    }
    if (url.searchParams.get("force_picker") === "1") {
      setForcePicker(true);
    }
    // Both admin subdomains get the cockpit treatment. Consumer host
    // (taxottic.com) stays as the cream consumer-facing experience.
    const host = url.host.toLowerCase();
    if (host === "hq.taxottic.com" || host === "enterprise.taxottic.com") {
      setIsAdminHost(true);
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
    // Host-aware default `next`. On hq.taxottic.com and
    // enterprise.taxottic.com the consumer path /dashboard doesn't
    // exist — the middleware rewrites it to /admin/dashboard which
    // 404s. Default to "/" instead, which the middleware then routes
    // to the right /admin/** root (hq → /admin, enterprise →
    // /admin/firms). The auditor's Round-2 finding that
    // enterprise.taxottic.com "still redirects to consumer dashboard"
    // reproduced precisely here: signing in from the enterprise
    // splash sent the user to /dashboard, the rewrite missed, and
    // the user ended up on the consumer host's dashboard via the
    // requireSuperAdmin fallback.
    const host = url.host.toLowerCase();
    const isOperatorHost =
      host === "hq.taxottic.com" || host === "enterprise.taxottic.com";
    const defaultNext = isOperatorHost ? "/" : "/dashboard";
    const next = url.searchParams.get("next") ?? defaultNext;
    // When the login page was opened from "Switch accounts", we forward
    // prompt=select_account so Google/Microsoft show their account picker
    // even if the browser still has a live session for that provider.
    // Both Google and Microsoft honor this OAuth 2.0 prompt value.
    // (Apple silently ignores it; that's fine — Apple's flow always
    // includes its own picker.)
    const queryParams: Record<string, string> | undefined = forcePicker
      ? { prompt: "select_account" }
      : undefined;
    // Per-provider scopes. Azure: explicit OIDC scopes so we always
    // get the user's email. Apple: "name email" since Apple only
    // releases name on the first authorization for that Services ID.
    const scopes =
      provider === "azure"
        ? "email openid profile"
        : provider === "apple"
          ? "name email"
          : undefined;
    // PR #52: stash `next` in a short-lived same-origin cookie instead
    // of passing it through Supabase's `redirect_to`. Supabase's
    // redirect-URL allowlist is strict about exact matches on the
    // post-Google leg — passing `?next=/dashboard` caused fall-back to
    // Site URL (taxottic.com), which bypassed our /auth/callback handler
    // entirely and left users on /login?next=/. The cookie-based path
    // means `redirect_to` is always the exact allowlisted URL.
    if (typeof document !== "undefined") {
      document.cookie = `_oauth_next=${encodeURIComponent(next)}; Path=/; Max-Age=600; SameSite=Lax; Secure`;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes,
        queryParams,
      },
    });
    if (error) {
      // Supabase returns "Unsupported provider" or "Provider not
      // enabled" when the provider isn't configured in the dashboard.
      // Map that to the same friendly message the OAuth-callback
      // error path uses, instead of leaking the raw API message.
      const lower = error.message.toLowerCase();
      if (
        lower.includes("provider is not enabled") ||
        lower.includes("unsupported provider") ||
        lower.includes("provider not enabled")
      ) {
        const label =
          provider === "azure"
            ? "Microsoft"
            : provider === "apple"
              ? "Apple"
              : "Google";
        setError(
          `${label} sign-in isn't fully set up yet — try Google, a passkey, or a magic link below.`,
        );
        return;
      }
      setError(error.message);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Wordmark size="lg" />
          {forcePicker ? (
            <>
              <p className="mt-3 text-sm font-medium text-forest-900">
                Choose a different account
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Your previous session was signed out. Pick the account you want
                to use.
              </p>
            </>
          ) : isAdminHost ? (
            <>
              <p className="mt-3 text-sm font-medium text-forest-900">
                Sign in to the Taxottic cockpit.
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Super-admin operations for Techno Optics.
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">
              Sign in to forecast your taxes.
            </p>
          )}
        </div>

        <div className="card p-5 sm:p-7">
          {/* Three OAuth providers always rendered. Per-provider
              configuration lives in the Supabase dashboard (see
              SETUP.md "SSO providers"). If a provider is enabled
              there, clicking takes the user through the consent
              flow. If it isn't enabled yet, the oauth() handler
              catches the error and renders a friendly "Provider X
              isn't set up yet — try Google or a passkey" message
              inline. We deliberately don't hide unconfigured
              providers behind env flags anymore: rendering them as
              available-options-with-fallbacks is a clearer signal
              of what we support, and surfaces the configuration
              gap as a fix-this rather than a missing-feature. */}
          <div className="grid gap-2">
            <button
              onClick={() => oauth("google")}
              className="btn-ghost w-full"
              aria-label="Continue with Google"
            >
              <SsoGlyph kind="google" />
              <span>Continue with Google</span>
            </button>
            <button
              onClick={() => oauth("azure")}
              className="btn-ghost w-full"
              aria-label="Continue with Microsoft"
            >
              <SsoGlyph kind="microsoft" />
              <span>Continue with Microsoft</span>
            </button>
            <button
              onClick={() => oauth("apple")}
              className="btn-ghost w-full"
              aria-label="Continue with Apple"
            >
              <SsoGlyph kind="apple" />
              <span>Continue with Apple</span>
            </button>
          </div>

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
            <div className="h-px flex-1 bg-forest-200/60" />
            <span>or passkey · Face ID · Touch ID · Windows Hello · PIN</span>
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

// Inline SVG glyphs for the three SSO providers. Kept here rather
// than pulled from a library because (a) we use them on exactly one
// page, (b) Google's brand guidelines specifically require their
// "G" mark not be recolored, and (c) inline SVGs avoid a runtime
// hit on the auth-critical first paint.
function SsoGlyph({ kind }: { kind: "google" | "microsoft" | "apple" }) {
  if (kind === "google") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 18 18"
        width="16"
        height="16"
        className="shrink-0"
      >
        {/* Google's official 4-color "G" mark, simplified path. */}
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.32z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z"
        />
      </svg>
    );
  }
  if (kind === "microsoft") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 22 22"
        width="16"
        height="16"
        className="shrink-0"
      >
        {/* Microsoft's four-square mark. */}
        <rect width="10" height="10" x="1" y="1" fill="#F25022" />
        <rect width="10" height="10" x="11" y="1" fill="#7FBA00" />
        <rect width="10" height="10" x="1" y="11" fill="#00A4EF" />
        <rect width="10" height="10" x="11" y="11" fill="#FFB900" />
      </svg>
    );
  }
  // apple
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      className="shrink-0"
    >
      {/* Apple logo — single path. currentColor so it works on
          both light (forest text) and dark (cream text) themes. */}
      <path d="M17.05 12.04c-.03-3.04 2.49-4.5 2.6-4.57-1.42-2.07-3.62-2.36-4.4-2.39-1.87-.19-3.65 1.1-4.6 1.1-.95 0-2.42-1.07-3.97-1.04-2.04.03-3.94 1.19-4.99 3.02-2.13 3.69-.54 9.13 1.52 12.13 1.01 1.47 2.21 3.12 3.78 3.06 1.52-.06 2.09-.99 3.92-.99 1.83 0 2.36.99 3.97.96 1.65-.03 2.68-1.49 3.68-2.97 1.17-1.71 1.64-3.36 1.66-3.45-.04-.02-3.18-1.22-3.21-4.85zM14.06 3.51c.83-1 1.39-2.4 1.23-3.79-1.19.05-2.63.79-3.49 1.78-.77.88-1.45 2.29-1.27 3.66 1.33.1 2.69-.67 3.53-1.65z" />
    </svg>
  );
}
