/**
 * UNREVIEWED DRAFT. Not legal advice, not a final legal instrument.
 *
 * Revised 2026-08-01. The previous table was wrong in three ways and
 * was corrected against the code:
 *   1. It listed `tx_gdpr_consent`, which does not exist. Consent is a
 *      column on the profiles table (app/actions/consent.ts:6-13), not
 *      a cookie. Removed.
 *   2. It used the supabase-js v1 cookie names `sb-access-token` and
 *      `sb-refresh-token`. @supabase/ssr writes a single chunked
 *      `sb-<project-ref>-auth-token`. Corrected.
 *   3. It omitted six real cookies: the three OAuth handshake cookies
 *      set in app/api/auth/{google,azure}/start/route.ts, the
 *      client-side `_oauth_next` from app/login/page.tsx:264, and the
 *      two one-shot invite flash cookies from
 *      app/c/[publicId]/manage/actions.ts:212,219. Added.
 *
 * The substantive claims (no advertising cookies, no third-party
 * tracking pixels, no analytics SDK) were verified and are accurate:
 * there is no Sentry, PostHog, GA, Plausible, Mixpanel or Segment in
 * the tree, and @vercel/analytics is not installed.
 *
 * next.config.ts used to allow-list *.vercel-insights.com in
 * script-src and connect-src. Nothing referenced it, so it collected
 * nothing, but a CSP allow-list is a promise about where bytes may go
 * and that promise was looser than this page. It was removed on
 * 2026-08-17, and lib/security/csp.test.ts now fails if any analytics
 * host is added back without this page changing first.
 *
 * If any non-essential cookie is ever added, the GdprBanner is
 * notice-only today (components/GdprBanner.tsx) and would need to
 * become a real consent gate with a reject path.
 */

export const metadata = {
  title: "Cookies - Taxottic",
  description:
    "Every cookie Taxottic sets, what it is for, and how long it lasts. All of them are strictly necessary.",
  alternates: { canonical: "/legal/cookies" },
};

const COOKIES = [
  {
    name: "sb-<project>-auth-token",
    purpose:
      "Holds your signed-in session. Split across numbered chunks when it is too large for one cookie.",
    duration: "Rotated on use, cleared when you sign out.",
    type: "Strictly necessary",
  },
  {
    name: "tx_passkey_challenge",
    purpose:
      "Holds a short-lived challenge during a passkey sign-in or registration.",
    duration: "A few minutes.",
    type: "Strictly necessary",
  },
  {
    name: "taxottic_oauth_state",
    purpose:
      "Guards the Google and Microsoft sign-in handshake against cross-site request forgery.",
    duration: "10 minutes.",
    type: "Strictly necessary",
  },
  {
    name: "taxottic_oauth_nonce",
    purpose:
      "Ties the identity token returned by Google or Microsoft to the sign-in you started.",
    duration: "10 minutes.",
    type: "Strictly necessary",
  },
  {
    name: "taxottic_oauth_next",
    purpose:
      "Remembers the page you were heading to so we can return you there after sign-in.",
    duration: "10 minutes.",
    type: "Strictly necessary",
  },
  {
    name: "_oauth_next",
    purpose:
      "The same return-to-page memory, set in the browser for the mobile app and installed-app sign-in path.",
    duration: "10 minutes.",
    type: "Strictly necessary",
  },
  {
    name: "taxottic_last_invite_link",
    purpose:
      "Carries the invite link you just generated across one page reload so it can be shown to you.",
    duration: "Read once, then cleared.",
    type: "Strictly necessary",
  },
  {
    name: "taxottic_last_invite_email_status",
    purpose:
      "Carries the result of sending an invite email across one page reload so it can be shown to you.",
    duration: "Read once, then cleared.",
    type: "Strictly necessary",
  },
];

export default function CookiesPage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Cookies
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          The short cookie story.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">Last updated: 2026-08-01</p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <p>
            Taxottic uses only the cookies it needs to keep you signed in
            and to make sign-in, passkeys, and basic security work. We do
            not set advertising cookies. We do not load third-party
            tracking pixels. We do not run an analytics or crash-reporting
            SDK. We do not sell or share your data with ad networks.
          </p>
          <p>
            The banner you may have seen asking you to accept is a notice
            about how we process your data generally, not a cookie
            consent, because every cookie below is strictly necessary.
            Your acknowledgement is recorded on your account rather than
            in a cookie.
          </p>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.18em] text-gold-700 border-b border-forest-100">
                  <th className="text-left font-medium px-4 py-3">Cookie</th>
                  <th className="text-left font-medium px-4 py-3">Purpose</th>
                  <th className="text-left font-medium px-4 py-3">Lifetime</th>
                </tr>
              </thead>
              <tbody>
                {COOKIES.map((c) => (
                  <tr
                    key={c.name}
                    className="border-b border-forest-50 last:border-0 align-top"
                  >
                    <td className="px-4 py-3 text-forest-900 font-mono text-[12px] break-all">
                      {c.name}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{c.purpose}</td>
                    <td className="px-4 py-3 text-ink-muted">{c.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-ink-muted">
            Strictly necessary cookies do not require consent under GDPR
            because the service cannot function without them. If we ever
            add an analytics or marketing cookie, you will be asked to
            consent first and we will list it on this page.
          </p>
        </div>
      </section>
    </main>
  );
}
