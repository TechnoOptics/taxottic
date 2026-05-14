export const metadata = { title: "Acceptable Use - Taxottic" };

export default function AcceptableUsePage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Acceptable Use Policy
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          What we ask of you.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">Last updated: 2026-05-04</p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <p>
            Taxottic is a tool that helps people and firms understand and
            organise their taxes. Please use it accordingly. The list below
            isn&apos;t exhaustive; the spirit is what matters.
          </p>

          <h2 className="display text-xl text-forest-900">Don&apos;t do these</h2>
          <ul className="list-disc pl-5 grid gap-2">
            <li>
              Use Taxottic for unlawful activity, money laundering, tax
              evasion, or to file fraudulent returns.
            </li>
            <li>
              Misrepresent who you are. No fake identities, no scraping
              other people&apos;s tax data, no sign-ups on someone
              else&apos;s behalf without their permission.
            </li>
            <li>
              Share your sign-in or pretend to be another user. Each
              account is for one person; firms have firm-side seats.
            </li>
            <li>
              Probe, scan, or load-test the service without prior written
              consent (security research excepted - see{" "}
              <a href="/legal/security" className="underline hover:text-forest-900">
                /legal/security
              </a>
              ).
            </li>
            <li>
              Reverse engineer or scrape the interface, deduction
              catalog, or AI prompts. Use the official export at
              <em> Forecast &raquo; Year-end summary</em> for your data.
            </li>
            <li>
              Upload malware, run automated bots, or attempt to interfere
              with other users&apos; experience.
            </li>
            <li>
              Harass, threaten, or abuse other users, our team, or
              support contacts.
            </li>
            <li>
              Use the service to facilitate discrimination prohibited by
              law.
            </li>
          </ul>

          <h2 className="display text-xl text-forest-900">Please do these</h2>
          <ul className="list-disc pl-5 grid gap-2">
            <li>Tell us what is broken or confusing - we want to fix it.</li>
            <li>
              Verify any tax decision against the cited IRS publication
              before acting on it.
            </li>
            <li>
              Treat your CPA / preparer as the final word on your filing.
              Taxottic is here to help, not replace.
            </li>
          </ul>

          <p className="text-xs text-ink-muted">
            We may suspend accounts that violate this policy. Honest
            mistakes get a heads-up first; bad-faith use does not.
          </p>
        </div>
      </section>
    </main>
  );
}
