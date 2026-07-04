import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = {
  title: "W-9 received, Taxottic",
  robots: { index: false, follow: false },
};

export default function W9ThankYouPage() {
  return (
    <main id="main" className="min-h-screen bg-cream-100 flex items-start justify-center px-4 sm:px-6 py-10">
      <div className="w-full max-w-xl">
        <div className="text-center mb-6">
          <Wordmark size="md" />
        </div>
        <div className="card p-8 text-center">
          <div className="text-3xl">✓</div>
          <h1 className="display mt-3 text-2xl text-forest-900">
            W-9 received.
          </h1>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-md mx-auto">
            Your firm will review the form. You can close this tab -
            no further action required. If they need anything else,
            they&apos;ll reach out directly.
          </p>
          <Link
            href="https://taxottic.com/"
            className="mt-6 inline-block text-xs text-ink-muted hover:text-forest-800"
          >
            What is Taxottic? →
          </Link>
        </div>
      </div>
    </main>
  );
}
