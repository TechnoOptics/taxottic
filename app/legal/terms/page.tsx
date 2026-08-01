import Link from "next/link";

/**
 * UNREVIEWED DRAFT. Not legal advice, not a final legal instrument.
 *
 * Revised 2026-08-01 by an engineering pass that checked the billing
 * clauses against what Stripe is actually configured to do. It has NOT
 * been reviewed by an attorney.
 *
 * What changed on 2026-08-01:
 *  1. "Free tiers exist ... Paid tiers (Pro, Firm)" described plans
 *     that do not exist. The real ladder is free / filer / solo /
 *     studio / scale / practice, monthly or yearly, plus one-off
 *     credit packs (lib/plans/limits.ts:36, 273-334, 342-367).
 *  2. The 7-day Solo trial with no card was undisclosed
 *     (supabase/migrations/20260505000005_signup_trial.sql:82-96).
 *  3. Cancellation happens in the Stripe-hosted billing portal, not in
 *     our UI (app/api/stripe/portal/route.ts:36-39). There is no
 *     refund logic in the product at all. Stated honestly.
 *  4. Purchases are made on the web, never in the mobile app
 *     (capacitor.config.ts:23-26, app/billing/page.tsx:59-79). Added,
 *     because an app-store reviewer will look for it.
 *  5. Added a mileage/employer clause pointing at the new notice.
 *
 * ATTORNEY: the two clauses that most need your judgment are
 *   - "Governing law and disputes". The Massachusetts choice of law
 *     and Suffolk County venue were already shipped and match the
 *     entity's home state, so they were left in place rather than
 *     replaced with a blank. But the DISPUTE MECHANISM is an open
 *     question that was never decided by anyone qualified: courts
 *     versus arbitration, class-action waiver, jury waiver, and the
 *     consumer carve-outs that several states require. Treat the
 *     current text as a placeholder pending your decision.
 *   - "Limitation of liability". The $100-or-fees-paid cap is a
 *     drafting convention, not a considered position, and its
 *     enforceability against consumers varies by state.
 *
 * ALSO FOR THE OWNER: the app-store payment-compliance model is still
 * undecided (docs/store-listing/CONTENT_PACK.md:85). Today there is no
 * in-app purchase code and the native build hides purchase controls.
 * If that changes, the "Where you can buy" clause must change with it.
 */

export const metadata = {
  title: "Terms - Taxottic",
  description:
    "The agreement between you and Techno Optics LLC for using Taxottic, including what the software is not, subscription terms, and liability.",
  alternates: { canonical: "/legal/terms" },
};

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

          <Section title="What Taxottic does (and does not do)" id="forecast-vs-advice">
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
            <h3 className="display text-base text-forest-900 mt-2">
              Forecast vs. tax advice, the distinction
            </h3>
            <p>
              Every number Taxottic shows is a <strong>forecast</strong>:
              a computation produced by a tax engine, run against the
              books and tax-profile data you supplied, using current-year
              federal and state rate tables that we maintain on a
              best-effort basis. This includes:
            </p>
            <ul className="list-disc ml-5 grid gap-1">
              <li>Projected federal + state income tax owed</li>
              <li>Quarterly estimated payment recommendations</li>
              <li>Refund / amount-owed estimates on Form 1040 drafts</li>
              <li>Schedule C, K-1, 1099, 1065, 1120, 1120-S generators</li>
              <li>
                Multi-state apportionment math + sales-tax nexus
                detection
              </li>
              <li>Bella AI educational answers about tax code</li>
            </ul>
            <p>
              Forecasts are <strong>not</strong>:
            </p>
            <ul className="list-disc ml-5 grid gap-1">
              <li>
                Tax advice rendered by a licensed Enrolled Agent, CPA,
                or attorney
              </li>
              <li>A filed return, only the IRS / state DOR + your
                preparer can produce that
              </li>
              <li>
                A substitute for preparer judgment on facts and
                circumstances the engine doesn&apos;t see
              </li>
              <li>
                A guarantee that the rate tables we use are current -
                states publish rate changes at varying cadences and
                we may lag a few weeks
              </li>
            </ul>
            <p>
              Generated documents are watermarked DRAFT for a reason.
              Before you sign anything, pay the IRS based on a
              Taxottic figure, or send a return to the authority, run
              the work past a licensed tax professional. If a number
              we showed turns out to be wrong, the
              limitation-of-liability section below applies.
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

          <Section title="Subscriptions and payment" id="billing">
            <p>
              There is a free tier. Paid plans are Filer, Solo, Studio,
              Scale, and Practice, each available monthly or yearly, with
              yearly billed at a discount. Current prices are listed in USD
              on the{" "}
              <Link
                href="/pricing"
                className="underline hover:text-forest-900"
              >
                Pricing
              </Link>{" "}
              page. Tax may be added based on your billing address.
            </p>
            <p>
              <strong>Free trial.</strong> New accounts start on a 7-day
              Solo trial with an initial credit grant, and we do not ask
              for a card to begin it. When the 7 days end, the account
              simply reverts to the free tier. Nothing is charged unless
              you choose a paid plan.
            </p>
            <p>
              <strong>Credits and top-ups.</strong> Some features consume
              credits, which your plan grants each billing period. You can
              buy one-off credit packs. Top-up purchases are capped per
              billing period, and unused granted credits roll over only up
              to a cap. Credits are not money, have no cash value, and are
              not redeemable or refundable.
            </p>
            <p>
              <strong>Renewal and cancellation.</strong> Paid plans renew
              automatically at the end of each period until you cancel.
              Cancellation is handled in the Stripe billing portal, which
              you reach from <em>Billing</em>. When you cancel, your plan
              stays active until the end of the period you already paid
              for, and then drops to the free tier.
            </p>
            <p>
              <strong>Refunds.</strong> Charges are not refundable and we
              do not pro-rate partial periods, except where the law where
              you live requires otherwise or where we agree in writing. If
              you think you were billed in error, write to{" "}
              <a
                href="mailto:contact@taxottic.com"
                className="underline hover:text-forest-900"
              >
                contact@taxottic.com
              </a>{" "}
              and we will look at it.
            </p>
            <p>
              <strong>Where you can buy.</strong> Subscriptions and credit
              packs are purchased on the Taxottic website and processed by
              Stripe. The iOS and Android apps do not sell anything; they
              link you to the web for billing. We never see or store your
              card number.
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

          <Section title="Automatic mileage tracking and teams">
            <p>
              Automatic mileage tracking is optional and off until you turn
              it on. If you turn it on, the app records your location in
              the background to detect drives. What is recorded, how long
              it is kept, and who can see it is described at{" "}
              <Link
                href="/legal/location-monitoring"
                className="underline hover:text-forest-900"
              >
                Location tracking and team visibility
              </Link>
              .
            </p>
            <p>
              <strong>
                If you enable mileage tracking for people who work for you,
                you are responsible for doing so lawfully.
              </strong>{" "}
              Employee location monitoring is regulated, and the notice and
              consent obligations differ by jurisdiction. You confirm that
              you have given your workers whatever notice is required where
              they work, obtained any consent that is required, and that
              you have a lawful basis for the monitoring. We provide the
              product controls, the notice linked above, and a{" "}
              <Link
                href="/legal/dpa"
                className="underline hover:text-forest-900"
              >
                Data Processing Agreement
              </Link>
              . We do not advise you on whether your deployment is lawful,
              and nothing in these Terms is legal advice.
            </p>
            <p>
              Mileage figures produced by the app are estimates derived
              from GPS. You remain responsible for the mileage records you
              rely on for a deduction and for meeting IRS substantiation
              requirements.
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

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={id ? "scroll-mt-24" : undefined}>
      <h2 className="display text-xl text-forest-900">{title}</h2>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}
