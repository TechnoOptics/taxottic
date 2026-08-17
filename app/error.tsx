"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Top-level Next.js error boundary.
 *
 * Without this file, an uncaught throw in a server component, page
 * data fetch, or server action renders Next's default crash page
 *, which the user reports as "the app crashed saying the page
 * could not load." That page has no branding, no recovery
 * affordances, and looks like the app died.
 *
 * This component:
 *   1. Surfaces the error message in plain English.
 *   2. Gives the user three obvious next moves (reset, dashboard, contact).
 *   3. Console-logs the digest so we can correlate with Vercel runtime
 *      logs when the user tells us what they hit.
 *
 * Per Next.js convention this file MUST be a Client Component (the
 * `reset` callback is a function ref, can't cross the RSC boundary).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort log, Sentry / Vercel will also catch the throw.
    console.error("[error.tsx]", error.digest, error.message);
  }, [error]);

  return (
    <main
      id="main"
      // Page ground, so it has to track the skin: `bg-cream/40` is baked to a
      // literal #fbf7e9 by `@theme inline` and cast the whole error screen warm
      // over the cool paper ground.
      className="min-h-screen grid place-items-center px-4 py-10 bg-[var(--color-cream)]/40"
    >
      <div className="card p-6 sm:p-8 max-w-lg w-full">
        <div className="text-xs uppercase tracking-[0.22em] text-gold-700">
          Something went wrong
        </div>
        <h1 className="display mt-2 text-2xl text-forest-900">
          We couldn&apos;t load that page
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed">
          The server hit an error before the page finished rendering.
          Your data is safe, only this view is affected.
        </p>

        {error?.message ? (
          <pre className="mt-3 text-[11px] text-ink-muted bg-cream/60 border border-forest-100 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        ) : null}
        {error?.digest ? (
          <p className="mt-2 text-[10px] text-ink-muted font-mono">
            ref: {error.digest}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
          <Link
            href="/dashboard"
            className="btn-ghost text-sm text-center"
          >
            Go to dashboard
          </Link>
          <button
            type="button"
            onClick={() => reset()}
            className="btn-primary text-sm"
          >
            Try again
          </button>
        </div>

        <p className="mt-4 text-[11px] text-ink-muted leading-relaxed">
          If this keeps happening, send us the reference id above -{" "}
          <a
            href="mailto:hello@taxottic.com"
            className="underline underline-offset-2 hover:text-forest-900"
          >
            hello@taxottic.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
