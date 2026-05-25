import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";

export const metadata = {
  title: "Your data - Taxottic",
  description:
    "Download a copy of everything Taxottic stores about you. JSON export, no signup required, no rate limit.",
  robots: { index: false, follow: false },
};

// /settings/data
//
// One-click "give me everything you have on me" page. Backend lives at
// /api/export/data and returns a single JSON file. This page is the
// human-facing wrapper: explains what's in the export, what's NOT in
// it (live access tokens, password hashes), and the 30-day retention
// promise tied to the recycle bin.
//
// We deliberately keep this on the consumer host (taxottic.com) and
// not behind the firm / HQ subdomains because GDPR's "right to data
// portability" applies to the human user, not to the admin role.

export default async function DataPage() {
  const { user } = await requireUser();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Profile
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Your data</h1>
        <p className="mt-2 text-sm text-ink-soft max-w-2xl leading-relaxed">
          A copy of everything Taxottic stores about you — companies,
          transactions, monthly entries, reminders, goals, badges, and
          feedback you&apos;ve sent us. JSON format, machine-readable,
          one file.
        </p>

        <section className="mt-6 card p-6 grid gap-3">
          <h2 className="display text-lg text-forest-900">
            Download my data
          </h2>
          <p className="text-sm text-ink-soft leading-relaxed">
            The export bundles every row across every company you&apos;re
            a member of, plus your user-scoped reminders / goals /
            badges / feedback. Items currently in the{" "}
            <Link
              href="/settings/recycle-bin"
              className="underline hover:text-forest-900"
            >
              recycle bin
            </Link>{" "}
            are included — the export is your full history, not just
            what&apos;s active today.
          </p>
          {/* Triggers the download endpoint. Browsers honor the
              Content-Disposition: attachment header and save to the
              user's Downloads folder. */}
          <p>
            <a
              href="/api/export/data"
              className="btn-primary inline-block"
              download
            >
              Download JSON
            </a>
          </p>
          <p className="text-[11px] text-ink-muted leading-relaxed">
            File size is bounded by your data — typically under a few
            MB. The download is private and not cached anywhere.
          </p>
        </section>

        <section className="mt-6 card p-6 grid gap-3">
          <h2 className="display text-lg text-forest-900">
            What&apos;s in the export
          </h2>
          <ul className="list-disc pl-5 grid gap-1.5 text-sm text-ink-soft">
            <li>Your profile (name, email, sign-up date, consent timestamps).</li>
            <li>
              Every company you manage or belong to, including its
              business profile, monthly income, monthly expenses, bank
              connections, accounts, and historical transactions.
            </li>
            <li>Reminders, goals, badges, and feedback submissions.</li>
            <li>
              Items in the recycle bin (with their <code>deleted_at</code>{" "}
              timestamps so a downstream importer can preserve grace-
              window state).
            </li>
          </ul>
        </section>

        <section className="mt-6 card p-6 grid gap-3">
          <h2 className="display text-lg text-forest-900">
            What&apos;s NOT in the export
          </h2>
          <ul className="list-disc pl-5 grid gap-1.5 text-sm text-ink-soft">
            <li>
              <strong>Bank-connection access tokens.</strong> Those are
              live credentials we hold with Plaid and Stripe on your
              behalf, not user data. Re-link the institution to get
              fresh tokens if you re-import.
            </li>
            <li>
              <strong>Your password / passkey credential.</strong>{" "}
              Supabase manages those; we never have plaintext.
            </li>
            <li>
              <strong>Internal operator tables</strong> (super-admin
              allowlist, audit logs, feature gates) — not yours.
            </li>
          </ul>
        </section>

        <section className="mt-6 card p-6 grid gap-3">
          <h2 className="display text-lg text-forest-900">
            What happens when you close a company or disconnect a bank
          </h2>
          <p className="text-sm text-ink-soft leading-relaxed">
            It goes to the recycle bin for <strong>30 days</strong>.
            During that window:
          </p>
          <ul className="list-disc pl-5 grid gap-1.5 text-sm text-ink-soft">
            <li>One-click <strong>Restore</strong> brings it back.</li>
            <li>
              One-click <strong>Permanently delete now</strong> skips
              the wait.
            </li>
            <li>
              The item is hidden from your dashboard, firm cockpit, and
              every other active view — only the recycle bin sees it.
            </li>
          </ul>
          <p className="text-sm text-ink-soft leading-relaxed">
            After 30 days, the recycle bin auto-purges: rows hard-delete
            from the database, cascading to every dependent record. We
            don&apos;t keep deleted-customer archives; once it&apos;s
            gone, it&apos;s gone.
          </p>
          <p>
            <Link
              href="/settings/recycle-bin"
              className="btn-ghost inline-block"
            >
              Open recycle bin
            </Link>
          </p>
        </section>

        <p className="mt-8 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
          Need data we don&apos;t expose here, or a different format?
          Email{" "}
          <a
            href="mailto:privacy@taxottic.com"
            className="underline hover:text-forest-900"
          >
            privacy@taxottic.com
          </a>{" "}
          — we honor GDPR / CCPA / CPRA data-subject requests under the
          terms in{" "}
          <Link
            href="/legal/privacy"
            className="underline hover:text-forest-900"
          >
            our privacy policy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
