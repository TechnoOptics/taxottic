import Link from "next/link";

type Props = {
  /** What's behind the gate; appears in the headline. */
  feature: string;
  /** One-line pitch for why this feature is Pro. */
  pitch: string;
  /** What they get on Pro - rendered as a small bullet list. */
  perks?: string[];
  /** Used to thread context into the upgrade redirect so /billing
   *  can know what the user was trying to do. */
  reason?: string;
};

/**
 * Drop-in paywall card. Server component (no client interactivity).
 * Renders a tasteful upgrade prompt instead of the actual feature
 * page. Used inside the /banks, /chat, /preparer, /manage,
 * /import tabs when the active plan doesn't grant the feature.
 */
export function ProGate({ feature, pitch, perks, reason }: Props) {
  const href = reason
    ? `/billing?reason=${encodeURIComponent(reason)}`
    : "/billing";
  return (
    <section className="card p-7 sm:p-9 border-gold-300/60 mt-6">
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Pro feature
      </div>
      <h2 className="display mt-1 text-2xl sm:text-3xl text-forest-900">
        {feature} is part of Taxottic Pro.
      </h2>
      <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
        {pitch}
      </p>
      {perks && perks.length > 0 ? (
        <ul className="mt-4 grid gap-1.5 max-w-xl">
          {perks.map((p) => (
            <li
              key={p}
              className="flex items-start gap-2 text-sm text-ink-soft leading-relaxed"
            >
              <span className="mt-1 inline-block size-1.5 rounded-full bg-gold-500 shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-6 flex items-center gap-2 flex-wrap">
        <Link href={href} className="btn-primary text-sm">
          See Pro plans
        </Link>
        <Link
          href="/dashboard"
          className="text-sm text-ink-soft hover:text-forest-900"
        >
          Back to dashboard
        </Link>
      </div>
      <p className="mt-5 text-[11px] text-ink-muted">
        Free plan covers forecasting, manual income/expense entry, sales
        tax tracking, year-end CPA export, and one company. Pro unlocks
        the rest.
      </p>
    </section>
  );
}
