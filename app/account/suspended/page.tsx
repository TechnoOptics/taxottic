import { Wordmark } from "@/components/Wordmark";

export default function SuspendedPage() {
  return (
    <main className="min-h-screen grid place-items-center px-6 py-12">
      <div className="max-w-md w-full text-center">
        <div className="mb-6">
          <Wordmark size="lg" />
        </div>
        <div className="card p-6 sm:p-8">
          <div className="text-xs uppercase tracking-[0.2em] text-red-700">
            Account suspended
          </div>
          <h1 className="display mt-2 text-2xl text-forest-900">
            Your access has been paused.
          </h1>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed">
            A Taxottic admin has temporarily suspended this account. If you
            believe this is a mistake, reach out to{" "}
            <a
              href="mailto:contact@taxottic.com"
              className="underline hover:text-forest-900"
            >
              contact@taxottic.com
            </a>
            . We&apos;ll respond within one business day.
          </p>
          <p className="mt-3 text-xs text-ink-muted">
            Your data is preserved while the account is suspended; nothing
            has been deleted.
          </p>
        </div>
      </div>
    </main>
  );
}
