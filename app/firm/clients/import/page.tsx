import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { bulkInviteClients } from "./actions";
import { CsvImportPreview } from "@/components/firm/CsvImportPreview";

// /firm/clients/import, bulk CSV onboarding.
//
// One page. The firm pastes a CSV (or types up to 200 rows) and
// hits Import. The action loops through every row, sniffs each
// email, routes to the right path (existing-user engagement or
// outreach), sends a branded invitation email per row, and
// redirects to /firm/outreach with a summary query string.
//
// We deliberately use a textarea instead of a file picker for the
// first cut. Reasons:
//   1. Files in Server Actions need <form encType="multipart/...">
//      which Next handles, but bringing in client-side parsing for
//      the preview adds complexity we don't need yet.
//   2. Most accountants migrating from another CRM already have
//      the CSV open in Numbers / Excel and can copy-paste in 2s.
// Adding the file picker later is a one-line input + a small
// client-side reader; planned for Phase 3 follow-up if anyone
// asks.

export default async function BulkImportPage() {
  const { user } = await requireUserWithAdmin();
  await requireFirmContext();
  const taxYear = new Date().getUTCFullYear();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Bulk import
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Onboard a year of clients in one paste.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-2xl">
          Drop in a CSV with one client per row. We&apos;ll send each
          one a branded invitation, route existing Taxottic users
          straight to the engagement, and queue brand-new prospects
          for the convert-on-signup pipeline. Up to 200 rows per
          batch.
        </p>

        <div className="card mt-6 p-5">
          <h2 className="display text-base text-forest-900">
            Accepted columns
          </h2>
          <p className="mt-2 text-xs text-ink-soft leading-relaxed">
            First row is the header. Column names are case-insensitive
            and tolerate spaces / underscores. Only{" "}
            <code className="bg-cream/70 border border-forest-100 rounded px-1">
              email
            </code>{" "}
            is required.
          </p>
          <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-soft">
            <Column name="email" required />
            <Column name="full_name" />
            <Column name="business_name" />
            <Column name="kind" hint="tax_prep, bookkeeping, advisory, audit_support" />
            <Column name="tax_year" hint="defaults to the batch year" />
            <Column name="message" hint="freeform note included in the email" />
          </div>
          <div className="mt-4 rounded-md bg-cream-100 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
            Example header:{" "}
            <code className="font-mono">email,full_name,business_name,kind</code>
          </div>
        </div>

        <form action={bulkInviteClients} className="card p-5 sm:p-6 mt-6 grid gap-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Default engagement type
              </span>
              <select
                name="default_kind"
                className="input"
                defaultValue="tax_prep"
              >
                <option value="tax_prep">Tax preparation</option>
                <option value="bookkeeping">Bookkeeping</option>
                <option value="advisory">Advisory</option>
                <option value="audit_support">Audit response</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Default tax year
              </span>
              <input
                type="number"
                name="default_tax_year"
                min={2020}
                max={2100}
                defaultValue={taxYear}
                className="input tabular-nums"
              />
            </label>
          </div>

          <CsvImportPreview defaultKind="tax_prep" />

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button type="submit" className="btn-primary text-sm">
              Send invitations
            </button>
            <Link href="/firm/clients/new" className="btn-ghost text-sm">
              ← Single client instead
            </Link>
          </div>
        </form>

        <p className="mt-6 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
          Each row triggers a separate email. We dedupe within the
          batch (a duplicate email keeps the last row&apos;s data).
          You can re-send a pending invitation or cancel it from{" "}
          <Link
            href="/firm/outreach"
            className="underline hover:text-forest-800"
          >
            Outreach
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

function Column({
  name,
  required,
  hint,
}: {
  name: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <code className="font-mono text-forest-800">{name}</code>
      {required ? (
        <span className="ml-1 text-[10px] uppercase tracking-[0.15em] text-amber-700">
          required
        </span>
      ) : null}
      {hint ? <span className="text-ink-muted">, {hint}</span> : null}
    </div>
  );
}
