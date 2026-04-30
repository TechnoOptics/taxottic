export const metadata = { title: "Terms - Taxottic" };

export default function TermsPage() {
  return (
    <main className="min-h-screen">
      <section className="max-w-2xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Terms of Service
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          The honest version.
        </h1>

        <div className="mt-6 text-sm text-ink-soft leading-relaxed grid gap-4">
          <p>
            By using Taxottic you agree to these terms. Taxottic is provided
            by Techno Optics LLC (&quot;we&quot;).
          </p>
          <p>
            <strong>Service.</strong> Taxottic forecasts your taxes and
            organizes deductions based on data you enter. It is{" "}
            <em>educational guidance</em>, not tax advice. Always confirm
            important decisions with a licensed CPA or tax attorney.
          </p>
          <p>
            <strong>Accounts.</strong> One account per person. You are
            responsible for what happens under your sign-in. Don&apos;t
            share credentials.
          </p>
          <p>
            <strong>Payment.</strong> If you upgrade to Pro, Stripe handles
            billing on a recurring basis until you cancel. You can cancel
            at any time from Billing; access continues until period end.
          </p>
          <p>
            <strong>No warranty for tax outcomes.</strong> We do our best to
            keep brackets, deductions, and rules accurate, but tax law
            changes. Numbers shown are estimates. We are not liable for tax
            outcomes.
          </p>
          <p>
            <strong>Use of content.</strong> Taxottic content (the
            interface, screens, dashboards, generated reports, deduction
            scorecards, and any visual or textual asset rendered to you)
            is licensed to you for your own use only. You agree not to
            (a) screenshot, screen-record, or otherwise capture
            Taxottic surfaces for redistribution, (b) download, save, or
            extract assets except via the official year-end export
            provided under Forecast {">"} Year-end summary, or (c)
            republish, repost, or share captured content publicly or
            with third parties beyond the CPA or preparer you engage.
            Taxottic watermarks all authenticated screens with your
            account email so leaks are traceable; circumventing or
            removing watermarks is a separate breach. Capture-attempt
            heuristics may log when these protections are tripped.
          </p>
          <p>
            <strong>Termination.</strong> We may suspend accounts that
            violate these terms or applicable law. You may delete your
            account at any time.
          </p>
          <p className="text-xs text-ink-muted">
            Last updated 2026-04-30. Questions:{" "}
            <a
              href="mailto:contact@taxottic.com"
              className="underline hover:text-forest-900"
            >
              contact@taxottic.com
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
