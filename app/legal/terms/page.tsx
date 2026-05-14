import Link from "next/link";

export const metadata = { title: "Terms - Taxottic" };

export default function TermsPage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Terms of Service
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          The honest version.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Effective: 2026-05-04 · Last updated: 2026-05-04
        </p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <Section title="Agreement">
            <p>
              These Terms of Service (&quot;Terms&quot;) form a binding
              agreement between you and <strong>Techno Optics LLC</strong>{" "}
              (a Massachusetts LLC, &quot;we&quot;, &quot;us&quot;,
              &quot;Taxottic&quot;). By creating an account or using
              Taxottic you accept these Terms and our{" "}
              <Link href="/legal/privacy" className="underline hover:text-forest-900">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link href="/legal/acceptable-use" className="underline hover:text-forest-900">
                Acceptable Use Policy
              </Link>
              .
            </p>
          </Section>

          <Section title="What Taxottic does (and does not do)">
            <p>
              Taxottic forecasts your taxes and organises deductions based
              on data you enter or import. It is{" "}
              <em>educational guidance</em>, not tax, legal, or financial
              advice. Numbers are estimates that depend on the data you
              provide. <strong>Always confirm important decisions with a
              licensed CPA or tax attorney.</strong>
            </p>
            <p>
              Taxottic is not the IRS, not a tax preparer, and does not
              file returns on your behalf.
            </p>
          </Section>

          <Section title="Your account">
            <p>
              One account per person. You must be at least 18 years old.
              You are responsible for what happens under your sign-in -
              keep your credentials private and add a passkey from
              <em> Settings &raquo; Security</em>.
            </p>
            <p>
              You may delete your account at any time. We may suspend or
              terminate accounts that violate these Terms or applicable
              law.
            </p>
          </Section>

          <Section title="Subscriptions and payment">
            <p>
              Free tiers exist for individuals and small teams. Paid
              tiers (Pro, Firm) are billed by Stripe on a recurring basis
              until you cancel. You can cancel any time from
              <em> Billing</em>; access continues until period end. We do
              not pro-rate refunds for partial months unless required by
              law or agreed in writing.
            </p>
            <p>
              Prices are listed in USD on the Billing page. Tax may be
              added based on your billing address.
            </p>
          </Section>

          <Section title="Bank connections">
            <p>
              When you connect a bank, you authorise Taxottic to retrieve
              transaction data through Plaid for the purposes of
              forecasting and deduction tracking. You can revoke that
              authorisation at any time from <em>Banks &raquo; Disconnect</em>;
              we then revoke the access token and stop syncing.
            </p>
            <p>
              You confirm you have the right to share the bank data with
              Taxottic and that doing so does not violate any agreement
              you have with your bank.
            </p>
          </Section>

          <Section title="Bella (AI features)">
            <p>
              Bella generates educational responses to tax-related
              questions you ask. Replies are produced by Anthropic on our
              behalf. They can be wrong. Treat them as a starting point,
              not a verdict, and verify any cited IRS publication
              directly. We do not guarantee the accuracy or completeness
              of Bella&apos;s answers.
            </p>
          </Section>

          <Section title="Your content">
            <p>
              You retain ownership of all data you enter (your tax
              entries, exports, conversations). You grant us a non-
              exclusive, worldwide, royalty-free licence to host,
              process, and display that data solely to operate Taxottic
              for you and to provide the features you request. The
              licence ends when you delete your account.
            </p>
          </Section>

          <Section title="Use of Taxottic content">
            <p>
              The Taxottic interface, screens, dashboards, generated
              reports, deduction scorecards, and visual or textual
              assets are licensed to you for your own use. You agree not
              to:
            </p>
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                Screenshot, screen-record, or otherwise capture Taxottic
                surfaces for redistribution.
              </li>
              <li>
                Download, save, or extract assets except via the official
                year-end export under <em>Forecast &raquo; Year-end
                summary</em>.
              </li>
              <li>
                Republish, repost, or share captured content publicly or
                with third parties beyond the CPA or preparer you engage.
              </li>
              <li>
                Reverse engineer, scrape, or attempt to derive source
                code or data models from the service.
              </li>
            </ul>
            <p>
              Taxottic watermarks authenticated screens with your account
              email so leaks are traceable. Circumventing or removing
              watermarks is a separate breach of these Terms.
            </p>
          </Section>

          <Section title="Acceptable use">
            <p>
              You agree to follow our{" "}
              <Link href="/legal/acceptable-use" className="underline hover:text-forest-900">
                Acceptable Use Policy
              </Link>
              . In short: no illegal activity, no harassment, no
              misrepresentation, no abuse of the service or other users.
            </p>
          </Section>

          <Section title="Service availability">
            <p>
              We aim for high availability but do not guarantee
              uninterrupted access. Scheduled maintenance is announced in
              advance where possible. We are not liable for downtime
              caused by upstream providers (Vercel, Supabase, Plaid,
              Anthropic, Stripe).
            </p>
          </Section>

          <Section title="Disclaimer of warranties">
            <p>
              Taxottic is provided &quot;as is&quot; and &quot;as
              available&quot;. To the maximum extent permitted by law, we
              disclaim all warranties, express or implied, including
              warranties of merchantability, fitness for a particular
              purpose, non-infringement, and accuracy of tax outcomes.
            </p>
          </Section>

          <Section title="Limitation of liability">
            <p>
              To the maximum extent permitted by law, our total liability
              for any claim arising from or related to Taxottic is
              limited to the greater of (a) USD $100 or (b) the fees you
              paid us in the 12 months before the claim arose. We are
              not liable for indirect, consequential, special, or
              punitive damages, lost profits, lost data, or tax
              penalties or interest.
            </p>
          </Section>

          <Section title="Indemnification">
            <p>
              You agree to indemnify and hold harmless Techno Optics LLC,
              its members, officers, and employees from claims arising
              out of your use of Taxottic, your content, or your
              violation of these Terms.
            </p>
          </Section>

          <Section title="Governing law and disputes">
            <p>
              These Terms are governed by the laws of the Commonwealth
              of Massachusetts, without regard to conflict-of-law rules.
              Disputes will be resolved in the state or federal courts
              located in Suffolk County, Massachusetts, and you consent
              to that jurisdiction.
            </p>
          </Section>

          <Section title="Changes to these Terms">
            <p>
              We may update these Terms. For material changes we will
              notify you in-app and by email at least 14 days before
              they take effect. Continued use after the effective date
              means you accept the change.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about these Terms:{" "}
              <a href="mailto:contact@taxottic.com" className="underline hover:text-forest-900">
                contact@taxottic.com
              </a>
              . Privacy:{" "}
              <a href="mailto:privacy@taxottic.com" className="underline hover:text-forest-900">
                privacy@taxottic.com
              </a>
              . Security:{" "}
              <a href="mailto:security@taxottic.com" className="underline hover:text-forest-900">
                security@taxottic.com
              </a>
              .
            </p>
          </Section>
        </div>
      </section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="display text-xl text-forest-900">{title}</h2>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}
