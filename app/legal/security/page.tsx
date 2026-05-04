import Link from "next/link";

export const metadata = { title: "Security - Taxottic" };

export default function SecurityPage() {
  return (
    <main className="min-h-screen">
      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Security
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          How we protect your data.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Effective: 2026-05-04 · Last updated: 2026-05-04 · Questions:{" "}
          <a href="mailto:security@taxottic.com" className="underline hover:text-forest-900">
            security@taxottic.com
          </a>
        </p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <Section title="Encryption">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>In transit.</strong> TLS 1.2+ on every endpoint.
                HTTPS-only cookies. HSTS preload.
              </li>
              <li>
                <strong>At rest.</strong> Postgres data is AES-256
                encrypted at the disk layer (Supabase / AWS managed).
                Backups are encrypted with separate keys.
              </li>
              <li>
                <strong>Secrets.</strong> Application secrets are stored
                in Vercel encrypted env, scoped per environment, never
                in source.
              </li>
            </ul>
          </Section>

          <Section title="Authentication">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>Passkeys (WebAuthn).</strong> Biometric sign-in
                using the device&apos;s Face ID, Touch ID, Windows Hello,
                or Android fingerprint. Resident-key required so the
                credential is discoverable without typing email.
              </li>
              <li>
                <strong>SSO</strong> via Google and Microsoft for
                everyone, with OAuth client IDs registered to Taxottic
                (no third-party trust beyond what you already have with
                those providers).
              </li>
              <li>
                <strong>Magic links</strong> as a backup. Single-use,
                short-lived, signed.
              </li>
              <li>
                <strong>Sessions</strong> stored as HttpOnly, Secure,
                SameSite=Lax cookies. Refresh tokens rotate on use.
              </li>
            </ul>
          </Section>

          <Section title="Access control">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>Row-level security (RLS)</strong> is enabled on
                every table that holds user data. A user can only read
                or modify rows they own (or rows the company they belong
                to owns, scoped by role).
              </li>
              <li>
                <strong>Least privilege</strong> service-role keys are
                used only for narrow server actions where RLS would
                otherwise prevent legitimate writes (e.g. inserting an
                inquiry from the public booking form).
              </li>
              <li>
                <strong>Multi-company isolation.</strong> Firms see only
                clients they have an active engagement with. Engagement
                state is checked on every query, not cached client-side.
              </li>
            </ul>
          </Section>

          <Section title="Bank connections (Plaid)">
            <p>
              Bank credentials are entered into Plaid&apos;s secure UI
              and never reach Taxottic servers. We receive an access
              token plus the transaction stream. Tokens are stored in a
              separate <code className="text-[12px] bg-cream/70 border border-forest-100 rounded px-1">
                bank_connection_secrets
              </code>{" "}
              table with restricted RLS. We do not store bank passwords,
              MFA codes, or account / routing numbers.
            </p>
            <p>
              You can disconnect a bank from <em>Banks &raquo;
              Disconnect</em> at any time. We then revoke the Plaid
              token and stop syncing.
            </p>
          </Section>

          <Section title="Network and platform">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                Hosted on Vercel (US edge), database on Supabase
                (Postgres 17, AWS us-east-1).
              </li>
              <li>
                Strict Content-Security-Policy and security headers
                (HSTS, X-Frame-Options, Referrer-Policy, Permissions-
                Policy, X-Content-Type-Options) on every response.
              </li>
              <li>
                Service worker caches static assets only; HTML and API
                are network-first so revoked auth always takes effect.
              </li>
            </ul>
          </Section>

          <Section title="Vulnerability handling">
            <p>
              We monitor dependencies daily and patch critical
              vulnerabilities within 7 days, high within 30 days.
            </p>
            <p>
              <strong>Reporting.</strong> If you find a vulnerability,
              please email{" "}
              <a href="mailto:security@taxottic.com" className="underline hover:text-forest-900">
                security@taxottic.com
              </a>
              . We acknowledge within 2 business days, fix critical
              issues within 7 days, and will credit researchers (with
              permission) once a fix has shipped.
            </p>
            <p>
              Please act in good faith: no DDoS, social engineering, or
              tests against accounts you don&apos;t own.
            </p>
          </Section>

          <Section title="Incident response">
            <p>
              If we discover a security incident affecting your data,
              we will notify affected users within 72 hours, share what
              we know, what we are doing, and what (if anything) you
              should do. We will follow up with a post-mortem once the
              incident is resolved.
            </p>
          </Section>

          <Section title="Compliance posture">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                Built to align with <strong>SOC 2 Type II</strong>{" "}
                controls; formal audit in progress.
              </li>
              <li>
                <strong>GDPR / UK GDPR</strong> rights are honoured for
                EU / UK users. See{" "}
                <Link href="/legal/privacy" className="underline hover:text-forest-900">
                  Privacy Policy
                </Link>
                .
              </li>
              <li>
                <strong>CCPA / CPRA</strong> for California residents.
                We do not sell personal information.
              </li>
              <li>
                Plaid is the only entity that touches bank credentials;
                Plaid is SOC 2 Type II certified and ISO 27001:2013
                certified.
              </li>
            </ul>
          </Section>

          <Section title="Subprocessors">
            <p>
              See{" "}
              <Link href="/legal/subprocessors" className="underline hover:text-forest-900">
                /legal/subprocessors
              </Link>{" "}
              for the full list of vendors that process customer data
              on our behalf, plus their roles, regions, and certifications.
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
