import type { ReactNode } from "react";

/**
 * The one page-header primitive for content screens.
 *
 * Before this, every screen hand-rolled its own header and they drifted:
 * the gold eyebrow was `text-[10px] tracking-[0.32em]` on some pages,
 * `text-xs tracking-[0.2em]` on others, `.kicker-sm` on the dashboard;
 * the serif title jumped between text-3xl and 3xl/4xl; and the tapered
 * gold flourish appeared on some pages but not others. This component is
 * the single source of truth so they all match:
 *
 *   <eyebrow>            ← .kicker-sm (11px, 0.2em, uppercase, gold)
 *   Big serif title      ← .display, text-3xl → sm:text-4xl
 *   Optional subtitle     ← ink-soft, max-w-2xl
 *   ▸ gold flourish       ← the tapered champagne rule
 *
 * `eyebrow` is a ReactNode so callers can pass a plain string OR a
 * breadcrumb with links (e.g. Mileage → Business trips). Flourish is on
 * by default; pass `flourish={false}` to drop it.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  flourish = true,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  flourish?: boolean;
}) {
  return (
    <header>
      <div className="kicker-sm">{eyebrow}</div>
      <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
        {title}
      </h1>
      {subtitle ? (
        <p className="mt-2 text-sm text-ink-soft max-w-2xl leading-relaxed">
          {subtitle}
        </p>
      ) : null}
      {flourish ? (
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>
      ) : null}
    </header>
  );
}
