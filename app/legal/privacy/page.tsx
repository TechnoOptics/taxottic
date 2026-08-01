import Link from "next/link";

/**
 * UNREVIEWED DRAFT. Not legal advice, not a final legal instrument.
 *
 * Revised 2026-08-01 by an engineering pass that read the schema and
 * the code, specifically to remove statements that did not match what
 * the software actually does. It has NOT been reviewed by an attorney.
 *
 * What changed on 2026-08-01 and why (keep this list, it is the audit
 * trail for anyone checking the policy against the code):
 *
 *  1. "Location ... never shared" was false. Coordinates are sent to
 *     Google Maps Platform (lib/maps/static-map.ts:91-107 puts raw
 *     points in a URL, lib/maps/reverseGeocode.ts:59,113 sends trip
 *     endpoints to Geocoding and Places). Business trips are also
 *     shared with the employer and any engaged firm. Corrected.
 *  2. No retention window was stated for location. Real windows are in
 *     app/api/cron/mileage-retention/route.ts:47-49. Raw fixes 30 days
 *     after consumption, stranded fixes swept at 45 then deleted at
 *     +30, heartbeats 30 days. mileage_points and mileage_trips have
 *     NO expiry job at all. Stated plainly.
 *  3. Employer visibility was one sentence and described the wrong
 *     actor ("account manager you have an active engagement with").
 *     The real rule is lib/mileage/team-scope.ts:154-157, and it
 *     applies to in-company managers as well as engaged firms. Given
 *     its own page at /legal/location-monitoring and summarised here.
 *  4. Document OCR was undisclosed. Full unredacted file bytes go to
 *     Anthropic (lib/ocr/extract-*.ts). A W-2 image carries an SSN
 *     even though we never parse or store one. Disclosed.
 *  5. Device telemetry, chat messages, push tokens and notification
 *     content, W-9 TINs, EINs, and inferred home/work places were all
 *     undisclosed. Added.
 *  6. The claim that Anthropic does not retain data for training "per
 *     our Anthropic enterprise agreement" is a CONTRACTUAL claim with
 *     no evidence in this repo. Softened to what we can stand behind.
 *     ATTORNEY/OWNER: confirm the agreement exists, or this sentence
 *     and the matching one on /legal/subprocessors must change again.
 *
 * Known gaps deliberately left as placeholders, see the report:
 *  - docs/mobile-privacy-disclosure.md still declares precise location
 *    "Not collected". That is wrong and must be fixed before the next
 *    store submission. Not fixed here because it changes a store
 *    declaration, which is the owner's call.
 *  - The retention schedule in docs/DATA_RETENTION_AND_DISPOSAL_POLICY
 *    promises a 24-month cap on bank transactions and a 12-month cap
 *    on Bella conversations. No cron enforces either. This policy
 *    therefore does NOT repeat those numbers.
 */

export const metadata = {
  title: "Privacy - Taxottic",
  description:
    "What Taxottic collects, why, who can see it, how long it is kept, and how to get it back or delete it.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Privacy Policy
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Your data, in plain English.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Effective: 2026-08-01 · Last updated: 2026-08-01
        </p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <Section title="Who we are">
            <p>
              Taxottic is a tax forecasting and deduction-tracking service
              operated by <strong>Techno Optics LLC</strong>, a
              Massachusetts limited liability company (&quot;we&quot;,
              &quot;us&quot;, &quot;Taxottic&quot;). Contact:{" "}
              <a
                href="mailto:contact@taxottic.com"
                className="underline hover:text-forest-900"
              >
                contact@taxottic.com
              </a>
              .
            </p>
            <p>
              For data-protection inquiries (GDPR / CCPA requests,
              deletion, portability):{" "}
              <a
                href="mailto:privacy@taxottic.com"
                className="underline hover:text-forest-900"
              >
                privacy@taxottic.com
              </a>
              .
            </p>
            <p>
              When you use Taxottic for your own taxes, we are the
              controller of your data. When your employer or an accounting
              firm puts you on Taxottic, that company decides what is
              collected about you and why, and we process it for them
              under our{" "}
              <Link
                href="/legal/dpa"
                className="underline hover:text-forest-900"
              >
                Data Processing Agreement
              </Link>
              .
            </p>
          </Section>

          <Section title="What we collect, and why">
            <p>
              We only collect what we need to forecast your taxes and run
              your account. We do not buy data about you.
            </p>
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>Account info</strong> from sign-in: email, full
                name, profile photo (when supplied by Google or Microsoft).
                Used for authentication and to greet you.
              </li>
              <li>
                <strong>Tax profile</strong> you enter: filing status,
                state, number of dependents, age, and business profile
                fields. Used to run forecasts. We store a count of
                dependents, never their names or identifiers.
              </li>
              <li>
                <strong>Income and expense entries</strong> you log or
                import. Used to calculate your federal and state tax
                estimate, surface deductions, and produce reports you ask
                for.
              </li>
              <li>
                <strong>Business tax identifiers</strong>. If you enter an
                EIN for your business, we store it encrypted. If you
                complete a W-9 that a firm sent you, the taxpayer
                identification number you type (an SSN or EIN) is
                encrypted before it is stored, and is shown masked
                afterwards. We also record the IP address and browser
                user-agent at the moment you sign a W-9, because a signed
                tax form needs an audit trail.
              </li>
              <li>
                <strong>Bank connection data</strong> if you connect a bank
                through Plaid, or a Stripe account as an income source: the
                institution name, the last four digits of the account, the
                balance, and for each transaction the date, amount,
                merchant, and the bank&apos;s own description. We also keep
                the provider&apos;s raw record of the transaction. We never
                see your bank login. See &quot;Bank connections&quot;
                below.
              </li>
              <li>
                <strong>Documents you scan</strong>: receipts, pay stubs,
                W-2s, and prior-year tax documents. See &quot;Documents and
                scanning&quot; below, which explains what happens to the
                file.
              </li>
              <li>
                <strong>Bella conversations</strong>: messages you send to
                our in-app guide, and its replies. Used to answer you and
                to keep your conversation history.
              </li>
              <li>
                <strong>Team chat</strong>: messages and file attachments
                you send to other members of your company inside Taxottic.
              </li>
              <li>
                <strong>Location</strong>, only if you turn on automatic
                mileage tracking: GPS points while you drive, used to
                compute your IRS mileage deduction. Off by default,
                opt-in, and stoppable any time. See{" "}
                <Link
                  href="/legal/location-monitoring"
                  className="underline hover:text-forest-900"
                >
                  Location tracking and team visibility
                </Link>
                , which covers this in full.
              </li>
              <li>
                <strong>Device and diagnostic data</strong> from the mobile
                app while mileage tracking is on: platform, app version,
                whether tracking is enabled, which location permission you
                granted, whether precise location is on, whether battery
                optimisation or low-power mode is active, and how recently
                the app uploaded. Used to tell you when tracking has
                silently stopped.
              </li>
              <li>
                <strong>Push notification tokens</strong> if you allow
                notifications, so Apple, Google, or your browser can
                deliver them.
              </li>
              <li>
                <strong>Operational data</strong>: timestamps, IP address
                at request time, browser user-agent, and the events needed
                for security, debugging, and billing.
              </li>
            </ul>
            <p>
              We do not collect your Social Security number for your own
              account, your bank account or routing numbers, your card
              numbers, or your dependents&apos; details. We do not use any
              third-party analytics or advertising SDK, and there is no
              crash-reporting SDK in the app.
            </p>
          </Section>

          <Section title="Location and automatic mileage tracking" id="location">
            <p>
              Automatic mileage tracking is <strong>off by default</strong>
              . It turns on only when you flip the toggle on the Mileage
              screen, read the explanation, and grant your phone&apos;s
              location permission. You can turn it off there at any time.
            </p>
            <p>
              While on, the app records GPS points as you drive, including
              in the background, so a trip is captured even when the app is
              closed. We use them to detect trips and calculate your IRS
              mileage deduction, and for nothing else.{" "}
              <strong>
                Location data is never sold and is never used for
                advertising or profiling.
              </strong>
            </p>
            <p>
              It is shared in two specific ways, and you should know about
              both. Coordinates are sent to Google Maps Platform to draw
              maps, route thumbnails, and place names. And{" "}
              <strong>
                if you drive for a company, a manager at that company (and
                any accounting firm it has engaged) can see the drives you
                have marked as business, including the route line
              </strong>
              . Drives you mark personal, and drives you have not yet
              classified or confirmed, are not shown to them.
            </p>
            <p>
              Retention is not uniform. Raw GPS fixes are deleted within
              roughly 30 to 75 days. Device-health history is deleted after
              30 days. Completed trips and their route lines are kept until
              you delete them or the account is deleted, because a mileage
              deduction has to be substantiated to the IRS long after the
              drive.
            </p>
            <p>
              The full account, including exactly what a manager sees and
              what employers should consider, is at{" "}
              <Link
                href="/legal/location-monitoring"
                className="underline hover:text-forest-900"
              >
                /legal/location-monitoring
              </Link>
              .
            </p>
          </Section>

          <Section title="Bank connections (Plaid and Stripe)">
            <p>
              When you connect a bank account through Plaid, your bank
              credentials are entered into Plaid&apos;s secure interface
              and never reach Taxottic servers. Plaid returns an access
              token and the transaction stream we display. We store that
              access token encrypted with AES-256-GCM, and we request only
              transaction data, not account or identity verification
              products.
            </p>
            <p>
              You can also connect a Stripe account as an income source. In
              that case the record we store for each payout or charge is
              the one Stripe gives us, which can include the name and email
              your own customer gave Stripe.
            </p>
            <p>
              We store the last four digits of an account, never the full
              account number and never a routing number. Plaid&apos;s
              privacy practices are documented at{" "}
              <a
                href="https://plaid.com/legal/#consumers"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-forest-900"
              >
                plaid.com/legal
              </a>
              . You can disconnect a bank at any time from{" "}
              <em>Banks &raquo; Disconnect</em>, which stops syncing and
              moves the connection to your recycle bin.
            </p>
          </Section>

          <Section title="Documents and scanning" id="documents">
            <p>
              When you scan a receipt, a pay stub, a W-2, or a prior-year
              tax document, the file is sent to Anthropic, which reads it
              and returns the figures. We then store only the structured
              result, for example the wage and withholding amounts from a
              W-2, plus the filename.{" "}
              <strong>
                We do not store the image or PDF itself for any of these
                four document types.
              </strong>
            </p>
            <p>
              Be aware of what that means in practice:{" "}
              <strong>
                the whole file is transmitted, not just the parts we ask
                for.
              </strong>{" "}
              If you photograph a W-2, that image contains your Social
              Security number and address even though Taxottic never reads,
              parses, or stores either. If you would rather not transmit a
              document, type the figures in by hand instead.
            </p>
            <p>
              Other files you upload are stored rather than passed through.
              Chat attachments, company and firm logos, avatars, and
              documents a firm exchanges with a client are kept in private
              storage (logos and avatars are public by design, since they
              are displayed). Documents in a firm workspace are retained
              for the firm and are visible to the firm members working on
              your engagement.
            </p>
          </Section>

          <Section title="Bella and AI features">
            <p>
              Bella is our in-app tax guide. Replies are generated by
              Anthropic on your behalf. When you ask Bella a question we
              send it your question, the last few turns of that
              conversation, and a summary of your situation: tax year,
              filing status, state, age, your company&apos;s name, industry
              and entity type, and your year-to-date income and expense
              totals. We also use Anthropic to suggest categories for
              imported bank transactions, which sends the transaction
              description, amount, and date.
            </p>
            <p>
              We do not sell your data and we do not use it to train any
              model of our own. We do not permit our AI provider to train
              general models on your content, and our contractual terms
              with them govern that. If you would rather not send anything
              to an AI provider, do not use Bella and enter figures
              manually rather than scanning documents.
            </p>
            <p>
              Your Bella conversation history is stored on your account so
              you can return to it, and you can delete it.
            </p>
          </Section>

          <Section title="Team chat">
            <p>
              Messages you send in a company channel are readable by the
              members of that company who belong to the conversation.
              Messages in a private group or direct message are readable by
              the participants. A company manager can delete a message in
              their company. Losing your seat in a company removes your
              access to that company&apos;s conversations.
            </p>
            <p>
              Chat is not scanned, not analysed, and not sent to any AI
              provider or any other third party. There is currently no
              automatic expiry on chat, so messages remain until they are
              deleted or the company or account is deleted. If someone
              messages you and you have notifications on, the notification
              says who messaged you but never includes the message text.
            </p>
          </Section>

          <Section title="Notifications">
            <p>
              If you allow notifications, we store a device token so Apple,
              Google, or your browser can deliver them, and we keep a
              record of what we sent. Notification text is kept deliberately
              thin, because it appears on a lock screen: it can include a
              drive&apos;s mileage, a goal or badge name you chose, or the
              name of the person who messaged you. It does not include
              financial totals or message contents.
            </p>
          </Section>

          <Section title="How we use your data">
            <ul className="list-disc pl-5 grid gap-2">
              <li>To operate the service (sign-in, forecasts, exports).</li>
              <li>
                To send service emails: receipts, security alerts,
                quarterly-tax reminders you opted into.
              </li>
              <li>
                To keep the service working and secure, including telling
                you when mileage tracking has stopped.
              </li>
              <li>To take payment for paid plans.</li>
              <li>
                To improve the product, in aggregated and de-identified
                form.
              </li>
              <li>
                To comply with law, respond to lawful requests, and protect
                our rights.
              </li>
            </ul>
          </Section>

          <Section title="Legal bases (UK and EU)">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>Performance of a contract</strong>: running the
                account, forecasting, billing, and the features you ask
                for.
              </li>
              <li>
                <strong>Consent</strong>: location tracking for automatic
                mileage, push notifications, and marketing email. You can
                withdraw any of these at any time without losing the rest
                of the service.
              </li>
              <li>
                <strong>Legitimate interests</strong>: security, fraud
                prevention, debugging, and product improvement, balanced
                against your rights.
              </li>
              <li>
                <strong>Legal obligation</strong>: keeping billing and tax
                records we are required to keep.
              </li>
            </ul>
            <p>
              Where a company puts you on Taxottic, that company chooses
              the legal basis for monitoring you, not us. See{" "}
              <Link
                href="/legal/location-monitoring"
                className="underline hover:text-forest-900"
              >
                /legal/location-monitoring
              </Link>
              .
            </p>
          </Section>

          <Section title="Who else processes your data (subprocessors)">
            <p>
              We rely on a vetted list of vendors to operate Taxottic,
              including our hosting and database providers, our bank-data
              provider, our payments provider, our AI provider, Google Maps
              for mapping and geocoding, Apple and Google for push
              delivery, and our email provider. See the full list with
              roles and data residency at{" "}
              <Link
                href="/legal/subprocessors"
                className="underline hover:text-forest-900"
              >
                /legal/subprocessors
              </Link>
              . We update that page when we add or change a vendor.
            </p>
            <p>
              <strong>We do not sell your personal information</strong>, and
              we do not share it for cross-context behavioural advertising.
            </p>
          </Section>

          <Section title="Where your data lives, and international transfers">
            <p>
              Application data is stored in the United States (Supabase,
              Postgres, AWS us-east-1) and served via Vercel&apos;s global
              edge. Data is encrypted at rest and in transit (TLS 1.2+).
              Sensitive fields, specifically bank access tokens and
              taxpayer identification numbers, are additionally encrypted
              at the application layer with AES-256-GCM. Backups are
              encrypted and retained for 30 days.
            </p>
            <p>
              If you are in the UK or the EEA, using Taxottic means your
              data is transferred to and processed in the United States. We
              rely on the UK and EU Standard Contractual Clauses, or an
              equivalent approved mechanism, in our agreements with the
              vendors listed on the subprocessors page. Write to{" "}
              <a
                href="mailto:privacy@taxottic.com"
                className="underline hover:text-forest-900"
              >
                privacy@taxottic.com
              </a>{" "}
              if you need the transfer documentation for your own records.
            </p>
          </Section>

          <Section title="Your rights">
            <p>Wherever you live, you can ask us to:</p>
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>Access</strong> the personal data we hold about you.
              </li>
              <li>
                <strong>Correct</strong> data that is wrong or incomplete.
              </li>
              <li>
                <strong>Export</strong> your data in a portable format.
              </li>
              <li>
                <strong>Delete</strong> your account and associated personal
                data.
              </li>
              <li>
                <strong>Restrict</strong> certain processing.
              </li>
              <li>
                <strong>Object</strong> to processing where we rely on
                legitimate interests.
              </li>
              <li>
                <strong>Withdraw consent</strong> at any time where
                processing is based on consent, including turning off
                location tracking.
              </li>
            </ul>
            <p>
              California residents have additional rights under the CCPA
              and CPRA, including the right to know, delete, and correct,
              and the right to opt out of any &quot;sale&quot; or
              &quot;sharing&quot; of personal information. We do not sell
              or share personal information for cross-context behavioural
              advertising, and we do not use or disclose sensitive personal
              information beyond the purposes described here. Exercising
              your rights will never get you worse service or a worse
              price.
            </p>
            <p>
              EU and UK residents have rights under the GDPR and UK GDPR,
              including the right to lodge a complaint with a supervisory
              authority.
            </p>
            <p>
              To exercise any right, write to{" "}
              <a
                href="mailto:privacy@taxottic.com"
                className="underline hover:text-forest-900"
              >
                privacy@taxottic.com
              </a>
              . We respond within 30 days. If a company put you on
              Taxottic, we may need to route your request to that company,
              and we will tell you if we do.
            </p>
          </Section>

          <Section title="Retention" id="retention">
            <p>
              We retain your data while your account is active. When you
              delete your account, personal data is deleted within 30 days
              from production systems and within 90 days from encrypted
              backups. We may retain de-identified, aggregated data.
            </p>
            <p>
              <strong>Location data.</strong> Raw GPS fixes are deleted 30
              days after they are built into a trip, and a fix that never
              became a trip is closed out at 45 days and deleted 30 days
              after that. Device-health history is deleted after 30 days.
              Completed trips and their route lines have no automatic
              expiry and are kept until you delete them or the account is
              deleted.
            </p>
            <p>
              <strong>Companies and bank connections, 30-day recycle
              bin.</strong> When you close a company or disconnect a bank,
              the item moves to a per-user recycle bin at{" "}
              <Link
                href="/settings/recycle-bin"
                className="underline hover:text-forest-900"
              >
                /settings/recycle-bin
              </Link>
              . During the 30-day grace window you can restore it in one
              click or delete it immediately. After 30 days it is
              hard-deleted automatically, the company with all its income,
              expenses, and transactions, or the bank connection with its
              accounts and historical transactions. We do not keep a
              separate archive of deleted customers.
            </p>
            <p>
              <strong>Tax records.</strong> Reports and exports you have
              generated follow IRS retention guidance, typically 7 years
              from the relevant tax year. You may delete them earlier from
              the app. Billing records are kept as long as tax and
              accounting law requires.
            </p>
            <p>
              <strong>Chat and Bella conversations</strong> are kept until
              you delete them or the account is deleted.
            </p>
            <p>
              <strong>Firm activity log, 365-day rolling retention.</strong>{" "}
              Firms running on the Taxottic cockpit generate an event
              stream (document uploads, signature dispatches, invoice
              sends, notes added). Rows older than 365 days are deleted by
              a nightly job. The window covers a full tax cycle plus a
              buffer for amended returns. Tenants who need pre-retention
              rows for a specific investigation can ask{" "}
              <a
                href="mailto:trust@taxottic.com"
                className="underline hover:text-forest-900"
              >
                trust@taxottic.com
              </a>
              ; we can serve them from point-in-time recovery snapshots for
              up to seven additional days.
            </p>
            <p>
              <strong>Cross-tenant access log, indefinite retention.</strong>{" "}
              When a Taxottic support engineer accesses a tenant&apos;s
              data on the tenant&apos;s behalf, always recorded against the
              engineer&apos;s identity and never anonymised, the event is
              appended to an access log. These records are retained
              indefinitely and are visible to the account owner in the
              in-app audit log.
            </p>
            <p>
              You can always export everything we have on you first, at{" "}
              <Link
                href="/settings/data"
                className="underline hover:text-forest-900"
              >
                /settings/data
              </Link>
              . The download is a single JSON file including items
              currently in the recycle bin.
            </p>
          </Section>

          <Section title="Children">
            <p>
              Taxottic is for adults. You must be at least 18 to hold an
              account, and the service is not directed at children. We do
              not knowingly collect data from anyone under 16. If you
              believe a child has signed up, write to{" "}
              <a
                href="mailto:privacy@taxottic.com"
                className="underline hover:text-forest-900"
              >
                privacy@taxottic.com
              </a>{" "}
              and we will delete the account.
            </p>
          </Section>

          <Section title="Cookies">
            <p>
              We use a small number of cookies, all of them strictly
              necessary for sign-in, passkeys, and security. We do not set
              advertising or cross-site tracking cookies, and we do not
              load third-party tracking pixels. Details:{" "}
              <Link
                href="/legal/cookies"
                className="underline hover:text-forest-900"
              >
                /legal/cookies
              </Link>
              .
            </p>
          </Section>

          <Section title="Security">
            <p>
              Our security posture is summarised at{" "}
              <Link
                href="/legal/security"
                className="underline hover:text-forest-900"
              >
                /legal/security
              </Link>
              . If you believe you have found a vulnerability, please email{" "}
              <a
                href="mailto:security@taxottic.com"
                className="underline hover:text-forest-900"
              >
                security@taxottic.com
              </a>
              . We respond within 2 business days.
            </p>
          </Section>

          <Section title="Google API user-data policy">
            <p>
              When you sign in with Google, we receive your name, email
              address, and profile picture via the OpenID Connect{" "}
              <code className="text-[12px] bg-cream/70 border border-forest-100 rounded px-1">
                openid email profile
              </code>{" "}
              scopes. Taxottic&apos;s use and transfer of information
              received from Google APIs adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-forest-900"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. We do not sell
              Google user data, do not share it with third parties for
              advertising, and do not use it for any purpose other than
              authenticating your Taxottic session and personalising your
              account.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              We will tell you (in-app banner and email) when we make
              material changes. Routine updates are reflected by the
              &quot;Last updated&quot; date at the top of this page.
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
