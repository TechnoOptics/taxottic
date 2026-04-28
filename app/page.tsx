import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/Wordmark";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="min-h-screen">
      <header className="header-glow-line relative">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Wordmark />
          <Link href="/login" className="text-sm text-forest-800 hover:text-forest-600">
            Sign in
          </Link>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 pt-16 sm:pt-24 pb-20">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Tax forecasting, refined
        </div>
        <h1 className="display mt-5 text-5xl sm:text-6xl lg:text-7xl text-forest-900 max-w-3xl">
          Forecast your taxes.{" "}
          <span className="gold-shine">Maximize your deductions.</span>
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-ink-soft max-w-2xl leading-relaxed">
          Built for individuals and small businesses. Bella, our in-app guide,
          helps you find every deduction you have earned and stay calmly ahead
          of what you owe.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/login" className="btn-primary">
            Get started
          </Link>
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
        </div>

        <div className="mt-20 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Feature
            kicker="Plan"
            title="Forecast what you owe"
            body="Live federal and state brackets. Monthly income and expense tracking with a quarterly view."
          />
          <Feature
            kicker="Capture"
            title="Every deduction earned"
            body="Auto-categorize bank and card statements. Bella explains why each deduction qualifies."
          />
          <Feature
            kicker="Stay ready"
            title="Goals + reminders"
            body="Set aside what is owed before it is gone. Reminders shaped to your business cadence."
          />
        </div>

        <p className="mt-16 text-xs text-ink-muted max-w-md">
          Taxottic provides tax forecasting and educational guidance. It is not
          a substitute for advice from a licensed CPA or tax attorney.
        </p>
      </section>
    </main>
  );
}

function Feature({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string;
}) {
  return (
    <div className="card card-hover p-5">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
        {kicker}
      </div>
      <h3 className="display mt-2 text-xl text-forest-900">{title}</h3>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">{body}</p>
    </div>
  );
}
