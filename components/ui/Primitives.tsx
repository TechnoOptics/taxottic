import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared visual primitives ported from Techottic's `src/components/ui.tsx`.
 *
 * Taxottic had exactly one shared display component (`components/PageHeader`);
 * stat tiles, section headings, empty states and status badges were hand-rolled
 * on every page, which is how they drifted. These are the four Techottic leans
 * on everywhere, rebuilt on Taxottic's semantic surface tokens.
 *
 * See docs/design-system-from-techottic.md sections 5.3 and 5.4 for the
 * extracted source values.
 *
 * Server components by design: none of these hold state, so pages can render
 * them without pulling a client boundary.
 *
 * Note on colour: every one of these renders through `currentColor` or a CSS
 * custom property, never a literal hex. That matters on the authenticated
 * pages, which are dark: raw SVG hex is not remapped by the theme and would
 * render invisible there.
 */

/* -------------------------------------------------------------------------
   Status pill
   ------------------------------------------------------------------------- */

/**
 * Semantic tones. Techottic keeps status colour out of the token layer and in
 * a map next to the component that renders it, so the palette stays legible
 * as a list. Each hue is fed to the `.pill` class as `--pill` and the class
 * derives text (100%), background (10%) and border (25%) from it, so a pill
 * needs no dark-mode variant.
 *
 * The hues below are the Tailwind -400/-500 steps Taxottic already uses for
 * these meanings elsewhere, so nothing shifts semantically.
 */
export const PILL_TONES = {
  neutral: "#94a3b8",
  positive: "#34d399",
  warning: "#fbbf24",
  critical: "#ef4444",
  info: "#38bdf8",
  accent: "#d5bb7e",
} as const;

export type PillTone = keyof typeof PILL_TONES;

/**
 * Rounded-full status badge with an optional leading dot.
 *
 * <StatusPill tone="positive" dot>Reconciled</StatusPill>
 */
export function StatusPill({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: PillTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className="pill"
      style={{ ["--pill" as string]: PILL_TONES[tone] }}
    >
      {dot ? <span className="pill-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/**
 * Dense rounded-md code badge, no dot, heavier weight. For short codes and
 * counts where a full pill would be too loud.
 */
export function CodePill({
  tone = "neutral",
  children,
}: {
  tone?: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className="pill-code"
      style={{ ["--pill" as string]: PILL_TONES[tone] }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
   Stat card
   ------------------------------------------------------------------------- */

/**
 * Muted small-caps label, large number, small muted sub. Techottic's
 * signature 12 / 30 / 12 stack.
 *
 * `tone` picks the number's colour from the same semantic map the pills use,
 * so a negative balance and a "critical" badge agree on what red means.
 * Wraps in a Link when `href` is passed, exactly as Techottic's does.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = "accent",
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: PillTone;
  href?: string;
}) {
  const inner = (
    <div className="card card-hover h-full p-4">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: PILL_TONES[tone] }}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/* -------------------------------------------------------------------------
   Section title
   ------------------------------------------------------------------------- */

/**
 * Heading above a group of cards, with an optional right-aligned action.
 * Deliberately muted and uppercase rather than a serif display heading:
 * this labels a group, it does not title the page. Page titles keep
 * `components/PageHeader`.
 */
export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Empty state
   ------------------------------------------------------------------------- */

/**
 * Default empty-state mark: a clean stroke outline, sized and weighted to
 * match the app's other icons (24 viewBox, 1.6 stroke). Callers can pass
 * their own `icon` for something more specific.
 */
function EmptyMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-8"
    >
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </svg>
  );
}

/**
 * Card, 40px padding, centred. Icon at 60% muted, medium title, small muted
 * sub, optional action below.
 */
export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="text-muted/60">{icon ?? <EmptyMark />}</div>
      <div className="font-medium">{title}</div>
      {sub ? <div className="text-sm text-muted">{sub}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
