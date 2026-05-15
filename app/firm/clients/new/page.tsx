import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { inviteClient } from "./actions";

// /firm/clients/new — invite a client to an engagement.
//
// One form. The server action sniffs the email and routes to either
// the direct-engagement path (existing Taxottic user) or the
// outreach path (prospect not yet on Taxottic). The firm doesn't
// have to know which is which.

export default async function NewClientPage() {
  const { user } = await requireUserWithAdmin();
  await requireFirmContext(); // gate to firm members only
  const taxYear = new Date().getUTCFullYear();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Onboard a client
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Bring a client into your firm.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          Type their email and we&apos;ll handle the rest. If
          they&apos;re already on Taxottic, we&apos;ll send them an
          engagement request inside the app. If they&apos;re not, we
          drop a pending outreach so they see your firm waiting when
          they sign up.
        </p>

        <form action={inviteClient} className="card p-5 sm:p-6 mt-6 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Client email
            </span>
            <input
              type="email"
              name="email"
              required
              placeholder="founder@theirbusiness.com"
              className="input"
              autoComplete="email"
            />
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Client name (optional)
              </span>
              <input
                type="text"
                name="full_name"
                placeholder="Riley Chen"
                className="input"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Business name (optional)
              </span>
              <input
                type="text"
                name="business_name"
                placeholder="Maple Lane Design Co."
                className="input"
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Engagement type
              </span>
              <select name="kind" className="input" defaultValue="tax_prep">
                <option value="tax_prep">Tax preparation</option>
                <option value="bookkeeping">Bookkeeping</option>
                <option value="advisory">Advisory</option>
                <option value="audit_support">Audit response</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Tax year
              </span>
              <input
                type="number"
                name="tax_year"
                min={2020}
                max={2100}
                defaultValue={taxYear}
                className="input tabular-nums"
              />
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Message to the client (optional)
            </span>
            <textarea
              name="message"
              rows={3}
              placeholder="Hi Riley — we'll handle your 2026 return. Use this link to share your books securely."
              className="input"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button type="submit" className="btn-primary text-sm">
              Send invitation
            </button>
            <Link href="/firm" className="btn-ghost text-sm">
              Cancel
            </Link>
          </div>
        </form>

        <p className="mt-6 text-[11px] text-ink-muted leading-relaxed max-w-xl">
          The engagement is created in a <em>pending</em> state until
          the client accepts on their side. Once active, your firm
          has read-only access to their books — income, expenses,
          bank feed, prior-year documents — and can post engagement
          letters, drafts, and invoices from the client&apos;s page.
        </p>
      </section>
    </main>
  );
}
