import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { submitFirmAccessRequest } from "./actions";

export const metadata = {
  title: "Request a Taxottic firm account",
  description:
    "Apply for a Taxottic Enterprise account. We'll provision your firm's subdomain within one business day.",
  alternates: { canonical: "/firms/request-account" },
};

// /firms/request-account — public form. Submits a row into
// firm_access_requests. A super-admin reviews on /admin/firms and
// either approves (mints the firm + subdomain + owner invitation)
// or rejects with a note.
//
// Page is intentionally narrow: one column, short form, no
// distractions. The pre-launch state of Taxottic Enterprise means
// most visits here come from a deliberate referral; treat the form
// as a serious application, not a casual sign-up.

type SearchParams = Promise<{ ok?: string }>;

export default async function RequestAccountPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const submitted = sp.ok === "1";

  return (
    <main id="main" className="min-h-screen flex items-start justify-center px-4 sm:px-6 py-12">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <Wordmark size="lg" />
          <div className="mt-3 text-[10px] uppercase tracking-[0.32em] text-gold-700">
            Enterprise · Account request
          </div>
        </div>

        {submitted ? <SuccessPanel /> : <RequestForm />}

        <p className="mt-6 text-[11px] leading-relaxed text-ink-muted text-center max-w-md mx-auto">
          Already have an account?{" "}
          <Link
            href="https://enterprise.taxottic.com"
            className="underline hover:text-forest-800"
          >
            Sign in at enterprise.taxottic.com
          </Link>
          .
        </p>
      </div>
    </main>
  );
}

function RequestForm() {
  return (
    <div className="card p-6 sm:p-7">
      <h1 className="display text-2xl text-forest-900 leading-tight">
        Tell us about your firm.
      </h1>
      <p className="mt-3 text-sm text-ink-soft leading-relaxed">
        Taxottic Enterprise is in pilot with a small group of firms.
        Fill out the short form and a member of our team will
        provision your subdomain (<code>yourfirm.taxottic.com</code>)
        within one business day.
      </p>

      <form
        action={submitFirmAccessRequest}
        className="mt-6 grid gap-4"
      >
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">
            Firm name
          </span>
          <input
            type="text"
            name="firm_name"
            required
            maxLength={120}
            placeholder="Smith & Allen CPA"
            className="input"
          />
        </label>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Your name
            </span>
            <input
              type="text"
              name="contact_full_name"
              required
              maxLength={120}
              placeholder="Riley Smith"
              className="input"
              autoComplete="name"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Work email
            </span>
            <input
              type="email"
              name="contact_email"
              required
              maxLength={200}
              placeholder="riley@smithallen.com"
              className="input"
              autoComplete="email"
            />
          </label>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Phone (optional)
            </span>
            <input
              type="tel"
              name="contact_phone"
              maxLength={40}
              placeholder="+1 555 555 0100"
              className="input"
              autoComplete="tel"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Firm size
            </span>
            <select
              name="firm_size"
              className="input"
              defaultValue=""
            >
              <option value="">Select…</option>
              <option value="solo">Just me</option>
              <option value="2-5">2 – 5 preparers</option>
              <option value="6-15">6 – 15 preparers</option>
              <option value="16-50">16 – 50 preparers</option>
              <option value="50+">50+ preparers</option>
            </select>
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">
            Anything you want us to know? (optional)
          </span>
          <textarea
            name="message"
            rows={4}
            maxLength={1000}
            placeholder="We're switching from QBO Accountant. ~40 clients on Schedule C. Would love to see the workflow before committing."
            className="input"
          />
        </label>

        <input type="hidden" name="source" value="request-account" />

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button type="submit" className="btn-primary text-sm">
            Submit application
          </button>
          <Link
            href="https://taxottic.com/"
            className="text-xs text-ink-muted hover:text-forest-800"
          >
            ← Back to the consumer app
          </Link>
        </div>
      </form>

      <p className="mt-6 text-[11px] text-ink-muted leading-relaxed">
        We approve applications individually so we can hand-walk each
        firm through onboarding. You&apos;ll hear from us within one
        business day; if you have a tight deadline,{" "}
        <Link
          href="https://taxottic.com/book?for=firm"
          className="underline hover:text-forest-800"
        >
          book a 20-minute demo
        </Link>{" "}
        instead.
      </p>
    </div>
  );
}

function SuccessPanel() {
  return (
    <div className="card p-7 text-center">
      <div className="text-3xl">✓</div>
      <h1 className="display mt-3 text-2xl text-forest-900">
        Application received.
      </h1>
      <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-md mx-auto">
        A member of our team will review your application and provision
        your firm&apos;s subdomain within one business day. Watch your
        inbox for the welcome email — it will include the sign-in
        link for your firm&apos;s portal.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="https://taxottic.com/book?for=firm"
          className="btn-ghost text-sm"
        >
          Book a 20-minute demo
        </Link>
        <Link
          href="https://taxottic.com/"
          className="btn-ghost text-sm"
        >
          Back to taxottic.com
        </Link>
      </div>
    </div>
  );
}
