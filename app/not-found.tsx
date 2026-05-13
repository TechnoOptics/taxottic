import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

/**
 * Custom 404 page. Replaces the default unstyled Next.js "This page
 * could not be found." with something that fits the rest of the
 * visual language (cream background, gold-flourish, forest accents)
 * and offers obvious paths back into the app.
 *
 * Kept as a pure server component (no client interactivity) so it
 * remains cheap to serve and indexable correctly with a 404 status.
 * Routes that legitimately need a 404 should call notFound() from
 * next/navigation, which renders this file.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg text-center">
        <div className="mb-8">
          <Wordmark size="lg" />
        </div>
        <div className="card p-8 sm:p-10">
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            404
          </div>
          <h1 className="display mt-2 text-3xl text-forest-900">
            That page is taking a personal day.
          </h1>
          <div aria-hidden="true" className="gold-flourish mt-4 mx-auto">
            <span />
          </div>
          <p className="mt-4 text-sm text-ink-soft leading-relaxed">
            We couldn&apos;t find what you were looking for. The link may be
            broken, or the page may have moved — either way, we&apos;ll get
            you back on track.
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Link href="/" className="btn-ghost">
              Marketing site
            </Link>
            <Link href="/dashboard" className="btn-primary">
              Your dashboard
            </Link>
          </div>
          <p className="mt-5 text-[11px] text-ink-muted">
            Still stuck?{" "}
            <Link
              href="/book"
              className="underline hover:text-forest-900"
            >
              Talk to us.
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
