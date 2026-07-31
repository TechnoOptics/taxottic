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
 *   <eyebrow>          .kicker-sm (11px, 0.2em, uppercase, gold)
 *   Serif title        .display, text-2xl -> sm:text-3xl
 *   Optional subtitle  text-muted, max-w-2xl
 *   Optional action    right-aligned, baseline with the title block
 *
 * July 2026, Techottic alignment (docs/design-system-from-techottic.md
 * sections 2.4 and 9). Three changes, all aimed at the same thing: page
 * headers were taking up far more vertical space and visual weight than
 * the content under them.
 *
 *   1. Title drops a step, 3xl/4xl -> 2xl/3xl. Techottic's page titles are
 *      24px; Taxottic was running 30/36px, so every screen opened with a
 *      headline nearly twice the size of anything it introduced. The serif
 *      `.display` face stays: that is the brand, not a system detail.
 *   2. `flourish` now defaults to OFF. The tapered gold ornament reads as
 *      decoration on a data screen. Pages that genuinely want it (marketing,
 *      the year-end export cover) can still pass `flourish`.
 *   3. Colours come from the semantic tokens (`text-foreground`,
 *      `text-muted`) rather than `text-forest-900` / `text-ink-soft`, so the
 *      header theme-flips through the token swap instead of through the
 *      `!important` dark-mode overrides in globals.css.
 *
 * `action` is new and matches Techottic's header, which is a
 * `flex items-end justify-between` row so a primary button sits on the
 * title's baseline instead of on its own line below.
 *
 * `eyebrow` is a ReactNode so callers can pass a plain string OR a
 * breadcrumb with links (e.g. Mileage, then Business trips). Pass `logo`
 * (e.g. a <CompanyLogo/>) for the company-branded screens (Forecast,
 * Deduction explorer); it sits to the left of the eyebrow/title block so
 * those headers keep their identity while still sharing this one primitive.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  flourish = false,
  logo,
  action,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  flourish?: boolean;
  logo?: ReactNode;
  action?: ReactNode;
}) {
  const body = (
    <div className="min-w-0">
      <div className="kicker-sm">{eyebrow}</div>
      <h1 className="display mt-1.5 text-2xl sm:text-3xl text-foreground leading-tight">
        {title}
      </h1>
      {subtitle ? (
        <p className="mt-1.5 text-sm text-muted max-w-2xl leading-relaxed">
          {subtitle}
        </p>
      ) : null}
      {flourish ? (
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>
      ) : null}
    </div>
  );

  const lead = logo ? (
    <div className="flex items-center gap-4 min-w-0">
      <div className="shrink-0">{logo}</div>
      {body}
    </div>
  ) : (
    body
  );

  if (action) {
    return (
      <header className="flex flex-wrap items-end justify-between gap-3">
        {lead}
        {action}
      </header>
    );
  }
  return <header>{lead}</header>;
}
