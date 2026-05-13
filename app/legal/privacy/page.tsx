import Link from "next/link";

export const metadata = { title: "Privacy - Taxottic" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Privacy Policy
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Your data, in plain English.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Effective: 2026-05-04 · Last updated: 2026-05-04
        </p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <Section title="Who we are">
            <p>
              Taxottic is a tax forecasting and deduction-tracking service
              operated by <strong>Techno Optics LLC</strong>, a Massachusetts
              limited liability company (&quot;we&quot;, &quot;us&quot;,
              &quot;Taxottic&quot;). Contact:{" "}
              <a href="mailto:contact@taxottic.com" className="underline hover:text-forest-900">
                contact@taxottic.com
              </a>
              .
            </p>
            <p>
              For data-protection inquiries (GDPR / CCPA requests, deletion,
              portability):{" "}
              <a href="mailto:privacy@taxottic.com" className="underline hover:text-forest-900">
                privacy@taxottic.com
              </a>
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
                <strong>Account info</strong> from sign-in: email, full name,
                profile photo (when supplied by Google or Microsoft). Used
                for authentication and to greet you.
              </li>
              <li>
                <strong>Tax profile</strong> you enter: filing status, state,
                dependents, business profile fields. Used to run forecasts.
              </li>
              <li>
                <strong>Income and expense entries</strong> you log or import.
                Used to calculate your federal + state tax estimate, surface
                deductions, and produce reports you ask for (Schedule C export).
              </li>
              <li>
                <strong>Bank connection metadata</strong> if you connect a
                bank via Plaid: the institution name, last-four account mask,
                and per-transaction merchant + amount + date. We do not see
                your bank login. See &quot;Bank connections&quot; below.
              </li>
              <li>
                <strong>Bella conversations</strong>: messages you send to
                our in-app guide. Used to generate replies and improve
                Bella&apos;s answers.
              </li>
              <li>
                <strong>Operational data</strong>: timestamps, IP address (at
                request time, not stored long-term), browser user-agent, and
                usage events necessary for security, debugging, and billing.
              </li>
            </ul>
          </Section>

          <Section title="Bank connections (Plaid)">
            <p>
              When you connect a bank account through Plaid, your bank
              credentials are entered into Plaid&apos;s secure interface and
              never reach Taxottic servers. Plaid returns an access token
              and the transaction stream we display.
            </p>
            <p>
              Plaid&apos;s privacy practices are documented at{" "}
              <a
                href="https://plaid.com/legal/#consumers"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-forest-900"
              >
                plaid.com/legal
              </a>
              . You can disconnect a bank at any time from{" "}
              <em>Banks &raquo; Disconnect</em>; we then revoke the access
              token and stop syncing.
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
                To improve the product, in aggregated and de-identified form.
              </li>
              <li>
                To comply with law, respond to lawful requests, and protect
                our rights.
              </li>
            </ul>
            <p>
              We do not use your data to train any third party&apos;s general
              AI model. Bella&apos;s replies are generated by Anthropic on
              your behalf for your session and are not retained by Anthropic
              for training (per our Anthropic enterprise agreement).
            </p>
          </Section>

          <Section title="Who else processes your data (subprocessors)">
            <p>
              We rely on a short list of vetted vendors to operate Taxottic.
              See the full list with their roles and data residency at{" "}
              <Link href="/legal/subprocessors" className="underline hover:text-forest-900">
                /legal/subprocessors
              </Link>
              . We update that page when we add or change a vendor.
            </p>
          </Section>

          <Section title="Where your data lives">
            <p>
              Application data is stored in the United States (Supabase,
              Postgres, AWS us-east-1) and served via Vercel&apos;s global
              edge. Data is encrypted at rest (AES-256) and in transit
              (TLS 1.2+). Backups are encrypted and retained for 30 days.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              Wherever you live, you can ask us to:
            </p>
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>Access</strong> the personal data we hold about you.
              </li>
              <li>
                <strong>Correct</strong> data that is wrong or incomplete.
              </li>
              <li>
                <strong>Export</strong> your data in a portable format (CSV
                + JSON).
              </li>
              <li>
                <strong>Delete</strong> your account and all associated
                personal data.
              </li>
              <li>
                <strong>Restrict</strong> certain processing (e.g. opt out
                of analytics).
              </li>
              <li>
                <strong>Object</strong> to processing where we rely on
                legitimate interests.
              </li>
              <li>
                <strong>Withdraw consent</strong> at any time where
                processing is based on consent.
              </li>
            </ul>
            <p>
              California residents have additional rights under the CCPA /
              CPRA, including the right to know, the right to delete, the
              right to correct, and the right to opt out of any
              &quot;sale&quot; or &quot;sharing&quot; of personal
              information. <strong>We do not sell or share personal
              information for cross-context behavioural advertising.</strong>
            </p>
            <p>
              EU / UK residents have rights under the GDPR / UK GDPR. The
              legal bases we rely on are: performance of a contract
              (operating the service you signed up for), legitimate
              interests (security, fraud prevention, product improvement),
              and consent (marketing emails, optional cookies).
            </p>
            <p>
              To exercise any right, write to{" "}
              <a href="mailto:privacy@taxottic.com" className="underline hover:text-forest-900">
                privacy@taxottic.com
              </a>
              . We respond within 30 days. You can also lodge a complaint
              with your local data protection authority.
            </p>
          </Section>

          <Section title="Retention">
            <p>
              We retain your data while your account is active. When you
              delete your account, personal data is deleted within 30 days
              from production systems and within 90 days from encrypted
              backups. We may retain de-identified, aggregated data for
              analytics indefinitely.
            </p>
            <p>
              Tax-related records you ask us to keep (Schedule C exports
              you have generated) follow IRS retention guidance: typically
              7 years from the relevant tax year. You may delete them
              earlier from the app.
            </p>
            <p>
              <strong>Companies and bank connections — 30-day recycle
              bin.</strong> When you close a company or disconnect a
              bank, the item is moved to a per-user recycle bin at{" "}
              <Link
                href="/settings/recycle-bin"
                className="underline hover:text-forest-900"
              >
                /settings/recycle-bin
              </Link>
              . During the 30-day grace window you can restore it in one
              click or permanently delete it now. After 30 days, the
              item is hard-deleted automatically — the company (with all
              its income, expenses, and transactions) or the bank
              connection (with its accounts and historical transactions)
              is removed from the database. Encrypted backups age out
              of retention on the schedule above. We do not keep a
              separate &ldquo;deleted customer&rdquo; archive.
            </p>
            <p>
              You can always export everything we have on you first,
              before deleting, at{" "}
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
              Taxottic is not directed at children under 16. We do not
              knowingly collect data from children. If you believe a child
              has signed up, write to{" "}
              <a href="mailto:privacy@taxottic.com" className="underline hover:text-forest-900">
                privacy@taxottic.com
              </a>{" "}
              and we will delete the account.
            </p>
          </Section>

          <Section title="Cookies">
            <p>
              We use a small number of cookies, all of them strictly
              necessary for sign-in and session continuity. We do not set
              advertising or cross-site tracking cookies. Details:{" "}
              <Link href="/legal/cookies" className="underline hover:text-forest-900">
                /legal/cookies
              </Link>
              .
            </p>
          </Section>

          <Section title="Security">
            <p>
              Our security posture is summarised at{" "}
              <Link href="/legal/security" className="underline hover:text-forest-900">
                /legal/security
              </Link>
              . If you believe you have found a vulnerability, please
              email{" "}
              <a href="mailto:security@taxottic.com" className="underline hover:text-forest-900">
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
              We will tell you (in-app banner + email) when we make material
              changes. Routine updates are reflected by the &quot;Last
              updated&quot; date at the top of this page.
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
