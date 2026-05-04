export const metadata = { title: "Cookies - Taxottic" };

const COOKIES = [
  {
    name: "sb-access-token",
    purpose: "Holds your signed-in session.",
    duration: "1 hour, refreshed with sb-refresh-token.",
    type: "Strictly necessary",
  },
  {
    name: "sb-refresh-token",
    purpose: "Renews the access token without re-typing your password.",
    duration: "Up to 7 days, rotated on use.",
    type: "Strictly necessary",
  },
  {
    name: "tx_passkey_challenge",
    purpose:
      "Holds a short-lived challenge during a passkey sign-in or registration.",
    duration: "5 minutes.",
    type: "Strictly necessary",
  },
  {
    name: "tx_gdpr_consent",
    purpose:
      "Remembers that you accepted the GDPR banner so we don't show it again.",
    duration: "12 months.",
    type: "Strictly necessary",
  },
];

export default function CookiesPage() {
  return (
    <main className="min-h-screen">
      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Cookies
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          The short cookie story.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">Last updated: 2026-05-04</p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <p>
            Taxottic uses only the cookies it needs to keep you signed in
            and to make passkeys, GDPR consent, and basic security work.
            We do not set advertising cookies. We do not load third-party
            tracking pixels. We do not sell or share your data with ad
            networks.
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
