import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

/**
 * Splash page shown to unauthenticated visitors at the root of
 * `enterprise.taxottic.com`. Added in response to the May 2026 weekly
 * audit's Critical #4, the subdomain was either 404'ing or silently
 * redirecting to the consumer dashboard, which read as "Taxottic
 * sells enterprise but doesn't have it." The actual console for
 * super-admins / firm operators lives at /admin/firms inside this
 * same Next.js app; the middleware routes signed-in users straight
 * there and only sends anonymous visitors to this page.
 *
 * The splash is intentionally short and signposted: explain what
 * Enterprise is, surface Sign In + Book a Demo + Back to consumer
 * site. Nothing else. We are not selling features here that don't
 * exist yet (the Enterprise product is still being built); the page
 * is to make the subdomain feel deliberate, not abandoned.
 */
export const metadata = {
  title: "Taxottic Enterprise, Sign in or talk to us",
  description:
    "The Taxottic Enterprise console for accounting firms and operations teams managing multiple client books. Sign in to your firm account or book a 20-minute demo.",
  alternates: { canonical: "/" },
  robots: {
    index: false,
    follow: false,
  },
};

export default function EnterpriseWelcomePage() {
  return (
    <main id="main" className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <Wordmark size="lg" />
          <div className="mt-3 text-[10px] uppercase tracking-[0.32em] text-gold-700">
            Enterprise console
          </div>
        </div>

        <div className="card p-5 sm:p-7">
          <h1 className="display text-2xl text-forest-900 leading-tight">
            For accounting firms and operations teams.
          </h1>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed">
            Taxottic Enterprise gives firms a single console to manage
            books for multiple client companies, with shared
            categorisation, year-end exports, and a CPA-facing summary
            for every entity you steward. If you already have an
            Enterprise account, sign in below.
          </p>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed">
            Don&apos;t have one yet? It&apos;s in active build with a small
            group of partner firms. Book a 20-minute demo and we&apos;ll
            add you to the pilot list.
          </p>

          <div className="mt-6 grid gap-3">
            <Link href="/login" className="btn-primary w-full text-center">
              Sign in
            </Link>
            <Link
              href="https://taxottic.com/book?for=firm"
              className="btn-ghost w-full text-center"
            >
              Book a 20-minute demo
            </Link>
          </div>

          <div className="mt-6 pt-5 border-t border-forest-100 text-center">
            <Link
              href="https://taxottic.com/"
              className="text-xs text-ink-muted hover:text-forest-800"
            >
              ← Back to taxottic.com (consumer app)
            </Link>
          </div>
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-ink-muted text-center max-w-md mx-auto">
          Looking for the consumer app? Visit{" "}
          <Link href="https://taxottic.com/" className="underline">
            taxottic.com
          </Link>{" "}
          or the super-admin cockpit at{" "}
          <span className="text-ink-muted">hq.taxottic.com</span>.
        </p>
      </div>
    </main>
  );
}
